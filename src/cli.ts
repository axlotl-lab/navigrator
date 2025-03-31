#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import figlet from 'figlet';
import os from 'os';
import path from 'path';
import { CertificateManager } from './lib/certificates';
import { HostsManager } from './lib/hosts';
import { WebServer } from './lib/web-server';

// Crear instancia de la CLI
const program = new Command();

// Versión y descripción
program
  .version('1.0.0')
  .description('A local domain manager for development environments');

// Función para mostrar el banner
function displayBanner() {
  console.log(
    chalk.blue(
      figlet.textSync('Navigrator', { horizontalLayout: 'full' })
    )
  );
  console.log(chalk.cyan('  Local domain manager by Axlotl Lab\n'));
}

// Comando principal
program
  .command('start')
  .description('Start the web interface')
  .option('-p, --port <port>', 'HTTP port to use', '3000')
  .option('-s, --ssl-port <port>', 'HTTPS port to use', '3443')
  .option('--no-ssl', 'Disable HTTPS server')
  .action(async (options) => {
    displayBanner();

    // Verificar privilegios
    const isRoot = process.getuid && process.getuid() === 0;
    const isAdmin = process.platform === 'win32' && new Buffer(process.env.PATH!, 'utf-8').toString().toLowerCase().includes('system32');

    if (!isRoot && !isAdmin) {
      console.log(chalk.yellow('⚠️  Warning: This tool may need elevated privileges to modify the hosts file.'));
      console.log(chalk.yellow('   Try running as administrator or with sudo.\n'));
    }

    try {
      // Crear instancias de los managers
      const hostsManager = new HostsManager();
      const certsDir = path.join(os.homedir(), '.navigrator', 'certs');
      const certManager = new CertificateManager(certsDir);

      // Inicializar el gestor de certificados
      console.log(chalk.cyan('Initializing certificate manager...'));
      await certManager.initialize();

      // Configurar el servidor web
      const config = {
        port: parseInt(options.port, 10),
        sslPort: parseInt(options.sslPort, 10),
        enableSSL: options.ssl
      };

      const webServer = new WebServer(hostsManager, certManager, config);

      // Iniciar servidor
      console.log(chalk.cyan('Starting server...'));
      await webServer.start();

      // Manejar cierre del proceso
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

// Comando para listar hosts
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

// Comando para agregar un dominio
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

      // Inicializar el gestor de certificados
      await certManager.initialize();

      // Agregar al archivo hosts
      console.log(chalk.cyan(`Adding ${domain} to hosts file...`));
      await hostsManager.addHost(domain, options.ip);

      // Crear certificado
      console.log(chalk.cyan(`Creating SSL certificate for ${domain}...`));
      await certManager.createCertificate(domain);

      console.log(chalk.green(`\n✅ Domain ${domain} successfully added`));
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error?.message}`));
      process.exit(1);
    }
  });

// Comando para eliminar un dominio
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

// Analizar argumentos de la línea de comandos
program.parse(process.argv);

// Si no se proporciona ningún argumento, mostrar ayuda
if (process.argv.length === 2) {
  displayBanner();
  program.outputHelp();
}