#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.docker}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

AI_HOST_PORT="${AI_HOST_PORT:-5001}"
BACKEND_HOST_PORT="${BACKEND_HOST_PORT:-3000}"

curl -sS "http://localhost:${AI_HOST_PORT}/"
echo
curl -sS "http://localhost:${BACKEND_HOST_PORT}/config"
echo
