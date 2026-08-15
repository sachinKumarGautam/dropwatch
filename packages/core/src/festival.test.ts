import { describe, it, expect } from "vitest";
import { activeOrUpcomingWindow, buyWaitAdvice } from "./festival.js";
import type { DealScore } from "./types.js";

const score = (total: number, bypass: DealScore["bypass"] = null): DealScore => ({
  total,
  depth: 0,
  rarity: 0,
  crossPlatform: 0,
  offerQuality: 0,
  trustLogistics: 0,
  urgency: 0,
  penalties: { fakeMrp: 0, volatility: 0, staleData: 0 },
  bypass,
  routing: total >= 70 ? "immediate" : total >= 55 ? "digest" : "log",
});

describe("festival calendar", () => {
  it("Sep 20 → BBD upcoming, advises wait for a mediocre deal", () => {
    const win = activeOrUpcomingWindow(new Date("2026-09-20T06:00:00Z"));
    expect(win?.name).toContain("Big Billion Days");
    expect(win?.startsInDays).toBe(5);
    const advice = buyWaitAdvice(score(60), win);
    expect(advice).toMatch(/Wait: Big Billion Days/);
  });

  it("Oct 2 (inside BBD) + strong score → buy", () => {
    const win = activeOrUpcomingWindow(new Date("2026-10-02T06:00:00Z"));
    expect(win?.startsInDays).toBe(0);
    const advice = buyWaitAdvice(score(78), win);
    expect(advice).toMatch(/Buy: inside/);
  });

  it("Mar 1 with a mediocre deal → no advice", () => {
    const win = activeOrUpcomingWindow(new Date("2026-03-01T06:00:00Z"));
    expect(win).toBeNull();
    expect(buyWaitAdvice(score(60), win)).toBeNull();
  });
});
