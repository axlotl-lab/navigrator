import * as fs from 'fs/promises';
import * as os from 'os';
import { HostsManager } from './hosts';

// Mock fs and os modules
jest.mock('fs/promises');
jest.mock('os');

// Constants for tests
const APP_IDENTIFIER = '# @axlotl-lab/navigrator';
const DISABLED_IDENTIFIER = '# @axlotl-lab/navigrator-disabled';
const MOCK_HOSTS_PATH = '/mock/etc/hosts';

describe('HostsManager', () => {
  let hostsManager: HostsManager;
  let mockHostsContent: string;

  beforeEach(() => {
    // Reset mocks
    jest.resetAllMocks();

    // Mock os.platform to return 'linux' for test
    (os.platform as jest.Mock).mockReturnValue('linux');

    // Mock fs.readFile to return mock hosts file content
    mockHostsContent = `
127.0.0.1 localhost
127.0.0.1 example.local
${APP_IDENTIFIER}
127.0.0.1 test.local
${APP_IDENTIFIER}
# 127.0.0.1 disabled.local
${DISABLED_IDENTIFIER}
192.168.1.1 external.example
# Comment line
::1 ipv6.local
127.0.0.1 notmanaged.local
    `;

    (fs.readFile as jest.Mock).mockResolvedValue(mockHostsContent);

    // Mock other fs functions
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.appendFile as jest.Mock).mockResolvedValue(undefined);

    // Create instance
    hostsManager = new HostsManager();

    // Override private property for testing
    (hostsManager as any).hostsFilePath = MOCK_HOSTS_PATH;
  });

  describe('readHosts', () => {
    it('should read and parse hosts file correctly', async () => {
      const hosts = await hostsManager.readHosts();

      expect(hosts).toHaveLength(7); // 7 valid host entries in mock content

      // Check example.local entry
      const exampleHost = hosts.find(h => h.domain === 'example.local');
      expect(exampleHost).toBeDefined();
      expect(exampleHost?.ip).toBe('127.0.0.1');
      expect(exampleHost?.isCreatedByUs).toBe(true);
      expect(exampleHost?.isDisabled).toBe(false);

      // Check test.local entry
      const testHost = hosts.find(h => h.domain === 'test.local');
      expect(testHost).toBeDefined();
      expect(testHost?.isCreatedByUs).toBe(true);

      // Check disabled.local entry
      const disabledHost = hosts.find(h => h.domain === 'disabled.local');
      expect(disabledHost).toBeDefined();
      expect(disabledHost?.isCreatedByUs).toBe(true);
      expect(disabledHost?.isDisabled).toBe(true);

      // Check external.example entry
      const externalHost = hosts.find(h => h.domain === 'external.example');
      expect(externalHost).toBeDefined();
      expect(externalHost?.isCreatedByUs).toBe(false);

      // Check notmanaged.local entry
      const notManagedHost = hosts.find(h => h.domain === 'notmanaged.local');
      expect(notManagedHost).toBeDefined();
      expect(notManagedHost?.isCreatedByUs).toBe(false);
    });

    it('should handle fs errors gracefully', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('Mock file read error'));

      await expect(hostsManager.readHosts()).rejects.toThrow('Failed to read hosts file');
    });
  });

  describe('readLocalHosts', () => {
    it('should return only local hosts (127.0.0.1 or ::1)', async () => {
      const localHosts = await hostsManager.readLocalHosts();

      expect(localHosts.some(h => h.ip === '192.168.1.1')).toBe(false);
      expect(localHosts.some(h => h.domain === 'localhost')).toBe(true);
      expect(localHosts.some(h => h.domain === 'ipv6.local')).toBe(true);
    });
  });

  describe('addHost', () => {
    it('should add a new host entry to hosts file', async () => {
      await hostsManager.addHost('newdomain.local');

      expect(fs.appendFile).toHaveBeenCalledWith(
        MOCK_HOSTS_PATH,
        `\n127.0.0.1 newdomain.local\n${APP_IDENTIFIER}`,
        'utf-8'
      );
    });

    it('should use provided IP if specified', async () => {
      await hostsManager.addHost('customip.local', '192.168.0.100');

      expect(fs.appendFile).toHaveBeenCalledWith(
        MOCK_HOSTS_PATH,
        `\n192.168.0.100 customip.local\n${APP_IDENTIFIER}`,
        'utf-8'
      );
    });

    it('should mark existing host as ours if already exists but not managed', async () => {
      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce(mockHostsContent) // First call in readHosts
        .mockResolvedValueOnce(mockHostsContent); // Second call in markHostAsOurs

      await hostsManager.addHost('notmanaged.local');

      // Check that writeFile was called with modified content
      expect(fs.writeFile).toHaveBeenCalled();
      const writeFileCall = (fs.writeFile as jest.Mock).mock.calls[0];
      expect(writeFileCall[0]).toBe(MOCK_HOSTS_PATH);
      expect(writeFileCall[1]).toContain('notmanaged.local');
      expect(writeFileCall[1]).toContain(APP_IDENTIFIER);
    });

    it('should enable a disabled host', async () => {
      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce(mockHostsContent) // First call in readHosts
        .mockResolvedValueOnce(mockHostsContent); // Second call in toggleHostState

      await hostsManager.addHost('disabled.local');

      expect(fs.writeFile).toHaveBeenCalled();
      const writeFileCall = (fs.writeFile as jest.Mock).mock.calls[0];
      expect(writeFileCall[0]).toBe(MOCK_HOSTS_PATH);
      expect(writeFileCall[1]).toContain('127.0.0.1 disabled.local');
      expect(writeFileCall[1]).toContain(APP_IDENTIFIER);
      expect(writeFileCall[1]).not.toContain('# 127.0.0.1 disabled.local');
    });
  });

  describe('adoptHost', () => {
    it('should mark an existing host as managed by us', async () => {
      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce(mockHostsContent) // For the initial readHosts check
        .mockResolvedValueOnce(mockHostsContent); // For markHostAsOurs

      await hostsManager.adoptHost('notmanaged.local');

      expect(fs.writeFile).toHaveBeenCalled();
      const writeFileCall = (fs.writeFile as jest.Mock).mock.calls[0];
      expect(writeFileCall[1]).toContain('127.0.0.1 notmanaged.local');
      expect(writeFileCall[1]).toContain(APP_IDENTIFIER);
    });

    it('should return false if host does not exist', async () => {
      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce(mockHostsContent) // First call in markHostAsOurs
        .mockResolvedValueOnce(mockHostsContent); // Second call

      const result = await hostsManager.adoptHost('nonexistent.local');

      expect(result).toBe(false);
    });
  });

  describe('importAllLocalHosts', () => {
    it('should adopt all local hosts that are not already managed', async () => {
      // Multiple readFile calls for repeated checks
      (fs.readFile as jest.Mock).mockResolvedValue(mockHostsContent);

      const result = await hostsManager.importAllLocalHosts();

      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);

      // Should have called writeFile for adoption
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('toggleHostState', () => {
    it('should disable an enabled host', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(mockHostsContent);

      await hostsManager.toggleHostState('test.local', true);

      expect(fs.writeFile).toHaveBeenCalled();
      const writeFileCall = (fs.writeFile as jest.Mock).mock.calls[0];
      expect(writeFileCall[1]).toContain('# 127.0.0.1 test.local');
      expect(writeFileCall[1]).toContain(DISABLED_IDENTIFIER);
    });

    it('should enable a disabled host', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(mockHostsContent);

      await hostsManager.toggleHostState('disabled.local', false);

      expect(fs.writeFile).toHaveBeenCalled();
      const writeFileCall = (fs.writeFile as jest.Mock).mock.calls[0];
      expect(writeFileCall[1]).toContain('127.0.0.1 disabled.local');
      expect(writeFileCall[1]).toContain(APP_IDENTIFIER);
      expect(writeFileCall[1]).not.toContain('# 127.0.0.1 disabled.local');
    });

    it('should return false if host is not managed by us', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(mockHostsContent);

      const result = await hostsManager.toggleHostState('notmanaged.local', true);

      expect(result).toBe(false);
    });
  });

  describe('removeHost', () => {
    it('should remove a host managed by us', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(mockHostsContent);

      await hostsManager.removeHost('test.local');

      expect(fs.writeFile).toHaveBeenCalled();
      const writeFileCall = (fs.writeFile as jest.Mock).mock.calls[0];
      expect(writeFileCall[1]).not.toContain('127.0.0.1 test.local');
    });

    it('should remove a disabled host managed by us', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(mockHostsContent);

      await hostsManager.removeHost('disabled.local');

      expect(fs.writeFile).toHaveBeenCalled();
      const writeFileCall = (fs.writeFile as jest.Mock).mock.calls[0];
      expect(writeFileCall[1]).not.toContain('disabled.local');
    });

    it('should return false if host is not managed by us', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(mockHostsContent);

      const result = await hostsManager.removeHost('notmanaged.local');

      expect(result).toBe(false);
    });
  });
});