import express from 'express';
import * as http from 'http';
import open from 'open';
import * as path from 'path';
import { CertificateManager } from './certificates';
import { HostsManager } from './hosts';
import { ProxyConfig, ProxyService } from './proxy-service';

export interface WebServerConfig {
  port: number;
}

export class WebServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private hostsManager: HostsManager;
  private certManager: CertificateManager;
  private proxyService: ProxyService;
  private config: WebServerConfig;

  constructor(hostsManager: HostsManager, certManager: CertificateManager, config: WebServerConfig) {
    this.app = express();
    this.hostsManager = hostsManager;
    this.certManager = certManager;
    this.proxyService = new ProxyService();
    this.config = {
      port: config.port || 10191,
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Configure middleware for Express
   */
  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files
    const staticDir = path.join(__dirname, '..', '..', 'public');
    this.app.use(express.static(staticDir));
  }

  /**
   * Configure routes for the API
   */
  private setupRoutes(): void {
    // Original routes...
    this.app.get('/api/hosts', async (_, res) => {
      try {
        const hosts = await this.hostsManager.readLocalHosts();
        res.json({ success: true, hosts });
      } catch (error) {
        console.error('Error fetching hosts:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch hosts' });
      }
    });

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

    this.app.post('/api/hosts/:domain/adopt', async (req, res) => {
      try {
        const { domain } = req.params;
        const { ip = '127.0.0.1' } = req.body;

        const success = await this.hostsManager.adoptHost(domain, ip);

        if (success) {
          res.json({ success: true, message: `Host ${domain} adopted successfully` });
        } else {
          res.status(404).json({ success: false, error: 'Host not found or already adopted' });
        }
      } catch (error) {
        console.error('Error adopting host:', error);
        res.status(500).json({ success: false, error: 'Failed to adopt host' });
      }
    });

    this.app.post('/api/hosts/import-all', async (req, res) => {
      try {
        const result = await this.hostsManager.importAllLocalHosts();

        if (result.success) {
          res.json({
            success: true,
            message: `${result.count} hosts imported successfully`
          });
        } else {
          res.status(404).json({ success: false, error: 'No hosts found to import' });
        }
      } catch (error) {
        console.error('Error importing hosts:', error);
        res.status(500).json({ success: false, error: 'Failed to import hosts' });
      }
    });

    this.app.delete('/api/hosts/:domain', async (req, res) => {
      try {
        const { domain } = req.params;
        const { ip = '127.0.0.1' } = req.query;

        const hostSuccess = await this.hostsManager.removeHost(domain, ip as string);

        // Also remove the associated certificate
        let certSuccess = false;
        try {
          certSuccess = await this.certManager.deleteCertificate(domain);
        } catch (certError) {
          console.error(`Error removing certificate for ${domain}:`, certError);
          // Don't fail the main operation if deleting the certificate fails
        }

        if (hostSuccess) {
          const message = certSuccess
            ? `Host ${domain} and its certificate removed successfully`
            : `Host ${domain} removed successfully`;
          res.json({ success: true, message, certificateRemoved: certSuccess });
        } else {
          res.status(404).json({ success: false, error: 'Host not found or not created by this application' });
        }
      } catch (error) {
        console.error('Error removing host:', error);
        res.status(500).json({ success: false, error: 'Failed to remove host' });
      }
    });

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

    this.app.get('/api/certificates', async (req, res) => {
      try {
        const certificates = await this.certManager.listCertificates();
        res.json({ success: true, certificates });
      } catch (error) {
        console.error('Error fetching certificates:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch certificates' });
      }
    });

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

    this.app.delete('/api/certificates/:domain', async (req, res) => {
      try {
        const { domain } = req.params;

        const success = await this.certManager.deleteCertificate(domain);

        if (success) {
          res.json({ success: true, message: `Certificate for ${domain} removed successfully` });
        } else {
          res.status(404).json({ success: false, error: 'Certificate not found' });
        }
      } catch (error) {
        console.error('Error removing certificate:', error);
        res.status(500).json({ success: false, error: 'Failed to remove certificate' });
      }
    });

    this.app.get('/api/status/:domain', async (req, res) => {
      try {
        const { domain } = req.params;
        const hosts = await this.hostsManager.readLocalHosts();
        const hostEntry = hosts.find(host => host.domain === domain);
        const hostExists = !!hostEntry;
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

    // New proxy-related routes
    this.app.get('/api/proxies', (req, res) => {
      try {
        const proxies = this.proxyService.getProxies();
        res.json({ success: true, proxies });
      } catch (error) {
        console.error('Error fetching proxies:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch proxies' });
      }
    });

    this.app.post('/api/proxies', async (req, res) => {
      try {
        const { domain, target, port } = req.body;

        if (!domain || !target) {
          res.status(400).json({ success: false, error: 'Domain and target are required' });
          return;
        }

        // Verify domain exists and has a valid certificate
        const hosts = await this.hostsManager.readLocalHosts();
        const hostEntry = hosts.find(host => host.domain === domain);

        if (!hostEntry) {
          res.status(404).json({ success: false, error: 'Domain not found in hosts file' });
          return;
        }

        const certInfo = await this.certManager.verifyCertificate(domain);

        if (!certInfo || !certInfo.isValid) {
          res.status(400).json({ success: false, error: 'Domain does not have a valid certificate' });
          return;
        }

        const proxyConfig: ProxyConfig = {
          domain,
          target,
          isRunning: false,
          port: port || 443
        };

        const config = this.proxyService.addProxy(proxyConfig);

        res.json({
          success: true,
          message: `Proxy configuration for ${domain} added successfully`,
          proxy: config
        });
      } catch (error) {
        console.error('Error adding proxy:', error);
        res.status(500).json({ success: false, error: 'Failed to add proxy' });
      }
    });

    this.app.delete('/api/proxies/:domain', (req, res) => {
      try {
        const { domain } = req.params;
        const success = this.proxyService.removeProxy(domain);

        if (success) {
          res.json({ success: true, message: `Proxy for ${domain} removed successfully` });
        } else {
          res.status(404).json({ success: false, error: 'Proxy not found' });
        }
      } catch (error) {
        console.error('Error removing proxy:', error);
        res.status(500).json({ success: false, error: 'Failed to remove proxy' });
      }
    });

    this.app.post('/api/proxies/:domain/start', async (req, res) => {
      try {
        const { domain } = req.params;

        // Get certificate paths
        const certInfo = await this.certManager.verifyCertificate(domain);

        if (!certInfo || !certInfo.isValid || !certInfo.certFilePath || !certInfo.keyFilePath) {
          res.status(400).json({ success: false, error: 'Domain does not have a valid certificate' });
          return;
        }

        const success = this.proxyService.startProxy(
          domain,
          certInfo.certFilePath,
          certInfo.keyFilePath
        );

        if (success) {
          res.json({ success: true, message: `Proxy for ${domain} started successfully` });
        } else {
          res.status(500).json({ success: false, error: 'Failed to start proxy' });
        }
      } catch (error) {
        console.error('Error starting proxy:', error);
        res.status(500).json({ success: false, error: 'Failed to start proxy' });
      }
    });

    this.app.post('/api/proxies/:domain/stop', (req, res) => {
      try {
        const { domain } = req.params;
        const success = this.proxyService.stopProxy(domain);

        if (success) {
          res.json({ success: true, message: `Proxy for ${domain} stopped successfully` });
        } else {
          res.status(404).json({ success: false, error: 'Proxy not found or not running' });
        }
      } catch (error) {
        console.error('Error stopping proxy:', error);
        res.status(500).json({ success: false, error: 'Failed to stop proxy' });
      }
    });

    this.app.patch('/api/proxies/:domain', (req, res) => {
      try {
        const { domain } = req.params;
        const { target, port } = req.body;

        if (!target && !port) {
          res.status(400).json({ success: false, error: 'No update parameters provided' });
          return;
        }

        const success = this.proxyService.updateProxy(domain, { target, port });

        if (success) {
          res.json({ success: true, message: `Proxy for ${domain} updated successfully` });
        } else {
          res.status(404).json({ success: false, error: 'Proxy not found' });
        }
      } catch (error) {
        console.error('Error updating proxy:', error);
        res.status(500).json({ success: false, error: 'Failed to update proxy' });
      }
    });

    // Route to serve the user interface
    this.app.get('*', (_, res) => {
      res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
    });
  }

  /**
   * Start the web server
   */
  public async start(): Promise<void> {
    this.server = this.app.listen(this.config.port, () => {
      console.log(`Server listening on http://localhost:${this.config.port}`);
    });

    try {
      await open(`http://localhost:${this.config.port}`);
    } catch (error) {
      console.warn('Could not open browser automatically:', error);
    }
  }

  /**
   * Stop the web server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        // Stop all proxies first
        this.proxyService.stopAllProxies();

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