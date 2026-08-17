# Security Policy

## Repository Security

- Do not commit `.env` files, signing keys, certificates, deployment artifacts, or credentials.
- Enable GitHub secret scanning, push protection, Dependabot alerts, and two-factor authentication for every repository administrator.
- Review dependency and security alerts before production releases.

## Secret Management

- Store production secrets only in Supabase and hosting-provider encrypted environment settings.
- Use only the Supabase publishable key in web and Android builds.
- Never include service-role keys, database credentials, personal access tokens, or signing material in client applications.
- Limit production credentials to the minimum required scope and maintain an inventory of active credentials.

## Credential Rotation

- Rotate a credential immediately when it is suspected to be exposed, misconfigured, or no longer required.
- Revoke obsolete credentials rather than retaining them for compatibility.
- Review active secrets after administrator access changes and before each production release.

## Test Accounts

- Test and demonstration accounts must use unique, non-production credentials.
- Demo scripts require `DEMO_PASSWORD` explicitly and must never run against production without an approved test plan.
