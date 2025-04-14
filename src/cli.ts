#!/usr/bin/env node

import chalk from 'chalk';
import { exec } from 'child_process';
import { Command } from 'commander';
import figlet from 'figlet';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import packageJson from './../package.json';
import { CAGenerator } from './lib/ca-generator';
import { CAInstaller } from './lib/ca-installer';
import { CertificateManager } from './lib/certificates';
import { HostsManager } from './lib/hosts';
import { WebServer } from './lib/web-server';

const execAsync = promisify(exec);
const program = new Command();

program
  .version(packageJson.version)
  .description('A local domain manager for development environments');

function displayBanner() {
  console.log(
    chalk.blue(
      figlet.textSync('Navigrator', { horizontalLayout: 'full' })
    )
  );
  console.log(chalk.cyan('  Local domain manager by Axlotl Lab\n'));
}

/**
 * Check if OpenSSL is installed
 */
async function checkOpenSSL(): Promise<boolean> {
  try {
    await execAsync('openssl version');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Display error message about missing OpenSSL
 */
function displayOpenSSLError() {
  console.error(chalk.red('\n❌ Error: OpenSSL is not installed or not available in PATH'));
  console.error(chalk.yellow('\nNavigrator requires OpenSSL to create and manage SSL certificates.'));

  // OS-specific installation instructions
  if (process.platform === 'win32') {
    console.error(chalk.yellow('\nTo install OpenSSL on Windows:'));
    console.error(chalk.white('  1. Download the installer from https://slproweb.com/products/Win32OpenSSL.html'));
    console.error(chalk.white('  2. Run the installer and make sure to select "Copy OpenSSL DLLs to Windows system directory"'));
    console.error(chalk.white('  3. Restart your terminal/command prompt'));
  } else if (process.platform === 'darwin') {
    console.error(chalk.yellow('\nTo install OpenSSL on macOS:'));
    console.error(chalk.white('  Using Homebrew: brew install openssl'));
  } else {
    console.error(chalk.yellow('\nTo install OpenSSL on Linux:'));
    console.error(chalk.white('  Debian/Ubuntu: sudo apt-get install openssl'));
    console.error(chalk.white('  Fedora/RHEL: sudo dnf install openssl'));
  }

  console.error(chalk.yellow('\nPlease install OpenSSL and try again.\n'));
}

// Main command
program
  .command('start')
  .description('Start the web interface and manage certificates')
  .option('-p, --port <port>', 'HTTP port to use', '10191')
  .option('--no-ca-check', 'Skip checking for the CA certificate')
  .option('--no-ca-install', 'Skip installing the CA certificate')
  .action(async (options) => {
    displayBanner();

    // Verify privileges
    const isRoot = process.getuid && process.getuid() === 0;
    const isAdmin = process.platform === 'win32' && new Buffer(process.env.PATH!, 'utf-8').toString().toLowerCase().includes('system32');

    if (!isRoot && !isAdmin) {
      console.log(chalk.yellow('⚠️  Warning: This tool may need elevated privileges to modify the hosts file and install certificates.'));
      console.log(chalk.yellow('   Try running as administrator or with sudo.\n'));
    }

    try {
      // Check for OpenSSL before proceeding
      console.log(chalk.cyan('Checking OpenSSL installation...'));
      const hasOpenSSL = await checkOpenSSL();

      if (!hasOpenSSL) {
        displayOpenSSLError();
        process.exit(1);
      }

      console.log(chalk.green('✅ OpenSSL found'));

      // Check if CA certificate exists and install if needed
      if (options.caCheck !== false) {
        const certsDir = path.join(os.homedir(), '.navigrator', 'certs');
        const caInstaller = new CAInstaller(certsDir);
        const caGenerator = new CAGenerator(certsDir);
        const caExists = await caInstaller.checkCAExists();

        if (!caExists) {
          console.log(chalk.cyan('Root CA certificate not found. Generating...'));

          // Initialize directories
          await caGenerator.initialize();

          // Generate the CA
          await caGenerator.generateCA();

          console.log(chalk.green('✅ CA certificate generated'));

          // Install the CA certificate if option is enabled
          if (options.caInstall !== false) {
            console.log(chalk.cyan('Installing the root CA certificate...'));
            const result = await caInstaller.installCA();

            if (result.success) {
              console.log(chalk.green(`✅ CA certificate installed successfully`));

              // Show browser-specific instructions
              console.log(chalk.cyan('\nBrowser-specific notes:'));

              if (process.platform === 'win32') {
                console.log(chalk.white('• Chrome and Edge: Should recognize the certificate immediately.'));
                console.log(chalk.white('• Firefox: May require manual import. Check the Firefox notification above.'));
              } else if (process.platform === 'darwin') {
                console.log(chalk.white('• Safari and Chrome: Should recognize the certificate after restart.'));
                console.log(chalk.white('• Firefox: May require manual import. Check the Firefox notification above.'));
              } else {
                console.log(chalk.white('• Chrome: May require restarting the browser.'));
                console.log(chalk.white('• Firefox: May require manual import. Check the Firefox notification above.'));
              }

              console.log(chalk.cyan('\nIf you experience any issues:'));
              console.log(chalk.white('• Try restarting your browsers completely'));
              console.log(chalk.white('• For Chrome, you can visit chrome://restart\n'));
            } else {
              console.log(chalk.yellow(`\n⚠️  ${result.message}`));

              // Continue anyway with a warning
              console.log(chalk.yellow('Continuing without a trusted certificate. HTTPS certificates will be generated but browsers will show warnings.\n'));
            }
          } else {
            // Just use the generated CA without installing
            console.log(chalk.yellow('\n⚠️  Skipping CA installation as requested (--no-ca-install flag).'));
            console.log(chalk.yellow('Browsers will show warnings for the generated certificates.\n'));
          }
        } else if (options.caInstall !== false) {
          // CA exists, check if it should be installed
          console.log(chalk.cyan('Root CA certificate found. Installing...'));

          // For simplicity, we'll try installing the certificate even if it's already installed
          // Most operating systems handle this gracefully
          const result = await caInstaller.installCA();

          if (result.success) {
            console.log(chalk.green(`✅ CA certificate installed successfully`));
          } else {
            console.log(chalk.yellow(`\n⚠️  ${result.message}`));
          }
        }
      }

      const hostsManager = new HostsManager();
      const certsDir = path.join(os.homedir(), '.navigrator', 'certs');
      const certManager = new CertificateManager(certsDir);

      console.log(chalk.cyan('\nInitializing certificate manager...'));
      await certManager.initialize();

      const config = {
        port: parseInt(options.port, 10)
      };

      const webServer = new WebServer(hostsManager, certManager, config);

      console.log(chalk.cyan('Starting server...'));
      await webServer.start();

      const handleShutdown = async () => {
        console.log(chalk.cyan('\nShutting down server...'));
        await webServer.stop();
        process.exit(0);
      };

      process.on('SIGINT', handleShutdown);
      process.on('SIGTERM', handleShutdown);

    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error?.message}`));
      process.exit(1);
    }
  });

// Command to list all local domains
program
  .command('list')
  .description('List all local domains')
  .action(async () => {
    displayBanner();

    try {
      const hostsManager = new HostsManager();
      const hosts = await hostsManager.readLocalHosts();

      console.log(chalk.cyan('Local domains:'));

      if (hosts.length === 0) {
        console.log(chalk.yellow('  No local domains found'));
      } else {
        hosts.forEach(host => {
          const indicator = host.isCreatedByUs ? chalk.green('✓') : chalk.gray('·');
          console.log(`  ${indicator} ${host.domain} → ${host.ip}`);
        });
        console.log();
        console.log(chalk.green('✓') + ' Created by Navigrator');
      }
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error?.message}`));
      process.exit(1);
    }
  });

// Command to add a new domain
program
  .command('add <domain>')
  .description('Add a new local domain')
  .option('-i, --ip <ip>', 'IP address to use', '127.0.0.1')
  .action(async (domain, options) => {
    displayBanner();

    try {
      // Check for OpenSSL before proceeding
      console.log(chalk.cyan('Checking OpenSSL installation...'));
      const hasOpenSSL = await checkOpenSSL();

      if (!hasOpenSSL) {
        displayOpenSSLError();
        process.exit(1);
      }

      console.log(chalk.green('✅ OpenSSL found'));

      const hostsManager = new HostsManager();
      const certsDir = path.join(os.homedir(), '.navigrator', 'certs');
      const certManager = new CertificateManager(certsDir);

      await certManager.initialize();

      console.log(chalk.cyan(`Adding ${domain} to hosts file...`));
      await hostsManager.addHost(domain, options.ip);

      console.log(chalk.cyan(`Creating SSL certificate for ${domain}...`));
      await certManager.createCertificate(domain);

      console.log(chalk.green(`\n✅ Domain ${domain} successfully added`));
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error?.message}`));
      process.exit(1);
    }
  });

// Command to remove a domain
program
  .command('remove <domain>')
  .description('Remove a local domain')
  .action(async (domain) => {
    displayBanner();

    try {
      const hostsManager = new HostsManager();

      console.log(chalk.cyan(`Removing ${domain} from hosts file...`));
      const removed = await hostsManager.removeHost(domain);

      if (removed) {
        console.log(chalk.green(`\n✅ Domain ${domain} successfully removed`));
      } else {
        console.log(chalk.yellow(`\n⚠️  Domain ${domain} not found or not created by Navigrator`));
      }
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error?.message}`));
      process.exit(1);
    }
  });

// Command to initialize and install the CA certificate
program
  .command('init-ca')
  .description('Generate and install the root CA certificate')
  .action(async () => {
    displayBanner();

    try {
      const certsDir = path.join(os.homedir(), '.navigrator', 'certs');
      const caInstaller = new CAInstaller(certsDir);

      console.log(chalk.cyan('Generating and installing the root CA certificate...'));
      const result = await caInstaller.generateAndInstallCA();

      if (result.success) {
        console.log(chalk.green(`\n✅ ${result.message}`));

        // Show browser-specific instructions
        console.log(chalk.cyan('\nBrowser-specific notes:'));

        if (process.platform === 'win32') {
          console.log(chalk.white('• Chrome and Edge: Should recognize the certificate immediately.'));
          console.log(chalk.white('• Firefox: May require manual import. Check the Firefox notification above.'));
        } else if (process.platform === 'darwin') {
          console.log(chalk.white('• Safari and Chrome: Should recognize the certificate after restart.'));
          console.log(chalk.white('• Firefox: May require manual import. Check the Firefox notification above.'));
        } else {
          console.log(chalk.white('• Chrome: May require restarting the browser.'));
          console.log(chalk.white('• Firefox: May require manual import. Check the Firefox notification above.'));
        }

        console.log(chalk.cyan('\nIf you experience any issues:'));
        console.log(chalk.white('• Try restarting your browsers completely'));
        console.log(chalk.white('• For Chrome, you can visit chrome://restart'));

        console.log(chalk.green('\n🚀 You are now ready to use Navigrator! Start the web interface with:'));
        console.log(chalk.white('  navigrator start'));
      } else {
        console.log(chalk.yellow(`\n⚠️  ${result.message}`));
      }
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error?.message}`));
      process.exit(1);
    }
  });

// Command to install the CA certificate (if it exists)
program
  .command('install-ca')
  .description('Install the root CA certificate in system/browser trust stores')
  .action(async () => {
    displayBanner();

    try {
      // First check for OpenSSL
      console.log(chalk.cyan('Checking OpenSSL installation...'));
      const hasOpenSSL = await checkOpenSSL();

      if (!hasOpenSSL) {
        displayOpenSSLError();
        process.exit(1);
      }

      console.log(chalk.green('✅ OpenSSL found'));

      const certsDir = path.join(os.homedir(), '.navigrator', 'certs');
      const caInstaller = new CAInstaller(certsDir);

      // Check if CA exists, if not, generate it
      const caExists = await caInstaller.checkCAExists();
      if (!caExists) {
        console.log(chalk.cyan('Root CA certificate not found. Generating...'));
        const result = await caInstaller.generateAndInstallCA();

        if (result.success) {
          console.log(chalk.green(`\n✅ ${result.message}`));
        } else {
          console.log(chalk.yellow(`\n⚠️  ${result.message}`));
          process.exit(1);
        }
      } else {
        console.log(chalk.cyan('Installing the existing root CA certificate...'));
        const result = await caInstaller.installCA();

        if (result.success) {
          console.log(chalk.green(`\n✅ ${result.message}`));
        } else {
          console.log(chalk.yellow(`\n⚠️  ${result.message}`));
          process.exit(1);
        }
      }

      // Show browser-specific instructions
      console.log(chalk.cyan('\nBrowser-specific notes:'));

      if (process.platform === 'win32') {
        console.log(chalk.white('• Chrome and Edge: Should recognize the certificate immediately.'));
        console.log(chalk.white('• Firefox: May require manual import. Check the Firefox notification above.'));
      } else if (process.platform === 'darwin') {
        console.log(chalk.white('• Safari and Chrome: Should recognize the certificate after restart.'));
        console.log(chalk.white('• Firefox: May require manual import. Check the Firefox notification above.'));
      } else {
        console.log(chalk.white('• Chrome: May require restarting the browser.'));
        console.log(chalk.white('• Firefox: May require manual import. Check the Firefox notification above.'));
      }

      console.log(chalk.cyan('\nIf you experience any issues:'));
      console.log(chalk.white('• Try restarting your browsers completely'));
      console.log(chalk.white('• For Chrome, you can visit chrome://restart'));
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error?.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);

// If no argument is provided, show help
if (process.argv.length === 2) {
  displayBanner();
  program.outputHelp();
}