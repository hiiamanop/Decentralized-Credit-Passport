import { maskSensitive, parseAmountToMinor, parseCurrency, safeTrim, sha256Hex, toIsoUtc } from "./utils.js";
import type { SourceType, TransactionEvent, TransactionStatus } from "./types.js";
import { computeIdempotencyKey } from "./store.js";

type NormalizeOk = { ok: true; event: TransactionEvent };
type NormalizeErr = { ok: false; errors: string[] };
export type NormalizeResult = NormalizeOk | NormalizeErr;

function requireString(value: unknown, field: string, errors: string[]): string | null {
  const s = safeTrim(value);
  if (!s) errors.push(`${field} is required`);
  return s;
}

function mapStatus(source: SourceType, value: unknown): TransactionStatus {
  if (typeof value !== "string") return "unknown";
  const v = value.trim().toLowerCase();

  if (source === "qris") {
    if (v === "paid" || v === "success") return "captured";
    if (v === "settled") return "settled";
    if (v === "refund" || v === "refunded") return "refunded";
    if (v === "failed") return "failed";
  }

  if (source === "marketplace") {
    if (v === "paid") return "captured";
    if (v === "completed" || v === "settled") return "settled";
    if (v === "refunded") return "refunded";
    if (v === "canceled" || v === "failed") return "failed";
  }

  if (source === "ewallet") {
    if (v === "authorized") return "authorized";
    if (v === "paid" || v === "captured") return "captured";
    if (v === "settled") return "settled";
    if (v === "refunded") return "refunded";
    if (v === "failed") return "failed";
  }

  if (source === "bank") {
    if (v === "posted" || v === "settled") return "settled";
    if (v === "failed") return "failed";
  }

  return "unknown";
}

function directionFromAmountMinor(amountMinor: number): "in" | "out" {
  return amountMinor >= 0 ? "in" : "out";
}

function abs(n: number): number {
  return n < 0 ? -n : n;
}

function makeEventId(idempotencyKey: string): string {
  return `evt_${idempotencyKey.slice(0, 24)}`;
}

export function normalizeQris(input: unknown): NormalizeResult {
  const errors: string[] = [];
  const obj = (input ?? {}) as Record<string, unknown>;

  const merchant_id = requireString(obj.merchant_id ?? obj.store_id, "merchant_id", errors);
  const source_transaction_id =
    requireString(obj.trx_id ?? obj.rrn ?? obj.ref_id ?? obj.transaction_id, "source_transaction_id", errors);
  const occurred_at = toIsoUtc(obj.paid_at ?? obj.settled_at ?? obj.occurred_at ?? obj.created_at);
  if (!occurred_at) errors.push("occurred_at is required");

  const currency = parseCurrency(obj.currency ?? "IDR");
  if (!currency) errors.push("currency is invalid");

  const amountMinor = currency ? parseAmountToMinor(obj.amount ?? obj.gross_amount, currency) : null;
  if (amountMinor === null) errors.push("amount is invalid");

  if (errors.length) return { ok: false, errors };

  const status = mapStatus("qris", obj.status);
  const money_amount_minor = abs(amountMinor!);
  const direction = "in";

  const idempotency_key = computeIdempotencyKey({
    source: "qris",
    merchant_id: merchant_id!,
    source_transaction_id: source_transaction_id!,
    occurred_at: occurred_at!,
    status,
    money_amount_minor,
    currency: currency!,
  });

  const counterparty = maskSensitive(safeTrim(obj.issuer ?? obj.customer ?? obj.wallet_provider));

  return {
    ok: true,
    event: {
      event_id: makeEventId(idempotency_key),
      idempotency_key,
      source: "qris",
      source_event_id: safeTrim(obj.event_id) ?? null,
      source_transaction_id: source_transaction_id!,
      merchant_id: merchant_id!,
      occurred_at: occurred_at!,
      status,
      direction,
      money: { currency: currency!, amount_minor: money_amount_minor },
      fee_minor: null,
      net_amount_minor: null,
      channel: "qris",
      counterparty,
      raw: obj,
    },
  };
}

export function normalizeMarketplace(input: unknown): NormalizeResult {
  const errors: string[] = [];
  const obj = (input ?? {}) as Record<string, unknown>;

  const merchant_id = requireString(obj.merchant_id ?? obj.seller_id, "merchant_id", errors);
  const source_transaction_id = requireString(obj.payment_id ?? obj.order_id, "source_transaction_id", errors);
  const occurred_at = toIsoUtc(obj.paid_time ?? obj.completed_time ?? obj.occurred_at ?? obj.created_at);
  if (!occurred_at) errors.push("occurred_at is required");

  const currency = parseCurrency(obj.currency ?? "IDR");
  if (!currency) errors.push("currency is invalid");

  const amountMinor = currency ? parseAmountToMinor(obj.total_paid ?? obj.amount, currency) : null;
  if (amountMinor === null) errors.push("total_paid is invalid");

  const feeMinor = currency ? parseAmountToMinor(obj.platform_fee ?? 0, currency) : null;

  if (errors.length) return { ok: false, errors };

  const status = mapStatus("marketplace", obj.status);
  const money_amount_minor = abs(amountMinor!);

  const idempotency_key = computeIdempotencyKey({
    source: "marketplace",
    merchant_id: merchant_id!,
    source_transaction_id: source_transaction_id!,
    occurred_at: occurred_at!,
    status,
    money_amount_minor,
    currency: currency!,
  });

  const netAmount = feeMinor !== null ? money_amount_minor - abs(feeMinor) : null;

  return {
    ok: true,
    event: {
      event_id: makeEventId(idempotency_key),
      idempotency_key,
      source: "marketplace",
      source_event_id: safeTrim(obj.event_id) ?? null,
      source_transaction_id: source_transaction_id!,
      merchant_id: merchant_id!,
      occurred_at: occurred_at!,
      status,
      direction: "in",
      money: { currency: currency!, amount_minor: money_amount_minor },
      fee_minor: feeMinor !== null ? abs(feeMinor) : null,
      net_amount_minor: netAmount,
      channel: "marketplace",
      counterparty: maskSensitive(safeTrim(obj.buyer_id ?? obj.buyer_phone ?? obj.buyer_email)),
      raw: obj,
    },
  };
}

export function normalizeEwallet(input: unknown): NormalizeResult {
  const errors: string[] = [];
  const obj = (input ?? {}) as Record<string, unknown>;

  const merchant_id = requireString(obj.merchant_id, "merchant_id", errors);
  const source_transaction_id = requireString(obj.payment_id ?? obj.transaction_id, "source_transaction_id", errors);
  const occurred_at = toIsoUtc(obj.paid_at ?? obj.created_at ?? obj.occurred_at);
  if (!occurred_at) errors.push("occurred_at is required");

  const currency = parseCurrency(obj.currency ?? "IDR");
  if (!currency) errors.push("currency is invalid");

  const amountMinor = currency ? parseAmountToMinor(obj.amount, currency) : null;
  if (amountMinor === null) errors.push("amount is invalid");

  const feeMinor = currency ? parseAmountToMinor(obj.fee ?? 0, currency) : null;

  if (errors.length) return { ok: false, errors };

  const status = mapStatus("ewallet", obj.status);
  const money_amount_minor = abs(amountMinor!);

  const idempotency_key = computeIdempotencyKey({
    source: "ewallet",
    merchant_id: merchant_id!,
    source_transaction_id: source_transaction_id!,
    occurred_at: occurred_at!,
    status,
    money_amount_minor,
    currency: currency!,
  });

  const netAmount = feeMinor !== null ? money_amount_minor - abs(feeMinor) : null;

  return {
    ok: true,
    event: {
      event_id: makeEventId(idempotency_key),
      idempotency_key,
      source: "ewallet",
      source_event_id: safeTrim(obj.event_id) ?? null,
      source_transaction_id: source_transaction_id!,
      merchant_id: merchant_id!,
      occurred_at: occurred_at!,
      status,
      direction: "in",
      money: { currency: currency!, amount_minor: money_amount_minor },
      fee_minor: feeMinor !== null ? abs(feeMinor) : null,
      net_amount_minor: netAmount,
      channel: "ewallet",
      counterparty: maskSensitive(safeTrim(obj.customer_id ?? obj.customer_phone)),
      raw: obj,
    },
  };
}

export function normalizeBank(input: unknown): NormalizeResult {
  const errors: string[] = [];
  const obj = (input ?? {}) as Record<string, unknown>;

  const merchant_id = requireString(obj.merchant_id, "merchant_id", errors);
  const occurred_at = toIsoUtc(obj.posting_date ?? obj.transaction_date ?? obj.occurred_at);
  if (!occurred_at) errors.push("occurred_at is required");

  const currency = parseCurrency(obj.currency ?? "IDR");
  if (!currency) errors.push("currency is invalid");

  const amountMinor = currency ? parseAmountToMinor(obj.amount, currency) : null;
  if (amountMinor === null) errors.push("amount is invalid");

  const direction = amountMinor !== null ? directionFromAmountMinor(amountMinor) : "in";

  const ref = safeTrim(obj.reference);
  const desc = safeTrim(obj.description);
  const source_transaction_id =
    safeTrim(obj.transaction_id) ??
    (ref ? ref : sha256Hex(`${merchant_id ?? ""}|${occurred_at ?? ""}|${amountMinor ?? ""}|${desc ?? ""}`).slice(0, 32));

  if (!source_transaction_id) errors.push("source_transaction_id is required");

  if (errors.length) return { ok: false, errors };

  const status = mapStatus("bank", obj.status ?? "posted");
  const money_amount_minor = abs(amountMinor!);

  const idempotency_key = computeIdempotencyKey({
    source: "bank",
    merchant_id: merchant_id!,
    source_transaction_id: source_transaction_id!,
    occurred_at: occurred_at!,
    status,
    money_amount_minor,
    currency: currency!,
  });

  return {
    ok: true,
    event: {
      event_id: makeEventId(idempotency_key),
      idempotency_key,
      source: "bank",
      source_event_id: safeTrim(obj.event_id) ?? null,
      source_transaction_id: source_transaction_id!,
      merchant_id: merchant_id!,
      occurred_at: occurred_at!,
      status,
      direction,
      money: { currency: currency!, amount_minor: money_amount_minor },
      fee_minor: null,
      net_amount_minor: null,
      channel: "bank_transfer",
      counterparty: maskSensitive(safeTrim(obj.counterparty ?? obj.account_number)),
      raw: obj,
    },
  };
}

