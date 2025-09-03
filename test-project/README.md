# Navigrator Test Project

Quick test to validate navigrator's new project-based functionality.

## Setup

1. **Configure the project** (requires elevated privileges):
   ```bash
   navigrator config
   ```

2. **Start development**:
   ```bash
   npm run dev
   ```

3. **Visit**: https://test-app.local

## What this demonstrates

- Project-based configuration via `navigrator.config.json`
- Automatic HTTPS proxy from `test-app.local` to `localhost:8080`
- Transparent certificate handling
- Team-friendly workflow