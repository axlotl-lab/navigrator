import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as tls from 'tls';

export interface ProxyConfig {
  domain: string;
  target: string;
  isRunning: boolean;
  certPath?: string;
  keyPath?: string;
  port?: number;
}

export class ProxyService {
  private proxies: Map<string, ProxyConfig> = new Map();
  private sniServer: https.Server | null = null;
  private configFilePath: string;
  private sniServerPort: number = 443;
  private sniCertificates: Map<string, { key: Buffer, cert: Buffer }> = new Map();

  constructor() {
    this.configFilePath = path.join(os.homedir(), '.navigrator', 'proxies.json');
    this.loadProxies();
  }

  /**
   * Load saved proxy configurations
   */
  private loadProxies(): void {
    try {
      // Create directory if it doesn't exist
      const configDir = path.dirname(this.configFilePath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Create file if it doesn't exist
      if (!fs.existsSync(this.configFilePath)) {
        fs.writeFileSync(this.configFilePath, JSON.stringify([]));
        return;
      }

      const data = fs.readFileSync(this.configFilePath, 'utf-8');
      const configs: ProxyConfig[] = JSON.parse(data);

      // Initialize each proxy (but don't start them automatically)
      configs.forEach(config => {
        // Mark all as not running on load
        config.isRunning = false;
        this.proxies.set(config.domain, config);
      });
    } catch (error) {
      console.error('Error loading proxy configurations:', error);
      this.proxies.clear();
    }
  }

  /**
   * Save current proxy configurations
   */
  private saveProxies(): void {
    try {
      const configs = Array.from(this.proxies.values());
      fs.writeFileSync(this.configFilePath, JSON.stringify(configs, null, 2));
    } catch (error) {
      console.error('Error saving proxy configurations:', error);
    }
  }

  /**
   * Get all proxy configurations
   */
  public getProxies(): ProxyConfig[] {
    return Array.from(this.proxies.values());
  }

  /**
   * Add a new proxy configuration
   */
  public addProxy(config: ProxyConfig): ProxyConfig {
    // Normalize the target URL
    if (!config.target.startsWith('http://') && !config.target.startsWith('https://')) {
      config.target = `http://${config.target}`;
    }

    // Set default port if not provided
    if (!config.port) {
      config.port = 443; // Default to HTTPS port
    }

    config.isRunning = false;
    this.proxies.set(config.domain, config);
    this.saveProxies();
    return config;
  }

  /**
   * Remove a proxy configuration
   */
  public removeProxy(domain: string): boolean {
    // Stop the proxy if it's running
    this.stopProxy(domain);

    const result = this.proxies.delete(domain);

    // Remove from SNI certificates if it exists
    this.sniCertificates.delete(domain);

    // If no more active certificates and SNI server is running, stop it
    if (this.sniCertificates.size === 0 && this.sniServer) {
      this.stopSNIServer();
    }

    this.saveProxies();
    return result;
  }

  /**
   * Initialize or update the SNI server
   */
  private async initOrUpdateSNIServer(): Promise<boolean> {
    try {
      // If we already have an SNI server running, we can just update it
      if (this.sniServer) {
        // Update the context for the existing server
        const secureContext = this.createSecureContext();
        if (this.sniServer instanceof https.Server) {
          // Access the internal TLS server 
          // Note: This is accessing a non-public property, might break in future Node versions
          const tlsServer = this.sniServer.listeners('request')[0] as any;
          if (tlsServer && tlsServer._sharedCrypto) {
            tlsServer._sharedCrypto.context = secureContext;
          }
        }
        return true;
      }

      // Create new SNI server
      const httpsOptions: https.ServerOptions = {
        // This SNICallback will be called during the TLS handshake
        SNICallback: (servername, cb) => {
          const ctx = this.sniCertificates.get(servername);
          if (ctx) {
            const secureContext = tls.createSecureContext({
              key: ctx.key,
              cert: ctx.cert
            });
            cb(null, secureContext);
          } else {
            console.warn(`No certificate found for ${servername}`);
            cb(new Error(`No certificate found for ${servername}`));
          }
        }
      };

      this.sniServer = https.createServer(httpsOptions, (req, res) => {
        // Get the hostname from the request
        const hostname = req.headers.host?.split(':')[0];

        if (!hostname) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid host header');
          return;
        }

        // Find the corresponding proxy configuration
        const config = this.proxies.get(hostname);
        if (!config || !config.isRunning) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end(`No running proxy found for ${hostname}`);
          return;
        }

        // Handle the proxy request
        this.handleProxyRequest(req, res, config);
      });

      // Handle SNI server errors
      this.sniServer.on('error', (err) => {
        console.error(`SNI server error:`, err);
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          console.error(`Port ${this.sniServerPort} is already in use. Cannot start SNI server.`);
        }
      });

      // Start listening
      this.sniServer.listen(this.sniServerPort, () => {
        console.log(`SNI proxy server started on port ${this.sniServerPort}`);
      });

      return true;
    } catch (error) {
      console.error('Error initializing SNI server:', error);
      return false;
    }
  }

  /**
   * Create a secure context for SNI server
   */
  private createSecureContext(): tls.SecureContext {
    // Create a default context
    const ctx = tls.createSecureContext({
      // We'll use the first certificate as default if available
      key: this.sniCertificates.size > 0 ? this.sniCertificates.values().next().value!.key : undefined,
      cert: this.sniCertificates.size > 0 ? this.sniCertificates.values().next().value!.cert : undefined
    });
    return ctx;
  }

  /**
   * Stop the SNI server
   */
  private stopSNIServer(): boolean {
    if (this.sniServer) {
      try {
        this.sniServer.close();
        this.sniServer = null;
        console.log(`SNI server stopped`);
        return true;
      } catch (error) {
        console.error('Error stopping SNI server:', error);
        return false;
      }
    }
    return false;
  }

  /**
   * Handle a proxy request
   */
  private handleProxyRequest(req: http.IncomingMessage, res: http.ServerResponse, config: ProxyConfig): void {
    try {
      // Parse the target URL
      const targetUrl = new URL(config.target);
      const targetHostname = targetUrl.hostname;
      const targetPort = targetUrl.port ?
        parseInt(targetUrl.port) :
        (targetUrl.protocol === 'https:' ? 443 : 80);
      const targetProtocol = targetUrl.protocol;

      // Log request
      const date = new Date().toISOString();
      const clientIP = req.socket.remoteAddress || '-';
      console.log(`[${date}] ${clientIP} ${req.method} ${req.url} → ${config.target} [Protocol: ${targetProtocol}]`);

      // Get the original host from the request
      const originalHost = req.headers.host || config.domain;

      // Clone and modify the headers for the proxied request
      const proxyHeaders = this.prepareProxyHeaders(req.headers, targetHostname, targetPort, originalHost, config.domain);

      // Configure proxy request options
      const proxyOptions = {
        hostname: targetHostname,
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: proxyHeaders,
        // For HTTPS targets, don't verify certificates (useful for local dev)
        rejectUnauthorized: false
      };

      // Choose http or https module based on the target protocol
      const requestModule = targetProtocol === 'https:' ? https : http;

      // Create the proxy request using the appropriate module
      const proxyReq = requestModule.request(proxyOptions, (proxyRes) => {
        // Add our custom header to the response
        res.setHeader('X-Proxied-By', '@axlotl-lab/navigrator');

        // Copy the response status and headers
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

        // Pipe the response data directly
        proxyRes.pipe(res);
      });

      // Handle proxy request errors
      proxyReq.on('error', (error) => {
        console.error(`Proxy error: ${error.message} for ${config.domain} (target: ${config.target})`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(`Proxy error: ${error.message}. Target: ${config.target}`);
        } else {
          try {
            res.end();
          } catch (e) {
            console.error('Error ending response:', e);
          }
        }
      });

      // Handle client request errors
      req.on('error', (error) => {
        console.error(`Client request error: ${error.message} for ${config.domain}`);
        proxyReq.destroy();
      });

      // If there's data in the request, pipe it to the proxy request
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    } catch (error) {
      console.error(`Error handling proxy request for ${config.domain}:`, error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal Server Error: ${error}`);
      } else {
        try {
          res.end();
        } catch (e) {
          console.error('Error ending response:', e);
        }
      }
    }
  }

  /**
   * Start a proxy server for a domain
   */
  public startProxy(domain: string, certPath: string, keyPath: string): boolean {
    const config = this.proxies.get(domain);
    if (!config) return false;

    try {
      // Load SSL certificate files
      const key = fs.readFileSync(keyPath);
      const cert = fs.readFileSync(certPath);

      // Store the certificate in the SNI certificates map
      this.sniCertificates.set(domain, { key, cert });

      // Initialize or update the SNI server
      const sniInitialized = this.initOrUpdateSNIServer();
      if (!sniInitialized) {
        console.error(`Failed to initialize SNI server for ${domain}`);
        return false;
      }

      // Update the configuration
      config.certPath = certPath;
      config.keyPath = keyPath;
      config.isRunning = true;
      this.proxies.set(domain, config);

      console.log(`Proxy started for ${domain} -> ${config.target}`);
      this.saveProxies();
      return true;
    } catch (error) {
      console.error(`Error starting proxy for ${domain}:`, error);
      return false;
    }
  }

  /**
   * Prepare headers for the proxy request
   */
  private prepareProxyHeaders(
    originalHeaders: http.IncomingHttpHeaders,
    targetHostname: string,
    targetPort: number,
    originalHost: string,
    domain: string
  ): http.OutgoingHttpHeaders {
    // Clone headers to avoid modifying the original
    const headers: http.OutgoingHttpHeaders = { ...originalHeaders };

    // Set the host header to the target
    const targetHost = targetPort !== 80 && targetPort !== 443
      ? `${targetHostname}:${targetPort}`
      : targetHostname;

    headers.host = targetHost;

    // Set forwarding headers
    headers['x-forwarded-host'] = originalHost;
    headers['x-forwarded-proto'] = 'https';

    // Add or append to x-forwarded-for
    const clientIP = originalHeaders['x-forwarded-for']
      ? `${originalHeaders['x-forwarded-for']}, 127.0.0.1`
      : '127.0.0.1';

    headers['x-forwarded-for'] = clientIP;

    // Add our custom header
    headers['x-proxied-by'] = '@axlotl-lab/navigrator';
    headers['x-original-domain'] = domain;

    return headers;
  }

  /**
   * Stop a running proxy server
   */
  public stopProxy(domain: string): boolean {
    try {
      // Remove domain from the SNI certificates
      this.sniCertificates.delete(domain);

      // Update config
      const config = this.proxies.get(domain);
      if (config) {
        config.isRunning = false;
        this.proxies.set(domain, config);
      }

      // If no more proxies are running, stop the SNI server
      const runningProxies = Array.from(this.proxies.values()).filter(p => p.isRunning);
      if (runningProxies.length === 0 && this.sniServer) {
        this.stopSNIServer();
      } else if (this.sniServer) {
        // Just update the SNI server
        this.initOrUpdateSNIServer();
      }

      console.log(`Proxy stopped for ${domain}`);
      this.saveProxies();
      return true;
    } catch (error) {
      console.error(`Error stopping proxy for ${domain}:`, error);
      return false;
    }
  }

  /**
   * Stop all running proxy servers
   */
  public stopAllProxies(): void {
    // Clear all SNI certificates
    this.sniCertificates.clear();

    // Update all proxy configs
    for (const [domain, config] of this.proxies.entries()) {
      config.isRunning = false;
      this.proxies.set(domain, config);
    }

    // Stop the SNI server
    if (this.sniServer) {
      this.stopSNIServer();
    }

    this.saveProxies();
  }

  /**
   * Update a proxy configuration
   */
  public updateProxy(domain: string, newConfig: Partial<ProxyConfig>): boolean {
    const config = this.proxies.get(domain);
    if (!config) return false;

    // Normalize the target URL if it's being updated
    if (newConfig.target && !newConfig.target.startsWith('http://') && !newConfig.target.startsWith('https://')) {
      newConfig.target = `http://${newConfig.target}`;
    }

    // Update the configuration
    Object.assign(config, newConfig);

    // If the proxy is running and target was updated, restart it
    if (config.isRunning && newConfig.target) {
      this.stopProxy(domain);
      if (config.certPath && config.keyPath) {
        this.startProxy(domain, config.certPath, config.keyPath);
      }
    }

    this.saveProxies();
    return true;
  }
}