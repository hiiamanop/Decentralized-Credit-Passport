import crypto from "crypto";
import { stableStringify } from "../data-gateway/utils.js";

export function computePassportHash(passport: unknown): string {
  const canonical = stableStringify(passport);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

