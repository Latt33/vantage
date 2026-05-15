# AI Assistants & This Template

Guidance for hackathon teams using AI assistants (Claude, GitHub Copilot, Cursor, etc.)
without our dev-team setup.

---

## Table of Contents

- [Choosing an Assistant](#choosing-an-assistant)
- [How to Prompt Effectively](#how-to-prompt-effectively)
- [What to Delegate vs. Review](#what-to-delegate-vs-review)
- [Useful Commands](#useful-commands)
- [Stack Quick Reference](#stack-quick-reference)
- [Got Stuck?](#got-stuck)

---

## Choosing an Assistant

| Assistant | Free Tier | Strengths for This Stack | Best For |
|-----------|-----------|--------------------------|----------|
| **Claude (claude.ai)** | Often has a free plan; check current limits | Architecture reasoning, Next.js/Node.js code, DevOps docs | Initial scaffolding, API design, debugging |
| **GitHub Copilot** | Free/discounted access may be available for some students and OSS maintainers | Fast inline completions, TypeScript/JS fluent | Boilerplate filling, routine endpoint writing |
| **Cursor** | Trial or free usage may be available; check current pricing | Chat + index awareness, full repo context | Iterative feature building, refactoring |
| **GitHub Copilot Chat** | Usually bundled with Copilot access | GitHub integration, PR context, inline explanations | CI/CD tweaks, git history Q&A, code walk-throughs |

All work fine. Pick whichever your team already has access to.
If budget matters, check current pricing before the event instead of assuming a specific free tier.

---

## How to Prompt Effectively

### General Rule

Give the assistant **the full context** of your generation choices.
Include the five decisions you made when you ran cookiecutter:

> "I generated this template with `frontend_stack=next-js`,
> `backend_lang=typescript`, `inference_backend=cloudrun`,
> `auth_provider=supabase`, `payments=none`. Write a Next.js API route that..."

Check your choices anytime:

**Unix/macOS**
```bash
cat .chosen-backends
```

**Windows PowerShell**
```powershell
Get-Content .chosen-backends
```

### Specific Prompt Templates

**Architecture / Setup questions:**
```
I am using Vercel (frontend) + Supabase (auth/db) + Cloud Run (inference).
Write a Next.js API route that calls the Cloud Run inference endpoint.
```

**Auth (Supabase):**
```
Using Supabase Auth, write a Next.js middleware that protects /dashboard routes.
Redirect to /login if no session.
```

**Auth (NextAuth):**
```
Configure NextAuth.js v5 with Google OAuth. I already have NEXTAUTH_SECRET set.
Give me the auth.ts config and middleware.
```

**Payments (Stripe):**
```
Create a Stripe PaymentIntent endpoint at /api/create-payment-intent.
Use the STRIPE_SECRET_KEY env var. Return the client_secret.
```

**Inference (Verda GPU):**
```
I have a Verda GPU machine. The SSH host is in VERDA_SSH_HOST.
Write a TypeScript function that sends an HTTP POST to the inference endpoint.
Include error handling for connection failures.
```

**CI/CD:**
```
My inference service runs in Cloud Run. I want a GitHub Actions workflow that:
1. Builds the Docker image on push to dev/staging/main
2. Deploys to Cloud Run with the correct service account
3. Secrets are in GitHub Actions secrets
```

---

## What to Delegate vs. Review

### ✅ Delegate Freely
- Boilerplate files (API routes, components, middleware)
- Stripe/Supabase SDK integration code
- CI/CD workflow files
- Debugging error messages
- Writing unit tests
- Documentation explainers

### ⚠️ Delegate, But Review Carefully
- **Secrets management** — verify the assistant does not hardcode keys or tokens
- **Cost optimization** — double-check Cloud Run min-instances and Verda GPU pricing before deploy
- **Auth logic** — review session handling, especially OAuth redirect flows
- **SQL queries** — review for correctness and performance before running at scale
- **Full feature generation** — generating an entire feature from scratch is fine, but review
  every line before committing. The assistant doesn't know your hackathon's rules or scoring.

### ❌ Avoid
- Blindly committing AI-generated code without reading it
- Modifying `supabase/migrations/` without understanding the schema
- Changing CI/CD trigger conditions without knowing the pipeline dependencies

---

## Useful Commands

**Unix/macOS**
```bash
# Check which backends were chosen at generation time
cat .chosen-backends

# Copy and review local env vars
cp .env.example .env.local
grep -E '^[A-Za-z0-9_]+=' .env.local

# Install dependencies and start dev servers
npm install
npm run dev

# Run only the web app
npx turbo dev --filter=@hackathon/web

# Build all workspaces
npx turbo build

# Test inference locally (Cloud Run backend only)
cd services/inference
docker build -t inference .
docker run --rm -p 3000:3000 --name inference-service inference

# Check Verda GPU setup (Verda backend only)
ssh -i ~/.ssh/YOUR_SSH_KEY YOUR_USER@YOUR_VERDA_HOST "docker ps"
```

**Windows PowerShell**
```powershell
# Check which backends were chosen at generation time
Get-Content .chosen-backends

# Copy and review local env vars
Copy-Item .env.example .env.local
Select-String -Path .env.local -Pattern '^[A-Za-z0-9_]+='

# Install dependencies and start dev servers
npm install
npm run dev

# Run only the web app
npx turbo dev --filter=@hackathon/web

# Build all workspaces
npx turbo build

# Check Verda GPU setup (Verda backend only)
ssh -i ~/.ssh/YOUR_SSH_KEY YOUR_USER@YOUR_VERDA_HOST "docker ps"
```

Need a fresh scaffold instead of fixing this repo? Go back to the template repo and run
`./hackathon-start.sh` there. Do not run it inside an already generated project.

> **Note:** This is a Turborepo monorepo. Use `npm run dev` to run all workspaces,
> or `npx turbo dev --filter=@hackathon/web` to run just the web app.
> See `turbo.json` for the pipeline configuration.

For detailed setup instructions specific to your choices, see **README.md** (rendered from
`README.template.md` at generation time).

---

## Stack Quick Reference

```
┌─────────────────────────────────────────────────────────┐
│  Frontend:  Vercel (Next.js)                            │
│  Auth:      Supabase Auth  OR  NextAuth.js  OR  none    │
│  Payments:  Stripe  OR  none                            │
│  Inference: Cloud Run (Docker)  OR  Verda GPU (bare)   │
│  CI/CD:     GitHub Actions                              │
└─────────────────────────────────────────────────────────┘
```

Your exact combination is recorded in `.chosen-backends`.

---

## Got Stuck?

1. Check `.chosen-backends` to confirm your generation choices
2. Run `npx turbo build` to see all build errors at once
3. Verify env vars in `.env.local` match your hosting dashboard
4. For Supabase issues: run `npx supabase status` locally
5. For Verda GPU issues: SSH in and run `docker logs inference-service`
6. If you need a clean restart, rerun `./hackathon-start.sh` from the template repo, not from this generated project
7. Read **README.md** for choice-specific configuration steps

---

*This file is a static reference included with every generated project.
For choice-specific setup, see README.md — it adapts to your generation options.*
