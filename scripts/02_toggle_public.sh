#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/backend/.env" ]]; then
  set -a
  source "$ROOT_DIR/backend/.env"
  set +a
fi

NEAR_NETWORK="${NEAR_NETWORK:-testnet}"
NEAR_RPC_URL="${NEAR_RPC_URL:-https://rpc.testnet.fastnear.com}"
CONTRACT_ID="${CONTRACT_ID:-}"

OWNER_ACCOUNT_ID="${OWNER_ACCOUNT_ID:-${ORACLE_ACCOUNT_ID:-}}"

if [[ -z "$CONTRACT_ID" ]]; then
  echo "CONTRACT_ID belum di-set (cek backend/.env)"
  exit 1
fi

if [[ -z "$OWNER_ACCOUNT_ID" ]]; then
  echo "OWNER_ACCOUNT_ID belum di-set (set OWNER_ACCOUNT_ID atau ORACLE_ACCOUNT_ID di backend/.env)"
  exit 1
fi

export NEAR_CLI_TESTNET_RPC_URL="$NEAR_RPC_URL"

echo "1) Set public = true (opt-in)"
near call "$CONTRACT_ID" set_passport_public \
  "{\"enabled\":true}" \
  --accountId "$OWNER_ACCOUNT_ID" \
  --networkId "$NEAR_NETWORK" \
  --gas 30000000000000 \
  --deposit 0

echo "2) View public detail (harus muncul)"
near view "$CONTRACT_ID" get_credit_passport_public \
  --args "{\"account_id\":\"$OWNER_ACCOUNT_ID\"}" \
  --networkId "$NEAR_NETWORK"

echo "3) Set public = false (opt-out)"
near call "$CONTRACT_ID" set_passport_public \
  "{\"enabled\":false}" \
  --accountId "$OWNER_ACCOUNT_ID" \
  --networkId "$NEAR_NETWORK" \
  --gas 30000000000000 \
  --deposit 0

echo "4) View public detail (harus null)"
near view "$CONTRACT_ID" get_credit_passport_public \
  --args "{\"account_id\":\"$OWNER_ACCOUNT_ID\"}" \
  --networkId "$NEAR_NETWORK"

echo "5) View ringkasan (lihat is_public false)"
near view "$CONTRACT_ID" get_credit_passport_summary \
  --args "{\"account_id\":\"$OWNER_ACCOUNT_ID\"}" \
  --networkId "$NEAR_NETWORK"
