# Security policy

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue, discussion, pull request, or log excerpt.

Use GitHub's private vulnerability reporting for the `MaroIshiku/dropiku` repository. Include the affected version or commit, reproduction steps, expected impact, and any safe proof of concept. Remove all real setup secrets, master keys, TOTP values, recovery codes, capability links, cookies, IP addresses, and uploaded private files before attaching diagnostics.

No public response-time commitment is made for this personal project. Reports will be reviewed as availability permits.

## Supported versions

Dropiku is currently an initial pre-release implementation. Only the latest commit on the default branch is considered for security fixes.

## Operator responsibilities

- Publish Dropiku only through an HTTPS reverse proxy.
- Restrict `TRUSTED_PROXIES` to real proxy addresses.
- Generate independent random setup and master secrets.
- Keep `/data` and secret files readable only by the intended service/operator.
- Preserve accurate server time for TOTP verification.
- Keep Node.js, the container base image, dependencies, and reverse proxy updated.
- Set upload body limits at the reverse proxy as an additional layer.
- Review Admin Info and Activity after unexpected authentication or storage events.
- Test recovery codes and backups in a non-production environment.

## Security model notes

The owner uses TOTP as a passwordless single sign-in factor. A capability link grants access to its specific share or upload request. Anyone who obtains the complete link, including its URL fragment, has that capability until expiry, revocation, or limit exhaustion.

Dropiku does not provide client-side end-to-end encryption in Phase 1. TLS protects network transit, while host and storage administrators can access stored files. Optional at-rest file encryption is deferred.
