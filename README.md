# IQuila

IQuila is an offline-first poultry management system with a web app for owners/managers, an Android app for daily farm workers, and Supabase as the backend database/auth platform.

## Apps

- `apps/api`: TypeScript API server for secure business endpoints.
- `apps/web`: Owner/manager web dashboard.
- `apps/mobile`: Android-first Expo app for daily farm work and offline sync.

## Packages

- `packages/shared`: Shared domain types and role helpers.
- `packages/validation`: Shared Zod validation schemas.
- `packages/supabase`: Supabase admin/client helpers.
- `packages/sync`: Offline sync contract helpers.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and fill values locally.
3. Apply migrations in `supabase/migrations` to your Supabase project.
4. Run the API with `npm run dev:api`.

Never commit real Supabase secret keys.
