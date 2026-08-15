/**
 * demo-seed.ts — a self-contained MemoryDb seed for DRY_RUN demos and the E2E test.
 * Product URL matches fixtures/manifest.json so the FixtureScraper resolves it.
 */
import type { SeedData } from "./db/interface.js";
import { rupees } from "./money.js";
import type { Card, PricePointRow, TrackedProductRow } from "./types.js";

export const DEMO_PRODUCT_ID = "demo-iphone";
export const DEMO_URL = "https://www.amazon.in/dp/B0IPHONE15";

export function demoCards(): Card[] {
  return [
    {
      id: "card-hdfc",
      issuer: "HDFC",
      network: "visa",
      kind: "credit",
      productName: "Millennia",
      cobrand: null,
      baseOnlineRewardPct: 1,
      emiEligible: true,
      active: true,
    },
    {
      id: "card-icici-apay",
      issuer: "ICICI",
      network: "visa",
      kind: "credit",
      productName: "Amazon Pay",
      cobrand: "amazon_in",
      baseOnlineRewardPct: 5,
      emiEligible: true,
      active: true,
    },
  ];
}

export function demoSeed(now: Date): SeedData {
  const product: TrackedProductRow = {
    id: DEMO_PRODUCT_ID,
    url: DEMO_URL,
    canonicalUrl: DEMO_URL,
    platform: "amazon_in",
    title: "Apple iPhone 15 (128 GB) - Blue",
    brand: "Apple",
    modelNumber: "MTP43HN/A",
    ean: "0195949036194",
    imageUrl: null,
    category: "electronics",
    unitCount: null,
    unitLabel: null,
    targetPrice: null,
    pincode: "560102",
    collectionId: null,
    checkIntervalMinutes: null,
    lastCheckedAt: null,
    requestedCheckAt: null,
    paused: false,
    muteUntil: null,
    snoozeUntil: null,
    consecutiveFailures: 0,
    lastError: null,
    createdAt: new Date(now.getTime() - 100 * 86_400_000).toISOString(),
    updatedAt: now.toISOString(),
  };

  // 90 days of flat history at ₹1,45,000 so the fixture's ₹1,29,900 is a genuine all-time low.
  const pricePoints: PricePointRow[] = [];
  for (let d = 90; d >= 1; d--) {
    pricePoints.push({
      id: 1000 + (90 - d),
      productId: DEMO_PRODUCT_ID,
      checkedAt: new Date(now.getTime() - d * 86_400_000).toISOString(),
      price: rupees(145000),
      mrp: rupees(149900),
      inStock: true,
      isLightning: false,
      dealEndsAt: null,
      deliveryFee: 0,
      deliveryEtaDays: 2,
      effectiveInstant: rupees(145000),
      effectiveNet: rupees(145000),
      bestCardId: null,
      bestOfferIds: null,
      sourceTier: 1,
      extractSource: "jsonld",
      confidence: 1,
      evidencePath: null,
    });
  }

  return {
    products: [product],
    pricePoints,
    cards: demoCards(),
    competitorMatches: [
      {
        id: "cm-croma",
        productId: DEMO_PRODUCT_ID,
        merchant: "Croma",
        url: "https://www.croma.com/apple-iphone-15-128gb-blue/p/300100",
        title: "Apple iPhone 15 (128 GB) - Blue",
        matchedBy: "ean",
        confidence: 0.98,
        latestPrice: rupees(140000),
        latestCheckedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
        active: true,
      },
    ],
  };
}
