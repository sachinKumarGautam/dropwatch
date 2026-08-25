/**
 * pipeline/digest.ts — assemble & send the 9:00 IST digest of 55–69 scorers.
 * Deduplicated by fingerprint (7-day silence) so the SAME deal isn't re-announced
 * every day; only genuinely-new or further-dropped deals go out.
 */
import type { Deps } from "../deps.js";
import { buildDigestBlocks } from "../alerts/blocks.js";
import type { AlertEvent, AlertRow } from "../types.js";

const SILENCE_MS = 7 * 86_400_000;
const FURTHER_DROP_FLAT = 100_00; // ₹100

export interface DigestSummary {
  count: number;
  sent: boolean;
}

async function toEvent(deps: Deps, row: AlertRow): Promise<AlertEvent> {
  const product = await deps.db.getTrackedProduct(row.productId);
  return {
    productId: row.productId,
    platform: row.bestEffective.platform,
    fingerprint: row.fingerprint,
    score: row.scoreBreakdown,
    signals: row.signals,
    best: row.bestEffective,
    ranking: [row.bestEffective],
    bestCardNotHeld: null,
    festivalNote: null,
    baseline: row.context?.baseline ?? null,
    competitors: [],
    productTitle: product?.title ?? "Product",
    url: product?.url ?? "",
    dropwatchUrl: deps.cfg.appUrl ? `${deps.cfg.appUrl}/product/?id=${row.productId}` : null,
    createdAt: row.createdAt,
  };
}

export async function digest(deps: Deps): Promise<DigestSummary> {
  const now = deps.now();
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const pending = await deps.db.pendingDigestAlerts(since);

  // best row per product
  const bestByProduct = new Map<string, AlertRow>();
  for (const row of pending) {
    const cur = bestByProduct.get(row.productId);
    if (!cur || row.score > cur.score) bestByProduct.set(row.productId, row);
  }
  const candidates = [...bestByProduct.values()].sort((a, b) => b.score - a.score).slice(0, 10);

  // fingerprint dedup: drop products we already Slacked in the last 7 days,
  // unless the effective price dropped a further ≥ max(3%, ₹100).
  const fresh: { row: AlertRow; ev: AlertEvent }[] = [];
  for (const row of candidates) {
    const ev = await toEvent(deps, row);
    const last = await deps.db.lastSentForFingerprint(ev.fingerprint);
    if (last && now.getTime() - Date.parse(last.sentAt) < SILENCE_MS) {
      const drop = last.effectiveInstant - ev.best.effectiveInstant;
      const threshold = Math.max(Math.round(last.effectiveInstant * 0.03), FURTHER_DROP_FLAT);
      if (drop < threshold) continue; // already told you about this exact deal
    }
    fresh.push({ row, ev });
  }

  let sent = false;
  if (fresh.length > 0) {
    await deps.slack.send(buildDigestBlocks(fresh.map((f) => f.ev)));
    for (const f of fresh) await deps.db.markAlertSent(f.row.id);
    sent = true;
  }
  // Clear the rest so they don't linger and re-collapse tomorrow.
  for (const row of pending) {
    if (!fresh.some((f) => f.row.id === row.id)) await deps.db.markAlertSent(row.id);
  }

  return { count: fresh.length, sent };
}
