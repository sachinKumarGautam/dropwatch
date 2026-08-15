import { describe, it, expect } from "vitest";
import { deriveSignals, hasSignal, type DeriveInput } from "./stats.js";
import { makeStats, makeEff, makeExtracted, makeOffer } from "./testkit.js";

const NOW = new Date("2026-08-15T12:00:00Z");

function baseInput(over: Partial<DeriveInput> = {}): DeriveInput {
  return {
    stats: makeStats(),
    latest: makeExtracted({ price: 8000000, mrp: 9000000 }),
    prevLatest: null,
    history72h: [],
    offerDiff: { appeared: [], disappeared: [] },
    best: makeEff({ effectiveInstant: 8000000 }),
    targetPrice: null,
    baselinePrice: null,
    competitorMin: null,
    unit: { count: null, label: null },
    now: NOW,
    ...over,
  };
}

describe("deriveSignals", () => {
  it("fires all_time_low + effective ATL and NOT price_error on a genuine low", () => {
    const sig = deriveSignals(
      baseInput({
        latest: makeExtracted({ price: 7290000, mrp: 9000000 }),
        best: makeEff({ effectiveInstant: 7000000 }),
      }),
    );
    expect(hasSignal(sig, "all_time_low")).toBe(true);
    expect(hasSignal(sig, "eff_all_time_low")).toBe(true);
    expect(hasSignal(sig, "price_error")).toBe(false);
  });

  it("fake_mrp fires on inflated MRP and suppresses mrp_discount_display", () => {
    const sig = deriveSignals(
      baseInput({
        // median 8,000,000; mrp 1.9×median; price ≈ median
        latest: makeExtracted({ price: 7900000, mrp: 15200000 }),
      }),
    );
    expect(hasSignal(sig, "fake_mrp")).toBe(true);
    expect(hasSignal(sig, "mrp_discount_display")).toBe(false);
  });

  it("price_error fires when price ≤25% of median with enough samples", () => {
    const sig = deriveSignals(
      baseInput({ latest: makeExtracted({ price: 1500000, mrp: 9000000 }) }),
    );
    expect(hasSignal(sig, "price_error")).toBe(true);
  });

  it("target_hit fires on effective ≤ target", () => {
    const sig = deriveSignals(
      baseInput({ best: makeEff({ effectiveInstant: 6900000 }), targetPrice: 7000000 }),
    );
    expect(hasSignal(sig, "target_hit")).toBe(true);
  });

  it("baseline_drop fires at ≥5% below the add-price, not at 3%", () => {
    // baseline 10,00,000 ; 5.4% below → fires
    const fires = deriveSignals(
      baseInput({ best: makeEff({ effectiveInstant: 9460000 }), baselinePrice: 10000000 }),
    );
    expect(hasSignal(fires, "baseline_drop")).toBe(true);
    // 3% below → does not fire
    const quiet = deriveSignals(
      baseInput({ best: makeEff({ effectiveInstant: 9700000 }), baselinePrice: 10000000 }),
    );
    expect(hasSignal(quiet, "baseline_drop")).toBe(false);
  });

  it("back_in_stock fires on OOS→in-stock transition", () => {
    const sig = deriveSignals(
      baseInput({
        prevLatest: { price: 8000000, inStock: false, checkedAt: "2026-08-15T04:00:00Z" },
        latest: makeExtracted({ price: 8000000, inStock: true }),
      }),
    );
    expect(hasSignal(sig, "back_in_stock")).toBe(true);
  });

  it("drop_velocity_24h fires on a fast single-step drop", () => {
    const sig = deriveSignals(
      baseInput({
        prevLatest: { price: 8000000, inStock: true, checkedAt: "2026-08-15T00:00:00Z" },
        latest: makeExtracted({ price: 7400000 }), // 7.5% drop
      }),
    );
    expect(hasSignal(sig, "drop_velocity_24h")).toBe(true);
  });

  it("coupon_appeared fires when a new coupon shows up", () => {
    const sig = deriveSignals(
      baseInput({
        offerDiff: { appeared: [makeOffer({ kind: "coupon", valueFlat: 50000 })], disappeared: [] },
      }),
    );
    expect(hasSignal(sig, "coupon_appeared")).toBe(true);
  });

  it("a plain at-median check fires no bypass/urgency signals", () => {
    const sig = deriveSignals(baseInput());
    expect(hasSignal(sig, "price_error")).toBe(false);
    expect(hasSignal(sig, "target_hit")).toBe(false);
    expect(hasSignal(sig, "all_time_low")).toBe(false);
  });
});
