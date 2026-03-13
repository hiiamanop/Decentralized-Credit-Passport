import type { Request, Response } from "express";
import { verifyIngestSignature } from "./auth.js";
import { normalizeBank, normalizeEwallet, normalizeMarketplace, normalizeQris } from "./normalizers.js";
import type { InMemoryStore } from "./store.js";
import { acceptEvent } from "./store.js";
import type { IngestResult, SourceType, TransactionEvent } from "./types.js";
import { stableStringify } from "./utils.js";

export type GatewayEnv = {
  secrets: Partial<Record<SourceType, string>>;
};

export type GatewayDeps = {
  store: InMemoryStore;
  env: GatewayEnv;
  publish: (event: TransactionEvent) => void;
};

function readRawBody(req: Request): string {
  const anyReq = req as any;
  if (typeof anyReq.rawBody === "string") return anyReq.rawBody;
  return stableStringify(req.body ?? {});
}

function normalizeBySource(source: SourceType, payload: unknown): { ok: true; event: TransactionEvent } | { ok: false; errors: string[] } {
  if (source === "qris") return normalizeQris(payload);
  if (source === "marketplace") return normalizeMarketplace(payload);
  if (source === "ewallet") return normalizeEwallet(payload);
  return normalizeBank(payload);
}

export function handleIngest(source: SourceType, deps: GatewayDeps) {
  return (req: Request, res: Response) => {
    const rawBody = readRawBody(req);
    const sig = verifyIngestSignature({
      source,
      secrets: deps.env.secrets,
      timestampHeader: req.header("X-Timestamp") ?? undefined,
      signatureHeader: req.header("X-Signature") ?? undefined,
      rawBody,
      nowMs: Date.now(),
    });
    if (!sig.ok) {
      res.status(401).json({ accepted: false, deduped: false, error: sig.error } satisfies IngestResult);
      return;
    }

    const normalized = normalizeBySource(source, req.body);
    if (!normalized.ok) {
      res.status(400).json({ accepted: false, deduped: false, error: "Validation failed", validationErrors: normalized.errors } satisfies IngestResult);
      return;
    }

    const result = acceptEvent(deps.store, normalized.event);
    if (result.event && !result.deduped) deps.publish(result.event);
    res.json(result);
  };
}

export function handleListEvents(deps: GatewayDeps) {
  return (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50) || 50));
    const merchantId = typeof req.query.merchantId === "string" ? req.query.merchantId : null;
    const source = typeof req.query.source === "string" ? (req.query.source as SourceType) : null;

    const events = deps.store.events.filter((e) => {
      if (merchantId && e.merchant_id !== merchantId) return false;
      if (source && e.source !== source) return false;
      return true;
    });

    res.json({ items: events.slice(0, limit), total: events.length });
  };
}

export function handleSummary(deps: GatewayDeps) {
  return (_req: Request, res: Response) => {
    const bySource: Record<string, { count: number; amount_minor: number; currency: string }> = {};
    for (const e of deps.store.events) {
      const k = e.source;
      if (!bySource[k]) bySource[k] = { count: 0, amount_minor: 0, currency: e.money.currency };
      bySource[k].count += 1;
      bySource[k].amount_minor += e.direction === "in" ? e.money.amount_minor : -e.money.amount_minor;
    }
    res.json({ bySource, totalEvents: deps.store.events.length });
  };
}

export function handleStream(deps: GatewayDeps) {
  return (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const listener = (event: TransactionEvent) => {
      res.write(`event: tx\n`);
      res.write(`data: ${stableStringify(event)}\n\n`);
    };

    const anyReq = req as any;
    const anyRes = res as any;
    const bus = anyReq.app?.locals?.gatewayBus as { on: (cb: (e: TransactionEvent) => void) => void; off: (cb: (e: TransactionEvent) => void) => void } | undefined;
    if (!bus) {
      res.write(`event: error\n`);
      res.write(`data: {"error":"Stream bus not configured"}\n\n`);
      res.end();
      return;
    }

    bus.on(listener);
    const close = () => bus.off(listener);
    req.on("close", close);
    anyRes.on?.("close", close);
  };
}

