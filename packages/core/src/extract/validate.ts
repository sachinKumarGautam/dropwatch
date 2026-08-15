/**
 * extract/validate.ts — validation gates before any DB write.
 * The LLM never invents a stored number: its price must appear verbatim in the source.
 */
import type { ExtractedProduct, Paise, ValidationResult } from "../types.js";

/**
 * Is the rupee value present verbatim in the source? Comma/space-insensitive, so
 * Indian ("1,29,900") and Western ("129,900") groupings and "129900.00" all match.
 */
export function assertVerbatimPrice(
  price: Paise,
  source: string,
): { ok: boolean; matchedToken?: string } {
  const rupees = Math.round(price / 100);
  const token = String(rupees);
  const norm = source.replace(/[,\s]/g, "");
  return norm.includes(token) ? { ok: true, matchedToken: token } : { ok: false };
}

const JUMP_THRESHOLD = 0.6;

export function validateExtraction(
  p: ExtractedProduct,
  source: string,
  lastAcceptedPrice: Paise | null,
): ValidationResult {
  if (!(p.price > 0)) return { verdict: "reject", reason: "price<=0" };
  if (p.mrp != null && p.price > p.mrp)
    return { verdict: "reject", reason: "price>mrp" };
  if (p.evidence.source === "llm") {
    const v = assertVerbatimPrice(p.price, source);
    if (!v.ok)
      return { verdict: "reject", reason: "price not a verbatim substring of source" };
  }
  if (p.confidence < 0.5)
    return { verdict: "reject", reason: `confidence ${p.confidence} < 0.5` };
  if (lastAcceptedPrice != null && lastAcceptedPrice > 0) {
    const delta = Math.abs(p.price - lastAcceptedPrice) / lastAcceptedPrice;
    if (delta > JUMP_THRESHOLD)
      return {
        verdict: "needs_rescrape",
        reason: `price moved ${(delta * 100).toFixed(0)}% vs last accepted`,
      };
  }
  return { verdict: "ok" };
}
