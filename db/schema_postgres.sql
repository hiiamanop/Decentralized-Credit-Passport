CREATE TABLE IF NOT EXISTS merchants (
  merchant_id TEXT PRIMARY KEY,
  legal_name TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE source_type AS ENUM ('qris', 'marketplace', 'ewallet', 'bank');
CREATE TYPE tx_status AS ENUM ('authorized', 'captured', 'settled', 'refunded', 'failed', 'unknown');
CREATE TYPE tx_direction AS ENUM ('in', 'out');
CREATE TYPE tx_channel AS ENUM ('qris', 'marketplace', 'ewallet', 'bank_transfer');

CREATE TABLE IF NOT EXISTS source_connections (
  connection_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  source source_type NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_events (
  event_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  source source_type NOT NULL,
  source_event_id TEXT,
  source_transaction_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  status tx_status NOT NULL,
  direction tx_direction NOT NULL,
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL,
  fee_minor BIGINT,
  net_amount_minor BIGINT,
  channel tx_channel NOT NULL,
  counterparty_masked TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tx_events_merchant_time ON transaction_events (merchant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_events_source_time ON transaction_events (source, occurred_at DESC);

CREATE TABLE IF NOT EXISTS transaction_raw (
  event_id TEXT PRIMARY KEY REFERENCES transaction_events(event_id) ON DELETE CASCADE,
  raw_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  source source_type NOT NULL,
  merchant_id TEXT NOT NULL,
  source_transaction_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count BIGINT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_keys (source, merchant_id, source_transaction_id);
