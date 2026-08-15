/**
 * testkit.ts — factories for tests and DRY_RUN seeds. Not shipped logic.
 */
import type {
  Card,
  EffectivePrice,
  ExtractedProduct,
  Offer,
  OfferKind,
  Platform,
  ProductStats,
} from "./types.js";

export function makeExtracted(
  p: Partial<ExtractedProduct> = {},
): ExtractedProduct {
  return {
    title: "Test Product",
    price: 8000000,
    mrp: 9000000,
    currency: "INR",
    inStock: true,
    isLightningDeal: false,
    dealEndsAt: null,
    deliveryFee: 0,
    deliveryEtaDays: 2,
    unitCount: null,
    unitLabel: null,
    seller: "Appario Retail",
    modelNumber: null,
    ean: null,
    offers: [],
    evidence: { priceRaw: "₹80,000", source: "jsonld" },
    confidence: 1,
    ...p,
  };
}

export function makeStats(p: Partial<ProductStats> = {}): ProductStats {
  return {
    productId: "p1",
    platform: "amazon_in",
    currentPrice: 8000000,
    currentEffective: 8000000,
    inStock: true,
    lastCheckedAt: "2026-08-15T08:00:00Z",
    allTimeLow: 7290000,
    low180d: 7290000,
    low90d: 7490000,
    low30d: 7690000,
    avg30d: 7900000,
    median90d: 8000000,
    stddev90d: 200000,
    samples90d: 30,
    effAllTimeLow: 7100000,
    effLow90d: 7300000,
    ...p,
  };
}

export function makeEff(p: Partial<EffectivePrice> = {}): EffectivePrice {
  const sticker = p.sticker ?? 8000000;
  const effectiveInstant = p.effectiveInstant ?? sticker;
  return {
    productId: "p1",
    platform: "amazon_in",
    cardId: null,
    cardLabel: "No card offer",
    paymentPath: "plain",
    sticker,
    couponDiscount: 0,
    bankInstantDiscount: 0,
    emiGstCost: 0,
    effectiveInstant,
    walletCashbackValue: 0,
    statementCashbackValue: 0,
    cobrandRewardValue: 0,
    effectiveNet: effectiveInstant,
    appliedOfferIds: [],
    explain: [],
    ...p,
  };
}

let oseq = 0;
export function makeOffer(p: Partial<Offer> & { kind: OfferKind }): Offer {
  return {
    id: `off-${oseq++}`,
    productId: "p1",
    platform: "amazon_in",
    rawText: p.kind,
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

export function makeCard(p: Partial<Card> & { issuer: string }): Card {
  return {
    id: `card-${p.issuer}`,
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

export const platform = (x: Platform): Platform => x;
