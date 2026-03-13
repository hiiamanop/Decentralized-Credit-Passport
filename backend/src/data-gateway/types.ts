export type SourceType = "qris" | "marketplace" | "ewallet" | "bank";

export type TransactionStatus =
  | "authorized"
  | "captured"
  | "settled"
  | "refunded"
  | "failed"
  | "unknown";

export type Money = {
  currency: string;
  amount_minor: number;
};

export type TransactionEvent = {
  event_id: string;
  idempotency_key: string;
  source: SourceType;
  source_event_id?: string | null;
  source_transaction_id: string;
  merchant_id: string;
  occurred_at: string;
  status: TransactionStatus;
  direction: "in" | "out";
  money: Money;
  fee_minor?: number | null;
  net_amount_minor?: number | null;
  channel: "qris" | "marketplace" | "ewallet" | "bank_transfer";
  counterparty?: string | null;
  raw: unknown;
};

export type IngestResult = {
  accepted: boolean;
  deduped: boolean;
  event?: TransactionEvent;
  error?: string;
  validationErrors?: string[];
};
