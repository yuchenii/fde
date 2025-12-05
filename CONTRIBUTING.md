# Contributing to FDE

Thank you for your interest in contributing to FDE! 🎉

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Guidelines](#coding-guidelines)
- [Testing](#testing)

## 📜 Code of Conduct

This project and everyone participating in it is governed by respect and professionalism. Please be kind and courteous to others.

## 🤝 How Can I Contribute?

### 🐛 Reporting Bugs

Before creating bug reports, please check existing issues. When creating a bug report, include:

- **Clear title** - Use a clear and descriptive title
- **Steps to reproduce** - Detailed steps to reproduce the issue
- **Expected behavior** - What you expected to happen
- **Actual behavior** - What actually happened
- **Environment** - OS, architecture, version
- **Logs** - Relevant error messages or logs

### 💡 Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Clear title** - Use a clear and descriptive title
- **Use case** - Explain why this would be useful
- **Proposed solution** - How you think it should work
- **Alternatives** - Any alternative solutions you've considered

### 🔧 Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add or update tests
5. Ensure all tests pass
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## 🔧 Development Setup

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/yuchenii/fde.git
cd fde/

# Install dependencies
bun install

# Run tests
bun test

# Start development server with hot reload
bun run dev:server

# Start development client
bun run dev:client
```

## 📥 Pull Request Process

1. **Update documentation** - Update README.md or other docs if needed
2. **Add tests** - Add tests for new features
3. **Update CHANGELOG** - Add your changes to CHANGELOG.md under [Unreleased]
4. **Pass all tests** - Ensure `bun test` passes
5. **Follow style guide** - Follow the coding guidelines below
6. **Small, focused changes** - Keep PRs focused on a single concern

## 📝 Coding Guidelines

### TypeScript Style

- Use TypeScript for all new code
- Follow existing code style
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Prefer `async/await` over callbacks

### Example

```typescript
/**
 * Upload a file to the server
 * @param filePath - Path to the file to upload
 * @param serverUrl - Server URL
 * @param authToken - Authentication token
 * @returns Upload result with success status
 */
export async function uploadFile(
  filePath: string,
  serverUrl: string,
  authToken: string
): Promise<UploadResult> {
  // Implementation
}
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `chore:` - Maintenance tasks

Examples:

```
feat: add streaming upload with progress bar
fix: resolve Windows path compatibility issue
docs: update installation instructions
test: add checksum verification tests
```

## 🧪 Testing

### Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun run test:watch

# Run with coverage
bun run test:coverage
```

### Writing Tests

- Place tests in the `tests/` directory
- Name test files with `.test.ts` extension
- Use descriptive test names
- Test both success and error cases

Example:

```typescript
import { describe, it, expect } from "bun:test";

describe("Feature Name", () => {
  it("should do something correctly", () => {
    const result = myFunction();
    expect(result).toBe(expected);
  });

  it("should handle errors gracefully", () => {
    expect(() => myFunction()).toThrow();
  });
});
```

## 📁 Project Structure

```
fde/
├── src/
│   ├── client/                # Client-side code
│   │   ├── config/
│   │   │   └── loader.ts      # Config file parser
│   │   ├── services/
│   │   │   ├── archive.ts     # Directory compression (withTempZip)
│   │   │   ├── build.ts       # Build command execution
│   │   │   ├── deploy.ts      # Deploy trigger
│   │   │   ├── streamUpload.ts # Streaming upload with progress
│   │   │   └── upload.ts      # FormData upload
│   │   ├── utils/
│   │   │   ├── healthCheck.ts # Server connectivity checks
│   │   │   ├── path.ts        # Path type detection
│   │   │   └── response.ts    # JSON response parser
│   │   ├── types.ts           # Client type definitions
│   │   └── index.ts           # CLI entry point
│   ├── server/                # Server-side code
│   │   ├── config/
│   │   │   └── loader.ts      # Config file parser
│   │   ├── routes/
│   │   │   ├── handlers.ts    # Upload/Deploy handlers
│   │   │   └── streamHandlers.ts # Streaming upload handler
│   │   ├── services/
│   │   │   ├── deployment.ts  # File extraction, command execution
│   │   │   └── validation.ts  # Auth & checksum verification
│   │   ├── utils/
│   │   │   ├── env.ts         # Docker detection
│   │   │   ├── logger.ts      # Logging with rotation
│   │   │   └── logRotate.ts   # Log rotation logic
│   │   ├── types.ts           # Server type definitions
│   │   └── index.ts           # HTTP server entry point
│   ├── utils/                 # Shared utilities
│   │   ├── checksum.ts        # SHA256 checksum
│   │   ├── command.ts         # Script path resolution
│   │   ├── selfUninstall.ts   # Self-uninstall logic
│   │   ├── selfUpdate.ts      # Self-update logic
│   │   └── throttle.ts        # Throttle function
│   └── version.ts             # Version constant
├── tests/                     # Test files
├── scripts/                   # Utility scripts
└── dist/                      # Compiled binaries
```

## ❓ Questions?

Feel free to open an issue for any questions or concerns!

---

Thank you for contributing! 🚀
