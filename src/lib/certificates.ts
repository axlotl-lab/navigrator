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
    // Directorio donde se guardarán los certificados
    this.certsDir = certsDir || path.join(os.homedir(), '.navigrator', 'certs');
    // Verificar si mkcert está instalado
    this.hasMkcert = this.checkMkcertInstalled();
  }

  /**
   * Inicializa el directorio de certificados
   */
  public async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.certsDir, { recursive: true });

      // Si mkcert está disponible, inicializarlo
      if (this.hasMkcert) {
        await this.initMkcert();
      }
    } catch (error: any) {
      console.error('Error initializing certificate manager:', error);
      throw new Error(`Failed to initialize certificate manager: ${error?.message}`);
    }
  }

  /**
   * Verifica si mkcert está instalado en el sistema
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
   * Inicializa mkcert (crear CA local)
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
   * Crea un certificado para un dominio usando mkcert si está disponible,
   * o node-forge si no lo está
   */
  public async createCertificate(domain: string): Promise<CertificateInfo> {
    if (this.hasMkcert) {
      return await this.createCertificateWithMkcert(domain);
    } else {
      return await this.createCertificateWithForge(domain);
    }
  }

  /**
   * Elimina un certificado para un dominio
   */
  public async deleteCertificate(domain: string): Promise<boolean> {
    try {
      // Verificar si el certificado existe
      const certInfo = await this.verifyCertificate(domain);
      
      // Si no existe, no hay nada que eliminar
      if (!certInfo || !certInfo.certFilePath || !certInfo.keyFilePath) {
        return false;
      }
      
      // Eliminar archivos
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
   * Verifica si existe un certificado válido para el dominio
   */
  public async verifyCertificate(domain: string): Promise<CertificateInfo | null> {
    try {
      const certPath = path.join(this.certsDir, `${domain}.crt`);
      const keyPath = path.join(this.certsDir, `${domain}.key`);

      // Verificar si los archivos existen
      try {
        await fs.access(certPath);
        await fs.access(keyPath);
      } catch (error) {
        return null; // Si no existen, no hay certificado válido
      }

      // Leer certificado
      const certPem = await fs.readFile(certPath, 'utf-8');

      // Parsear certificado para obtener información
      const cert = forge.pki.certificateFromPem(certPem);

      // Obtener fechas de validez
      const validFrom = new Date(cert.validity.notBefore);
      const validTo = new Date(cert.validity.notAfter);

      // Verificar si está dentro del período de validez
      const now = new Date();
      const isValid = now >= validFrom && now <= validTo;

      // Verificar si el dominio está incluido en el certificado
      const altNames = this.getSubjectAltNames(cert);
      const domainIncluded = altNames.includes(domain) ||
        cert.subject.getField('CN')?.value === domain;

      // Obtener información del emisor
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
   * Obtiene los nombres alternativos del certificado
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
   * Crea un certificado usando mkcert
   */
  private async createCertificateWithMkcert(domain: string): Promise<CertificateInfo> {
    try {
      const certPath = path.join(this.certsDir, `${domain}.crt`);
      const keyPath = path.join(this.certsDir, `${domain}.key`);

      // Crear certificado con mkcert
      const command = `mkcert -cert-file "${certPath}" -key-file "${keyPath}" "${domain}"`;
      await execAsync(command);

      // Verificar que se creó el certificado
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
   * Crea un certificado usando node-forge
   */
  private async createCertificateWithForge(domain: string): Promise<CertificateInfo> {
    try {
      // Generar par de claves
      const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });

      // Crear certificado
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = '01' + this.randomHex(16);

      // Establecer validez (1 año)
      const now = new Date();
      cert.validity.notBefore = now;
      cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      // Establecer atributos del sujeto y emisor
      const attrs = [
        { name: 'commonName', value: domain },
        { name: 'organizationName', value: 'Axlotl Lab Navigrator' },
        { name: 'organizationalUnitName', value: 'Development' }
      ];
      cert.setSubject(attrs);
      cert.setIssuer(attrs);

      // Agregar extensiones
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
            { type: 2, value: domain } // Tipo 2 para DNS
          ]
        }
      ]);

      // Firmar certificado
      cert.sign(keys.privateKey, forge.md.sha256.create());

      // Convertir a PEM
      const certPem = forge.pki.certificateToPem(cert);
      const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

      // Guardar archivos
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
   * Lista todos los certificados creados por la aplicación
   */
  public async listCertificates(): Promise<CertificateInfo[]> {
    try {
      const files = await fs.readdir(this.certsDir);

      // Filtrar archivos de certificado (.crt)
      const certFiles = files.filter(file => file.endsWith('.crt'));

      // Procesar cada certificado
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