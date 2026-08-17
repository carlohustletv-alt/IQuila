# Security Policy

## Before Connecting GitHub

- Keep `.env`, `.env.local`, signing keys, certificates, and deployment folders out of Git.
- Store production secrets only in Supabase and the hosting provider's encrypted environment settings.
- Use the public Supabase publishable key in web and Android builds. Never place the Supabase service-role key, database password, or personal access token in a client build.
- Enable GitHub secret scanning, push protection, Dependabot alerts, and two-factor authentication for every repository administrator.

