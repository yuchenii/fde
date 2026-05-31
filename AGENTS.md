# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

FDE is a lightweight manual deployment tool for environments where CI/CD is unavailable. It ships two Bun/TypeScript CLIs:

- `fde-server`: receives uploads, extracts deployment packages, and runs server-side deploy commands.
- `fde-client`: builds local artifacts, archives/uploads them, and triggers deployments.

The project is intended to be single-binary and air-gap friendly, so keep runtime dependencies and platform behavior conservative.

## Repository Layout

- `src/client/`: client CLI entry point, config loading, build/archive/upload/deploy flows.
- `src/server/`: server CLI entry point, HTTP routes, upload handling, validation, deployment execution, logging.
- `src/utils/`: shared utilities such as path resolution, checksums, throttling, self-update, and uninstall logic.
- `tests/`: Bun tests for client, server, archive, env, log rotation, Docker path, and related behavior.
- `docs/`: user-facing documentation for Docker, env config, chunk upload, server API, and path resolution.
- `scripts/`: installer and helper scripts.

## Tooling

- Runtime/package manager: Bun.
- Language: TypeScript, ESM modules.
- Minimum Bun version: `>=1.0.0`.
- Local tool pinning is in `mise.toml`.

Common commands:

```bash
bun install
bun test
bun run test:coverage
bun run dev:server
bun run dev:client
bun run build
```

Use targeted tests when possible while iterating, then run `bun test` for changes that affect shared behavior.

## Coding Guidelines

- Follow the existing TypeScript style and module boundaries.
- Prefer `async/await` and typed interfaces over loosely shaped objects.
- Keep CLI behavior explicit and user-facing errors actionable.
- Add or update tests for behavior changes, especially config parsing, path resolution, upload/deploy flows, and cross-platform paths.
- Update README/docs when command behavior, config fields, defaults, or deployment semantics change.
- Keep public APIs and config schemas backward-compatible unless the task explicitly allows a breaking change.

## Deployment-Specific Cautions

- Treat auth tokens, deploy commands, and upload paths as security-sensitive.
- Be careful with path resolution across local, Docker, Unix-like, and Windows environments.
- Avoid changes that assume internet access at runtime.
- Do not introduce shell behavior that would break paths containing spaces or platform-specific separators.
- Preserve checksum and validation behavior unless intentionally changing the deploy protocol.

## Git and Release Notes

- Do not stage, commit, tag, or release unless explicitly asked.
- Commit messages should follow Conventional Commits when commits are requested.
- For user-visible changes, update `CHANGELOG.md` when appropriate.
