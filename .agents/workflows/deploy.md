---
description: Deploy to production or test environment
---

# FDE Workflow

This workflow demonstrates how to use the deployment system.

## Prerequisites

1. Ensure dependencies are installed:

```bash
bun install
```

2. Build the binaries (if not already built):
   // turbo

```bash
bun run build
```

## Development Mode

### Start the server (local development):

// turbo

```bash
bun run dev:server
```

### Deploy using client (local development):

// turbo

```bash
bun run dev:client deploy -e test
```

## Production Mode

### On the server machine:

1. Copy the compiled `fde-server` binary and `server.yaml` to your server

2. Start the server:
   // turbo

```bash
./fde-server -c server.yaml
```

### On your local machine:

1. Configure your deployment settings in `deploy.yaml`

2. Deploy to test environment:
   // turbo

```bash
./fde-client deploy -e test
```

3. Deploy to production environment:

```bash
./fde-client deploy -e prod
```

4. Deploy with custom config file:

```bash
./fde-client deploy -e prod -c /path/to/deploy.yaml
```

5. Skip build and upload files directly:

```bash
./fde-client deploy -e prod --skip-build
```

6. Trigger deployment only (no build/upload):

```bash
./fde-client deploy -e prod --trigger-only
```

## Utility Commands

### Check server connection:

```bash
./fde-client ping -e test
# or
./fde-client ping -s http://your-server:3000
```

### Check server health:

```bash
./fde-client health -e test
# or
./fde-client health -s http://your-server:3000
```

### Check for updates:

```bash
./fde-client upgrade
```

### Uninstall FDE:

```bash
./fde-client uninstall
```

## Troubleshooting

If deployment fails, check:

1. Server is running and accessible
2. Token matches between client and server configs
3. Environment name is correct
4. Network connectivity is working
