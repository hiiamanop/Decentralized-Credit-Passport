import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeBank, normalizeEwallet, normalizeMarketplace, normalizeQris } from "../data-gateway/normalizers.js";
import type { TransactionEvent } from "../data-gateway/types.js";
import { engineerTransactionFeatures } from "./feature-engineering.js";
import { computePassportHash } from "../credit-passport/passport-hash.js";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export async function runFeatureAndHashTests() {
  const base = path.resolve(process.cwd(), "testdata");
  const samples: Array<{ file: string; normalize: (p: unknown) => { ok: true; event: TransactionEvent } | { ok: false; errors: string[] } }> =
    [
      { file: "qris.sample.json", normalize: normalizeQris },
      { file: "marketplace.sample.json", normalize: normalizeMarketplace },
      { file: "ewallet.sample.json", normalize: normalizeEwallet },
      { file: "bank.sample.json", normalize: normalizeBank },
    ];

  const events: TransactionEvent[] = [];
  for (const s of samples) {
    const payload = readJson(path.join(base, s.file));
    const r = s.normalize(payload);
    assert(r.ok, `normalize should succeed for ${s.file}`);
    if (r.ok) {
      events.push(r.event);
    }
  }

  const features = engineerTransactionFeatures({ events, windowDays: 180, now: new Date("2026-03-12T12:00:00Z") });
  assert(features.feature_version === "tx_features_v1", "feature_version should be tx_features_v1");
  assert(features.tx_count_total === 4, "tx_count_total should be 4");
  assert(features.monthly_revenue_mean_minor >= 0, "monthly_revenue_mean_minor should be >= 0");
  assert(features.revenue_stability >= 0 && features.revenue_stability <= 1, "revenue_stability should be in [0,1]");

  const passport = {
    passport_version: "v1",
    owner_account_id: "owner.testnet",
    merchant_id: "umkm-001",
    data_window: features.window,
    features,
    ai_score: { credit_score: 800, risk_category: "low", probability_of_default: 0.2, model_version: "features_v1" },
  };

  const h1 = computePassportHash(passport);
  const h2 = computePassportHash(JSON.parse(JSON.stringify(passport)));
  assert(h1 === h2, "passport hash should be deterministic");

  const passport2 = { ...passport, merchant_id: "umkm-002" };
  const h3 = computePassportHash(passport2);
  assert(h1 !== h3, "passport hash should change when payload changes");

  return { ok: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runFeatureAndHashTests()
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
