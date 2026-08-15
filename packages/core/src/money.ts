/**
 * money.ts — integer-paise helpers + Indian-grouped ₹ formatting.
 * ₹1 = 100 paise. Never use floats for money math.
 */
import type { Paise } from "./types.js";

export const rupees = (r: number): Paise => Math.round(r * 100);

/** Indian digit grouping: 12990000 paise → "₹1,29,900". Drops paise when .00. */
export function formatINR(paise: Paise): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const p = abs % 100;
  const s = whole.toString();
  let grouped: string;
  if (s.length <= 3) {
    grouped = s;
  } else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  const paiseStr = p > 0 ? "." + p.toString().padStart(2, "0") : "";
  return `${neg ? "-" : ""}₹${grouped}${paiseStr}`;
}

/** Percent formatting, e.g. 0.183 → "18.3%". */
export function formatPct(frac: number, digits = 1): string {
  return `${(frac * 100).toFixed(digits)}%`;
}
