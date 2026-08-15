import { describe, it, expect } from "vitest";
import { isDue, intervalFor } from "./gate.js";
import type { TrackedProductRow } from "../types.js";

const NOW = new Date("2026-08-15T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

function prod(p: Partial<TrackedProductRow> = {}): TrackedProductRow {
  return {
    id: "p", url: "u", canonicalUrl: "u", platform: "amazon_in",
    title: null, brand: null, modelNumber: null, ean: null, imageUrl: null,
    category: null, unitCount: null, unitLabel: null, targetPrice: null, baselinePrice: null, pincode: null,
    collectionId: null, checkIntervalMinutes: null, lastCheckedAt: null, requestedCheckAt: null,
    expiresAt: null, deletedAt: null,
    paused: false, muteUntil: null, snoozeUntil: null, consecutiveFailures: 0, lastError: null,
    createdAt: ago(10000), updatedAt: ago(10000), ...p,
  };
}

const noCollections = new Map<string, number>();

describe("frequency gate", () => {
  it("never-checked product is due", () => {
    expect(isDue(prod(), noCollections, NOW)).toBe(true);
  });
  it("paused product is never due", () => {
    expect(isDue(prod({ paused: true, lastCheckedAt: null }), noCollections, NOW)).toBe(false);
  });
  it("checked 2h ago with daily default is NOT due", () => {
    expect(isDue(prod({ lastCheckedAt: ago(120) }), noCollections, NOW)).toBe(false);
  });
  it("checked 25h ago with daily default IS due", () => {
    expect(isDue(prod({ lastCheckedAt: ago(25 * 60) }), noCollections, NOW)).toBe(true);
  });
  it("per-URL override beats collection and default", () => {
    const cols = new Map([["c1", 1440]]);
    const p = prod({ collectionId: "c1", checkIntervalMinutes: 360, lastCheckedAt: ago(370) });
    expect(intervalFor(p, cols)).toBe(360);
    expect(isDue(p, cols, NOW)).toBe(true); // 370m > 360m
  });
  it("collection interval used when no override", () => {
    const cols = new Map([["c1", 360]]);
    const p = prod({ collectionId: "c1", lastCheckedAt: ago(200) });
    expect(intervalFor(p, cols)).toBe(360);
    expect(isDue(p, cols, NOW)).toBe(false); // 200m < 360m
  });
  it("grace window lets a daily item re-fire a few minutes early", () => {
    // 1440m interval, last checked 1425m ago → within 20m grace → due
    expect(isDue(prod({ lastCheckedAt: ago(1425) }), noCollections, NOW)).toBe(true);
  });
  it("requested_check_at after last check bypasses the interval", () => {
    const p = prod({ lastCheckedAt: ago(30), requestedCheckAt: ago(1) });
    expect(isDue(p, noCollections, NOW)).toBe(true);
  });
  it("requested_check_at before last check does NOT re-fire", () => {
    const p = prod({ lastCheckedAt: ago(1), requestedCheckAt: ago(30) });
    expect(isDue(p, noCollections, NOW)).toBe(false);
  });
});
