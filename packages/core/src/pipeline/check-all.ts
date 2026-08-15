/**
 * pipeline/check-all.ts — concurrency-limited fan-out over all DUE active products.
 * Frequency gating decides who actually gets scraped; one product throwing never
 * kills the run. Writes last_ok_run_at for the watchdog.
 */
import type { Deps } from "../deps.js";
import { checkProduct, type CheckSummary } from "./check.js";
import { buildHealthBlocks } from "../alerts/blocks.js";
import { sendHealthOnce } from "../alerts/ops.js";
import { isDue } from "./gate.js";

async function runLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface CheckAllSummary {
  checked: number;
  skipped: number;
  failed: number;
  alertsSent: number;
  results: CheckSummary[];
}

export async function checkAll(deps: Deps, concurrency = 2): Promise<CheckAllSummary> {
  const [products, collections] = await Promise.all([
    deps.db.getTrackedProducts({ activeOnly: true }),
    deps.db.getCollections(),
  ]);
  const intervals = new Map(collections.map((c) => [c.id, c.checkIntervalMinutes]));
  const now = deps.now();
  const due = products.filter((p) => isDue(p, intervals, now));
  const skipped = products.length - due.length;

  const results = await runLimited(due, concurrency, async (p) => {
    try {
      return await checkProduct(deps, p.id);
    } catch (e) {
      return { productId: p.id, ok: false, failed: true, error: (e as Error).message } as CheckSummary;
    }
  });

  const failed = results.filter((r) => r.failed).length;
  const succeeded = results.filter((r) => r.ok && !r.failed).length;
  const alertsSent = results.filter((r) => r.sent).length;

  if (succeeded > 0) {
    await deps.db.setMeta("last_ok_run_at", { at: now.toISOString() }).catch(() => {});
  }
  if (due.length > 0 && failed === due.length) {
    await sendHealthOnce(
      deps,
      "ALL",
      buildHealthBlocks({ productId: "ALL", title: "All due products", failures: failed, lastError: "every check failed this run" }),
    );
  }

  return { checked: results.length, skipped, failed, alertsSent, results };
}
