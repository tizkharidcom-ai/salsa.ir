# SALSA / WESTO

This repository contains the complete WESTO restaurant system and the SALSA operator console. The services run as separate Node.js processes:

| Service | Local address | Command |
| --- | --- | --- |
| WESTO restaurant, POS, accounting, kitchen and customer apps | `http://localhost:4180` | `npm start` |
| SALSA GODMODE console | `http://localhost:3050` | `npm run start:godmode` |
| SALSA Control Plane API | `http://localhost:3061` | `npm run superadmin:control` |

Install dependencies with `npm ci`. For the integrated local stack, run `npm run start:full`; it starts WESTO on 4180, the console service on 3050, and the Control Plane on 3061. Do not start `start:godmode` at the same time as `start:full`, because both use port 3050.

Configure database credentials and signing keys through environment variables. `.env.example` and `deploy/.env.production.example` contain placeholders; replace them locally or through the production secret manager. Do not commit `.env.local` or production credentials.

Deployment examples are in `Caddyfile.production`, `nginx/`, `deploy/nginx/`, and `deploy/systemd/`.

## WESTO modules

The existing WESTO implementation is organized into 14 shared modules with tenant access and compatible frontend releases. See [architecture and next hosting steps](modules/README.md) and [verification evidence](modules/VERIFICATION.md).
