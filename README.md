# Cookiecutter Hackathon Template

**Stack:** Vercel · Supabase · Google Cloud (Cloud Run)
**Team:** Team Alpha
**Hackathon:** HackMIT 2026 · 2026

**Auth:** Supabase Auth

> ⚠️ **Generated from cookiecutter template — infrastructure only.**
> All business logic (features, API routes, DB queries, UI) must be written **after**
> the hackathon event starts. Files are scaffolded with `TODO` comments marking where
> to write code. The generated repo has exactly one commit (the generation itself).

## Stack Overview

| Layer | Technology | Deploy Target |
|-------|------------|---------------|
| Frontend | Next.js 14 | Vercel |
| API Functions | Vercel Serverless | Vercel |
| Inference Service | Node.js + Express | Cloud Run |
| Database/Auth | Supabase (Postgres) | Managed |
| CI/CD | GitHub Actions | Managed |

## Repository Structure

```
hackathon-project/
├── apps/
│   ├── web/                  # Next.js frontend
│   │   └── src/
│   │       ├── lib/          # Supabase client, Verda client
│   │       └── pages/        # Next.js pages
│   └── api/                  # Vercel serverless functions
├── services/
│   └── inference/           # Cloud Run inference (Node.js)
├── packages/
│   ├── shared/               # Shared types, Zod schemas (TODO: add during hackathon)
│   └── db/                   # Supabase client (TODO: add ops during hackathon)
├── supabase/
│   └── migrations/           # DB migrations (TODO: schema goes here)
├── .github/workflows/        # CI/CD pipelines
├── turbo.json                # Turborepo config
└── package.json              # Workspace root
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js 14)                      │
│                     Vercel · src/pages/*                          │
└─────────────┬─────────────────────────────────┬──────────────────┘
              │                                 │
       ┌──────┴──────┐               ┌─────────┴─────────┐
       │  Supabase   │               │  Stripe (optional)│
       │  Auth/DB    │               └──────────────────┘
       └─────────────┘
              │
    ┌─────────┴──────────┐              ┌─────────────────────────┐
    │  Vercel Serverless  │              │   Inference Backend     │
    │    Functions        │              │  ┌───────────────────┐  │
    │  apps/api/*         │              │  │ Cloud Run (Docker)│  │
    └─────────────────────┘              │  └───────────────────┘  │
                                        └─────────────────────────┘
```

## Key Files by Feature

### Auth (`apps/web/_auth/`)

| File | Purpose |
|------|---------|
| `supabase/auth.ts` | Re-exports `supabase` client; add `signIn()`, `signOut()`, `getSession()` helpers |
| `supabase/middleware.ts` | Route protection via `getSession()` — update `protectedRoutes` |
| `nextauth/nextauth.ts` | NextAuth config with Google OAuth; add providers, callbacks, pages |
| `nextauth/middleware.ts` | Route protection via `withAuth()` — update `matcher` |
| `one/auth.ts` | Stub — no auth configured |
| `one/middleware.ts` | Pass-through middleware (no protection) |

### Payments (`apps/web/_payments/`)

| File | Purpose |
|------|---------|
| `stripe/payments.ts` | Server-side Stripe client + `createPaymentIntent()` helper skeleton |
| `stripe/api-create-payment-intent.ts` | API route skeleton — implement POST handler for payment intents |
| `one/payments.ts` | Stub — no payments configured |

### Inference (`services/inference/`)

| File | Purpose |
|------|---------|
| `cloudrun/src/index.ts` | Express server; implement `/api/inference` POST handler here |
| `cloudrun/Dockerfile` | Container build; build + push via `deploy-cloudrun.yml` |
| `verda-gpu/index.ts` | Placeholder; Verda GPU inference is HTTP-based, not served here |
| `verda-gpu/provision.sh` | Boot script for Verda GPU (paste into Verda dashboard) |
| `verda-gpu/deploy-to-verda.sh` | Deploy updates to GPU machine via SSH |

### Database (`packages/db/`, `supabase/migrations/`)

| File | Purpose |
|------|---------|
| `packages/db/src/index.ts` | Supabase server/client (`createClient`); add query helpers here |
| `apps/web/src/lib/supabase.ts` | Supabase browser client singleton |
| `supabase/migrations/001_initial.sql` | Schema + RLS policies; add tables + triggers here |

### Queue/Cache (`packages/queue/`)

| File | Purpose |
|------|---------|
| `packages/queue/src/index.ts` | Upstash Redis client; add `enqueueJob()`, `dequeueJob()`, rate-limiting |

### Shared (`packages/shared/`)

| File | Purpose |
|------|---------|
| `packages/shared/src/index.ts` | Zod schemas + TypeScript types for cross-package use |

## Environment Variables

| Variable | Where used | Description |
|----------|-----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend, API | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | API (server-only) | Supabase service role key (bypasses RLS) |
| `STRIPE_SECRET_KEY` | API | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | API | Stripe webhook signature verification |
| `GOOGLE_CLIENT_ID` | Frontend | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Frontend | Google OAuth 2.0 client secret |
| `NEXTAUTH_SECRET` | Frontend | Session encryption secret |
| `NEXTAUTH_URL` | Frontend | NextAuth callback URL (set for local dev) |
| `UPSTASH_REDIS_REST_URL` | Queue package | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Queue package | Upstash Redis REST token |
| `VERDA_SSH_HOST` | Verda GPU scripts | GPU machine hostname |
| `VERDA_SSH_USER` | Verda GPU scripts | SSH username |
| `VERDA_SSH_KEY_PATH` | Verda GPU scripts | SSH private key path |
| `GCP_SA_KEY` | CI (GitHub Secrets) | Base64-encoded GCP service account JSON |
| `GCP_PROJECT_ID` | CI | GCP project ID |
| `VERCEL_TOKEN` | CI (GitHub Secrets) | Vercel API token |
| `VERCEL_ORG_ID` | CI (GitHub Secrets) | Vercel organization ID |
| `VERCEL_PROJECT_ID` | CI (GitHub Secrets) | Vercel project ID |

## CI/CD Pipeline

```
Push to branch
     │
     ▼
┌─────────────┐
│   ci.yml    │  → lint + typecheck + test
└──────┬──────┘
       │ (on push to dev/staging/main)
       ▼
┌─────────────────────┐
│  deploy-vercel.yml   │  → Vercel (frontend + API)
└──────────┬──────────┘
           │ (on push to staging/main if cloudrun)
           ▼
┌─────────────────────────┐
│   deploy-cloudrun.yml    │  → Cloud Run (Docker)
└─────────────────────────┘
```

## Quick-Start Checklist (Do at Hackathon Event)

### 1. Initialize Git (2 min)

```bash
cd hackathon-project
git init
git add .
git commit -m "Scaffold from template"
```

> This timestamps the start of your work. The single commit is verifiable proof
> that all code was written during the event.

### 2. Install & Configure (10 min)

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:
- **Supabase:** URL + anon key + service role key from `supabase.com/dashboard`
- **Vercel:** token + org ID + project ID from `vercel.com/settings`
- **GCP:** service account JSON (base64-encode it) + project ID

### 3. Set GitHub Secrets (5 min)

`github.com/YOUR_ORG/hackathon-project/settings/secrets/actions`:

| Secret | Where to get it |
|--------|-----------------|
| `VERCEL_TOKEN` | vercel.com/settings/tokens |
| `VERCEL_ORG_ID` | vercel.com/settings/teams |
| `VERCEL_PROJECT_ID` | vercel project settings |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GCP_SA_KEY` | Base64-encoded GCP SA JSON |
| `GCP_PROJECT_ID` | GCP project ID (as a **Variable**, not Secret) |

### 4. Test the Pipeline

```bash
git checkout -b dev
git push origin dev
```

Watch `github.com/YOUR_ORG/hackathon-project/actions`.
If CI passes, Vercel deploys automatically.

### 5. Start Building

Write your hackathon code in:

| File | What to build |
|------|---------------|
| `apps/web/src/pages/index.tsx` | Frontend UI |
| `apps/api/api/index.ts` | API handlers |
| `services/inference/src/index.ts` | Cloud Run inference logic |
| `packages/shared/src/index.ts` | Shared types and Zod schemas |
| `packages/db/src/index.ts` | Supabase queries |
| `supabase/migrations/001_initial.sql` | Database schema |

## Branch Strategy

| Branch | Deploys | Use |
|--------|---------|-----|
| `feature/*` | Vercel preview per PR | Active development |
| `dev` | Vercel dev | Integration testing |
| `staging` | Vercel staging + Cloud Run | Pre-demo |
| `main` | Vercel prod + Cloud Run prod | Live |

## Monorepo Commands

```bash
npm run dev        # Start all apps in watch mode
npm run build      # Build all workspaces
npm run lint       # Lint all workspaces
npm run typecheck  # TypeScript check all workspaces
npm run test       # Run all tests
```

## Troubleshooting

**Cloud Run deployment fails**
- GCP SA needs **Cloud Run Admin** + **Artifact Registry Writer** roles
- `GCP_PROJECT_ID` variable must match your actual GCP project
- Encode SA JSON: `base64 -i key.json | tr -d '\n'`

**Vercel build fails**
- `NEXT_PUBLIC_*` vars must be set in Vercel dashboard, not only `.env.local`
- Run `vercel pull` locally to fetch env vars from Vercel

**Supabase connection issues**
- URL must be full (e.g. `https://abc123.supabase.co`)
- RLS policies may be blocking queries — check in Supabase dashboard

## License

MIT — Use freely for your hackathon project!