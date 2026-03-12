#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.docker}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file tidak ditemukan: $ENV_FILE"
  exit 1
fi

docker compose --env-file "$ENV_FILE" up -d --build
