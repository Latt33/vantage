#!/bin/bash
# =============================================================================
# provision.sh — Verda GPU machine startup script
# =============================================================================
# This script is executed on the Verda GPU machine at boot time (via Verda dashboard).
# It installs Docker and pulls your inference container from a registry.
# TODO (hackathon): customize this script for your inference stack.
set -e

echo "[provision] Starting GPU machine setup..."

# TODO (hackathon): Install Docker if not present
# apt-get update && apt-get install -y docker.io

# TODO (hackathon): Authenticate to your container registry (e.g., GCR, Artifact Registry)
# gcloud auth configure-docker --quiet

# TODO (hackathon): Pull your inference image
# docker pull {{cookiecutter.docker_image_prefix}}/inference-service:latest

# TODO (hackathon): Run your inference container
# docker run -d --gpus all --restart unless-stopped \
#   -p 8080:3000 \
#   {{cookiecutter.docker_image_prefix}}/inference-service:latest

echo "[provision] Setup complete. Inference service should be running on port 8080."
