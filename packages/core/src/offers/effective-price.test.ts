import { describe, it, expect } from "vitest";
import {
  computeEffectivePrices,
  rankEffective,
  bestCardNotHeld,
} from "./effective-price.js";
import { rupees } from "../money.js";
import type { Card, Offer, OfferKind, Platform } from "../types.js";

let seq = 0;
function offer(p: Partial<Offer> & { kind: OfferKind }): Offer {
  return {
    id: `o${seq++}`,
    productId: "p1",
    platform: "amazon_in",
    rawText: p.rawText ?? p.kind,
    issuer: null,
    network: null,
    cardKind: null,
    emiOnly: false,
    valuePct: null,
    valueFlat: null,
    cap: null,
    minSpend: null,
    emiMonths: null,
    couponCode: null,
    stackable: false,
    validTill: null,
    active: true,
    firstSeenAt: "2026-08-01T00:00:00Z",
    lastSeenAt: "2026-08-01T00:00:00Z",
    ...p,
  };
}

function card(p: Partial<Card> & { issuer: string }): Card {
  return {
    id: `c-${p.issuer}`,
    network: "visa",
    kind: "credit",
    productName: "Card",
    cobrand: null,
    baseOnlineRewardPct: 0,
    emiEligible: true,
    active: true,
    ...p,
  };
}

const platform: Platform = "amazon_in";

describe("effective-price", () => {
  it("(a) coupon + capped bank discount → exact paise", () => {
    const rows = computeEffectivePrices({
      productId: "p1",
      platform,
      sticker: rupees(64999),
      offers: [
        offer({ kind: "coupon", valueFlat: rupees(500), couponCode: "SAVE500" }),
        offer({
          kind: "instant_bank_discount",
          issuer: "HDFC",
          cardKind: "credit",
          valuePct: 10,
          cap: rupees(1500),
          minSpend: rupees(5000),
        }),
      ],
      cards: [card({ issuer: "HDFC", productName: "Millennia" })],
    });
    const ci = rows.find((r) => r.paymentPath === "card_instant")!;
    expect(ci.couponDiscount).toBe(rupees(500));
    expect(ci.bankInstantDiscount).toBe(rupees(1500)); // capped, not 10% of 64499
    expect(ci.effectiveInstant).toBe(rupees(62999)); // 64999 − 500 − 1500
  });

  it("(b) NCE and instant rows both emitted; ranking picks cheaper", () => {
    const rows = computeEffectivePrices({
      productId: "p1",
      platform,
      sticker: rupees(50000),
      offers: [
        offer({
          kind: "instant_bank_discount",
          issuer: "HDFC",
          cardKind: "credit",
          valuePct: 10,
          cap: rupees(2500),
          minSpend: rupees(5000),
        }),
        offer({ kind: "no_cost_emi", minSpend: rupees(2999), emiMonths: [3, 6, 9] }),
      ],
      cards: [card({ issuer: "HDFC", productName: "Regalia", emiEligible: true })],
    });
    const paths = rows.map((r) => r.paymentPath);
    expect(paths).toContain("card_instant");
    expect(paths).toContain("no_cost_emi");
    const ranked = rankEffective(rows);
    expect(ranked[0]!.paymentPath).toBe("card_instant");
    expect(ranked[0]!.effectiveInstant).toBe(rupees(47500)); // 50000 − 2500
  });

  it("(c) EMI GST cost is exact (9 months on ₹50,000 base)", () => {
    const rows = computeEffectivePrices({
      productId: "p1",
      platform,
      sticker: rupees(50000),
      offers: [
        offer({ kind: "no_cost_emi", minSpend: rupees(2999), emiMonths: [3, 6, 9] }),
        offer({
          kind: "instant_bank_discount",
          issuer: "ICICI",
          cardKind: "credit",
          emiOnly: true,
          valueFlat: rupees(3000),
          minSpend: rupees(49999),
        }),
      ],
      cards: [card({ issuer: "ICICI", productName: "Sapphiro", emiEligible: true })],
    });
    const nce = rows.find((r) => r.paymentPath === "no_cost_emi")!;
    // 0.18 * 5,000,000 * 0.16 * (10/24) = 60,000 paise = ₹600
    expect(nce.emiGstCost).toBe(rupees(600));
    expect(nce.bankInstantDiscount).toBe(rupees(3000)); // EMI-only offer applies here
    expect(nce.effectiveInstant).toBe(rupees(47600)); // 50000 − 3000 + 600
  });

  it("(d) minSpend excludes an offer that doesn't meet the threshold", () => {
    const rows = computeEffectivePrices({
      productId: "p1",
      platform,
      sticker: rupees(50000),
      offers: [
        offer({
          kind: "instant_bank_discount",
          issuer: "HDFC",
          cardKind: "credit",
          valuePct: 10,
          minSpend: rupees(60000), // above sticker → excluded
        }),
      ],
      cards: [card({ issuer: "HDFC", productName: "Millennia" })],
    });
    expect(rows.every((r) => r.bankInstantDiscount === 0)).toBe(true);
  });

  it("(e) effectiveNet applies 0.9/0.7 cashback weights + cobrand reward", () => {
    const rows = computeEffectivePrices({
      productId: "p1",
      platform: "amazon_in",
      sticker: rupees(10000),
      offers: [
        offer({
          kind: "instant_bank_discount",
          issuer: "ICICI",
          cardKind: "credit",
          valuePct: 10,
          cap: rupees(1000),
          minSpend: rupees(5000),
        }),
        offer({ kind: "cashback_wallet", valueFlat: rupees(500) }),
        offer({ kind: "cashback_statement", valueFlat: rupees(1000) }),
      ],
      cards: [
        card({
          issuer: "ICICI",
          productName: "Amazon Pay",
          cobrand: "amazon_in",
          baseOnlineRewardPct: 5,
          emiEligible: false,
        }),
      ],
    });
    const ci = rows.find((r) => r.paymentPath === "card_instant")!;
    expect(ci.effectiveInstant).toBe(rupees(9000)); // 10000 − 1000
    expect(ci.walletCashbackValue).toBe(rupees(450)); // 500 × 0.9
    expect(ci.statementCashbackValue).toBe(rupees(700)); // 1000 × 0.7
    expect(ci.cobrandRewardValue).toBe(rupees(450)); // 9000 × 5%
    expect(ci.effectiveNet).toBe(rupees(7400)); // 9000 − 450 − 700 − 450
  });

  it("(f) bestCardNotHeld surfaces an ICICI offer when wallet is HDFC-only", () => {
    const offers = [
      offer({
        kind: "instant_bank_discount",
        issuer: "ICICI",
        cardKind: "credit",
        valuePct: 10,
        cap: rupees(1500),
        minSpend: rupees(5000),
      }),
    ];
    const held = [card({ issuer: "HDFC", productName: "Millennia" })];
    const res = bestCardNotHeld(offers, held, rupees(50000));
    expect(res).not.toBeNull();
    expect(res!.cardLabel).toContain("ICICI");
    expect(res!.effectiveInstant).toBe(rupees(48500)); // 50000 − 1500 (capped)
  });
});
