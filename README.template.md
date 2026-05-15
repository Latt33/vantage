# {{cookiecutter.project_name}}

**Stack:** {% if cookiecutter.frontend_stack == "next-js" %}Next.js 14{% elif cookiecutter.frontend_stack == "astro-svelte" %}Astro + Svelte{% else %}React + Vite{% endif %} · {% if cookiecutter.backend_lang == "typescript" %}Vercel Serverless{% else %}FastAPI · Cloud Run{% endif %} · Supabase · Google Cloud{% if cookiecutter.inference_backend == "cloudrun" %} (Cloud Run){% endif %}{% if cookiecutter.inference_backend == "verda-gpu" %} · Verda GPU{% endif %}
**Team:** {{cookiecutter.team_name}}
**Hackathon:** {{cookiecutter.hackathon_name}} · {{cookiecutter.hackathon_year}}

{% if cookiecutter.inference_backend == "verda-gpu" %}
**Inference:** Verda GPU machine (bare metal rental, SSH, direct HTTP)
{% endif %}
{% if cookiecutter.auth_provider == "nextauth" %}
**Auth:** NextAuth.js (Google OAuth) + Supabase
{% elif cookiecutter.auth_provider == "none" %}
**Auth:** None (public app)
{% else %}
**Auth:** Supabase Auth
{% endif %}
{% if cookiecutter.payments == "stripe" %}
**Payments:** Stripe
{% endif %}

> ⚠️ **Generated from cookiecutter template — infrastructure only.**
> All business logic (features, API routes, DB queries, UI) must be written **after**
> the hackathon event starts. Files are scaffolded with `TODO` comments marking where
> to write code. The generated repo has exactly one commit (the generation itself).

## Stack Overview

| Layer | Technology | Deploy Target |
|-------|------------|---------------|
{% if cookiecutter.frontend_stack == "next-js" %}
| Frontend | Next.js 14 (App Router) | Vercel |
{% elif cookiecutter.frontend_stack == "astro-svelte" %}
| Frontend | Astro + Svelte (Islands) | Vercel (static) |
{% else %}
| Frontend | React + Vite | Vercel (static) |
{% endif %}
{% if cookiecutter.backend_lang == "typescript" %}
| API Functions | Vercel Serverless (Node.js) | Vercel |
{% else %}
| API Functions | FastAPI (Python) | Cloud Run |
{% endif %}
{% if cookiecutter.inference_backend == "cloudrun" %}
| Inference Service | Node.js + Express | Cloud Run |
{% endif %}
{% if cookiecutter.inference_backend == "verda-gpu" %}
| Inference | Verda GPU machine (bare metal, SSH) | Your rented machine |
{% endif %}
| Queue Worker | {% if cookiecutter.backend_lang == "typescript" %}Upstash Redis + Node.js worker (packages/queue/){% else %}Upstash Redis + Python worker (apps/queue-py/){% endif %} | {% if cookiecutter.inference_backend == "cloudrun" %}Cloud Run{% else %}Verda GPU{% endif %} |
| Database/Auth | Supabase (Postgres){% if cookiecutter.auth_provider == "nextauth" %} + NextAuth.js{% endif %} | Managed |
{% if cookiecutter.payments == "stripe" %}
| Payments | Stripe | Managed |
{% endif %}
| CI/CD | GitHub Actions | Managed |

## Repository Structure

```
{{cookiecutter.project_slug}}/
├── apps/
│   {% if cookiecutter.frontend_stack == "next-js" %}
│   ├── web/                  # Next.js 14 frontend
│   │   └── src/
│   │       ├── auth/         # {% if cookiecutter.auth_provider == "supabase" %}Supabase Auth helpers{% elif cookiecutter.auth_provider == "nextauth" %}NextAuth.js config + API route{% else %}No auth (public app){% endif %}
│   │       ├── lib/          # Supabase client, Verda client
│   │       ├── payments/     # {% if cookiecutter.payments == "stripe" %}Stripe client{% else %}No payments{% endif %}
│   │       └── pages/        # Next.js pages
│   {% elif cookiecutter.frontend_stack == "astro-svelte" %}
│   ├── web-astro/            # Astro + Svelte frontend
│   │   └── src/
│   │       ├── components/   # Astro/Svelte components
│   │       ├── layouts/      # Page layouts
│   │       └── pages/        # Astro pages
│   {% else %}
│   ├── web-react/            # React + Vite frontend
│   │   └── src/
│   │       ├── components/   # React components
│   │       └── pages/        # React Router pages
│   {% endif %}
│   {% if cookiecutter.backend_lang == "typescript" %}
│   └── api/                  # Vercel serverless functions
│   {% else %}
│   └── api-py/               # FastAPI (Python) backend
│       ├── app/              # FastAPI app + routes
│       ├── Dockerfile         # Cloud Run container
│       └── requirements.txt  # Python dependencies
│   {% endif %}
├── services/
│   └── inference/            # {% if cookiecutter.inference_backend == "cloudrun" %}Cloud Run inference (Node.js){% else %}Verda GPU scripts (provision.sh + deploy-to-verda.sh){% endif %}
├── apps/
│   {% if cookiecutter.backend_lang == "python" and cookiecutter.inference_pattern == "queue_worker" %}
│   └── queue-py/             # Python queue worker (Upstash Redis → inference service)
│       ├── worker.py         # Worker loop + job processing
│       ├── requirements.txt  # Python dependencies
│       └── docker-compose.yml
│   {% endif %}
├── packages/
│   ├── shared/               # Shared types, Zod schemas (TODO: add during hackathon)
│   {% if cookiecutter.backend_lang == "typescript" %}
│   └── db/                   # Supabase client (TODO: add ops during hackathon)
│   {% endif %}
├── supabase/
│   └── migrations/           # DB migrations (TODO: schema goes here)
├── .github/workflows/        # CI/CD pipelines
├── turbo.json                # Turborepo config
└── package.json              # Workspace root
```

## Quick-Start Checklist (Do at Hackathon Event)

### 1. Initialize Git (2 min)

```bash
cd {{cookiecutter.project_slug}}
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
{% if cookiecutter.inference_backend == "cloudrun" %}
- **GCP:** service account JSON (base64-encode it) + project ID
{% else %}
- **Verda GPU:** `VERDA_SSH_HOST`, `VERDA_SSH_USER`, `VERDA_SSH_KEY_PATH` from `verda.ai/dashboard`
{% endif %}
{% if cookiecutter.auth_provider == "nextauth" %}
- **NextAuth:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from `console.cloud.google.com`, `NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`)
{% endif %}
{% if cookiecutter.payments == "stripe" %}
- **Stripe:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from `dashboard.stripe.com`
{% endif %}

### 3. Set GitHub Secrets (5 min)

`github.com/YOUR_ORG/{{cookiecutter.project_slug}}/settings/secrets/actions`:

| Secret | Where to get it |
|--------|-----------------|
| `VERCEL_TOKEN` | vercel.com/settings/tokens |
| `VERCEL_ORG_ID` | vercel.com/settings/teams |
| `VERCEL_PROJECT_ID` | vercel project settings |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
{% if cookiecutter.inference_backend == "cloudrun" %}
| `GCP_SA_KEY` | Base64-encoded GCP SA JSON |
{% else %}
| `VERDA_SSH_HOST` | `gpu01.verda.example.com` (from Verda dashboard) |
| `VERDA_SSH_USER` | `root` (from Verda dashboard) |
{% endif %}
{% if cookiecutter.auth_provider == "nextauth" %}
| `GOOGLE_CLIENT_ID` | console.cloud.google.com (OAuth 2.0) |
| `GOOGLE_CLIENT_SECRET` | console.cloud.google.com (OAuth 2.0) |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
{% endif %}
{% if cookiecutter.payments == "stripe" %}
| `STRIPE_SECRET_KEY` | dashboard.stripe.com (developers → API keys) |
| `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com (developers → webhooks) |
{% endif %}
| `GCP_PROJECT_ID` | GCP project ID (as a **Variable**, not Secret) |

{% if cookiecutter.inference_backend == "verda-gpu" %}
### 4. Configure Verda GPU Machine

1. Rent a GPU machine at **verda.ai**
2. In the Verda dashboard, set the **startup script** to `services/inference/provision.sh`
3. Wait for the machine to provision (SSH becomes available)
4. Add `VERDA_SSH_HOST` as `NEXT_PUBLIC_VERDA_URL` in your Vercel environment variables
{% elif cookiecutter.auth_provider == "nextauth" %}
### 4. Configure Google OAuth

1. Go to **console.cloud.google.com** → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `https://your-domain.com/api/auth/callback/google`
4. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to GitHub Secrets
{% else %}
### 4. Test the Pipeline
{% endif %}

```bash
git checkout -b dev
git push origin dev
```

Watch `github.com/YOUR_ORG/{{cookiecutter.project_slug}}/actions`.
If CI passes, Vercel deploys automatically.

### 5. Start Building

Write your hackathon code in:

| File | What to build |
|------|---------------|
{% if cookiecutter.frontend_stack == "next-js" %}
| `apps/web/src/pages/index.tsx` | Frontend UI |
{% elif cookiecutter.frontend_stack == "astro-svelte" %}
| `apps/web-astro/src/pages/index.astro` | Frontend UI (Astro) |
{% else %}
| `apps/web-react/src/main.tsx` | Frontend UI (React) |
{% endif %}
{% if cookiecutter.backend_lang == "typescript" %}
| `apps/api/api/index.ts` | API handlers |
{% else %}
| `apps/api-py/app/main.py` | API endpoints (FastAPI) |
{% endif %}
{% if cookiecutter.inference_backend == "cloudrun" %}
| `services/inference/_inference/cloudrun/src/index.ts` | Cloud Run inference logic |
{% else %}
| `services/inference/provision.sh` | GPU machine bootstrap (paste into Verda dashboard) |
| `services/inference/deploy-to-verda.sh` | Deploy updated inference image via SSH |
{% endif %}
| `apps/web/src/lib/verda.ts` | Frontend calls to Verda GPU machine (HTTP) |
{% if cookiecutter.auth_provider != "none" %}
| `apps/web/src/auth/auth.ts` | Auth helpers (signIn, signOut, session) |
{% endif %}
{% if cookiecutter.payments == "stripe" %}
| `apps/web/src/payments/payments.ts` | Stripe client + payment helpers |
| `apps/web/src/pages/api/payments/create-payment-intent.ts` | Payment intent API route |
{% endif %}
| `packages/shared/src/index.ts` | Shared types and Zod schemas |
| `packages/db/src/index.ts` | Supabase queries |
| `supabase/migrations/001_initial.sql` | Database schema |

## Branch Strategy

| Branch | Deploys | Use |
|--------|---------|-----|
| `feature/*` | Vercel preview per PR | Active development |
| `dev` | Vercel dev | Integration testing |
{% if cookiecutter.inference_backend == "cloudrun" %}
| `staging` | Vercel staging + Cloud Run | Pre-demo |
| `main` | Vercel prod + Cloud Run prod | Live |
{% else %}
| `staging` | Vercel staging | Pre-demo (Verda GPU always-on) |
| `main` | Vercel prod | Live (Verda GPU always-on) |
{% endif %}

## Monorepo Commands

```bash
npm run dev        # Start all apps in watch mode
npm run build      # Build all workspaces
npm run lint        # Lint all workspaces
npm run typecheck  # TypeScript check all workspaces
npm run test       # Run all tests
```

## Troubleshooting

{% if cookiecutter.inference_backend == "cloudrun" %}
**Cloud Run deployment fails**
- GCP SA needs **Cloud Run Admin** + **Artifact Registry Writer** roles
- `GCP_PROJECT_ID` variable must match your actual GCP project
- Encode SA JSON: `base64 -i key.json | tr -d '\n'`
{% else %}
**Verda GPU not responding**
- Verify the machine is running in the Verda dashboard
- Check that `provision.sh` completed successfully (look at machine logs)
- Verify `NEXT_PUBLIC_VERDA_URL` points to the correct `http://<verda_ssh_host>:<port>`
- Test connectivity: `curl http://<verda_ssh_host>:<port>/health`
{% endif %}

{% if cookiecutter.auth_provider == "nextauth" %}
**NextAuth sign-in fails**
- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are correct
- Check that the redirect URI in Google Cloud matches your Vercel domain exactly
- Ensure `NEXTAUTH_SECRET` is set (required for session encryption)
- For local dev, set `NEXTAUTH_URL=http://localhost:3000` in `.env.local`
{% endif %}

**Vercel build fails**
- `NEXT_PUBLIC_*` vars must be set in Vercel dashboard, not only `.env.local`
- Run `vercel pull` locally to fetch env vars from Vercel

**Supabase connection issues**
- URL must be full (e.g. `https://abc123.supabase.co`)
- RLS policies may be blocking queries — check in Supabase dashboard

## License

MIT — Use freely for your hackathon project!
