# Packaging Notes — Self-contained full release

This archive is intentionally self-contained for the WESTO application code and local static assets.

Included:
- all local font binaries under `assets/fonts/`, including `Vazirmatn-Variable.woff2`;
- all active menu/media/audio/vendor assets from the source baseline;
- all frontend, admin, server, database seed/snapshot, tests and documentation.

Not included:
- `server/data/secret.key` — this is deployment-specific secret material and must never be copied between environments. When absent, `server/server.js` creates a fresh 32-byte secret with mode `0600` on first start.

No Service Worker is registered by this release. The existing cleanup helper only removes legacy Service Workers from older deployments.
