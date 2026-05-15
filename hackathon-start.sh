#!/bin/bash
# =============================================================================
# hackathon-start.sh — Run on hackathon day to generate and initialize the project.
# =============================================================================
# This script:
#   1. Runs cookiecutter to generate a fresh project (no git history)
#   2. Installs npm dependencies
#   3. Initializes a new git repo with a single "Scaffold from template" commit
#   4. Prints the checklist for configuring secrets
#
# Usage:
#   bash <(curl -sL https://raw.githubusercontent.com/YOUR_ORG/hackathon-template/main/hackathon-start.sh)
#   OR clone the template repo and run locally:
#   ./hackathon-start.sh
# =============================================================================

set -e

echo ""
echo "========================================"
echo "  Hackathon Monorepo — Project Scaffold"
echo "========================================"
echo ""

# Check prerequisites
for cmd in node npm git python3 cookiecutter; do
  if ! command -v $cmd &> /dev/null; then
    echo "❌ Missing: $cmd (required)"
    exit 1
  fi
done

NODE_VERSION=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js 20+ required. You have: $(node -v)"
  exit 1
fi

echo "✅ Prerequisites OK"
echo ""

# Detect template source
if [ -d "$(dirname "$0")/.git" ]; then
  # Running from within the template repo
  TEMPLATE_DIR="$(cd "$(dirname "$0")" && pwd)"
  echo "📦 Generating project from local template: $TEMPLATE_DIR"
  cookiecutter "$TEMPLATE_DIR" --no-input
else
  # Running remotely
  echo "📦 Generating project from GitHub template"
  echo ""
  echo "⚠️  Enter your project details when prompted."
  echo ""
  cookiecutter gh:YOUR_ORG/hackathon-template
fi

# Find the generated directory
GENERATED_DIR=$(ls -td */ 2>/dev/null | head -1 | sed 's/\/$//')

if [ ! -d "$GENERATED_DIR" ]; then
  echo "❌ Could not find generated project directory"
  exit 1
fi

echo ""
echo "✅ Generated: $GENERATED_DIR"
echo ""

cd "$GENERATED_DIR"

# Install dependencies
echo "📦 Installing npm dependencies..."
npm install --silent
echo "✅ Dependencies installed"
echo ""

# Initialize git with a single scaffold commit
echo "📝 Initializing git repo with timestamped scaffold commit..."
git init
git add .
git commit -m "Scaffold from template — generated at hackathon start"
echo "✅ Git initialized: 1 commit, timestamped $(git log -1 --format='%ci')"
echo ""

# Show next steps
echo "========================================"
echo "  ✅ Project Ready!"
echo "========================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. cp .env.example .env.local"
echo "     Fill in: Supabase, Vercel, GCP, Verda keys"
echo ""
echo "  2. Add GitHub secrets:"
echo "     Settings → Secrets → Actions:"
echo "     - VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID"
echo "     - NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
echo "     - SUPABASE_SERVICE_ROLE_KEY"
echo "     - GCP_SA_KEY (base64-encoded GCP SA JSON)"
echo "     - VERDA_API_KEY, VERDA_API_URL"
echo "     - NEXT_PUBLIC_VERDA_API_URL"
echo "     - GCP_PROJECT_ID (as a Variable, not Secret)"
echo ""
echo "  3. Push to dev to test CI/CD:"
echo "     git checkout -b dev"
echo "     git push origin dev"
echo ""
echo "  4. Start building in:"
echo "     - apps/web/src/pages/index.tsx"
echo "     - apps/api/api/index.ts"
echo "     - services/inference/src/index.ts"
echo "     - packages/shared/src/index.ts"
echo "     - packages/db/src/index.ts"
echo "     - supabase/migrations/001_initial.sql"
echo ""
echo "⚠️  All feature code must be written AFTER this step."
echo "   This scaffold is infrastructure only — not feature code."
echo ""
echo "========================================"
echo ""
echo "💡 To run locally:"
echo "   cd $GENERATED_DIR"
echo "   npm run dev"
echo ""