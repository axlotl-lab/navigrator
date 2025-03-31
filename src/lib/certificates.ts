import { exec, execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as forge from 'node-forge';
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
  private hasMkcert: boolean;

  constructor(certsDir?: string) {
    this.certsDir = certsDir || path.join(os.homedir(), '.navigrator', 'certs');
    this.hasMkcert = this.checkMkcertInstalled();
  }

  /**
   * Initialize the certificate directory
   */
  public async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.certsDir, { recursive: true });

      if (this.hasMkcert) {
        await this.initMkcert();
      }
    } catch (error: any) {
      console.error('Error initializing certificate manager:', error);
      throw new Error(`Failed to initialize certificate manager: ${error?.message}`);
    }
  }

  /**
   * Verify if mkcert is installed on the system
   */
  private checkMkcertInstalled(): boolean {
    try {
      execSync('mkcert -version', { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Initialize mkcert (create local CA)
   */
  private async initMkcert(): Promise<void> {
    try {
      await execAsync('mkcert -install');
    } catch (error: any) {
      console.error('Error initializing mkcert:', error);
      throw new Error(`Failed to initialize mkcert: ${error?.message}`);
    }
  }

  /**
   * Create a certificate for a domain using mkcert if available,
   * or node-forge if not
   */
  public async createCertificate(domain: string): Promise<CertificateInfo> {
    if (this.hasMkcert) {
      return await this.createCertificateWithMkcert(domain);
    } else {
      return await this.createCertificateWithForge(domain);
    }
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

      // Verify permissions
      try {
        await fs.access(certPath);
        await fs.access(keyPath);
      } catch (error) {
        return null; // If the certs cannot be accessed, there is no valid certificate
      }

      const certPem = await fs.readFile(certPath, 'utf-8');

      const cert = forge.pki.certificateFromPem(certPem);
      const validFrom = new Date(cert.validity.notBefore);
      const validTo = new Date(cert.validity.notAfter);

      // Verify if the certificate is within the validity period
      const now = new Date();
      const isValid = now >= validFrom && now <= validTo;

      // Verify if the domain is included in the certificate
      const altNames = this.getSubjectAltNames(cert);
      const domainIncluded = altNames.includes(domain) ||
        cert.subject.getField('CN')?.value === domain;

      const issuerCN = cert.issuer.getField('CN')?.value || 'Unknown';

      return {
        domain,
        validFrom,
        validTo,
        issuer: issuerCN,
        isValid: isValid && domainIncluded,
        certFilePath: certPath,
        keyFilePath: keyPath
      };
    } catch (error) {
      console.error(`Error verifying certificate for ${domain}:`, error);
      return null;
    }
  }

  /**
   * Get the subject alternative names of the certificate
   */
  private getSubjectAltNames(cert: forge.pki.Certificate): string[] {
    try {
      const altNames: string[] = [];
      const extensions = cert.extensions || [];

      for (const ext of extensions) {
        if (ext.name === 'subjectAltName') {
          const altName = ext.altNames || [];
          for (const name of altName) {
            if (name.type === 2) { // DNS
              altNames.push(name.value);
            }
          }
        }
      }

      return altNames;
    } catch (error) {
      console.error('Error getting subject alternative names:', error);
      return [];
    }
  }

  /**
   * Create a certificate using mkcert
   */
  private async createCertificateWithMkcert(domain: string): Promise<CertificateInfo> {
    try {
      const certPath = path.join(this.certsDir, `${domain}.crt`);
      const keyPath = path.join(this.certsDir, `${domain}.key`);
      const command = `mkcert -cert-file "${certPath}" -key-file "${keyPath}" "${domain}"`;
    
      await execAsync(command);

      const certInfo = await this.verifyCertificate(domain);
     
      if (!certInfo) {
        throw new Error(`Failed to create certificate for ${domain}`);
      }

      return certInfo;
    } catch (error: any) {
      console.error(`Error creating certificate for ${domain} with mkcert:`, error);
      throw new Error(`Failed to create certificate with mkcert: ${error?.message}`);
    }
  }

  /**
   * Create a certificate using node-forge
   */
  private async createCertificateWithForge(domain: string): Promise<CertificateInfo> {
    try {
      const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const cert = forge.pki.createCertificate();

      cert.publicKey = keys.publicKey;
      cert.serialNumber = '01' + this.randomHex(16);

      // Set validity (1 year)
      const now = new Date();
      cert.validity.notBefore = now;
      cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      const attrs = [
        { name: 'commonName', value: domain },
        { name: 'organizationName', value: 'Axlotl Lab Navigrator' },
        { name: 'organizationalUnitName', value: 'Development' }
      ];
      cert.setSubject(attrs);
      cert.setIssuer(attrs);

      cert.setExtensions([
        {
          name: 'basicConstraints',
          cA: false
        },
        {
          name: 'keyUsage',
          digitalSignature: true,
          keyEncipherment: true
        },
        {
          name: 'extKeyUsage',
          serverAuth: true
        },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: domain } // Type 2 for DNS
          ]
        }
      ]);

      cert.sign(keys.privateKey, forge.md.sha256.create());

      const certPem = forge.pki.certificateToPem(cert);
      const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
      const certPath = path.join(this.certsDir, `${domain}.crt`);
      const keyPath = path.join(this.certsDir, `${domain}.key`);

      await fs.writeFile(certPath, certPem);
      await fs.writeFile(keyPath, keyPem);

      return {
        domain,
        validFrom: cert.validity.notBefore,
        validTo: cert.validity.notAfter,
        issuer: 'Axlotl Lab Navigrator',
        isValid: true,
        certFilePath: certPath,
        keyFilePath: keyPath
      };
    } catch (error: any) {
      console.error(`Error creating certificate for ${domain} with node-forge:`, error);
      throw new Error(`Failed to create certificate with node-forge: ${error?.message}`);
    }
  }

  /**
   * Genera una cadena hexadecimal aleatoria
   */
  private randomHex(length: number): string {
    const bytes = forge.random.getBytesSync(length);
    return forge.util.bytesToHex(bytes);
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