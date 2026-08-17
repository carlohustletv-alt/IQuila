<p align="center">
  <img src="assets/logo.svg" alt="IQuila logo" width="720">
</p>

# IQuila

IQuila is an offline-first poultry management system with a web app for owners and managers, an Android app for daily farm work, and Supabase for database, authentication, storage, and Edge API services.

## About

IQuila helps poultry operations keep farm, flock, personnel, evidence, and daily production records in one system. It is designed for field teams that need to continue recording work when connectivity is limited, then synchronize verified records when they are back online.

The project includes a manager web console, an Android field application, a Supabase-backed data layer, and auditable role-based access controls. IQuila is independently maintained and distributed as free software under GPL-3.0-only.

## Project Information

- **Status:** Active development
- **Primary platform:** Web console and Android field application
- **Backend:** Supabase PostgreSQL, Storage, Auth, and Edge Functions
- **License:** GNU General Public License v3.0 only
- **Security policy:** See [`SECURITY.md`](SECURITY.md)
- **Contributions:** Contributions must be compatible with `GPL-3.0-only` and include appropriate tests or verification notes.

## Features

- Farm, flock, team, and role-based access management.
- Offline Android daily logging for mortality, feed consumption, egg collection, and field notes.
- Secure synchronization of queued records when connectivity returns.
- Time-stamped photo evidence with best-effort GPS: fresh GPS when available, an honestly labelled last-known location fallback, or an unavailable-location stamp without blocking capture.
- Private evidence storage, signed image access, and manager review.
- Web notifications when field records or evidence are synchronized.
- Farm reports, recent-history views, and flock-scoped PDF exports.
- Explainable flock trend advisories that compare recent mortality, feed, water, and egg signals with each flock's own baseline, forecast the next two days, and recommend operational checks.
- Advisory safeguards: insufficient-data states, role-visible data scope, no disease diagnosis, no medication advice, and veterinary escalation guidance for sudden or continuing mortality.

## Applications

- `apps/api`: TypeScript API server for secure business endpoints.
- `apps/web`: Owner and manager web dashboard.
- `apps/mobile`: Android-first React Native app for daily field work and offline sync.

## Packages

- `packages/shared`: Shared domain types and role helpers.
- `packages/validation`: Shared Zod validation schemas.
- `packages/supabase`: Supabase admin and client helpers.
- `packages/sync`: Offline sync contract helpers.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and fill values locally.
3. Apply migrations in `supabase/migrations` to the Supabase project.
4. Run the API with `npm run dev:api`.
5. Run the web app with `npm run dev:web`.

Never commit real Supabase secret keys. See `SECURITY.md` before connecting a deployment or GitHub integration.

## License

Copyright (C) 2026 carlohustletv. IQuila is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See `LICENSE`.

You may run, study, modify, and redistribute the source under GPL-3.0 terms. Distributed modified versions must remain under GPL-3.0 and include corresponding source code. The software is provided without warranty.

All application, package, script, and Supabase source is covered by `REUSE.toml`. Primary executable entry points also carry SPDX identifiers. Verify the repository licensing metadata with:

```bash
npm run check:license
```

The GitHub security workflow runs this check for every push and pull request. When distributing an APK, web bundle, or other binary, provide the corresponding source code, build files, Supabase migrations, and this license notice.
