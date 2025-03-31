import React, { useEffect, useState } from 'react';
import './styles.css';

/**
 * Tipos de datos
 */
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

/**
 * Componente principal
 */
function App() {
  const [domains, setDomains] = useState<Host[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [statuses, setStatuses] = useState<{ [key: string]: DomainStatus }>({});
  const [newDomain, setNewDomain] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'domains' | 'certificates'>('domains');
  const [confirmImport, setConfirmImport] = useState(false);
  const [confirmDeleteCertificate, setConfirmDeleteCertificate] = useState<string | null>(null);

  // Cargar datos al iniciar
  useEffect(() => {
    fetchData();
  }, []);

  // Cargar todos los datos
  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      await Promise.all([
        fetchHosts(),
        fetchCertificates()
      ]);

      setLoading(false);
    } catch (error) {
      setError('Failed to load data. Please check if the server is running with admin privileges.');
      setLoading(false);
    }
  };

  // Cargar hosts
  const fetchHosts = async () => {
    const response = await fetch('/api/hosts');
    if (!response.ok) throw new Error('Failed to fetch hosts');

    const data = await response.json();
    setDomains(data.hosts);

    // Actualizar estado para cada dominio
    await Promise.all(data.hosts.map((host: any) => fetchDomainStatus(host.domain)));
  };

  // Cargar certificados
  const fetchCertificates = async () => {
    const response = await fetch('/api/certificates');
    if (!response.ok) throw new Error('Failed to fetch certificates');

    const data = await response.json();
    setCertificates(data.certificates);
  };

  // Verificar estado de un dominio
  const fetchDomainStatus = async (domain: string) => {
    const response = await fetch(`/api/status/${domain}`);
    if (!response.ok) return;

    const data = await response.json();
    setStatuses(prev => ({
      ...prev,
      [domain]: data.status
    }));
  };

  // Agregar un nuevo dominio
  const addDomain = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newDomain) return;

    setLoading(true);

    try {
      // Agregar al archivo hosts
      const hostResponse = await fetch('/api/hosts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ domain: newDomain })
      });

      if (!hostResponse.ok) throw new Error('Failed to add host');

      // Crear certificado
      const certResponse = await fetch('/api/certificates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ domain: newDomain })
      });

      if (!certResponse.ok) throw new Error('Failed to create certificate');

      // Actualizar datos
      await fetchData();

      // Mostrar notificación
      showNotification(`Domain ${newDomain} added successfully`, 'success');

      // Limpiar campo
      setNewDomain('');
    } catch (error: any) {
      showNotification(`Error adding domain: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Adoptar un dominio existente
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

      // Actualizar datos
      await fetchData();

      // Mostrar notificación
      showNotification(`Domain ${domain} adopted successfully`, 'success');
    } catch (error: any) {
      showNotification(`Error adopting domain: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Importar todos los dominios locales
  const importAllDomains = async () => {
    setLoading(true);
    setConfirmImport(false);

    try {
      const response = await fetch('/api/hosts/import-all', {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to import hosts');

      const data = await response.json();

      // Actualizar datos
      await fetchData();

      // Mostrar notificación
      showNotification(data.message, 'success');
    } catch (error: any) {
      showNotification(`Error importing domains: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Eliminar un dominio
  const removeDomain = async (domain: string) => {
    if (!confirm(`Are you sure you want to remove ${domain}?`)) return;

    setLoading(true);

    try {
      // Eliminar del archivo hosts (y su certificado asociado automáticamente)
      const response = await fetch(`/api/hosts/${domain}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to remove host');

      const data = await response.json();

      // Actualizar datos
      await fetchData();

      // Mostrar notificación
      showNotification(data.message, 'success');
    } catch (error: any) {
      showNotification(`Error removing domain: ${error?.message} `, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Habilitar/deshabilitar un dominio
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

      // Actualizar datos
      await fetchData();

      // Mostrar notificación
      const state = disable ? 'disabled' : 'enabled';
      showNotification(`Domain ${domain} ${state} successfully`, 'success');
    } catch (error: any) {
      showNotification(`Error updating domain state: ${error?.message} `, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Eliminar un certificado
  const deleteCertificate = async (domain: string) => {
    setConfirmDeleteCertificate(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/certificates/${domain}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete certificate');

      // Actualizar datos
      await fetchData();

      // Mostrar notificación
      showNotification(`Certificate for ${domain} deleted successfully`, 'success');
    } catch (error: any) {
      showNotification(`Error deleting certificate: ${error?.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Mostrar notificación
  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Refrescar certificado
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

      // Actualizar datos
      await fetchData();

      // Mostrar notificación
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
                            // Acciones para dominios gestionados
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
                            // Acción para adoptar dominios no gestionados
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
      </div>
    </div>
  );
}

export default App;