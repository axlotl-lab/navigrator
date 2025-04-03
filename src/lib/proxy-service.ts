import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';

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
  private servers: Map<string, http.Server | https.Server> = new Map();
  private configFilePath: string;

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
    this.saveProxies();
    return result;
  }

  /**
   * Start a proxy server for a domain
   */
  public startProxy(domain: string, certPath: string, keyPath: string): boolean {
    const config = this.proxies.get(domain);
    if (!config) return false;

    // Stop existing server if it's already running
    this.stopProxy(domain);

    try {
      // Parse the target URL to get hostname and port
      const targetUrl = new URL(config.target);
      const targetHostname = targetUrl.hostname;
      const targetPort = targetUrl.port ?
        parseInt(targetUrl.port) :
        (targetUrl.protocol === 'https:' ? 443 : 80);
      const targetProtocol = targetUrl.protocol;

      // Load SSL certificate for our HTTPS server
      const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        // Allow self-signed certificates when connecting to the target
        rejectUnauthorized: false
      };

      // Create HTTPS server
      const server = https.createServer(httpsOptions, (req, res) => {
        // Log request
        const date = new Date().toISOString();
        const clientIP = req.socket.remoteAddress || '-';
        console.log(`[${date}] ${clientIP} ${req.method} ${req.url} → ${config.target} [Protocol: ${targetProtocol}]`);

        // Get the original host from the request
        const originalHost = req.headers.host || domain;

        // Clone and modify the headers for the proxied request
        const proxyHeaders = this.prepareProxyHeaders(req.headers, targetHostname, targetPort, originalHost, domain);

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
          console.error(`Proxy error: ${error.message} for ${domain} (target: ${config.target})`);
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
          console.error(`Client request error: ${error.message} for ${domain}`);
          proxyReq.destroy();
        });

        // If there's data in the request, pipe it to the proxy request
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          req.pipe(proxyReq);
        } else {
          proxyReq.end();
        }
      });

      // Basic error handling for the server
      server.on('error', (err) => {
        console.error(`Server error for ${domain}:`, err);
      });

      // Listen on configured port
      server.listen(config.port, () => {
        console.log(`Proxy server for ${domain} started on port ${config.port}`);
        console.log(`Target: ${config.target} using ${targetProtocol} protocol`);
      });

      // Update the configuration
      config.certPath = certPath;
      config.keyPath = keyPath;
      config.isRunning = true;
      this.proxies.set(domain, config);
      this.servers.set(domain, server);

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
    const server = this.servers.get(domain);
    if (!server) return false;

    try {
      server.close();
      this.servers.delete(domain);

      const config = this.proxies.get(domain);
      if (config) {
        config.isRunning = false;
        this.proxies.set(domain, config);
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
    for (const domain of this.servers.keys()) {
      this.stopProxy(domain);
    }
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