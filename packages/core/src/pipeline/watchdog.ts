/**
 * pipeline/watchdog.ts — alerts (once/day) if no successful check has happened in
 * over 26h, i.e. the scheduler or scraping is silently broken.
 */
import type { Deps } from "../deps.js";
import { istDayKey, sendOps } from "../alerts/ops.js";

const STALE_MS = 26 * 3_600_000;

export interface WatchdogResult {
  ok: boolean;
  stale: boolean;
  alerted: boolean;
  lastOkAt: string | null;
}

export async function watchdog(deps: Deps): Promise<WatchdogResult> {
  const now = deps.now();
  const meta = (await deps.db.getMeta("last_ok_run_at")) as { at?: string } | null;
  const lastOkAt = meta?.at ?? null;
  const stale = lastOkAt == null || now.getTime() - Date.parse(lastOkAt) > STALE_MS;
  if (!stale) return { ok: true, stale: false, alerted: false, lastOkAt };

  const dedupeKey = `watchdog:${istDayKey(now)}`;
  if (await deps.db.getMeta(dedupeKey)) return { ok: true, stale: true, alerted: false, lastOkAt };
  await deps.db.setMeta(dedupeKey, { at: now.toISOString() });
  await sendOps(
    deps.cfg,
    `⚠️ DropWatch watchdog: no successful check in over 26h (last OK: ${lastOkAt ?? "never"}). Scraping or the scheduler may be down.`,
  );
  return { ok: true, stale: true, alerted: true, lastOkAt };
}
