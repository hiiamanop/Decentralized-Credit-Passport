import { sha256Hex, stableStringify } from "./utils.js";
import type { IngestResult, SourceType, TransactionEvent, TransactionStatus } from "./types.js";

export type InMemoryStore = {
  idempotency: Map<string, TransactionEvent>;
  events: TransactionEvent[];
};

export function createInMemoryStore(): InMemoryStore {
  return { idempotency: new Map(), events: [] };
}

export function computeIdempotencyKey(input: {
  source: SourceType;
  merchant_id: string;
  source_transaction_id: string;
  occurred_at: string;
  status: TransactionStatus;
  money_amount_minor: number;
  currency: string;
}): string {
  return sha256Hex(
    stableStringify({
      v: 1,
      source: input.source,
      merchant_id: input.merchant_id,
      source_transaction_id: input.source_transaction_id,
      occurred_at: input.occurred_at,
      status: input.status,
      money_amount_minor: input.money_amount_minor,
      currency: input.currency,
    })
  );
}

export function acceptEvent(store: InMemoryStore, event: TransactionEvent): IngestResult {
  const existing = store.idempotency.get(event.idempotency_key);
  if (existing) {
    return { accepted: true, deduped: true, event: existing };
  }
  store.idempotency.set(event.idempotency_key, event);
  store.events.unshift(event);
  if (store.events.length > 5000) store.events.length = 5000;
  return { accepted: true, deduped: false, event };
}

