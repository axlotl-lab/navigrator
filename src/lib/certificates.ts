import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CertificateInfo {
  domain: string;
  validFrom: Date;
  validTo: Date;
  issuer: string;
  isValid: boolean;
  certFilePath?: string;
  keyFilePath?: string;
}

export class CertificateManager {
  private certsDir: string;
  private caDir: string;
  private hasOpenSSL: boolean;

  constructor(certsDir?: string) {
    this.certsDir = certsDir || path.join(os.homedir(), '.navigrator', 'certs');
    this.caDir = path.join(this.certsDir, 'ca');
    this.hasOpenSSL = false; // Will be validated in initialize()
  }

  /**
   * Check if OpenSSL is installed on the system
   */
  private async checkOpenSSLInstalled(): Promise<boolean> {
    try {
      await execAsync('openssl version');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Initialize the certificate directory and validate OpenSSL
   */
  public async initialize(): Promise<void> {
    try {
      // Verify OpenSSL
      this.hasOpenSSL = await this.checkOpenSSLInstalled();
      if (!this.hasOpenSSL) {
        throw new Error('OpenSSL is not installed. Please install OpenSSL to continue.');
      }

      // Create required directories
      await fs.mkdir(this.certsDir, { recursive: true });
      await fs.mkdir(this.caDir, { recursive: true });

      // Create local CA if it doesn't exist
      await this.initLocalCA();

    } catch (error: any) {
      console.error('Error initializing certificate manager:', error);
      throw new Error(`Failed to initialize certificate manager: ${error?.message}`);
    }
  }

  /**
   * Initialize a local CA to sign certificates
   */
  private async initLocalCA(): Promise<void> {
    const caKeyPath = path.join(this.caDir, 'rootCA.key');
    const caCertPath = path.join(this.caDir, 'rootCA.crt');

    // Check if CA already exists
    try {
      await fs.access(caKeyPath);
      await fs.access(caCertPath);
      return; // CA already exists
    } catch (error) {
      // Doesn't exist, need to create it
    }

    // Create private key for the CA
    await execAsync(`openssl genrsa -out "${caKeyPath}" 4096`);

    // Create certificate for the CA (valid for 10 years)
    await execAsync(
      `openssl req -x509 -new -nodes -key "${caKeyPath}" -sha256 -days 3650 ` +
      `-out "${caCertPath}" -subj "/CN=Navigrator Local CA/O=Axlotl Lab/OU=Development"`
    );

    console.log('Local CA created successfully');
  }

  /**
   * Create a certificate for a domain using OpenSSL
   */
  public async createCertificate(domain: string): Promise<CertificateInfo> {
    if (!this.hasOpenSSL) {
      throw new Error('OpenSSL is not available');
    }

    try {
      const keyPath = path.join(this.certsDir, `${domain}.key`);
      const csrPath = path.join(this.certsDir, `${domain}.csr`);
      const certPath = path.join(this.certsDir, `${domain}.crt`);
      const configPath = path.join(this.certsDir, `${domain}.cnf`);

      // Create configuration file for the certificate
      const configContent = this.generateOpenSSLConfig(domain);
      await fs.writeFile(configPath, configContent);

      // Generate private key for the domain
      await execAsync(`openssl genrsa -out "${keyPath}" 2048`);

      // Create CSR (Certificate Signing Request)
      await execAsync(
        `openssl req -new -key "${keyPath}" -out "${csrPath}" ` +
        `-config "${configPath}" -subj "/CN=${domain}/O=Axlotl Lab/OU=Development"`
      );

      // Sign the certificate with our CA
      const caKeyPath = path.join(this.caDir, 'rootCA.key');
      const caCertPath = path.join(this.caDir, 'rootCA.crt');

      await execAsync(
        `openssl x509 -req -in "${csrPath}" -CA "${caCertPath}" ` +
        `-CAkey "${caKeyPath}" -CAcreateserial ` +
        `-out "${certPath}" -days 365 -sha256 ` +
        `-extensions v3_req -extfile "${configPath}"`
      );

      // Remove temporary files
      await fs.unlink(csrPath);
      await fs.unlink(configPath);

      // Verify the created certificate
      const certInfo = await this.parseCertificate(domain);
      if (!certInfo) {
        throw new Error(`Failed to verify certificate for ${domain} after creation`);
      }
      return certInfo;

    } catch (error: any) {
      console.error(`Error creating certificate for ${domain}:`, error);
      throw new Error(`Failed to create certificate: ${error?.message}`);
    }
  }

  /**
   * Generate an OpenSSL configuration file for the certificate
   */
  private generateOpenSSLConfig(domain: string): string {
    return `[req]
default_bits = 2048
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ${domain}
O = Axlotl Lab
OU = Development

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${domain}
`;
  }

  /**
   * Delete a certificate for a domain
   */
  public async deleteCertificate(domain: string): Promise<boolean> {
    try {
      const certInfo = await this.verifyCertificate(domain);

      if (!certInfo || !certInfo.certFilePath || !certInfo.keyFilePath) {
        return false;
      }

      try {
        await fs.unlink(certInfo.certFilePath);
        await fs.unlink(certInfo.keyFilePath);
        return true;
      } catch (error) {
        console.error(`Error deleting certificate files for ${domain}:`, error);
        return false;
      }
    } catch (error) {
      console.error(`Error deleting certificate for ${domain}:`, error);
      return false;
    }
  }

  /**
   * Verify if a valid certificate exists for the domain
   */
  public async verifyCertificate(domain: string): Promise<CertificateInfo | null> {
    try {
      const certPath = path.join(this.certsDir, `${domain}.crt`);
      const keyPath = path.join(this.certsDir, `${domain}.key`);

      // Check if files exist
      try {
        await fs.access(certPath);
        await fs.access(keyPath);
      } catch (error) {
        return null; // If certificates don't exist, there is no valid certificate
      }

      return await this.parseCertificate(domain);
    } catch (error) {
      console.error(`Error verifying certificate for ${domain}:`, error);
      return null;
    }
  }

  /**
   * Parse an existing certificate to get its information
   */
  private async parseCertificate(domain: string): Promise<CertificateInfo | null> {
    try {
      const certPath = path.join(this.certsDir, `${domain}.crt`);
      const keyPath = path.join(this.certsDir, `${domain}.key`);

      // Verify that the certificate exists
      try {
        await fs.access(certPath);
        await fs.access(keyPath);
      } catch (error) {
        return null;
      }

      // Validate certificate dates
      const { stdout: dates } = await execAsync(
        `openssl x509 -in "${certPath}" -noout -dates`
      );

      // Parse dates (format: notBefore=May 30 12:00:00 2023 GMT / notAfter=May 30 12:00:00 2024 GMT)
      const notBeforeMatch = dates.match(/notBefore=(.+)$/m);
      const notAfterMatch = dates.match(/notAfter=(.+)$/m);

      if (!notBeforeMatch || !notAfterMatch) {
        throw new Error('Could not extract dates from certificate');
      }

      const validFrom = new Date(notBeforeMatch[1]);
      const validTo = new Date(notAfterMatch[1]);

      // Get issuer name
      const { stdout: issuerData } = await execAsync(
        `openssl x509 -in "${certPath}" -noout -issuer`
      );

      // Extract CN from issuer
      const issuerCNMatch = issuerData.match(/CN\s*=\s*([^,\/]+)/);
      const issuer = issuerCNMatch ? issuerCNMatch[1].trim() : 'Unknown';

      // Verify that the domain is included in the certificate
      const { stdout: subjectAltNames } = await execAsync(
        `openssl x509 -in "${certPath}" -noout -ext subjectAltName`
      );

      const domainIncluded = subjectAltNames.includes(`DNS:${domain}`);

      // Verify certificate validity
      const now = new Date();
      const isValid = now >= validFrom && now <= validTo && domainIncluded;

      return {
        domain,
        validFrom,
        validTo,
        issuer,
        isValid,
        certFilePath: certPath,
        keyFilePath: keyPath
      };
    } catch (error: any) {
      console.error(`Error parsing certificate for ${domain}:`, error);
      return null;
    }
  }

  /**
   * List all certificates created by the application
   */
  public async listCertificates(): Promise<CertificateInfo[]> {
    try {
      const files = await fs.readdir(this.certsDir);
      const certFiles = files.filter(file => file.endsWith('.crt'));
      const certificates: CertificateInfo[] = [];

      for (const certFile of certFiles) {
        const domain = certFile.replace('.crt', '');
        const certInfo = await this.verifyCertificate(domain);

        if (certInfo) {
          certificates.push(certInfo);
        }
      }

      return certificates;
    } catch (error) {
      console.error('Error listing certificates:', error);
      return [];
    }
  }
}