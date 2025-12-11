# 📂 Path Resolution

All relative paths in config files are resolved relative to the **config file directory**, not the current working directory.

## Config Paths

| Config Field | Resolution                              |
| ------------ | --------------------------------------- |
| `uploadPath` | Relative to config file → Absolute path |
| `localPath`  | Relative to config file → Absolute path |
| `log.path`   | Relative to config file → Absolute path |

## Command Working Directory

| Command Format          | Working Directory                                |
| ----------------------- | ------------------------------------------------ |
| `./scripts/deploy.sh`   | Script's directory (`scripts/`)                  |
| `../deploy.sh`          | Script's directory (resolved relative to config) |
| `/opt/scripts/run.sh`   | Script's directory (`/opt/scripts/`)             |
| `npm run build`         | Current working directory (`process.cwd()`)      |
| `sh ./scripts/build.sh` | Current working directory (shell handles path)   |

**Examples:**

```yaml
# server.yaml in /home/user/project/
environments:
  prod:
    uploadPath: "./deploy-packages/prod" # → /home/user/project/deploy-packages/prod
    deployCommand: "./scripts/deploy.sh" # Executes in /home/user/project/scripts/
  test:
    uploadPath: "./deploy-packages/test"
    deployCommand: "npm run restart" # Executes in current working directory
```
