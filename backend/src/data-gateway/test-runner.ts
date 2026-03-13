import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createInMemoryStore } from "./store.js";
import { handleIngest } from "./gateway.js";
import type { SourceType, TransactionEvent } from "./types.js";

type FakeReq = {
  body: unknown;
  headers: Record<string, string>;
  header: (name: string) => string | undefined;
  rawBody: string;
  app: { locals: { gatewayBus: { on: (cb: (e: TransactionEvent) => void) => void; off: (cb: (e: TransactionEvent) => void) => void } } };
  on: (_: string, __: () => void) => void;
};

type FakeRes = {
  statusCode: number;
  payload: unknown;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => void;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function hmac(secret: string, timestamp: string, raw: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
}

function makeReq(source: SourceType, body: unknown, secret: string): FakeReq {
  const rawBody = stableStringify(body);
  const ts = String(Date.now());
  const sig = `sha256=${hmac(secret, ts, rawBody)}`;
  const headers: Record<string, string> = { "x-timestamp": ts, "x-signature": sig, "x-source": source };
  return {
    body,
    rawBody,
    headers,
    header: (name: string) => headers[name.toLowerCase()],
    app: { locals: { gatewayBus: { on: () => undefined, off: () => undefined } } },
    on: () => undefined,
  };
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    payload: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.payload = payload;
    },
  };
  return res;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export async function runDataGatewayTests() {
  const secret = "dev_secret";
  const store = createInMemoryStore();

  const deps = {
    store,
    env: { secrets: { qris: secret, marketplace: secret, ewallet: secret, bank: secret } as any },
    publish: () => undefined,
  };

  const base = path.resolve(process.cwd(), "testdata");
  const samples: Array<{ source: SourceType; file: string }> = [
    { source: "qris", file: "qris.sample.json" },
    { source: "marketplace", file: "marketplace.sample.json" },
    { source: "ewallet", file: "ewallet.sample.json" },
    { source: "bank", file: "bank.sample.json" },
  ];

  for (const s of samples) {
    const handler = handleIngest(s.source, deps as any);
    const payload = readJson(path.join(base, s.file));
    const req = makeReq(s.source, payload, secret) as any;
    const res = makeRes() as any;
    handler(req, res);
    assert(res.statusCode === 200, `${s.source} ingest should be 200`);
    assert((res.payload as any)?.accepted === true, `${s.source} accepted should be true`);
  }

  const qrisPayload = readJson(path.join(base, "qris.sample.json"));
  {
    const handler = handleIngest("qris", deps as any);
    const req1 = makeReq("qris", qrisPayload, secret) as any;
    const res1 = makeRes() as any;
    handler(req1, res1);
    const req2 = makeReq("qris", qrisPayload, secret) as any;
    const res2 = makeRes() as any;
    handler(req2, res2);
    assert((res2.payload as any)?.deduped === true, "Second ingest should be deduped");
  }

  {
    const handler = handleIngest("qris", deps as any);
    const badReq = makeReq("qris", qrisPayload, "wrong_secret") as any;
    const res = makeRes() as any;
    handler(badReq, res);
    assert(res.statusCode === 401, "Invalid signature should be 401");
  }

  assert(store.events.length >= 4, "Store should have events");
  return { ok: true, events: store.events.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runDataGatewayTests()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
