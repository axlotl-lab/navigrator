# @axlotl-lab/navigrator

A powerful local domain manager for development environments. Navigrator helps you manage local domains and SSL certificates with a simple web interface.

[![npm version](https://img.shields.io/npm/v/@axlotl-lab/navigrator.svg)](https://www.npmjs.com/package/@axlotl-lab/navigrator)

## Features

- Easily manage local domains (`*.local`, etc.)
- Create and manage SSL certificates for local development
- Simple web interface for domain management
- Enable/disable domains without removing them
- Automatic SSL certificate generation and installation
- Import existing host entries
- HTTPS proxies for local development

## Requirements

- Node.js 14 or newer
- OpenSSL installed and available in PATH
- Administrator/sudo privileges (for modifying the hosts file and installing certificates)

## Installation

### Installing OpenSSL

Before installing Navigrator, make sure OpenSSL is installed on your system:

**Windows:**
1. Download the installer from [https://slproweb.com/products/Win32OpenSSL.html](https://slproweb.com/products/Win32OpenSSL.html)
2. Run the installer and select "Copy OpenSSL DLLs to Windows system directory"
3. Restart your terminal/command prompt

**macOS:**
```bash
# Using Homebrew
brew install openssl
```

**Linux:**
```bash
# Debian/Ubuntu
sudo apt-get install openssl

# Fedora/RHEL
sudo dnf install openssl
```

### Installing Navigrator

You can install Navigrator globally using npm:

```bash
npm install -g @axlotl-lab/navigrator
```

## Usage

### Starting Navigrator

Simply run the start command with administrator privileges:

```bash
# On Windows (run Command Prompt or PowerShell as Administrator)
navigrator start

# On macOS/Linux
sudo navigrator start
```

That's it! The first time you run Navigrator:
1. It will check for and generate a root Certificate Authority (CA) if needed
2. Install the CA certificate in your system's trust store
3. Start the web interface on port 10191
4. Open your browser to the interface

Everything is managed automatically to provide a seamless experience.

### Options

```bash
# Start on a different port
navigrator start --port 4000
```

### Command Line Interface

In addition to the web interface, you can use Navigrator from the command line:

```bash
# Start the web interface (with automatic CA handling)
navigrator start

# List all local domains
navigrator list

# Add a new domain
navigrator add myapp.local

# Add a domain with a specific IP
navigrator add myapp.local --ip 127.0.0.2

# Remove a domain
navigrator remove myapp.local

# Reinstall the CA certificate (if needed)
navigrator install-ca
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
  
- **Proxies Tab**: Set up HTTPS proxies
  - Create proxies to forward HTTPS traffic to your local development servers
  - Start/stop proxies as needed
  - Edit proxy configurations

## How It Works

Navigrator manages entries in your system's hosts file and generates SSL certificates for local development. It uses:

- Node.js for the backend server
- React for the web interface
- OpenSSL for certificate generation
- A local Certificate Authority (CA) for signing certificates

When you first run Navigrator, it creates a local Certificate Authority (CA) in your home directory and installs it in your system's trust store. This CA is used to sign certificates for your local domains, making them trusted by your browser.

## Certificate Trust

The certificate installation happens automatically when you run `navigrator start`. If you need to reinstall the CA certificate (for example, on a new computer or browser), you can use:

```bash
# On Windows (run as Administrator)
navigrator install-ca

# On macOS/Linux
sudo navigrator install-ca
```

> **Note for Firefox users:** Firefox uses its own certificate store. Navigrator will detect Firefox and provide instructions for manually importing the CA certificate.

## Certificate Location

The root CA certificate is stored at:
```
~/.navigrator/certs/ca/rootCA.crt
```

Individual domain certificates are stored in:
```
~/.navigrator/certs/
```

## Troubleshooting

### Permission Issues

If you see errors related to permission denied:

- Make sure you're running Navigrator with administrator privileges
- On macOS/Linux, use `sudo navigrator start`
- On Windows, run Command Prompt or PowerShell as Administrator

### OpenSSL Not Found

If you get an error about OpenSSL not being installed:

1. Install OpenSSL following the instructions in the Installation section
2. Make sure OpenSSL is available in your PATH
3. Try running `openssl version` in your terminal to verify it's working

### Certificate Not Trusted

If your browser shows certificate warnings:

1. Run `navigrator install-ca` with administrator privileges
2. Restart your browser after installing the CA certificate
3. If using Chrome, you might need to visit `chrome://restart` after installing the CA
4. For Firefox, you need to manually import the certificate as described in the instructions provided by the tool

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

- [OpenSSL](https://www.openssl.org/) for certificate generation
- [Express](https://expressjs.com/) for the web server
- [React](https://reactjs.org/) for the user interface

---

Developed with ❤️ by [Axlotl Lab](https://github.com/axlotl-lab)