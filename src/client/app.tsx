import React, { useEffect, useState } from 'react';
import './styles.css';

interface Host {
  ip: string;
  domain: string;
  isCreatedByUs: boolean;
  isDisabled: boolean;
  lineNumber?: number;
}

interface Certificate {
  domain: string;
  validFrom: string;
  validTo: string;
  issuer: string;
  isValid: boolean;
  certFilePath?: string;
  keyFilePath?: string;
}

interface DomainStatus {
  domain: string;
  hostConfigured: boolean;
  certificateValid: boolean;
  isValid: boolean;
  isDisabled: boolean;
}

interface Proxy {
  domain: string;
  target: string;
  port: number;
  isRunning: boolean;
}

function App() {
  const [domains, setDomains] = useState<Host[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [statuses, setStatuses] = useState<{ [key: string]: DomainStatus }>({});
  const [newDomain, setNewDomain] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'domains' | 'certificates' | 'proxies'>('domains');
  const [confirmImport, setConfirmImport] = useState(false);
  const [confirmDeleteCertificate, setConfirmDeleteCertificate] = useState<string | null>(null);
  const [confirmDeleteProxy, setConfirmDeleteProxy] = useState<string | null>(null);

  const [newProxy, setNewProxy] = useState({
    domain: '',
    target: '',
    port: 443
  });

  const [editProxy, setEditProxy] = useState<Proxy | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      await Promise.all([
        fetchHosts(),
        fetchCertificates(),
        fetchProxies()
      ]);

      setLoading(false);
    } catch (error) {
      setError('Failed to load data. Please check if the server is running with admin privileges.');
      setLoading(false);
    }
  };

  const fetchHosts = async () => {
    const response = await fetch('/api/hosts');
    if (!response.ok) throw new Error('Failed to fetch hosts');

    const data = await response.json();
    setDomains(data.hosts);

    await Promise.all(data.hosts.map((host: any) => fetchDomainStatus(host.domain)));
  };

  const fetchCertificates = async () => {
    const response = await fetch('/api/certificates');
    if (!response.ok) throw new Error('Failed to fetch certificates');

    const data = await response.json();
    setCertificates(data.certificates);
  };

  const fetchProxies = async () => {
    const response = await fetch('/api/proxies');
    if (!response.ok) throw new Error('Failed to fetch proxies');

    const data = await response.json();
    setProxies(data.proxies);
  };

  const fetchDomainStatus = async (domain: string) => {
    const response = await fetch(`/api/status/${domain}`);
    if (!response.ok) return;

    const data = await response.json();
    setStatuses(prev => ({
      ...prev,
      [domain]: data.status
    }));
  };

  const addDomain = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newDomain) return;

    setLoading(true);

    try {
      const hostResponse = await fetch('/api/hosts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ domain: newDomain })
      });

      if (!hostResponse.ok) throw new Error('Failed to add host');

      const certResponse = await fetch('/api/certificates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ domain: newDomain })
      });

      if (!certResponse.ok) throw new Error('Failed to create certificate');

      await fetchData();

      showNotification(`Domain ${newDomain} added successfully`, 'success');

      setNewDomain('');
    } catch (error: any) {
      showNotification(`Error adding domain: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const adoptDomain = async (domain: string, ip: string) => {
    setLoading(true);

    try {
      const response = await fetch(`/api/hosts/${domain}/adopt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ip })
      });

      if (!response.ok) throw new Error('Failed to adopt host');

      await fetchData();

      showNotification(`Domain ${domain} adopted successfully`, 'success');
    } catch (error: any) {
      showNotification(`Error adopting domain: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const importAllDomains = async () => {
    setLoading(true);
    setConfirmImport(false);

    try {
      const response = await fetch('/api/hosts/import-all', {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to import hosts');

      const data = await response.json();

      await fetchData();

      showNotification(data.message, 'success');
    } catch (error: any) {
      showNotification(`Error importing domains: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const removeDomain = async (domain: string) => {
    if (!confirm(`Are you sure you want to remove ${domain}?`)) return;

    setLoading(true);

    try {
      const response = await fetch(`/api/hosts/${domain}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to remove host');

      const data = await response.json();

      await fetchData();

      showNotification(data.message, 'success');
    } catch (error: any) {
      showNotification(`Error removing domain: ${error?.message} `, 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleDomainState = async (domain: string, disable: boolean) => {
    setLoading(true);

    try {
      const response = await fetch(`/api/hosts/${domain}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ disabled: disable })
      });

      if (!response.ok) throw new Error('Failed to toggle domain state');

      await fetchData();

      const state = disable ? 'disabled' : 'enabled';
      showNotification(`Domain ${domain} ${state} successfully`, 'success');
    } catch (error: any) {
      showNotification(`Error updating domain state: ${error?.message} `, 'error');
    } finally {
      setLoading(false);
    }
  };

  const deleteCertificate = async (domain: string) => {
    setConfirmDeleteCertificate(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/certificates/${domain}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete certificate');

      await fetchData();

      showNotification(`Certificate for ${domain} deleted successfully`, 'success');
    } catch (error: any) {
      showNotification(`Error deleting certificate: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const addProxy = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newProxy.domain || !newProxy.target) return;

    setLoading(true);

    try {
      const response = await fetch('/api/proxies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newProxy)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add proxy');
      }

      await fetchProxies();

      showNotification(`Proxy for ${newProxy.domain} added successfully`, 'success');

      setNewProxy({
        domain: '',
        target: '',
        port: 443
      });
    } catch (error: any) {
      showNotification(`Error adding proxy: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const updateProxy = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editProxy) return;

    setLoading(true);

    try {
      const response = await fetch(`/api/proxies/${editProxy.domain}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: editProxy.target,
          port: editProxy.port
        })
      });

      if (!response.ok) throw new Error('Failed to update proxy');

      await fetchProxies();

      showNotification(`Proxy for ${editProxy.domain} updated successfully`, 'success');
      setEditProxy(null);
    } catch (error: any) {
      showNotification(`Error updating proxy: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const deleteProxy = async (domain: string) => {
    setConfirmDeleteProxy(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/proxies/${domain}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete proxy');

      await fetchProxies();

      showNotification(`Proxy for ${domain} deleted successfully`, 'success');
    } catch (error: any) {
      showNotification(`Error deleting proxy: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleProxy = async (domain: string, shouldStart: boolean) => {
    setLoading(true);

    try {
      const endpoint = shouldStart ? 'start' : 'stop';
      const response = await fetch(`/api/proxies/${domain}/${endpoint}`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to ${endpoint} proxy`);
      }

      await fetchProxies();

      const action = shouldStart ? 'started' : 'stopped';
      showNotification(`Proxy for ${domain} ${action} successfully`, 'success');
    } catch (error: any) {
      showNotification(`Error toggling proxy: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const refreshCertificate = async (domain: string) => {
    setLoading(true);

    try {
      const response = await fetch('/api/certificates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ domain })
      });

      if (!response.ok) throw new Error('Failed to refresh certificate');

      await fetchData();

      showNotification(`Certificate for ${domain} refreshed successfully`, 'success');
    } catch (error: any) {
      showNotification(`Error refreshing certificate: ${error?.message} `, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>@axlotl-lab/navigrator</h1>
        <p className="subtitle">Local Domain Manager</p>
      </header>

      {loading && <div className="loading">Loading...</div>}

      {error && (
        <div className="error-banner">
          <p>{error}</p>
          <button onClick={fetchData}>Retry</button>
        </div>
      )}

      {notification && (
        <div className={`notification ${notification.type} `}>
          {notification.message}
        </div>
      )}

      {confirmImport && (
        <div className="confirmation-dialog">
          <div className="confirmation-content">
            <h3>Import All Local Domains</h3>
            <p>This will mark all local domains as managed by Navigrator. Are you sure?</p>
            <div className="confirmation-actions">
              <button
                className="button danger"
                onClick={() => setConfirmImport(false)}
              >
                Cancel
              </button>
              <button
                className="button success"
                onClick={() => importAllDomains()}
              >
                Confirm Import
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteCertificate && (
        <div className="confirmation-dialog">
          <div className="confirmation-content">
            <h3>Delete Certificate</h3>
            <p>Are you sure you want to delete the certificate for {confirmDeleteCertificate}?</p>
            <p className="warning-text">This action cannot be undone.</p>
            <div className="confirmation-actions">
              <button
                className="button secondary"
                onClick={() => setConfirmDeleteCertificate(null)}
              >
                Cancel
              </button>
              <button
                className="button danger"
                onClick={() => deleteCertificate(confirmDeleteCertificate)}
              >
                Delete Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteProxy && (
        <div className="confirmation-dialog">
          <div className="confirmation-content">
            <h3>Delete Proxy</h3>
            <p>Are you sure you want to delete the proxy for {confirmDeleteProxy}?</p>
            <p className="warning-text">If the proxy is running, it will be stopped.</p>
            <div className="confirmation-actions">
              <button
                className="button secondary"
                onClick={() => setConfirmDeleteProxy(null)}
              >
                Cancel
              </button>
              <button
                className="button danger"
                onClick={() => deleteProxy(confirmDeleteProxy)}
              >
                Delete Proxy
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tabs">
        <button
          className={activeTab === 'domains' ? 'active' : ''}
          onClick={() => setActiveTab('domains')}
        >
          Domains
        </button>
        <button
          className={activeTab === 'certificates' ? 'active' : ''}
          onClick={() => setActiveTab('certificates')}
        >
          Certificates
        </button>
        <button
          className={activeTab === 'proxies' ? 'active' : ''}
          onClick={() => setActiveTab('proxies')}
        >
          Proxies
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'domains' && (
          <>
            <form className="add-domain-form" onSubmit={addDomain}>
              <h2>Add New Domain</h2>
              <div className="form-row">
                <input
                  type="text"
                  placeholder="Enter domain (e.g. myapp.local)"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  disabled={loading}
                />
                <button type="submit" disabled={loading || !newDomain}>
                  Add Domain
                </button>
              </div>
              <p className="help-text">
                All domains will point to 127.0.0.1 and include a local SSL certificate
              </p>
            </form>

            <div className="domains-list">
              <div className="domains-header">
                <h2>Your Local Domains</h2>
                <button
                  className="button secondary import-button"
                  onClick={() => setConfirmImport(true)}
                  disabled={loading}
                  title="Import all local domains to manage them with Navigrator"
                >
                  Import All Domains
                </button>
              </div>

              {domains.length === 0 ? (
                <p className="no-data">No domains configured yet</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Certificate</th>
                      <th>State</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domains.map((domain) => (
                      <tr
                        key={domain.domain}
                        className={domain.isDisabled ? 'disabled-row' : ''}
                      >
                        <td>{domain.domain}</td>
                        <td>
                          <span className={`status ${statuses[domain.domain]?.certificateValid ? 'valid' : 'invalid'} `}>
                            {statuses[domain.domain]?.certificateValid ? 'Valid' : 'Invalid/Missing'}
                          </span>
                        </td>
                        <td>
                          <span className={`status ${domain.isDisabled ? 'warning' : 'valid'}`}>
                            {domain.isDisabled ? 'Disabled' : 'Enabled'}
                          </span>
                        </td>
                        <td className="actions-cell">
                          {domain.isCreatedByUs ? (
                            <>
                              <button
                                onClick={() => toggleDomainState(domain.domain, !domain.isDisabled)}
                                className={`button ${domain.isDisabled ? 'success' : 'warning'}`}
                                disabled={loading}
                                title={domain.isDisabled ? 'Enable domain' : 'Disable domain'}
                              >
                                {domain.isDisabled ? 'Enable' : 'Disable'}
                              </button>
                              <button
                                onClick={() => refreshCertificate(domain.domain)}
                                className="button secondary"
                                disabled={loading}
                                title="Refresh SSL certificate"
                              >
                                Refresh Cert
                              </button>
                              <button
                                onClick={() => removeDomain(domain.domain)}
                                className="button danger"
                                disabled={loading}
                                title="Remove domain"
                              >
                                Remove
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => adoptDomain(domain.domain, domain.ip)}
                              className="button primary adopt-button"
                              disabled={loading}
                              title="Start managing this domain with Navigrator"
                            >
                              Adopt
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {activeTab === 'certificates' && (
          <div className="certificates-list">
            <h2>SSL Certificates</h2>

            {certificates.length === 0 ? (
              <p className="no-data">No certificates generated yet</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Status</th>
                    <th>Issuer</th>
                    <th>Valid Until</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {certificates.map((cert) => (
                    <tr key={cert.domain}>
                      <td>{cert.domain}</td>
                      <td>
                        <span className={`status ${cert.isValid ? 'valid' : 'invalid'} `}>
                          {cert.isValid ? 'Valid' : 'Invalid'}
                        </span>
                      </td>
                      <td>{cert.issuer}</td>
                      <td>{new Date(cert.validTo).toLocaleDateString()}</td>
                      <td className="actions-cell">
                        <button
                          onClick={() => refreshCertificate(cert.domain)}
                          className="button secondary"
                          disabled={loading}
                          title="Refresh certificate"
                        >
                          Refresh
                        </button>
                        <button
                          onClick={() => setConfirmDeleteCertificate(cert.domain)}
                          className="button danger"
                          disabled={loading}
                          title="Delete certificate"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'proxies' && (
          <>
            {editProxy ? (
              <form className="add-domain-form" onSubmit={updateProxy}>
                <h2>Edit Proxy for {editProxy.domain}</h2>
                <div className="form-row">
                  <input
                    type="text"
                    placeholder="Target URL (e.g. localhost:3000)"
                    value={editProxy.target}
                    onChange={(e) => setEditProxy({ ...editProxy, target: e.target.value })}
                    disabled={loading}
                  />
                  <input
                    type="number"
                    placeholder="Port (default: 443)"
                    value={editProxy.port}
                    onChange={(e) => setEditProxy({ ...editProxy, port: parseInt(e.target.value) || 443 })}
                    disabled={loading}
                    className="port-input"
                  />
                  <button type="submit" disabled={loading || !editProxy.target}>
                    Update Proxy
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setEditProxy(null)}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <form className="add-domain-form" onSubmit={addProxy}>
                <h2>Create HTTPS Proxy</h2>
                <div className="form-row form-row-multi">
                  <div className="input-group">
                    <label htmlFor="proxy-domain">Domain</label>
                    <select
                      id="proxy-domain"
                      value={newProxy.domain}
                      onChange={(e) => setNewProxy({ ...newProxy, domain: e.target.value })}
                      disabled={loading}
                      required
                    >
                      <option value="">Select a domain</option>
                      {domains
                        .filter(domain =>
                          !domain.isDisabled &&
                          statuses[domain.domain]?.certificateValid &&
                          !proxies.find(p => p.domain === domain.domain)
                        )
                        .map(domain => (
                          <option key={domain.domain} value={domain.domain}>
                            {domain.domain}
                          </option>
                        ))
                      }
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="proxy-target">Target URL</label>
                    <input
                      id="proxy-target"
                      type="text"
                      placeholder="localhost:3000"
                      value={newProxy.target}
                      onChange={(e) => setNewProxy({ ...newProxy, target: e.target.value })}
                      disabled={loading}
                      required
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="proxy-port">HTTPS Port</label>
                    <input
                      id="proxy-port"
                      type="number"
                      placeholder="443"
                      value={newProxy.port}
                      onChange={(e) => setNewProxy({ ...newProxy, port: parseInt(e.target.value) || 443 })}
                      disabled={loading}
                      min="1"
                      max="65535"
                      className="port-input"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !newProxy.domain || !newProxy.target}
                    className="button primary create-proxy-button"
                  >
                    Create Proxy
                  </button>
                </div>
                <p className="help-text">
                  Create a secure HTTPS proxy to your local development server. Traffic to your domain will be forwarded to the target URL.
                </p>
              </form>
            )}

            <div className="proxies-list">
              <h2>Your Proxies</h2>

              {proxies.length === 0 ? (
                <p className="no-data">No proxies configured yet</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Target</th>
                      <th>Port</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proxies.map((proxy) => (
                      <tr key={proxy.domain}>
                        <td>{proxy.domain}</td>
                        <td>{proxy.target}</td>
                        <td>{proxy.port}</td>
                        <td>
                          <span className={`status ${proxy.isRunning ? 'valid' : 'warning'}`}>
                            {proxy.isRunning ? 'Running' : 'Stopped'}
                          </span>
                        </td>
                        <td className="actions-cell">
                          {proxy.isRunning ? (
                            <button
                              onClick={() => toggleProxy(proxy.domain, false)}
                              className="button warning"
                              disabled={loading}
                              title="Stop proxy"
                            >
                              Stop
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleProxy(proxy.domain, true)}
                              className="button success"
                              disabled={loading}
                              title="Start proxy"
                            >
                              Start
                            </button>
                          )}
                          <button
                            onClick={() => setEditProxy(proxy)}
                            className="button secondary"
                            disabled={loading || proxy.isRunning}
                            title={proxy.isRunning ? "Stop proxy before editing" : "Edit proxy configuration"}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setConfirmDeleteProxy(proxy.domain)}
                            className="button danger"
                            disabled={loading}
                            title="Delete proxy"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;