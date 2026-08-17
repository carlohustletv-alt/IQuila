# IQuila API

The API server is in `apps/api` and uses Hono, Supabase, JWT verification through the Supabase JWKS URL, and shared Zod validation.

## Environment

Copy `.env.example` to `.env` locally and fill the Supabase values. Do not commit real secret keys.

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
API_PORT=4000
API_ALLOWED_ORIGINS=http://localhost:3000
```

The web app also needs `apps/web/.env.local`:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/flockiq-api

The production API runs as the Supabase Edge Function `flockiq-api`. Configure its browser allowlist before deployment:

```bash
npx supabase secrets set WEB_ALLOWED_ORIGINS=https://app.example.com --project-ref YOUR_PROJECT_REF
npm run deploy:edge
```

Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into the function. Never add the service-role key to web or Android configuration.
```

The Android app also needs `apps/mobile/.env.local`:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_API_URL=http://localhost:4000
```

Only publishable keys should be used in web/mobile environment variables. Keep the Supabase secret key server-side only.

## Commands

```bash
npm run dev:api
npm run typecheck
npm run build
```

## Auth

All `/api/*` routes require a Supabase access token:

```http
Authorization: Bearer <supabase-access-token>
```

## Endpoints

- `GET /health`
- `GET /health/supabase`
- `GET /api/auth/me`
- `GET /api/farms`
- `POST /api/farms`
- `PATCH /api/farms/:farmId`
- `POST /api/farms/:farmId/members`
- `GET /api/farms/:farmId/dashboard`
- `GET /api/farms/:farmId/flocks`
- `POST /api/farms/:farmId/flocks`
- `POST /api/farms/:farmId/daily-records`
- `POST /api/sync/push`
- `GET /api/sync/pull?farmId=<uuid>&since=<iso-date>`

## Offline Sync Contract

Android stores records locally first, then sends idempotent changes to `POST /api/sync/push`.

Each daily record must include an `idempotency_key`. The database enforces uniqueness with `(farm_id, idempotency_key)` so retries do not create duplicate records.
