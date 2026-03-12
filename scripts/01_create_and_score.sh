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
PORT="${PORT:-3000}"

OWNER_ACCOUNT_ID="${OWNER_ACCOUNT_ID:-${ORACLE_ACCOUNT_ID:-}}"
BUSINESS_ID="${BUSINESS_ID:-BIZ-123}"
VERIFICATION_HASH="${VERIFICATION_HASH:-init_hash}"

if [[ -z "$CONTRACT_ID" ]]; then
  echo "CONTRACT_ID belum di-set (cek backend/.env)"
  exit 1
fi

if [[ -z "$OWNER_ACCOUNT_ID" ]]; then
  echo "OWNER_ACCOUNT_ID belum di-set (set OWNER_ACCOUNT_ID atau ORACLE_ACCOUNT_ID di backend/.env)"
  exit 1
fi

export NEAR_CLI_TESTNET_RPC_URL="$NEAR_RPC_URL"

echo "1) Membuat Credit Passport (jika belum ada)"
set +e
near call "$CONTRACT_ID" create_credit_passport \
  "{\"business_id\":\"$BUSINESS_ID\",\"verification_hash\":\"$VERIFICATION_HASH\"}" \
  --accountId "$OWNER_ACCOUNT_ID" \
  --networkId "$NEAR_NETWORK" \
  --gas 30000000000000 \
  --deposit 0 >/dev/null 2>&1
CREATE_EXIT=$?
set -e
if [[ "$CREATE_EXIT" -ne 0 ]]; then
  echo "Passport sudah ada, lanjut"
fi

echo "2) Meminta scoring ke backend (akan mengupdate on-chain)"
curl -sS -X POST "http://localhost:${PORT}/calculate-score" \
  -H "Content-Type: application/json" \
  -d "{\"accountId\":\"$OWNER_ACCOUNT_ID\",\"financialData\":{\"monthlyIncome\":5000,\"age\":30,\"loanAmount\":1000,\"loanIntRate\":10,\"defaultHistory\":false,\"creditHistoryLen\":3}}"
echo

echo "3) View ringkasan (aman untuk publik)"
near view "$CONTRACT_ID" get_credit_passport_summary \
  --args "{\"account_id\":\"$OWNER_ACCOUNT_ID\"}" \
  --networkId "$NEAR_NETWORK"

echo "4) View public detail (null jika belum opt-in public)"
near view "$CONTRACT_ID" get_credit_passport_public \
  --args "{\"account_id\":\"$OWNER_ACCOUNT_ID\"}" \
  --networkId "$NEAR_NETWORK"
