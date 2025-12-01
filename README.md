# FDE

A lightweight, cross-platform deployment system built with Bun and TypeScript.

[![Build](https://img.shields.io/github/actions/workflow/status/yuchenii/fde/build.yml)](https://github.com/yuchenii/fde/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## ✨ Features

- 🚀 **Fast & Lightweight** - Single binary, no dependencies
- 🌍 **Cross-Platform** - macOS, Linux, Windows (ARM64 & x64)
- 📦 **Multiple Upload Modes** - FormData, Streaming with real-time progress
- 🔒 **Secure** - Token authentication, SHA256 checksum verification
- 📊 **Real-time Progress** - Beautiful progress bars during upload
- 🔄 **Hot Reload** - Development mode with auto-restart
- 🛡️ **Type-Safe** - Written in TypeScript
- 📝 **Configurable Logging** - Auto-rotating logs with size limits
- 🔧 **Daemon Mode** - Background process on Unix/Linux/macOS

## 📦 Supported Platforms

| Platform | ARM64 | x64 |
| -------- | ----- | --- |
| macOS    | ✅    | ✅  |
| Linux    | ✅    | ✅  |
| Windows  | ❌    | ✅  |

## 🚀 Quick Start

### Installation

#### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/yuchenii/fde/main/scripts/install.sh | bash
```

#### Windows (PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/yuchenii/fde/main/scripts/install.ps1 | iex
```

### Usage

#### Server

```bash
# Start server (foreground)
fde-server start -c server.yaml

# Start in daemon mode (Unix/Linux/macOS only)
fde-server start -d -c server.yaml

# Stop daemon
./scripts/stop-server.sh  # or stop-server.ps1 on Windows

# Show version
fde-server --version

# Show help
fde-server --help
```

#### Client

```bash
# Deploy to production
fde-client deploy -e prod

# Deploy with custom config
fde-client deploy -e test -c custom-deploy.yaml

# Show version
fde-client --version

# Show help
fde-client --help
```

## ⚙️ Configuration

### Server Config (server.yaml)

```yaml
port: 3000
token: "shared-secret"
log:
  path: "./fde-server.log"
  maxSize: 10 # MB
  maxBackups: 5

environments:
  prod:
    token: "your-secret-token"
    deployPath: "/var/www/html"
    deployCommand: "nginx -s reload"
```

### Client (deploy.yaml)

```yaml
token: "shared-secret"

environments:
  prod:
    serverUrl: "http://your-server.com:3000"
    authToken: "your-secret-token"
    buildCommand: "npm run build"
    localPath: "./dist"
    exclude:
      - "node_modules"
      - ".git"
      - "*.log"
```

### Update

FDE can update itself to the latest version:

```bash
# Update to latest version
fde-server upgrade
# or
fde-client upgrade
```

The update command will:

- Check GitHub for the latest release
- Download and install the new version
- Ask if you want to update the other binary (server/client)
- Show real-time download progress

### Uninstall

```bash
# Uninstall FDE
fde-server uninstall
# or
fde-client uninstall
```

The uninstall command will:

- Remove the current binary
- Scan for other FDE files and ask for confirmation
- Work regardless of how you renamed the binaries

## 🔧 Development

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0

### Setup

```bash
# Install dependencies
bun install

# Start server with hot reload
bun run dev:server

# Start client with hot reload
bun run dev:client

# Run tests
bun test

# Run tests in watch mode
bun run test:watch
```

### Build

```bash
# Build all platforms
bun run build:all

# Build specific platform
bun run build:mac
bun run build:linux
bun run build:windows

# Build specific architecture
bun run build:mac:arm64
bun run build:linux:x64
```

### Release Workflow

#### Commit Changes

Use the interactive commit tool to ensure your commit messages follow the standard convention:

```bash
bun run commit
```

#### Release

To create a new release (bump version, generate changelog, create git tag, and release on GitHub):

```bash
bun run release
```

## 📝 API Endpoints

| Endpoint         | Method | Description                    |
| ---------------- | ------ | ------------------------------ |
| `/ping`          | GET    | Health check                   |
| `/health`        | GET    | Detailed health status         |
| `/upload`        | POST   | File upload (FormData)         |
| `/upload-stream` | POST   | Streaming upload with progress |
| `/deploy`        | POST   | Execute deployment command     |

## 🧪 Testing

```bash
# Run all tests
bun test

# Run with coverage
bun run test:coverage

# Watch mode
bun run test:watch
```

Test coverage includes:

- ✅ Server API endpoints
- ✅ Authentication & authorization
- ✅ File upload & streaming
- ✅ Checksum verification
- ✅ Log rotation
- ✅ Archive creation
- ✅ Config loading

## 📚 Documentation

- [Cross-Platform Guide](CROSS_PLATFORM.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Built with [Bun](https://bun.sh/)
- Progress bars powered by [cli-progress](https://github.com/npkgz/cli-progress)
- Archive handling with [archiver](https://github.com/archiverjs/node-archiver)

---

Made with ❤️ by [Yu Chen]
