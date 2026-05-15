#!/bin/bash
# =============================================================================
# deploy-to-verda.sh — Deploy inference container to Verda GPU machine via SSH
# =============================================================================
# Usage: ./deploy-to-verda.sh [--ssh-key PATH] [--host HOST] [--port PORT] [--user USER]
#
# Prerequisites:
#   - You have SSH access to a Verda GPU machine ( rented via verda.ai )
#   - Docker is installed on the Verda machine
#   - Your inference image is pushed to a registry accessible from Verda
#
# This script:
#   1. Builds the inference Docker image
#   2. Pushes it to Artifact Registry (or your chosen registry)
#   3. SSHs into the Verda machine and pulls/runs the new image
#   4. Verifies the container is healthy
#
# NOTE: There is no Verda API — all interaction is via SSH.
# TODO (hackathon): customize the registry and inference startup for your model.

set -e

# ---------- Defaults (override with CLI args or env) ----------
SSH_KEY="${VERDA_SSH_KEY_PATH:-~/.ssh/id_ed25519}"
SSH_HOST="${VERDA_SSH_HOST:-}"
SSH_PORT="${VERDA_SSH_PORT:-22}"
SSH_USER="${VERDA_SSH_USER:-root}"
REGISTRY="${VERDA_REGISTRY:-}"
IMAGE_TAG="latest"

# ---------- CLI parsing ----------
while [[ $# -gt 0 ]]; do
  case $1 in
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --host) SSH_HOST="$2"; shift 2 ;;
    --port) SSH_PORT="$2"; shift 2 ;;
    --user) SSH_USER="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$SSH_HOST" ]]; then
  echo "ERROR: --host (VERDA_SSH_HOST) is required"
  echo "Usage: $0 --host gpu01.verda.example.com [--ssh-key ~/.ssh/verda_ed25519] [--port 22] [--user root] [--registry gcr.io/my-project]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFERENCE_DIR="$SCRIPT_DIR"

echo "=== Deploy to Verda GPU Machine ==="
echo "Host: $SSH_USER@$SSH_HOST:$SSH_PORT"
echo "Image tag: $IMAGE_TAG"
echo ""

# ---------- Build & Push (optional — comment out if image already exists) ----------
if [[ -n "$REGISTRY" ]]; then
  echo "[1/4] Building inference image..."
  docker build -t "$REGISTRY/inference-service:$IMAGE_TAG" "$INFERENCE_DIR"

  echo "[2/4] Pushing to registry..."
  docker push "$REGISTRY/inference-service:$IMAGE_TAG"
else
  echo "[1/4] Skipping build (no --registry provided)"
  echo "[2/4] Skipping push (no --registry provided)"
fi

# ---------- Deploy via SSH ----------
echo "[3/4] Connecting to Verda machine via SSH..."

SSH_CMD="ssh -i \"$SSH_KEY\" -o StrictHostKeyChecking=no -p $SSH_PORT $SSH_USER@$SSH_HOST"

# TODO (hackathon): customize the Docker run command for your model and ports
$SSH_CMD <<'REMOTE_SCRIPT'
set -e
echo "[deploy] Pulling latest inference image..."

# TODO (hackathon): replace with your actual registry + image
# docker pull REGISTRY/inference-service:latest

# TODO (hackathon): restart your inference container
# docker stop inference-service 2>/dev/null || true
# docker rm inference-service 2>/dev/null || true
# docker run -d --gpus all --name inference-service \
#   --restart unless-stopped \
#   -p 8080:3000 \
#   REGISTRY/inference-service:latest

echo "[deploy] Verifying container health..."
sleep 2
# TODO (hackathon): check health — curl -s http://localhost:8080/health || echo "health check not implemented"
echo "[deploy] Done."
REMOTE_SCRIPT

echo "[4/4] Deployment complete."
echo "Inference should be available at: http://$SSH_HOST:8080"
