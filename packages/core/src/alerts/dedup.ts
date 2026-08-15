/**
 * alerts/dedup.ts — fingerprinting + send/suppress decision.
 * See docs/product-spec.md §4.2.
 */
import { createHash } from "node:crypto";
import type { Db } from "../db/interface.js";
import type { AlertEvent, DedupDecision, Paise } from "../types.js";

const SILENCE_MS = 7 * 86_400_000;
const FURTHER_DROP_FLAT: Paise = 100_00; // ₹100
const PRICE_STEP: Paise = 5000; // ₹50 rounding for the fingerprint

export interface Caps {
  perProductPerDay: number;
  globalPerDay: number;
}

export function fingerprint(ev: {
  productId: string;
  platform: string;
  effectiveInstant: Paise;
  bestOfferId: string | null;
}): string {
  const bucket = Math.round(ev.effectiveInstant / PRICE_STEP) * PRICE_STEP;
  const key = `${ev.productId}|${ev.platform}|${bucket}|${ev.bestOfferId ?? "none"}`;
  return createHash("sha1").update(key).digest("hex");
}

/** Start of the current IST day, as a UTC ISO string. */
export function istDayStart(now: Date): string {
  const IST = 5.5 * 3_600_000;
  const DAY = 86_400_000;
  const istMs = now.getTime() + IST;
  const dayStartUtc = Math.floor(istMs / DAY) * DAY - IST;
  return new Date(dayStartUtc).toISOString();
}

/**
 * Decide whether an immediate alert should actually be sent now.
 * Only call for routing === 'immediate'. Enforces 7-day fingerprint silence
 * (with further-drop / routing-upgrade / restock overrides) and daily caps.
 */
export async function shouldSend(
  db: Db,
  ev: AlertEvent,
  now: Date,
  caps: Caps,
): Promise<DedupDecision> {
  const product = await db.getTrackedProduct(ev.productId);
  if (product) {
    if (product.muteUntil && Date.parse(product.muteUntil) > now.getTime())
      return { send: false, reason: "muted" };
    if (product.snoozeUntil && Date.parse(product.snoozeUntil) > now.getTime())
      return { send: false, reason: "snoozed" };
  }

  const last = await db.lastSentForFingerprint(ev.fingerprint);
  let reason: "new" | "further_drop" | "routing_upgrade" | "restock" = "new";
  if (last && now.getTime() - Date.parse(last.sentAt) < SILENCE_MS) {
    const eff = ev.best.effectiveInstant;
    const dropThreshold = Math.max(
      Math.round(last.effectiveInstant * 0.03),
      FURTHER_DROP_FLAT,
    );
    const restock = ev.signals.some((s) => s.kind === "back_in_stock");
    if (last.effectiveInstant - eff >= dropThreshold) reason = "further_drop";
    else if (last.routing === "digest" && ev.score.routing === "immediate")
      reason = "routing_upgrade";
    else if (restock) reason = "restock";
    else return { send: false, reason: "fingerprint_silence" };
  }

  const dayStart = istDayStart(now);
  const perProduct = await db.sentCountToday(ev.productId, dayStart);
  if (perProduct >= caps.perProductPerDay)
    return { send: false, reason: "product_cap" };
  const global = await db.sentCountToday(null, dayStart);
  if (global >= caps.globalPerDay) return { send: false, reason: "global_cap" };

  return { send: true, reason };
}
