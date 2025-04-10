import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CertificateManager } from './certificates';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn(),
  access: jest.fn(),
  unlink: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('child_process', () => ({
  exec: jest.fn()
}));

// Helper to mock the exec callback pattern
const mockExecImplementation = (stdout = '') => {
  (exec as unknown as jest.Mock).mockImplementation((cmd, callback) => {
    if (callback) {
      callback(null, { stdout, stderr: '' });
    }
    return {
      stdout,
      stderr: ''
    };
  });
};

describe('CertificateManager', () => {
  let certManager: CertificateManager;
  const testDir = path.join(os.tmpdir(), 'test-certs');
  const testCADir = path.join(testDir, 'ca');

  beforeEach(() => {
    jest.clearAllMocks();
    certManager = new CertificateManager(testDir);
    mockExecImplementation('OpenSSL 1.1.1f');
  });

  describe('initialize', () => {
    it('should create certificates and CA directories', async () => {
      await certManager.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith(testDir, { recursive: true });
      expect(fs.mkdir).toHaveBeenCalledWith(testCADir, { recursive: true });
    });

    it('should create local CA if it does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));

      await certManager.initialize();

      // Check that CA creation commands were executed
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('openssl genrsa -out'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('openssl req -x509'),
        expect.any(Function)
      );
    });

    it('should skip CA creation if it already exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      await certManager.initialize();

      // Verify exec was only called once for OpenSSL version check
      expect(exec).toHaveBeenCalledTimes(1);
    });

    it('should throw error if OpenSSL is not installed', async () => {
      (exec as unknown as jest.Mock).mockImplementation((cmd, callback) => {
        if (callback) {
          callback(new Error('Command not found'), { stdout: '', stderr: 'Command not found' });
        }
        throw new Error('Command not found');
      });

      await expect(certManager.initialize()).rejects.toThrow('OpenSSL is not installed');
    });
  });

  describe('createCertificate', () => {
    beforeEach(async () => {
      (certManager as any).hasOpenSSL = true;
      (certManager as any).certsDir = testDir;
      (certManager as any).caDir = testCADir;

      // Mock successful certificate parsing
      jest.spyOn(certManager as any, 'parseCertificate').mockResolvedValue({
        domain: 'test.local',
        validFrom: new Date(),
        validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        issuer: 'Navigrator Local CA',
        isValid: true,
        certFilePath: path.join(testDir, 'test.local.crt'),
        keyFilePath: path.join(testDir, 'test.local.key')
      });
    });

    it('should create certificate files with OpenSSL', async () => {
      const result = await certManager.createCertificate('test.local');

      // Check that OpenSSL commands were executed
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test.local.cnf'),
        expect.stringContaining('[req]')
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('openssl genrsa'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('openssl req -new'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('openssl x509 -req'),
        expect.any(Function)
      );

      // Check that temporary files were cleaned up
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('test.local.csr'));
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('test.local.cnf'));

      // Check that certificate was verified
      expect(certManager['parseCertificate']).toHaveBeenCalledWith('test.local');

      // Check return value
      expect(result).toEqual(expect.objectContaining({
        domain: 'test.local',
        isValid: true
      }));
    });

    it('should throw error if OpenSSL is not available', async () => {
      (certManager as any).hasOpenSSL = false;

      await expect(certManager.createCertificate('test.local')).rejects.toThrow('OpenSSL is not available');
    });

    it('should handle errors during certificate creation', async () => {
      (exec as unknown as jest.Mock).mockImplementation((cmd, callback) => {
        if (cmd.includes('openssl genrsa')) {
          if (callback) {
            callback(new Error('Failed to generate key'), { stdout: '', stderr: 'Failed to generate key' });
          }
          throw new Error('Failed to generate key');
        }
        if (callback) {
          callback(null, { stdout: '', stderr: '' });
        }
        return { stdout: '', stderr: '' };
      });

      await expect(certManager.createCertificate('test.local')).rejects.toThrow('Failed to create certificate');
    });
  });

  describe('verifyCertificate', () => {
    beforeEach(() => {
      (certManager as any).certsDir = testDir;
      (fs.access as jest.Mock).mockResolvedValue(undefined);
    });

    it('should return null if certificate files do not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));

      const result = await certManager.verifyCertificate('test.local');

      expect(result).toBeNull();
    });
  });

  describe('deleteCertificate', () => {
    beforeEach(() => {
      jest.spyOn(certManager, 'verifyCertificate').mockResolvedValue({
        domain: 'test.local',
        validFrom: new Date(),
        validTo: new Date(),
        issuer: 'Navigrator Local CA',
        isValid: true,
        certFilePath: path.join(testDir, 'test.local.crt'),
        keyFilePath: path.join(testDir, 'test.local.key')
      });
    });

    it('should delete certificate files', async () => {
      const result = await certManager.deleteCertificate('test.local');

      expect(fs.unlink).toHaveBeenCalledWith(path.join(testDir, 'test.local.crt'));
      expect(fs.unlink).toHaveBeenCalledWith(path.join(testDir, 'test.local.key'));
      expect(result).toBe(true);
    });

    it('should return false if certificate does not exist', async () => {
      jest.spyOn(certManager, 'verifyCertificate').mockResolvedValue(null);

      const result = await certManager.deleteCertificate('test.local');

      expect(result).toBe(false);
    });

    it('should handle errors when deleting files', async () => {
      (fs.unlink as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      const result = await certManager.deleteCertificate('test.local');

      expect(result).toBe(false);
    });
  });

  describe('listCertificates', () => {
    beforeEach(() => {
      (fs.readdir as jest.Mock).mockResolvedValue([
        'test1.local.crt',
        'test1.local.key',
        'test2.local.crt',
        'test2.local.key'
      ]);

      jest.spyOn(certManager, 'verifyCertificate').mockImplementation(async (domain) => {
        return {
          domain,
          validFrom: new Date(),
          validTo: new Date(),
          issuer: 'Navigrator Local CA',
          isValid: true,
          certFilePath: path.join(testDir, `${domain}.crt`),
          keyFilePath: path.join(testDir, `${domain}.key`)
        };
      });
    });

    it('should list certificates in the certificates directory', async () => {
      const certificates = await certManager.listCertificates();

      expect(certificates).toHaveLength(2);
      expect(certificates[0].domain).toBe('test1.local');
      expect(certificates[1].domain).toBe('test2.local');
    });

    it('should filter out invalid certificates', async () => {
      jest.spyOn(certManager, 'verifyCertificate').mockImplementation(async (domain) => {
        if (domain === 'test1.local') {
          return null;
        }
        return {
          domain,
          validFrom: new Date(),
          validTo: new Date(),
          issuer: 'Navigrator Local CA',
          isValid: true,
          certFilePath: path.join(testDir, `${domain}.crt`),
          keyFilePath: path.join(testDir, `${domain}.key`)
        };
      });

      const certificates = await certManager.listCertificates();

      expect(certificates).toHaveLength(1);
      expect(certificates[0].domain).toBe('test2.local');
    });

    it('should handle errors when listing certificates', async () => {
      (fs.readdir as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      const certificates = await certManager.listCertificates();

      expect(certificates).toEqual([]);
    });
  });
});