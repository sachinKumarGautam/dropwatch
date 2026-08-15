/**
 * pipeline/gate.ts — decides whether a product is DUE for a check.
 * Pure and unit-tested. Applied only in checkAll; direct `check <id>` bypasses it.
 */
import type { TrackedProductRow } from "../types.js";

// Absorb GitHub Actions start-time jitter so daily items don't slip a whole bucket.
const GRACE_MS = 20 * 60_000;
export const DEFAULT_INTERVAL_MIN = 1440;

/** interval = per-URL override ?? collection interval ?? 1 day. */
export function intervalFor(
  p: TrackedProductRow,
  collectionIntervals: Map<string, number>,
): number {
  if (p.checkIntervalMinutes != null) return p.checkIntervalMinutes;
  if (p.collectionId != null) {
    const c = collectionIntervals.get(p.collectionId);
    if (c != null) return c;
  }
  return DEFAULT_INTERVAL_MIN;
}

export function isDue(
  p: TrackedProductRow,
  collectionIntervals: Map<string, number>,
  now: Date,
): boolean {
  if (p.paused) return false;
  // manual "check now": requested after the last check
  if (
    p.requestedCheckAt &&
    (!p.lastCheckedAt || Date.parse(p.requestedCheckAt) > Date.parse(p.lastCheckedAt))
  )
    return true;
  if (!p.lastCheckedAt) return true; // never checked
  const intervalMs = intervalFor(p, collectionIntervals) * 60_000;
  return now.getTime() - Date.parse(p.lastCheckedAt) >= intervalMs - GRACE_MS;
}
