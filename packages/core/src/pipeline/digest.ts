/**
 * pipeline/digest.ts — assemble & send the 9:00 IST digest of 55–69 scorers.
 */
import type { Deps } from "../deps.js";
import { buildDigestBlocks } from "../alerts/blocks.js";
import type { AlertEvent, AlertRow } from "../types.js";

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
    productTitle: product?.title ?? "Product",
    url: product?.url ?? "",
    createdAt: row.createdAt,
  };
}

export async function digest(deps: Deps): Promise<DigestSummary> {
  const since = new Date(deps.now().getTime() - 24 * 3_600_000).toISOString();
  const pending = await deps.db.pendingDigestAlerts(since);

  // best row per product
  const bestByProduct = new Map<string, AlertRow>();
  for (const row of pending) {
    const cur = bestByProduct.get(row.productId);
    if (!cur || row.score > cur.score) bestByProduct.set(row.productId, row);
  }
  const rows = [...bestByProduct.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  if (rows.length === 0) return { count: 0, sent: false };

  const events = await Promise.all(rows.map((r) => toEvent(deps, r)));
  await deps.slack.send(buildDigestBlocks(events));
  for (const r of rows) await deps.db.markAlertSent(r.id);
  return { count: rows.length, sent: true };
}
