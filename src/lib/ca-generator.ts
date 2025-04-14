import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CAGenerator {
  private certsDir: string;
  private caDir: string;
  private caKeyPath: string;
  private caCertPath: string;

  constructor(certsDir?: string) {
    this.certsDir = certsDir || path.join(os.homedir(), '.navigrator', 'certs');
    this.caDir = path.join(this.certsDir, 'ca');
    this.caKeyPath = path.join(this.caDir, 'rootCA.key');
    this.caCertPath = path.join(this.caDir, 'rootCA.crt');
  }

  /**
   * Check if OpenSSL is installed on the system
   */
  public async checkOpenSSLInstalled(): Promise<boolean> {
    try {
      await execAsync('openssl version');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Initialize the certificate directory
   */
  public async initialize(): Promise<void> {
    try {
      // Create required directories
      await fs.mkdir(this.certsDir, { recursive: true });
      await fs.mkdir(this.caDir, { recursive: true });
    } catch (error: any) {
      console.error('Error creating certificate directories:', error);
      throw new Error(`Failed to create certificate directories: ${error?.message}`);
    }
  }

  /**
   * Check if the CA certificate exists
   */
  public async checkCAExists(): Promise<boolean> {
    try {
      await fs.access(this.caKeyPath);
      await fs.access(this.caCertPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate a local CA to sign certificates
   */
  public async generateCA(): Promise<{ keyPath: string; certPath: string }> {
    try {
      // Check if CA already exists
      const caExists = await this.checkCAExists();
      if (caExists) {
        return { keyPath: this.caKeyPath, certPath: this.caCertPath };
      }

      // Create private key for the CA
      await execAsync(`openssl genrsa -out "${this.caKeyPath}" 4096`);

      // Create certificate for the CA (valid for 10 years)
      await execAsync(
        `openssl req -x509 -new -nodes -key "${this.caKeyPath}" -sha256 -days 3650 ` +
        `-out "${this.caCertPath}" -subj "/CN=Navigrator Local CA/O=Axlotl Lab/OU=Development"`
      );

      return { keyPath: this.caKeyPath, certPath: this.caCertPath };
    } catch (error: any) {
      console.error('Error generating CA certificate:', error);
      throw new Error(`Failed to generate CA certificate: ${error?.message}`);
    }
  }

  /**
   * Get the paths to the CA files
   */
  public getCAPaths(): { keyPath: string; certPath: string } {
    return { keyPath: this.caKeyPath, certPath: this.caCertPath };
  }
}