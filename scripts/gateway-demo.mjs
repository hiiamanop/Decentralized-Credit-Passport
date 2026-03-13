import fs from "node:fs";
import crypto from "node:crypto";

const baseUrl = process.env.BASE_URL || "http://localhost:3000";

const sources = [
  { source: "qris", file: "qris.sample.json", secretEnv: "SOURCE_SECRET_QRIS" },
  { source: "marketplace", file: "marketplace.sample.json", secretEnv: "SOURCE_SECRET_MARKETPLACE" },
  { source: "ewallet", file: "ewallet.sample.json", secretEnv: "SOURCE_SECRET_EWALLET" },
  { source: "bank", file: "bank.sample.json", secretEnv: "SOURCE_SECRET_BANK" },
];

function hmac(secret, ts, body) {
  return crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

async function postJson(url, body, headers) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function run() {
  const config = await getJson(`${baseUrl}/config`);
  if (!config.ok) {
    throw new Error(`Backend not ready: ${config.status} ${config.text}`);
  }

  for (const s of sources) {
    const secret = process.env[s.secretEnv];
    if (!secret) throw new Error(`Missing ${s.secretEnv}`);
    const payload = JSON.parse(fs.readFileSync(new URL(`../testdata/${s.file}`, import.meta.url), "utf8"));
    const body = JSON.stringify(payload);
    const ts = String(Date.now());
    const sig = `sha256=${hmac(secret, ts, body)}`;
    const r = await postJson(`${baseUrl}/ingest/${s.source}`, body, { "X-Timestamp": ts, "X-Signature": sig });
    if (!r.ok) throw new Error(`Ingest failed ${s.source}: ${r.status} ${r.text}`);
    process.stdout.write(`${s.source}: ${r.text}\n`);
  }

  const summary = await getJson(`${baseUrl}/gateway/summary`);
  process.stdout.write(`summary: ${summary.text}\n`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

