# Dropiku

Private File Exchange

> A private, self-hosted file exchange for temporary uploads, write-only collection links, and capability-based downloads.

## Summary

Dropiku is a single-owner web app for moving files between devices without maintaining a conventional password. The owner signs in with a 10-digit, 30-second TOTP code. Files can expire automatically or remain pinned, and public access is granted through long cryptographic capability links whose secret stays in the URL fragment.

Dropiku is designed for Docker deployments behind an HTTPS reverse proxy. It stores metadata in SQLite and file bodies on the local filesystem; uploads and downloads are streamed instead of being buffered completely in memory.

## Part of the ishiku family

Dropiku follows the shared Pixel Soft Utility design system used by ishiku apps:

- calm, rounded components for self-hosted utility interfaces;
- a mobile app shell with bottom navigation and a desktop dashboard with a navigation rail;
- Lavender, Mint, Sky, Amber, Rose, and Graphite themes;
- System, Light, and Dark modes with per-browser persistence;
- consistent first-run setup, settings sheets, About, and Admin Info patterns.

The supplied Dropiku icon is used as the application identity without creating a separate app-specific color system.

## Features

- Single-owner first-run setup protected by a server-side setup secret.
- Passwordless owner login using 10-digit RFC 6238 TOTP with replay protection.
- Ten one-time recovery codes stored only as Argon2id hashes.
- Opaque, server-side sessions with idle and absolute expiry, strict cookies, and CSRF protection.
- Streamed multi-file uploads, streamed downloads, SHA-256 checksums, and server-enforced limits.
- Automatic expiry from 15 minutes to 7 days, plus pinning for files that should not expire.
- Download shares for one or more files with expiry and optional download limits.
- Write-only upload links with submission, file-count, file-size, extension, and byte limits.
- Capability secrets kept in URL fragments and exchanged for scoped, short-lived sessions.
- Local QR generation, clipboard image/file uploads, and responsive progress feedback.
- Privacy-preserving activity history without raw IP addresses or complete user-agent strings.
- Optional ClamAV streaming scan with quarantine on malware or scanner failure.
- PWA metadata and a small shell service worker; file contents are never cached for offline access.
- Health checks, authenticated diagnostics, automatic cleanup, and an offline TOTP reset command.

## Tech stack

- Frontend: React 19, TypeScript, Vite, and local Pixel Soft Utility assets.
- Backend: Node.js 22 LTS, TypeScript, and Fastify 5 with route schemas and OpenAPI generation.
- Data: SQLite in WAL mode through Drizzle ORM, with file bodies on the local filesystem.
- Security: Node cryptography, OTPAuth, Argon2id, HttpOnly cookies, and synchronizer CSRF tokens.
- Testing: Vitest integration/unit tests and Playwright browser tests.
- Deployment: one non-root Docker image for `linux/amd64` and `linux/arm64`.

## Installation

### Docker Compose

Clone the repository and prepare local secret files:

```bash
git clone https://github.com/MaroIshiku/dropiku.git
cd dropiku
mkdir -p secrets data
openssl rand -base64 48 > secrets/setup_secret.txt
openssl rand -base64 32 > secrets/master_key.txt
chmod 600 secrets/*.txt
cp docker-compose.example.yml docker-compose.yml
```

Set `APP_BASE_URL` in `docker-compose.yml` to the public HTTPS URL served by the reverse proxy, then start Dropiku:

```bash
docker compose up -d
```

The container listens on port `8080`. Expose it publicly only through an HTTPS reverse proxy. Set `TRUSTED_PROXIES` only to proxies that actually sit in front of the container.

### First launch

Opening Dropiku for the first time redirects to `/setup`. Enter the content of `secrets/setup_secret.txt`, then scan the TOTP QR code. Setup requires two correct 10-digit codes from separate 30-second windows before it can finish.

The `digits=10` parameter is not honored by every authenticator. Bitwarden Authenticator is a known compatible choice. Six-digit codes cannot be used with Dropiku.

### Create the owner access

Dropiku does not create a username or password. The setup flow creates exactly one owner configuration consisting of:

- an encrypted TOTP secret;
- replay-protection state;
- ten one-time recovery codes; and
- the first owner session.

Download or copy the recovery codes before confirming setup. They are shown only once. Public registration and multi-user accounts do not exist.

## Configuration

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_BASE_URL` | required | Public HTTPS base URL without a trailing slash |
| `APP_SETUP_SECRET_FILE` | preferred | File containing the first-run setup secret |
| `APP_SETUP_SECRET` | empty | Environment fallback; minimum 32 characters |
| `APP_MASTER_KEY_FILE` | preferred | File containing exactly 32 Base64-encoded random bytes |
| `APP_MASTER_KEY` | empty | Environment fallback for the master key |
| `DATA_DIR` | `/data` | Persistent data root |
| `PORT` | `8080` | Internal HTTP port |
| `TZ` | `Europe/Berlin` | Container time zone |
| `TRUSTED_PROXIES` | `false` | Fastify trusted-proxy configuration |
| `MAX_STORAGE_BYTES` | `107374182400` | Configured storage quota, 100 GiB by default |
| `DEFAULT_MAX_FILE_BYTES` | `5368709120` | Default maximum file size, 5 GiB |
| `ABSOLUTE_MAX_FILE_BYTES` | `21474836480` | Absolute maximum file size, 20 GiB |
| `MAX_CONCURRENT_UPLOADS` | `3` | Process-wide upload slots |
| `MAX_CONCURRENT_DOWNLOADS` | `6` | Process-wide download slots |
| `CLAMAV_HOST` | empty | Optional `clamd` host |
| `CLAMAV_PORT` | `3310` | Optional `clamd` port |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

Production startup fails closed if the base URL, setup secret, or master key is invalid. `APP_BASE_URL` must use HTTPS in production.

### Docker secrets

File-based secrets take precedence over environment values. The example Compose file mounts:

```text
/run/secrets/dropiku_setup_secret
/run/secrets/dropiku_master_key
```

Never rotate `APP_MASTER_KEY` without a migration plan. It encrypts the stored TOTP secret; losing it can make the existing owner configuration unusable. Keep an encrypted backup of the key separate from the data directory.

### Persistent data

The `/data` volume contains:

```text
/data/database/dropiku.sqlite
/data/files/
/data/tmp/
/data/quarantine/
/data/logs/
```

Original filenames are metadata only. File bodies use random storage keys and are not located under the served web root.

## Security

- TOTP is the owner's sole sign-in proof, not a second factor. Short sessions, rate limits, replay rejection, HTTPS, and recovery codes are therefore required parts of the model.
- The setup secret is accepted only before setup or during an explicitly authorized offline reset.
- TOTP secrets are encrypted with AES-256-GCM under `APP_MASTER_KEY`.
- Recovery codes use Argon2id and are invalidated immediately after use or regeneration.
- Session and capability tokens are stored only as hashes.
- Capability secrets stay after `#` in shared links, so they are not sent in the initial HTTP request or normal reverse-proxy path logs.
- Public upload sessions cannot list or download any file, including their own submission.
- Uploaded file names cannot become filesystem paths. Downloads always use attachment disposition and `application/octet-stream`.
- Sensitive headers and secret-shaped fields are redacted from structured logs.
- Public files, setup responses, authentication responses, and capability endpoints use `no-store` responses.

See [SECURITY.md](SECURITY.md) for private reporting and operational guidance.

## Updates and backup

Update a packaged deployment with:

```bash
docker compose pull
docker compose up -d
```

SQLite and file storage must be backed up as one consistent unit. The simplest safe procedure is an offline snapshot:

```bash
docker compose stop dropiku
tar -C . -czf dropiku-data-$(date +%Y%m%d).tar.gz data
docker compose start dropiku
```

Back up `secrets/master_key.txt` separately using encryption. Recovery codes should also remain outside ordinary unencrypted server backups.

If every authenticator and recovery code is lost, run this from the host:

```bash
docker compose exec dropiku node dist/server/cli.js admin reset-totp --confirm
```

Add `--revoke-links` to revoke all public links during the reset. Then open `/setup` and configure a new authenticator. The command is intentionally available only with container or host-level access.

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
docker build -t dropiku:local .
```

Development requires the same configuration values as production, but `APP_BASE_URL=http://127.0.0.1:8080`, `COOKIE_SECURE=false`, and a disposable `DATA_DIR` can be used locally. API documentation is available at `/api/docs` outside production.

## Created with ChatGPT Codex

This project was designed and implemented with assistance from ChatGPT Codex. Codex was used to create code, structure, UI components, tests, and documentation according to the ishiku and Pixel Soft Utility specifications.

Maintenance, security review, operation, and publishing responsibility remain with the repository owner.

## Status and license

Status: initial Phase 1 implementation. Treat the project as pre-release software until it has been reviewed and exercised with the intended reverse proxy and storage environment.

No license file is included yet. The absence of a license means no reuse rights are granted beyond those provided by applicable law; choose and add a license before inviting third-party reuse.
