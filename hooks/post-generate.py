#!/usr/bin/env python3
"""
Post-generation hook for hackathon-monorepo cookiecutter template.

This runs AFTER cookiecutter renders all files. It:
1. Removes unchosen inference backend files (cloudrun OR verda-gpu)
2. Removes unchosen auth provider files (supabase, nextauth, OR none)
3. Removes unchosen payment files (stripe OR none)
4. Replaces README.template.md with the rendered version
5. Removes itself from the generated project
6. Prints a clear checklist for the hackathon team
"""

import os
import shutil
from pathlib import Path

# The rendered project root (cookiecutter replaces {{cookiecutter.project_slug}})
PROJECT_ROOT = Path("{{cookiecutter.project_slug}}")
TEMPLATE_README = PROJECT_ROOT / "README.template.md"
GENERATED_README = PROJECT_ROOT / "README.md"
HOOK_FILE = Path(__file__)

project_name = "{{cookiecutter.project_name}}"
team_name = "{{cookiecutter.team_name}}"
hackathon_name = "{{cookiecutter.hackathon_name}}"
project_slug = "{{cookiecutter.project_slug}}"
inference_backend = "{{cookiecutter.inference_backend}}"
auth_provider = "{{cookiecutter.auth_provider}}"
payments = "{{cookiecutter.payments}}"

# -------------------- Path helpers --------------------


def move_chosen_files(src_dir: Path, dest_dir: Path) -> None:
    """Move all files from src_dir to dest_dir, then delete src_dir."""
    if not src_dir.exists():
        return
    for item in src_dir.iterdir():
        dest = dest_dir / item.name
        if dest.exists():
            if dest.is_dir():
                shutil.rmtree(dest)
            else:
                dest.unlink()
        shutil.move(str(item), str(dest))
    shutil.rmtree(src_dir)
    print(f"  ✅ Moved {src_dir.name} → {dest_dir.name} (deleted unchosen backends)")


def delete_file(path: Path) -> None:
    if path.exists():
        path.unlink()
        print(f"  ✅ Removed unchosen file: {path}")


# -------------------- Inference backend --------------------


def cleanup_inference_backend(backend: str) -> None:
    """Remove the unchosen inference backend files."""
    inf_dir = PROJECT_ROOT / "services" / "inference"
    cloudrun_dir = inf_dir / "_inference" / "cloudrun"
    verda_dir = inf_dir / "_inference" / "verda-gpu"

    if backend == "cloudrun":
        if verda_dir.exists():
            shutil.rmtree(verda_dir)
            print(f"  ✅ Removed verda-gpu inference files: {verda_dir}")
    elif backend == "verda-gpu":
        if cloudrun_dir.exists():
            shutil.rmtree(cloudrun_dir)
            print(f"  ✅ Removed cloudrun inference files: {cloudrun_dir}")
        # verda-gpu: no Cloud Run deploy workflow
        deploy_cloudrun = PROJECT_ROOT / ".github" / "workflows" / "deploy-cloudrun.yml"
        if deploy_cloudrun.exists():
            deploy_cloudrun.unlink()
            print(f"  ✅ Removed deploy-cloudrun.yml (not used in verda-gpu mode)")

    # Rename chosen backend dir to services/inference/
    chosen_dir = cloudrun_dir if backend == "cloudrun" else verda_dir
    if chosen_dir.exists():
        for item in chosen_dir.iterdir():
            dest = inf_dir / item.name
            if dest.exists():
                if dest.is_dir():
                    shutil.rmtree(dest)
                else:
                    dest.unlink()
            shutil.move(str(item), str(dest))
        shutil.rmtree(inf_dir / "_inference")
        print(f"  ✅ Finalized inference directory: services/inference/")


# -------------------- Auth provider --------------------


def cleanup_auth_provider(provider: str) -> None:
    """Remove the unchosen auth provider files."""
    web_dir = PROJECT_ROOT / "apps" / "web"
    auth_dir = web_dir / "_auth"

    supabase_dir = auth_dir / "supabase"
    nextauth_dir = auth_dir / "nextauth"
    none_dir = auth_dir / "none"

    if provider == "supabase":
        for d in [nextauth_dir, none_dir]:
            if d.exists():
                shutil.rmtree(d)
                print(f"  ✅ Removed nextauth auth files: {d}")
    elif provider == "nextauth":
        for d in [supabase_dir, none_dir]:
            if d.exists():
                shutil.rmtree(d)
                print(f"  ✅ Removed {d.name} auth files: {d}")
    elif provider == "none":
        for d in [supabase_dir, nextauth_dir]:
            if d.exists():
                shutil.rmtree(d)
                print(f"  ✅ Removed {d.name} auth files: {d}")

    # Rename chosen auth dir to apps/web/src/auth
    chosen_dir = (
        supabase_dir
        if provider == "supabase"
        else nextauth_dir
        if provider == "nextauth"
        else none_dir
    )
    chosen_dest = web_dir / "src" / "auth"

    if chosen_dir.exists():
        chosen_dest.mkdir(parents=True, exist_ok=True)
        for item in chosen_dir.iterdir():
            dest = chosen_dest / item.name
            if dest.exists():
                if dest.is_dir():
                    shutil.rmtree(dest)
                else:
                    dest.unlink()
            shutil.move(str(item), str(dest))
        shutil.rmtree(auth_dir)
        print(f"  ✅ Finalized auth directory: apps/web/src/auth/")

    # For nextauth: also need to add next-auth to package.json dependencies
    # (handled by the package.json Jinja2 template — see below)
    # For none: the auth.ts stub is already in place


# -------------------- Payments --------------------


def cleanup_payments(payment_choice: str) -> None:
    """Remove the unchosen payment files."""
    web_dir = PROJECT_ROOT / "apps" / "web"
    payments_dir = web_dir / "_payments"

    none_dir = payments_dir / "none"
    stripe_dir = payments_dir / "stripe"

    if payment_choice == "none":
        if stripe_dir.exists():
            shutil.rmtree(stripe_dir)
            print(f"  ✅ Removed stripe payment files: {stripe_dir}")
    elif payment_choice == "stripe":
        if none_dir.exists():
            shutil.rmtree(none_dir)
            print(f"  ✅ Removed 'none' payment files: {none_dir}")

    # Rename chosen payments dir to apps/web/src/payments
    chosen_dir = stripe_dir if payment_choice == "stripe" else none_dir
    chosen_dest = web_dir / "src" / "payments"

    if chosen_dir.exists():
        chosen_dest.mkdir(parents=True, exist_ok=True)
        for item in chosen_dir.iterdir():
            dest = chosen_dest / item.name
            if dest.exists():
                if dest.is_dir():
                    shutil.rmtree(dest)
                else:
                    dest.unlink()
            shutil.move(str(item), str(dest))
        shutil.rmtree(payments_dir)
        print(f"  ✅ Finalized payments directory: apps/web/src/payments/")


# =============================================================================
# MAIN
# =============================================================================

print("  Cleaning up unchosen backends...")

# Record generation choices for downstream tooling (AGENTS.md, scripts, etc.)
CHOSEN_FILE = PROJECT_ROOT / ".chosen-backends"
CHOSEN_FILE.write_text(
    f"inference_backend={inference_backend}\n"
    f"auth_provider={auth_provider}\n"
    f"payments={payments}\n"
)
print(f"  ✅ Wrote {CHOSEN_FILE.name}")

cleanup_inference_backend(inference_backend)
cleanup_auth_provider(auth_provider)
cleanup_payments(payments)

# Replace template README with rendered version (no Jinja2 vars visible)
if TEMPLATE_README.exists():
    GENERATED_README.write_text(TEMPLATE_README.read_text())
    TEMPLATE_README.unlink()
    print(f"  ✅ Replaced {TEMPLATE_README.name} with rendered {GENERATED_README.name}")

# Remove this hook from generated project
if HOOK_FILE.exists():
    HOOK_FILE.unlink()
    print(f"  ✅ Removed post-generate hook")

print()
print("=" * 60)
print(f"  🎉 Generated: {project_name}")
print(f"  👥 Team: {team_name}")
print(f"  🏆 Hackathon: {hackathon_name}")
print("=" * 60)
print()
print("  CONFIGURATION:")
print(f"  🔧 Inference backend: {inference_backend}")
print(f"  🔐 Auth provider:      {auth_provider}")
print(f"  💳 Payments:            {payments}")
print()
print("  NEXT STEPS — do these at the hackathon event:")
print()
print("  1. cd", project_slug)
print("  2. git init && git add . && git commit -m 'Scaffold from template'")
print("     (This is your first commit — timestamps the start of coding)")
print()
print("  3. npm install")
print()
print("  4. cp .env.example .env.local")
print("     Then fill in:")
print("     - Supabase: URL + anon key + service role key")
print("     - Vercel: token + org ID + project ID")
if inference_backend == "verda-gpu":
    print("     - Verda GPU: VERDA_SSH_HOST, VERDA_SSH_USER, VERDA_SSH_KEY_PATH")
else:
    print("     - GCP: service account JSON (base64-encode it) + project ID")
if auth_provider == "nextauth":
    print("     - NextAuth: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET")
if payments == "stripe":
    print("     - Stripe: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET")
print()
print("  5. Add secrets to GitHub: Settings → Secrets → Actions")
print("     - VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID")
print("     - NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY")
print("     - SUPABASE_SERVICE_ROLE_KEY")
if auth_provider == "nextauth":
    print("     - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET")
if payments == "stripe":
    print("     - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET")
if inference_backend == "verda-gpu":
    print("     - VERDA_SSH_HOST, VERDA_SSH_USER")
print("     - GCP_PROJECT_ID (as a GitHub Variable, not Secret)")
print()
if inference_backend == "verda-gpu" and auth_provider == "nextauth":
    print("  6. Configure Verda GPU machine + NextAuth OAuth:")
elif inference_backend == "verda-gpu":
    print("  6. Configure Verda GPU machine:")
elif auth_provider == "nextauth":
    print("  6. Configure NextAuth OAuth at console.cloud.google.com:")
else:
    print("  6. Test CI/CD pipeline:")
print("     git checkout -b dev && git push origin dev")
print()
print("  7. Start coding!")
print()
print("  ⚠️  IMPORTANT:")
print("     All business logic (features, API routes, DB queries, UI)")
print("     must be written AFTER this generation step.")
print("     This template is infrastructure only — not feature code.")
print("     Files contain TODO comments marking where to write code.")
print()
print("=" * 60)
print()
print("  Project is ready. Go build something! 🚀")
print()
