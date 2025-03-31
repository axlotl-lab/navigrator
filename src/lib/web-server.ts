import express from 'express';
import * as http from 'http';
import open from 'open';
import * as path from 'path';
import { CertificateManager } from './certificates';
import { HostsManager } from './hosts';

export interface WebServerConfig {
  port: number;
  sslPort?: number;
  enableSSL?: boolean;
}

export class WebServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private hostsManager: HostsManager;
  private certManager: CertificateManager;
  private config: WebServerConfig;

  constructor(hostsManager: HostsManager, certManager: CertificateManager, config: WebServerConfig) {
    this.app = express();
    this.hostsManager = hostsManager;
    this.certManager = certManager;
    this.config = {
      port: config.port || 3000,
      sslPort: config.sslPort,
      enableSSL: config.enableSSL
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Configura middleware para Express
   */
  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Servir archivos estáticos
    const staticDir = path.join(__dirname, '..', '..', 'public');
    this.app.use(express.static(staticDir));
  }

  /**
   * Configura rutas de la API
   */
  private setupRoutes(): void {
    // API para obtener todos los hosts locales
    this.app.get('/api/hosts', async (req, res) => {
      try {
        const hosts = await this.hostsManager.readLocalHosts();
        res.json({ success: true, hosts });
      } catch (error) {
        console.error('Error fetching hosts:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch hosts' });
      }
    });

    // API para agregar un nuevo host
    this.app.post('/api/hosts', async (req, res) => {
      try {
        const { domain, ip = '127.0.0.1' } = req.body;

        if (!domain) {
          res.status(400).json({ success: false, error: 'Domain is required' });
          return;
        }

        const success = await this.hostsManager.addHost(domain, ip);

        if (success) {
          res.json({ success: true, message: `Host ${domain} added successfully` });
        } else {
          res.status(500).json({ success: false, error: 'Failed to add host' });
        }
      } catch (error) {
        console.error('Error adding host:', error);
        res.status(500).json({ success: false, error: 'Failed to add host' });
      }
    });

    // API para eliminar un host
    this.app.delete('/api/hosts/:domain', async (req, res) => {
      try {
        const { domain } = req.params;
        const { ip = '127.0.0.1' } = req.query;

        const success = await this.hostsManager.removeHost(domain, ip as string);

        if (success) {
          res.json({ success: true, message: `Host ${domain} removed successfully` });
        } else {
          res.status(404).json({ success: false, error: 'Host not found or not created by this application' });
        }
      } catch (error) {
        console.error('Error removing host:', error);
        res.status(500).json({ success: false, error: 'Failed to remove host' });
      }
    });

    // NUEVO: API para habilitar/deshabilitar un host
    this.app.patch('/api/hosts/:domain/toggle', async (req, res) => {
      try {
        const { domain } = req.params;
        const { disabled, ip = '127.0.0.1' } = req.body;

        if (disabled === undefined) {
          res.status(400).json({ success: false, error: 'Disabled state is required' });
          return;
        }

        const success = await this.hostsManager.toggleHostState(domain, disabled, ip as string);

        if (success) {
          const state = disabled ? 'disabled' : 'enabled';
          res.json({ success: true, message: `Host ${domain} ${state} successfully` });
        } else {
          res.status(404).json({ success: false, error: 'Host not found or not created by this application' });
        }
      } catch (error) {
        console.error('Error toggling host:', error);
        res.status(500).json({ success: false, error: 'Failed to toggle host state' });
      }
    });

    // API para obtener todos los certificados
    this.app.get('/api/certificates', async (req, res) => {
      try {
        const certificates = await this.certManager.listCertificates();
        res.json({ success: true, certificates });
      } catch (error) {
        console.error('Error fetching certificates:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch certificates' });
      }
    });

    // API para verificar un certificado
    this.app.get('/api/certificates/:domain', async (req, res) => {
      try {
        const { domain } = req.params;

        const certInfo = await this.certManager.verifyCertificate(domain);

        if (certInfo) {
          res.json({ success: true, certificate: certInfo });
        } else {
          res.status(404).json({ success: false, error: 'Certificate not found' });
        }
      } catch (error) {
        console.error('Error verifying certificate:', error);
        res.status(500).json({ success: false, error: 'Failed to verify certificate' });
      }
    });

    // API para crear un certificado
    this.app.post('/api/certificates', async (req, res) => {
      try {
        const { domain } = req.body;

        if (!domain) {
          res.status(400).json({ success: false, error: 'Domain is required' });
          return;
        }

        const certInfo = await this.certManager.createCertificate(domain);

        res.json({ success: true, certificate: certInfo });
      } catch (error) {
        console.error('Error creating certificate:', error);
        res.status(500).json({ success: false, error: 'Failed to create certificate' });
      }
    });

    // API para verificar el estado de un dominio
    this.app.get('/api/status/:domain', async (req, res) => {
      try {
        const { domain } = req.params;

        // Verificar si existe en hosts
        const hosts = await this.hostsManager.readLocalHosts();
        const hostEntry = hosts.find(host => host.domain === domain);
        const hostExists = !!hostEntry;

        // Verificar si tiene certificado válido
        const certInfo = await this.certManager.verifyCertificate(domain);
        const certValid = certInfo?.isValid || false;

        const status = {
          domain,
          hostConfigured: hostExists,
          certificateValid: certValid,
          isValid: hostExists && certValid,
          isDisabled: hostEntry?.isDisabled || false
        };

        res.json({ success: true, status });
      } catch (error) {
        console.error('Error checking domain status:', error);
        res.status(500).json({ success: false, error: 'Failed to check domain status' });
      }
    });

    // Ruta para servir la interfaz de usuario
    this.app.get('*', (_, res) => {
      res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
    });
  }

  /**
   * Inicia el servidor web
   */
  public async start(): Promise<void> {
    // Iniciar servidor HTTP
    this.server = this.app.listen(this.config.port, () => {
      console.log(`Server listening on http://localhost:${this.config.port}`);
    });

    // Abrir navegador
    try {
      await open(`http://localhost:${this.config.port}`);
    } catch (error) {
      console.warn('Could not open browser automatically:', error);
    }
  }

  /**
   * Detiene el servidor web
   */
  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Detener servidor HTTP
      if (this.server) {
        this.server.close(err => {
          if (err) {
            console.error('Error stopping HTTP server:', err);
            reject(err);
          } else {
            console.log('HTTP server stopped');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}