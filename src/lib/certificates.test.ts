import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as forge from 'node-forge';
import * as os from 'os';
import * as path from 'path';
import { CertificateManager } from './certificates';

// Mock para fs/promises
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn(),
  access: jest.fn()
}));

// Mock para child_process
jest.mock('child_process', () => ({
  execSync: jest.fn(),
  exec: jest.fn((command, callback) => {
    if (callback) callback(null, { stdout: '', stderr: '' });
    return { stdout: '', stderr: '' };
  })
}));

// Mock para node-forge
jest.mock('node-forge', () => {
  const actualForge = jest.requireActual('node-forge');
  return {
    ...actualForge,
    pki: {
      ...actualForge.pki,
      createCertificate: jest.fn().mockReturnValue({
        publicKey: {},
        setSubject: jest.fn(),
        setIssuer: jest.fn(),
        setExtensions: jest.fn(),
        sign: jest.fn(),
        serialNumber: '',
        validity: {
          notBefore: new Date(),
          notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        },
        subject: {
          getField: jest.fn().mockReturnValue({ value: 'test.local' })
        },
        issuer: {
          getField: jest.fn().mockReturnValue({ value: 'Axlotl Lab Navigrator' })
        },
        extensions: []
      }),
      certificateFromPem: jest.fn().mockReturnValue({
        validity: {
          notBefore: new Date(),
          notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        },
        subject: {
          getField: jest.fn().mockReturnValue({ value: 'test.local' })
        },
        issuer: {
          getField: jest.fn().mockReturnValue({ value: 'Axlotl Lab Navigrator' })
        },
        extensions: []
      }),
      certificateToPem: jest.fn().mockReturnValue('-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAJC1HiIAZAiIMA==\n-----END CERTIFICATE-----\n'),
      privateKeyToPem: jest.fn().mockReturnValue('-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDx+BNL8SLR==\n-----END PRIVATE KEY-----\n'),
      rsa: {
        generateKeyPair: jest.fn().mockReturnValue({
          publicKey: {},
          privateKey: {}
        })
      }
    },
    md: {
      sha256: {
        create: jest.fn().mockReturnValue({})
      }
    },
    random: {
      getBytesSync: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4, 5]))
    },
    util: {
      bytesToHex: jest.fn().mockReturnValue('0102030405')
    }
  };
});

describe('CertificateManager', () => {
  let certManager: CertificateManager;
  const testDir = path.join(os.tmpdir(), 'test-certs');

  beforeEach(() => {
    jest.clearAllMocks();
    certManager = new CertificateManager(testDir);
  });

  describe('initialize', () => {
    it('should create certificates directory', async () => {
      await certManager.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith(testDir, { recursive: true });
    });

    it('should initialize mkcert if available', async () => {
      // Simular que mkcert está instalado
      jest.spyOn(certManager as any, 'checkMkcertInstalled').mockReturnValue(true);

      await certManager.initialize();

      expect(exec).toHaveBeenCalledWith('mkcert -install', expect.any(Function));
    });

    it('should handle errors during initialization', async () => {
      (fs.mkdir as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await expect(certManager.initialize()).rejects.toThrow('Failed to initialize certificate manager');
    });
  });

  describe('createCertificate', () => {
    beforeEach(() => {
      // Acceder a propiedades privadas
      (certManager as any).certsDir = testDir;
    });

    it('should use mkcert if available', async () => {
      // Simular que mkcert está instalado
      jest.spyOn(certManager as any, 'checkMkcertInstalled').mockReturnValue(true);
      (certManager as any).hasMkcert = true;

      const createWithMkcertSpy = jest.spyOn(certManager as any, 'createCertificateWithMkcert')
        .mockResolvedValue({
          domain: 'test.local',
          validFrom: new Date(),
          validTo: new Date(),
          issuer: 'mkcert',
          isValid: true,
          certFilePath: path.join(testDir, 'test.local.crt'),
          keyFilePath: path.join(testDir, 'test.local.key')
        });

      await certManager.createCertificate('test.local');

      expect(createWithMkcertSpy).toHaveBeenCalledWith('test.local');
    });

    it('should use node-forge if mkcert is not available', async () => {
      // Simular que mkcert no está instalado
      jest.spyOn(certManager as any, 'checkMkcertInstalled').mockReturnValue(false);
      (certManager as any).hasMkcert = false;

      const createWithForgeSpy = jest.spyOn(certManager as any, 'createCertificateWithForge')
        .mockResolvedValue({
          domain: 'test.local',
          validFrom: new Date(),
          validTo: new Date(),
          issuer: 'Axlotl Lab Navigrator',
          isValid: true,
          certFilePath: path.join(testDir, 'test.local.crt'),
          keyFilePath: path.join(testDir, 'test.local.key')
        });

      await certManager.createCertificate('test.local');

      expect(createWithForgeSpy).toHaveBeenCalledWith('test.local');
    });
  });

  describe('verifyCertificate', () => {
    beforeEach(() => {
      // Acceder a propiedades privadas
      (certManager as any).certsDir = testDir;

      // Mock para tener acceso a los archivos
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      // Mock para leer el archivo de certificado
      (fs.readFile as jest.Mock).mockResolvedValue('-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAJC1HiIAZAiIMA==\n-----END CERTIFICATE-----\n');
    });

    it('should return null if certificate files do not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));

      const result = await certManager.verifyCertificate('test.local');

      expect(result).toBeNull();
    });

    it('should parse certificate and return info if it exists', async () => {
      const result = await certManager.verifyCertificate('test.local');

      expect(result).not.toBeNull();
      expect(result?.domain).toBe('test.local');
      expect(result?.isValid).toBe(true);
    });

    it('should handle errors when verifying certificate', async () => {
      (forge.pki.certificateFromPem as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid certificate');
      });

      const result = await certManager.verifyCertificate('test.local');

      expect(result).toBeNull();
    });
  });

  describe('listCertificates', () => {
    beforeEach(() => {
      // Mock para listar archivos
      (fs.readdir as jest.Mock).mockResolvedValue([
        'test1.local.crt',
        'test1.local.key',
        'test2.local.crt',
        'test2.local.key'
      ]);

      // Mock para verificar certificados
      jest.spyOn(certManager, 'verifyCertificate').mockImplementation(async (domain) => {
        return {
          domain,
          validFrom: new Date(),
          validTo: new Date(),
          issuer: 'Axlotl Lab Navigrator',
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
          return null; // Certificado inválido
        }
        return {
          domain,
          validFrom: new Date(),
          validTo: new Date(),
          issuer: 'Axlotl Lab Navigrator',
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