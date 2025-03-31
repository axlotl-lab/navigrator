#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import figlet from 'figlet';
import os from 'os';
import path from 'path';
import { CertificateManager } from './lib/certificates';
import { HostsManager } from './lib/hosts';
import { WebServer } from './lib/web-server';

const program = new Command();

program
  .version('1.0.0')
  .description('A local domain manager for development environments');

function displayBanner() {
  console.log(
    chalk.blue(
      figlet.textSync('Navigrator', { horizontalLayout: 'full' })
    )
  );
  console.log(chalk.cyan('  Local domain manager by Axlotl Lab\n'));
}

// Main command
program
  .command('start')
  .description('Start the web interface')
  .option('-p, --port <port>', 'HTTP port to use', '10191')
  .action(async (options) => {
    displayBanner();

    // Verify privileges
    const isRoot = process.getuid && process.getuid() === 0;
    const isAdmin = process.platform === 'win32' && new Buffer(process.env.PATH!, 'utf-8').toString().toLowerCase().includes('system32');

    if (!isRoot && !isAdmin) {
      console.log(chalk.yellow('⚠️  Warning: This tool may need elevated privileges to modify the hosts file.'));
      console.log(chalk.yellow('   Try running as administrator or with sudo.\n'));
    }

    try {
      const hostsManager = new HostsManager();
      const certsDir = path.join(os.homedir(), '.navigrator', 'certs');
      const certManager = new CertificateManager(certsDir);

      console.log(chalk.cyan('Initializing certificate manager...'));
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

program.parse(process.argv);

// If no argument is provided, show help
if (process.argv.length === 2) {
  displayBanner();
  program.outputHelp();
}