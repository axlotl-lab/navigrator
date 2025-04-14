import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { CAGenerator } from './ca-generator';

const execAsync = promisify(exec);

export class CAInstaller {
  private caPath: string;
  private caKeyPath: string;
  private caGenerator: CAGenerator;

  constructor(certsDir?: string) {
    const rootDir = certsDir || path.join(os.homedir(), '.navigrator', 'certs');
    const caDir = path.join(rootDir, 'ca');
    this.caPath = path.join(caDir, 'rootCA.crt');
    this.caKeyPath = path.join(caDir, 'rootCA.key');
    this.caGenerator = new CAGenerator(rootDir);
  }

  /**
   * Check if the CA certificate exists
   */
  public async checkCAExists(): Promise<boolean> {
    try {
      await fs.promises.access(this.caPath);
      await fs.promises.access(this.caKeyPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate and install the CA certificate
   */
  public async generateAndInstallCA(): Promise<{ success: boolean; message: string }> {
    try {
      // First check if OpenSSL is installed
      const hasOpenSSL = await this.caGenerator.checkOpenSSLInstalled();
      if (!hasOpenSSL) {
        return {
          success: false,
          message: 'OpenSSL is not installed or not available in the PATH. Please install OpenSSL to continue.'
        };
      }

      // Initialize directories
      await this.caGenerator.initialize();

      // Generate the CA if it doesn't exist
      await this.caGenerator.generateCA();

      // Install the CA
      return await this.installCA();
    } catch (error: any) {
      return {
        success: false,
        message: `Error generating and installing CA: ${error?.message}`
      };
    }
  }

  /**
   * Install the CA certificate based on the platform
   */
  public async installCA(): Promise<{ success: boolean; message: string }> {
    // First check if the CA exists
    const caExists = await this.checkCAExists();
    if (!caExists) {
      return {
        success: false,
        message: 'CA certificate not found. Please run "navigrator init-ca" first to generate it.'
      };
    }

    const platform = os.platform();

    try {
      if (platform === 'win32') {
        return await this.installOnWindows();
      } else if (platform === 'darwin') {
        return await this.installOnMacOS();
      } else if (platform === 'linux') {
        return await this.installOnLinux();
      } else {
        return {
          success: false,
          message: `Unsupported platform: ${platform}. Please install the CA manually.`
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Error installing CA: ${error?.message}`
      };
    }
  }

  /**
   * Install CA on Windows using certutil
   */
  private async installOnWindows(): Promise<{ success: boolean; message: string }> {
    try {
      // Check if certutil is available
      await execAsync('certutil -?');

      // Install the certificate to the Trusted Root CA store
      await execAsync(`certutil -addstore -f "ROOT" "${this.caPath}"`);

      return {
        success: true,
        message: 'CA certificate has been installed in the Windows Trusted Root CA store.'
      };
    } catch (error: any) {
      if (error?.message?.includes('Access is denied')) {
        return {
          success: false,
          message: 'Administrator privileges required. Please run the command as administrator.'
        };
      }
      throw error;
    }
  }

  /**
   * Install CA on macOS using the security command
   */
  private async installOnMacOS(): Promise<{ success: boolean; message: string }> {
    try {
      // Add to system keychain
      await execAsync(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${this.caPath}"`);

      // Also add to Firefox if installed (Firefox uses its own certificate store)
      await this.installOnFirefox();

      return {
        success: true,
        message: 'CA certificate has been installed in the macOS System Keychain. You may need to restart browsers for changes to take effect.'
      };
    } catch (error: any) {
      if (error?.message?.includes('password')) {
        return {
          success: false,
          message: 'Sudo privileges required. Please run with sudo: sudo navigrator install-ca'
        };
      }
      throw error;
    }
  }

  /**
   * Install CA on Linux
   */
  private async installOnLinux(): Promise<{ success: boolean; message: string }> {
    try {
      // Try to determine the distribution type
      const hasApt = await this.commandExists('apt');
      const hasYum = await this.commandExists('yum');
      const hasDnf = await this.commandExists('dnf');
      const hasUpdateCACerts = await this.commandExists('update-ca-certificates');
      const hasUpdateCATrust = await this.commandExists('update-ca-trust');

      if (hasApt || hasUpdateCACerts) {
        // Debian/Ubuntu style
        await execAsync(`sudo cp "${this.caPath}" /usr/local/share/ca-certificates/navigrator-root-ca.crt`);
        await execAsync('sudo update-ca-certificates');
      } else if (hasYum || hasDnf || hasUpdateCATrust) {
        // RHEL/Fedora style
        await execAsync(`sudo cp "${this.caPath}" /etc/pki/ca-trust/source/anchors/navigrator-root-ca.crt`);
        await execAsync('sudo update-ca-trust');
      } else {
        return {
          success: false,
          message: 'Could not determine Linux distribution. Please install the CA certificate manually.'
        };
      }

      // Also add to Firefox if installed
      await this.installOnFirefox();

      // Chrome on Linux typically uses the system store so no additional steps needed

      return {
        success: true,
        message: 'CA certificate has been installed in the system certificate store. You may need to restart browsers for changes to take effect.'
      };
    } catch (error: any) {
      if (error?.message?.includes('sudo') || error?.message?.includes('permission')) {
        return {
          success: false,
          message: 'Sudo privileges required. Please run with sudo: sudo navigrator install-ca'
        };
      }
      throw error;
    }
  }

  /**
   * Install CA in Firefox (all platforms)
   * This is a complex process as Firefox uses its own certificate store
   */
  private async installOnFirefox(): Promise<void> {
    try {
      // Check if Firefox is installed
      let firefoxPath = '';

      const platform = os.platform();
      if (platform === 'win32') {
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

        const possiblePaths = [
          path.join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
          path.join(programFilesX86, 'Mozilla Firefox', 'firefox.exe')
        ];

        for (const p of possiblePaths) {
          try {
            await fs.promises.access(p);
            firefoxPath = p;
            break;
          } catch (e) {
            // Path doesn't exist
          }
        }
      } else if (platform === 'darwin') {
        const possiblePaths = [
          '/Applications/Firefox.app/Contents/MacOS/firefox'
        ];

        for (const p of possiblePaths) {
          try {
            await fs.promises.access(p);
            firefoxPath = p;
            break;
          } catch (e) {
            // Path doesn't exist
          }
        }
      } else if (platform === 'linux') {
        // Check if Firefox is in PATH
        try {
          await execAsync('which firefox');
          firefoxPath = 'firefox';
        } catch (e) {
          // Firefox not in PATH
        }
      }

      if (!firefoxPath) {
        // Firefox not found or not supported on this platform
        return;
      }

      // Firefox installation detected, but we won't attempt to modify its cert store
      // as it's complex and requires restarting Firefox or creating a new profile
      console.log(
        'Firefox detected. Please import the CA certificate manually in Firefox:\n' +
        '1. Open Firefox and go to Settings/Preferences\n' +
        '2. Search for "certificates" and click "View Certificates"\n' +
        '3. Go to the "Authorities" tab and click "Import"\n' +
        `4. Select the certificate file at: ${this.caPath}\n` +
        '5. Check "Trust this CA to identify websites" and click OK'
      );
    } catch (error) {
      // Ignore errors with Firefox detection/installation
      console.log('Note: Could not detect Firefox installation.');
    }
  }

  /**
   * Check if a command exists in the PATH
   */
  private async commandExists(command: string): Promise<boolean> {
    try {
      const platform = os.platform();
      if (platform === 'win32') {
        await execAsync(`where ${command}`);
      } else {
        await execAsync(`which ${command}`);
      }
      return true;
    } catch (error) {
      return false;
    }
  }
}