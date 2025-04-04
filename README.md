# @axlotl-lab/navigrator

A powerful local domain manager for development environments. Navigrator helps you manage local domains and SSL certificates with a simple web interface.

[![npm version](https://img.shields.io/npm/v/@axlotl-lab/navigrator.svg)](https://www.npmjs.com/package/@axlotl-lab/navigrator)

## Features

- Easily manage local domains (`*.local`, etc.)
- Create and manage SSL certificates for local development
- Simple web interface for domain management
- Enable/disable domains without removing them
- Automatic SSL certificate generation
- Import existing host entries

## Installation

You can install Navigrator globally using npm:

```bash
npm install -g @axlotl-lab/navigrator
```

## Usage

### Starting the web interface

```bash
navigrator start
```

This will start the web interface on port 10191 by default and open it in your browser.

**Note:** Since Navigrator modifies your hosts file, it requires administrator/sudo privileges to run.

- Windows: Run Command Prompt or PowerShell as Administrator
- macOS/Linux: Use sudo

```bash
# On macOS/Linux
sudo navigrator start
```

### Options

```bash
# Start on a different port
navigrator start --port 4000

# Specify a different SSL port
navigrator start --ssl-port 3443
```

### Command Line Interface

In addition to the web interface, you can use Navigrator from the command line:

```bash
# List all local domains
navigrator list

# Add a new domain
navigrator add myapp.local

# Add a domain with a specific IP
navigrator add myapp.local --ip 127.0.0.2

# Remove a domain
navigrator remove myapp.local
```

## Web Interface

The web interface provides a user-friendly way to manage your local domains:

- **Domains Tab**: Manage all your local domains
  - Add new domains
  - Enable/disable existing domains
  - Import existing domains from hosts file
  - Remove domains when no longer needed
  - View certificate status for each domain

- **Certificates Tab**: Manage SSL certificates
  - View all generated certificates
  - Check certificate status and expiration dates
  - Refresh certificates
  - Delete individual certificates

## How It Works

Navigrator manages entries in your system's hosts file and generates SSL certificates for local development. It uses:

- Node.js for the backend server
- React for the web interface
- [node-forge](https://github.com/digitalbazaar/forge) for certificate generation
- [mkcert](https://github.com/FiloSottile/mkcert) integration when available

## Requirements

- Node.js 14 or newer
- Administrator/sudo privileges (for modifying the hosts file)
- For best results with certificates, install [mkcert](https://github.com/FiloSottile/mkcert) (optional)

## Troubleshooting

### Permission Issues

If you see errors related to permission denied:

- Make sure you're running Navigrator with administrator privileges
- On macOS/Linux, use `sudo navigrator start`
- On Windows, run Command Prompt or PowerShell as Administrator

### Certificate Not Trusted

For the best experience with certificates:

1. Install [mkcert](https://github.com/FiloSottile/mkcert)
2. Run `mkcert -install` to install the local CA
3. Restart Navigrator

## Publishing New Versions

1. Update the version in `package.json`:
   ```json
   "version": "1.0.1",
   ```

2. Test the package locally before publishing:
   ```bash
   # Create a local package
   npm pack
   
   # Install the package globally to test it
   npm install -g ./axlotl-lab-navigrator-1.0.0.tgz
   
   # Test that it works properly
   navigrator start
   ```

3. Create a git tag for the new version:
   ```bash
   git tag v1.0.1
   ```

4. Push the tag to the repository:
   ```bash
   git push origin v1.0.1
   ```

5. Publish to npm:
   ```bash
   npm publish
   ```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [mkcert](https://github.com/FiloSottile/mkcert) for local certificate authority
- [node-forge](https://github.com/digitalbazaar/forge) for certificate generation
- [Express](https://expressjs.com/) for the web server
- [React](https://reactjs.org/) for the user interface

---

Developed with ❤️ by [Axlotl Lab](https://github.com/axlotl-lab)