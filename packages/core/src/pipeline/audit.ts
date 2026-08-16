/**
 * pipeline/audit.ts — daily self-diagnostic. Verifies the setup is actually working:
 * which URLs have no price, which are failing, which are stale — and posts a summary
 * to the Slack ops channel so problems surface even when no deal alert fires.
 */
import type { Deps } from "../deps.js";
import { sendOps } from "../alerts/ops.js";
import { intervalFor } from "./gate.js";

export interface AuditReport {
  total: number;
  priced: number;
  noPrice: string[];
  failing: string[];
  stale: string[];
  posted: boolean;
}

export async function audit(deps: Deps): Promise<AuditReport> {
  const now = deps.now().getTime();
  const [products, collections] = await Promise.all([
    deps.db.getTrackedProducts(),
    deps.db.getCollections(),
  ]);
  const intervals = new Map(collections.map((c) => [c.id, c.checkIntervalMinutes]));

  const noPrice: string[] = [];
  const failing: string[] = [];
  const stale: string[] = [];

  for (const p of products) {
    const name = (p.title ?? p.url).slice(0, 48);
    const pts = await deps.db.latestPricePoints(p.id, 1);
    if (pts.length === 0) noPrice.push(name);
    if ((p.consecutiveFailures ?? 0) >= 2)
      failing.push(`${name} (${p.consecutiveFailures}×: ${(p.lastError ?? "").slice(0, 60)})`);
    if (p.lastCheckedAt) {
      const graceMs = intervalFor(p, intervals) * 60_000 * 2 + 6 * 3_600_000;
      if (now - Date.parse(p.lastCheckedAt) > graceMs) stale.push(name);
    }
  }

  const priced = products.length - noPrice.length;
  const issues: string[] = [];
  if (noPrice.length) issues.push(`*${noPrice.length}* URL(s) with no price yet: ${noPrice.slice(0, 12).join(", ")}`);
  if (failing.length) issues.push(`*${failing.length}* failing: ${failing.slice(0, 10).join(" · ")}`);
  if (stale.length) issues.push(`*${stale.length}* overdue (not checked on schedule): ${stale.slice(0, 12).join(", ")}`);

  const header = `🩺 DropWatch daily audit — ${priced}/${products.length} URLs priced`;
  const text = issues.length ? `${header}\n• ${issues.join("\n• ")}` : `${header} — all healthy ✅`;

  // Always post one line/day so you know it ran; details only when there are issues.
  await sendOps(deps.cfg, text);

  return { total: products.length, priced, noPrice, failing, stale, posted: true };
}
