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
ATTACKER_ACCOUNT_ID="${ATTACKER_ACCOUNT_ID:-}"
ATTACKER_PRIVATE_KEY="${ATTACKER_PRIVATE_KEY:-}"

if [[ -z "$CONTRACT_ID" ]]; then
  echo "CONTRACT_ID belum di-set (cek backend/.env)"
  exit 1
fi

if [[ -z "$OWNER_ACCOUNT_ID" ]]; then
  echo "OWNER_ACCOUNT_ID belum di-set (set OWNER_ACCOUNT_ID atau ORACLE_ACCOUNT_ID di backend/.env)"
  exit 1
fi

if [[ -z "$ATTACKER_ACCOUNT_ID" || -z "$ATTACKER_PRIVATE_KEY" ]]; then
  echo "Set ATTACKER_ACCOUNT_ID dan ATTACKER_PRIVATE_KEY untuk menjalankan skenario ini"
  exit 1
fi

export NEAR_CLI_TESTNET_RPC_URL="$NEAR_RPC_URL"

echo "Mencoba update_credit_score sebagai akun non-oracle (harus gagal Unauthorized)"
if near call "$CONTRACT_ID" update_credit_score \
  "{\"owner_id\":\"$OWNER_ACCOUNT_ID\",\"new_score\":999,\"new_risk_level\":\"High Risk\",\"new_verification_hash\":\"attack\"}" \
  --accountId "$ATTACKER_ACCOUNT_ID" \
  --privateKey "$ATTACKER_PRIVATE_KEY" \
  --networkId "$NEAR_NETWORK" \
  --gas 30000000000000 \
  --deposit 0; then
  echo "Unexpected: transaksi berhasil (cek daftar authorized_oracles)"
  exit 1
else
  echo "OK: update ditolak (Unauthorized)"
fi
