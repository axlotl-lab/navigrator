import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Identificador único para los registros creados por nuestra aplicación
const APP_IDENTIFIER = '# @axlotl-lab/navigrator';
const DISABLED_IDENTIFIER = '# @axlotl-lab/navigrator-disabled';

// Tipo para representar un registro en el archivo hosts
export interface HostEntry {
  ip: string;
  domain: string;
  isCreatedByUs: boolean;
  isDisabled: boolean;
  lineNumber?: number;
}

export class HostsManager {
  private hostsFilePath: string;

  constructor() {
    // Determinar la ruta del archivo hosts según el sistema operativo
    if (os.platform() === 'win32') {
      this.hostsFilePath = path.join('C:', 'Windows', 'System32', 'drivers', 'etc', 'hosts');
    } else {
      this.hostsFilePath = '/etc/hosts';
    }
  }

  /**
   * Lee el archivo hosts y devuelve todas las entradas
   */
  public async readHosts(): Promise<HostEntry[]> {
    try {
      const content = await fs.readFile(this.hostsFilePath, 'utf-8');
      return this.parseHostsFile(content);
    } catch (error: any) {
      console.error('Error reading hosts file:', error);
      throw new Error(`Failed to read hosts file: ${error?.message}`);
    }
  }

  /**
   * Lee solo las entradas locales (127.0.0.1 o ::1)
   */
  public async readLocalHosts(): Promise<HostEntry[]> {
    const allHosts = await this.readHosts();
    return allHosts.filter(host => host.ip === '127.0.0.1' || host.ip === '::1');
  }

  /**
   * Parsea el contenido del archivo hosts
   */
  private parseHostsFile(content: string): HostEntry[] {
    const lines = content.split('\n');
    const entries: HostEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      let isDisabled = false;

      // Detectar si la línea está comentada
      if (line.startsWith('#')) {
        // Verificar si es un dominio deshabilitado por nosotros
        if (i < lines.length - 1 && lines[i + 1].trim() === DISABLED_IDENTIFIER) {
          // Quitar el comentario para obtener la información de la línea
          line = line.substring(1).trim();
          isDisabled = true;
        } else if (line === APP_IDENTIFIER || line === DISABLED_IDENTIFIER) {
          continue;
        } else {
          continue; // Ignorar otros comentarios
        }
      }

      // Ignorar líneas vacías
      if (line === '') continue;

      // Verificar si la línea siguiente es nuestro identificador
      const isCreatedByUs = (i < lines.length - 1 &&
        (lines[i + 1].trim() === APP_IDENTIFIER || lines[i + 1].trim() === DISABLED_IDENTIFIER));

      // Extraer IP y dominio
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const ip = parts[0];
        const domain = parts[1];

        entries.push({
          ip,
          domain,
          isCreatedByUs,
          isDisabled,
          lineNumber: i + 1
        });

        // Si esta entrada es nuestra, saltar la siguiente línea (que contiene el identificador)
        if (isCreatedByUs) i++;
      }
    }

    return entries;
  }

  /**
   * Agrega un nuevo registro al archivo hosts
   */
  public async addHost(domain: string, ip: string = '127.0.0.1'): Promise<boolean> {
    try {
      // Verificar si el dominio ya existe
      const hosts = await this.readHosts();
      const existingHost = hosts.find(h => h.domain === domain && h.ip === ip);

      if (existingHost) {
        if (existingHost.isCreatedByUs) {
          if (existingHost.isDisabled) {
            // Si está deshabilitado, lo habilitamos
            return await this.toggleHostState(domain, false);
          }
          return true; // Ya existe y está habilitado, no hacer nada
        } else {
          // Existe pero no fue creado por nosotros, marcar como nuestro
          return await this.markHostAsOurs(domain, ip);
        }
      }

      // Agregar nuevo host
      const newEntry = `\n${ip} ${domain}\n${APP_IDENTIFIER}`;

      return await this.appendToHostsFile(newEntry);
    } catch (error: any) {
      console.error('Error adding host:', error);
      throw new Error(`Failed to add host: ${error?.message}`);
    }
  }

  /**
   * "Adopta" un dominio existente marcándolo como creado por nuestra aplicación
   */
  public async adoptHost(domain: string, ip: string = '127.0.0.1'): Promise<boolean> {
    return await this.markHostAsOurs(domain, ip);
  }

  /**
   * Importa todos los dominios locales existentes y los marca como nuestros
   */
  public async importAllLocalHosts(): Promise<{ success: boolean, count: number }> {
    try {
      const hosts = await this.readLocalHosts();
      const hostsToAdopt = hosts.filter(host => !host.isCreatedByUs);

      let adoptedCount = 0;

      for (const host of hostsToAdopt) {
        const success = await this.adoptHost(host.domain, host.ip);
        if (success) adoptedCount++;
      }

      return {
        success: adoptedCount > 0,
        count: adoptedCount
      };
    } catch (error: any) {
      console.error('Error importing all hosts:', error);
      throw new Error(`Failed to import hosts: ${error?.message}`);
    }
  }

  /**
   * Marca un host existente como creado por nuestra aplicación
   */
  private async markHostAsOurs(domain: string, ip: string): Promise<boolean> {
    try {
      const content = await fs.readFile(this.hostsFilePath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '' || line.startsWith('#')) continue;

        const parts = line.split(/\s+/);
        if (parts.length >= 2 && parts[0] === ip && parts[1] === domain) {
          // Verificar si la siguiente línea ya es nuestro identificador
          if (i < lines.length - 1 &&
            (lines[i + 1].trim() === APP_IDENTIFIER || lines[i + 1].trim() === DISABLED_IDENTIFIER)) {
            return true; // Ya está marcado
          }

          // Insertar identificador después de esta línea
          lines.splice(i + 1, 0, APP_IDENTIFIER);
          modified = true;
          break;
        }
      }

      if (modified) {
        return await this.writeHostsFile(lines.join('\n'));
      }

      return false;
    } catch (error: any) {
      console.error('Error marking host as ours:', error);
      throw new Error(`Failed to mark host: ${error?.message}`);
    }
  }

  /**
   * Cambia el estado de un host (habilitado/deshabilitado)
   */
  public async toggleHostState(domain: string, disable: boolean, ip: string = '127.0.0.1'): Promise<boolean> {
    try {
      const content = await fs.readFile(this.hostsFilePath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Ignorar líneas vacías
        if (line === '') continue;

        // Verificar si es un comentario de nuestra aplicación
        if (line === APP_IDENTIFIER || line === DISABLED_IDENTIFIER) continue;

        // Verificar si es una línea comentada que necesitamos habilitar
        const isCommentedLine = line.startsWith('#');
        let actualLine = isCommentedLine ? line.substring(1).trim() : line;

        const parts = actualLine.split(/\s+/);
        if (parts.length >= 2 && parts[0] === ip && parts[1] === domain) {
          // Verificar si la siguiente línea es nuestro identificador
          const hasOurIdentifier =
            i < lines.length - 1 &&
            (lines[i + 1].trim() === APP_IDENTIFIER || lines[i + 1].trim() === DISABLED_IDENTIFIER);

          if (hasOurIdentifier) {
            // Si queremos deshabilitar y ya está comentado, o habilitar y ya está sin comentar, no hacer nada
            if ((disable && isCommentedLine) || (!disable && !isCommentedLine)) {
              // Solo actualizar el identificador si es necesario
              if ((disable && lines[i + 1].trim() !== DISABLED_IDENTIFIER) ||
                (!disable && lines[i + 1].trim() !== APP_IDENTIFIER)) {
                lines[i + 1] = disable ? DISABLED_IDENTIFIER : APP_IDENTIFIER;
                modified = true;
              }
            } else {
              // Cambiar el estado
              lines[i] = disable ? `# ${actualLine}` : actualLine;
              lines[i + 1] = disable ? DISABLED_IDENTIFIER : APP_IDENTIFIER;
              modified = true;
            }
            break;
          }
        }
      }

      if (modified) {
        return await this.writeHostsFile(lines.join('\n'));
      }

      return false;
    } catch (error: any) {
      console.error('Error toggling host state:', error);
      throw new Error(`Failed to toggle host state: ${error?.message}`);
    }
  }

  /**
   * Elimina un host que fue creado por nuestra aplicación
   */
  public async removeHost(domain: string, ip: string = '127.0.0.1'): Promise<boolean> {
    try {
      const content = await fs.readFile(this.hostsFilePath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // Ignorar líneas vacías
        if (line === '') continue;

        // Manejar líneas comentadas para buscar nuestros dominios deshabilitados
        const isCommentedLine = line.startsWith('#');
        if (isCommentedLine) {
          // Si es una línea comentada, verificamos si es un dominio deshabilitado por nosotros
          const actualLine = line.substring(1).trim();
          const parts = actualLine.split(/\s+/);

          if (parts.length >= 2 && parts[0] === ip && parts[1] === domain) {
            // Verificar si la siguiente línea es nuestro identificador de deshabilitado
            if (i < lines.length - 1 && lines[i + 1].trim() === DISABLED_IDENTIFIER) {
              // Eliminar esta línea y la siguiente (el identificador)
              lines.splice(i, 2);
              modified = true;
              break;
            }
          }
          continue;
        }

        // Procesar líneas no comentadas
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && parts[0] === ip && parts[1] === domain) {
          // Verificar si la siguiente línea es nuestro identificador
          if (i < lines.length - 1 &&
            (lines[i + 1].trim() === APP_IDENTIFIER || lines[i + 1].trim() === DISABLED_IDENTIFIER)) {
            // Eliminar esta línea y la siguiente (el identificador)
            lines.splice(i, 2);
            modified = true;
            break;
          }
        }
      }

      if (modified) {
        return await this.writeHostsFile(lines.join('\n'));
      }

      return false;
    } catch (error: any) {
      console.error('Error removing host:', error);
      throw new Error(`Failed to remove host: ${error?.message}`);
    }
  }

  /**
   * Escribe contenido en el archivo hosts
   * Asume que la aplicación ya tiene permisos elevados
   */
  private async writeHostsFile(content: string): Promise<boolean> {
    try {
      await fs.writeFile(this.hostsFilePath, content, 'utf-8');
      return true;
    } catch (error: any) {
      console.error('Error writing hosts file:', error);
      throw new Error(`Failed to write hosts file: ${error?.message}`);
    }
  }

  /**
   * Agrega contenido al final del archivo hosts
   * Asume que la aplicación ya tiene permisos elevados
   */
  private async appendToHostsFile(content: string): Promise<boolean> {
    try {
      await fs.appendFile(this.hostsFilePath, content, 'utf-8');
      return true;
    } catch (error: any) {
      console.error('Error appending to hosts file:', error);
      throw new Error(`Failed to append to hosts file: ${error?.message}`);
    }
  }
}