# 📂 Path Resolution

## Core Principle: Config File as Anchor

All relative paths in config files are resolved relative to the **config file directory** (`configDir`), ensuring consistent behavior regardless of where you run the command.

## Config Paths

| Config Field | Resolution                              |
| ------------ | --------------------------------------- |
| `uploadPath` | Relative to config file → Absolute path |
| `localPath`  | Relative to config file → Absolute path |
| `log.path`   | Relative to config file → Absolute path |

## Command Working Directory

**All commands run in `configDir`** (config file directory), regardless of command format:

| Command Format        | Working Directory     |
| --------------------- | --------------------- |
| `./scripts/deploy.sh` | Config file directory |
| `npm run build`       | Config file directory |
| `./deploy.sh ./dist`  | Config file directory |

This ensures:

- Script arguments with relative paths work correctly (e.g., `./scripts/deploy.sh ./dist`)
- Consistent behavior for all command types
- No surprises based on where you run fde-client/server

## Docker Environment

In Docker, paths are resolved relative to `/app` (container working directory), **not** the config file directory:

| Path Type                   | Resolution                            |
| --------------------------- | ------------------------------------- |
| `uploadPath`, `log.path`    | `resolve("/app", path)` → `/app/...`  |
| Command execution (via SSH) | `HOST_CONFIG_DIR` (host machine path) |

> **Note**: `HOST_CONFIG_DIR` environment variable is **required** in Docker. The container will fail to start without it.

### Examples

**Non-Docker Environment** (config file at `/home/user/project/server.yaml`):

```yaml
environments:
  prod:
    uploadPath: "./deploy-packages/prod" # → /home/user/project/deploy-packages/prod
    deployCommand: "./scripts/deploy.sh" # Runs in /home/user/project/
```

**Docker Environment** (config mounted to `/app/server.yaml`, `HOST_CONFIG_DIR=/home/user/project`):

```yaml
environments:
  prod:
    uploadPath: "./deploy-packages/prod" # → /app/deploy-packages/prod (container path)
    deployCommand: "./scripts/deploy.sh" # Runs via SSH in /home/user/project/ (host path)
```

Key differences in Docker:

- Data paths (`uploadPath`, `log.path`) resolve to `/app/...` inside the container
- Deploy commands execute on the **host machine** via SSH, using `HOST_CONFIG_DIR` as working directory
- **Upload directory must be mounted** (e.g., `-v ./deploy-packages:/app/deploy-packages`) for files to be accessible on the host

## Implementation

Path resolution is centralized in `src/utils/path.ts`:

- `PathContext`: Interface holding resolution context (`configDir`, `isDocker`, `hostConfigDir`)
- `resolveDataPath(path, ctx)`: Resolves config paths (localPath, uploadPath, log.path)
- `resolveCommandCwd(command, ctx)`: Determines command and working directory
