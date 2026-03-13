import crypto from "crypto";
import { timingSafeEqualHex } from "./utils.js";

export type SourceSecrets = Partial<Record<"qris" | "marketplace" | "ewallet" | "bank", string>>;

export type SignatureCheck = {
  ok: boolean;
  error?: string;
};

export function computeHmacHex(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyIngestSignature(args: {
  source: "qris" | "marketplace" | "ewallet" | "bank";
  secrets: SourceSecrets;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  rawBody: string;
  nowMs: number;
  maxSkewMs?: number;
}): SignatureCheck {
  const { source, secrets, timestampHeader, signatureHeader, rawBody, nowMs } = args;
  const maxSkewMs = args.maxSkewMs ?? 5 * 60 * 1000;

  const secret = secrets[source];
  if (!secret) return { ok: false, error: "Missing source secret" };
  if (!timestampHeader) return { ok: false, error: "Missing X-Timestamp" };
  if (!signatureHeader) return { ok: false, error: "Missing X-Signature" };

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return { ok: false, error: "Invalid X-Timestamp" };
  const skew = Math.abs(nowMs - ts);
  if (skew > maxSkewMs) return { ok: false, error: "Timestamp skew too large" };

  const expected = computeHmacHex(secret, String(ts), rawBody);
  const provided = signatureHeader.startsWith("sha256=") ? signatureHeader.slice("sha256=".length) : signatureHeader;
  if (!timingSafeEqualHex(expected, provided)) return { ok: false, error: "Invalid signature" };

  return { ok: true };
}
