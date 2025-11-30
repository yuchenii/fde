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

```bash
bun run dev:server
```

### Deploy using client (local development):

```bash
bun run dev:client
```

## Production Mode

### On the server machine:

1. Copy the compiled `fde-server` binary and `server.yaml` to your server

2. Start the server:
   // turbo

```bash
./dist/fde-server -c server.yaml
```

### On your local machine:

1. Configure your deployment settings in `deploy.yaml`

2. Deploy to test environment:
   // turbo

```bash
./dist/fde-client --env=test
```

3. Deploy to production environment:

```bash
./dist/fde-client --env=prod
```

## Verify Deployment

Check server health:

```bash
curl http://your-server:3000/health
```

## Troubleshooting

If deployment fails, check:

1. Server is running and accessible
2. Token matches between client and server configs
3. Environment name is correct
4. Network connectivity is working
