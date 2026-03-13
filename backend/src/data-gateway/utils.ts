import crypto from "crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function safeTrim(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length ? t : null;
}

export function toIsoUtc(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  return null;
}

export function parseCurrency(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const c = code.trim().toUpperCase();
  if (!c.match(/^[A-Z]{3}$/)) return null;
  return c;
}

export function parseAmountToMinor(amount: unknown, currency: string): number | null {
  const minorDigits = currency === "JPY" ? 0 : 2;
  if (typeof amount === "number" && Number.isFinite(amount)) {
    return Math.round(amount * Math.pow(10, minorDigits));
  }
  if (typeof amount !== "string") return null;
  const raw = amount.trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/\s/g, "")
    .replace(/[.](?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * Math.pow(10, minorDigits));
}

export function maskSensitive(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length <= 6) return "***";
  return `${v.slice(0, 2)}***${v.slice(-2)}`;
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const aa = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

