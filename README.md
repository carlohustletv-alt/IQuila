<p align="center">
  <img src="assets/logo.svg" alt="IQuila logo" width="720">
</p>

# IQuila

IQuila is an offline-first poultry management system with a web app for owners and managers, an Android app for daily farm work, and Supabase for database, authentication, storage, and Edge API services.

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

Copyright (C) 2026 carlohustletv. This project is licensed under the GNU General Public License v3.0. See `LICENSE`.
