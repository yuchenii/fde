# Changelog

## Unreleased

- Exclude local deployment credentials from Docker images. Mount `server.yaml` at `/app/server.yaml` when starting the container.
- Make deploy cooldown configurable via `limits.deployCooldownSec` (default **`30`**, was hard-coded `5`; set `0` to disable). Same-env deploys within the window return HTTP 409; applies to both stream and non-stream `/deploy`.
- Bind SSE reconnects and status lookups to the original deployment via `X-Deployment-ID`. Keep command diagnostics out of stored status and validate environment names before acquiring the deploy lock.
- Harden chunk uploads with environment-isolated storage, path validation, configurable request and storage limits, and streaming merge.
- Add authentication failure throttling, safer ZIP handling, private temporary directories, and generic server errors.
- Verify self-update binaries against the published SHA-256 manifest.

## [1.1.1](/compare/v1.1.0...v1.1.1) (2025-12-01)

# [1.1.0](/compare/v1.0.3...v1.1.0) (2025-12-01)


### Features

* add skip-build features 673411f
* refactor CLI and improve directory upload structure add274e
