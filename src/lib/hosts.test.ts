import * as fs from 'fs/promises';
import * as os from 'os';
import { HostsManager } from './hosts';

// Mock para fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined)
}));

// Mock para os
jest.mock('os', () => ({
  platform: jest.fn(),
  tmpdir: jest.fn().mockReturnValue('/tmp')
}));

describe('HostsManager', () => {
  let hostsManager: HostsManager;
  let mockHostsContent: string;

  beforeEach(() => {
    jest.clearAllMocks();

    // Simular sistema operativo Linux por defecto
    (os.platform as jest.Mock).mockReturnValue('linux');

    // Crear instancia de HostsManager para testing
    hostsManager = new HostsManager();

    // Contenido de muestra para el archivo hosts
    mockHostsContent = `
# Sample hosts file
127.0.0.1 localhost
::1 localhost

# Regular entries
127.0.0.1 example.local
# @axlotl-lab/navigrator
127.0.0.1 app.example.local
# @axlotl-lab/navigrator

192.168.1.1 router.local
`.trim();

    // Mock de readFile para devolver el contenido de muestra
    (fs.readFile as jest.Mock).mockResolvedValue(mockHostsContent);
  });

  describe('constructor', () => {
    it('should set correct hosts file path for Windows', () => {
      (os.platform as jest.Mock).mockReturnValue('win32');
      const winHostsManager = new HostsManager();

      // Acceder a la propiedad privada con type assertion
      const hostsFilePath = (winHostsManager as any).hostsFilePath;
      expect(hostsFilePath).toBe('C:\\Windows\\System32\\drivers\\etc\\hosts');
    });

    it('should set correct hosts file path for Linux/macOS', () => {
      (os.platform as jest.Mock).mockReturnValue('darwin'); // macOS
      const macHostsManager = new HostsManager();

      const hostsFilePath = (macHostsManager as any).hostsFilePath;
      expect(hostsFilePath).toBe('/etc/hosts');
    });
  });

  describe('readHosts', () => {
    it('should read and parse hosts file correctly', async () => {
      const hosts = await hostsManager.readHosts();

      expect(hosts).toHaveLength(4);
      expect(hosts[0]).toEqual({
        ip: '127.0.0.1',
        domain: 'localhost',
        isCreatedByUs: false,
        lineNumber: 2
      });

      // Verificar que identifica correctamente los hosts creados por nosotros
      expect(hosts[2]).toEqual({
        ip: '127.0.0.1',
        domain: 'app.example.local',
        isCreatedByUs: true,
        lineNumber: 6
      });
    });

    it('should handle errors when reading hosts file', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await expect(hostsManager.readHosts()).rejects.toThrow('Failed to read hosts file');
    });
  });

  describe('readLocalHosts', () => {
    it('should return only localhost entries', async () => {
      const localHosts = await hostsManager.readLocalHosts();

      expect(localHosts).toHaveLength(3);
      expect(localHosts.every(host => host.ip === '127.0.0.1' || host.ip === '::1')).toBe(true);
    });
  });

  describe('addHost', () => {
    it('should add a new host entry', async () => {
      const appendSpy = jest.spyOn(fs, 'appendFile');

      await hostsManager.addHost('new.example.local');

      // Verificar que se llamó a appendFile con el contenido correcto
      expect(appendSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('127.0.0.1 new.example.local'),
        'utf-8'
      );
      expect(appendSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('# @axlotl-lab/navigrator'),
        'utf-8'
      );
    });

    it('should not add duplicate hosts', async () => {
      // Simular que ya existe y fue creado por nosotros
      const mockReadHosts = jest.spyOn(hostsManager, 'readHosts').mockResolvedValue([
        {
          ip: '127.0.0.1',
          domain: 'existing.local',
          isCreatedByUs: true
        }
      ]);

      const result = await hostsManager.addHost('existing.local');

      expect(result).toBe(true);
      // Verificar que no se escribió nada al archivo hosts
      expect(fs.appendFile).not.toHaveBeenCalled();

      mockReadHosts.mockRestore();
    });

    it('should mark existing hosts as ours if not already marked', async () => {
      // Simular que existe pero no fue creado por nosotros
      const mockReadHosts = jest.spyOn(hostsManager, 'readHosts').mockResolvedValue([
        {
          ip: '127.0.0.1',
          domain: 'unmarked.local',
          isCreatedByUs: false
        }
      ]);

      const markMethod = jest.spyOn(hostsManager as any, 'markHostAsOurs').mockResolvedValue(true);

      const result = await hostsManager.addHost('unmarked.local');

      expect(result).toBe(true);
      expect(markMethod).toHaveBeenCalledWith('unmarked.local', '127.0.0.1');

      mockReadHosts.mockRestore();
      markMethod.mockRestore();
    });

    it('should handle errors when adding host', async () => {
      jest.spyOn(hostsManager, 'readHosts').mockRejectedValue(new Error('Failed to read'));

      await expect(hostsManager.addHost('error.local')).rejects.toThrow('Failed to add host');
    });
  });

  describe('removeHost', () => {
    it('should remove a host created by our application', async () => {
      // Mock el método writeHostsFile para evitar escribir realmente
      const writeMethod = jest.spyOn(hostsManager as any, 'writeHostsFile').mockResolvedValue(true);

      const result = await hostsManager.removeHost('app.example.local');

      expect(result).toBe(true);
      // Verificar que se llamó a writeHostsFile sin las líneas del host eliminado
      expect(writeMethod).toHaveBeenCalledWith(expect.not.stringContaining('app.example.local'));

      writeMethod.mockRestore();
    });

    it('should not remove hosts not created by our application', async () => {
      const result = await hostsManager.removeHost('example.local');

      // Debería retornar false porque no fue creado por nosotros
      expect(result).toBe(false);
    });

    it('should handle errors when removing host', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await expect(hostsManager.removeHost('app.example.local')).rejects.toThrow('Failed to remove host');
    });
  });

  describe('writeHostsFile', () => {
    it('should write to hosts file directly', async () => {
      const writeSpy = jest.spyOn(fs, 'writeFile');

      const result = await (hostsManager as any).writeHostsFile('test content');

      expect(result).toBe(true);
      expect(writeSpy).toHaveBeenCalledWith(
        expect.any(String),
        'test content',
        'utf-8'
      );
    });

    it('should handle errors when writing hosts file', async () => {
      (fs.writeFile as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await expect((hostsManager as any).writeHostsFile('test')).rejects.toThrow('Failed to write hosts file');
    });
  });

  describe('appendToHostsFile', () => {
    it('should append to hosts file directly', async () => {
      const appendSpy = jest.spyOn(fs, 'appendFile');

      const result = await (hostsManager as any).appendToHostsFile('test content');

      expect(result).toBe(true);
      expect(appendSpy).toHaveBeenCalledWith(
        expect.any(String),
        'test content',
        'utf-8'
      );
    });

    it('should handle errors when appending to hosts file', async () => {
      (fs.appendFile as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await expect((hostsManager as any).appendToHostsFile('test')).rejects.toThrow('Failed to append to hosts file');
    });
  });
});