import { describe, it, expect } from "vitest";
import { scoreDeal, type ScoreInput } from "./score.js";
import { makeStats, makeEff, makeExtracted, makeOffer, makeCard } from "./testkit.js";
import type { Signal } from "./types.js";

const NOW = new Date("2026-08-15T12:00:00Z");

function baseInput(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    signals: [],
    stats: makeStats(),
    best: makeEff({ effectiveInstant: 7140000, bankInstantDiscount: 150000, paymentPath: "card_instant", cardLabel: "HDFC CC" }),
    offers: [makeOffer({ kind: "instant_bank_discount", issuer: "HDFC", valuePct: 10 })],
    cards: [makeCard({ issuer: "HDFC" })],
    latest: makeExtracted({ price: 7290000, seller: "Appario Retail", deliveryEtaDays: 2, deliveryFee: 0 }),
    competitorMin: null,
    thresholds: { immediate: 70, digest: 55 },
    now: NOW,
    ...over,
  };
}

describe("scoreDeal", () => {
  it("ATL + bank offer + cross-platform lowest + coupon → ≥70 immediate", () => {
    const s = scoreDeal(
      baseInput({
        competitorMin: { price: 7500000, merchant: "Croma" },
        offers: [
          makeOffer({ kind: "instant_bank_discount", issuer: "HDFC", valuePct: 10 }),
          makeOffer({ kind: "coupon", valueFlat: 50000 }),
        ],
      }),
    );
    expect(s.total).toBeGreaterThanOrEqual(70);
    expect(s.routing).toBe("immediate");
  });

  it("mediocre case → 55–69 digest", () => {
    const s = scoreDeal(baseInput());
    expect(s.total).toBeGreaterThanOrEqual(55);
    expect(s.total).toBeLessThan(70);
    expect(s.routing).toBe("digest");
  });

  it("fake_mrp penalty subtracts 10 and can flip immediate→digest", () => {
    const input = baseInput({
      competitorMin: { price: 7500000, merchant: "Croma" },
      offers: [
        makeOffer({ kind: "instant_bank_discount", issuer: "HDFC", valuePct: 10 }),
        makeOffer({ kind: "coupon", valueFlat: 50000 }),
      ],
    });
    const clean = scoreDeal(input);
    const fakeSignal: Signal = { kind: "fake_mrp", value: true, detail: "x" };
    const dirty = scoreDeal({ ...input, signals: [fakeSignal] });
    expect(clean.total - dirty.total).toBe(10);
    expect(clean.routing).toBe("immediate");
    expect(dirty.routing).toBe("digest");
  });

  it("price_error bypasses scoring → immediate at any total", () => {
    const s = scoreDeal(
      baseInput({
        best: makeEff({ effectiveInstant: 7900000 }), // barely below median
        latest: makeExtracted({ price: 7950000, seller: "unknown 3P" }),
        signals: [{ kind: "price_error", value: 1, detail: "x" }],
      }),
    );
    expect(s.bypass).toBe("price_error");
    expect(s.routing).toBe("immediate");
  });

  it("target_hit bypasses → immediate", () => {
    const s = scoreDeal(
      baseInput({ signals: [{ kind: "target_hit", value: 1, detail: "x" }] }),
    );
    expect(s.bypass).toBe("target_hit");
    expect(s.routing).toBe("immediate");
  });

  it("baseline_drop bypasses → immediate at any total", () => {
    const s = scoreDeal(
      baseInput({
        best: makeEff({ effectiveInstant: 7900000 }),
        latest: makeExtracted({ price: 7950000, seller: "unknown 3P" }),
        signals: [{ kind: "baseline_drop", value: 0.06, detail: "6% below add-price" }],
      }),
    );
    expect(s.bypass).toBe("baseline_drop");
    expect(s.routing).toBe("immediate");
  });
});
