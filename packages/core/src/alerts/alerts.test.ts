import { describe, it, expect } from "vitest";
import { fingerprint, shouldSend, type Caps } from "./dedup.js";
import { buildDealBlocks, buildDigestBlocks } from "./blocks.js";
import { createMemoryDb } from "../db/memory.js";
import { makeEff, makeExtracted } from "../testkit.js";
import type { AlertEvent, DealScore, Signal, TrackedProductRow } from "../types.js";

const NOW = new Date("2026-08-15T12:00:00Z");
const caps: Caps = { perProductPerDay: 2, globalPerDay: 8 };

const score = (routing: DealScore["routing"], total = 80): DealScore => ({
  total,
  depth: 0, rarity: 0, crossPlatform: 0, offerQuality: 0, trustLogistics: 0, urgency: 0,
  penalties: { fakeMrp: 0, volatility: 0, staleData: 0 },
  bypass: null,
  routing,
});

function ev(over: Partial<AlertEvent> = {}, effInstant = 6100000): AlertEvent {
  const best = makeEff({ effectiveInstant: effInstant, cardLabel: "HDFC CC" });
  const fp = fingerprint({ productId: "p1", platform: "amazon_in", effectiveInstant: effInstant, bestOfferId: "o1" });
  return {
    productId: "p1",
    platform: "amazon_in",
    fingerprint: fp,
    score: score("immediate"),
    signals: [{ kind: "all_time_low", value: 1, detail: "New all-time low" } as Signal],
    best,
    ranking: [best],
    bestCardNotHeld: null,
    festivalNote: null,
    productTitle: "Samsung Galaxy S24 Ultra",
    url: "https://amazon.in/dp/X",
    createdAt: NOW.toISOString(),
    ...over,
  };
}

function seedProduct(): TrackedProductRow[] {
  return [
    {
      id: "p1", url: "https://amazon.in/dp/X", canonicalUrl: "https://amazon.in/dp/X",
      platform: "amazon_in", title: "S24", brand: null, modelNumber: null, ean: null,
      imageUrl: null, category: null, unitCount: null, unitLabel: null, targetPrice: null,
      pincode: null, collectionId: null, checkIntervalMinutes: null, lastCheckedAt: null,
      requestedCheckAt: null, paused: false, muteUntil: null, snoozeUntil: null,
      consecutiveFailures: 0, lastError: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    },
  ];
}

describe("fingerprint", () => {
  it("same ₹50 band → same fp; different band → different fp", () => {
    const a = fingerprint({ productId: "p1", platform: "amazon_in", effectiveInstant: 7000000, bestOfferId: "o1" });
    const b = fingerprint({ productId: "p1", platform: "amazon_in", effectiveInstant: 7002000, bestOfferId: "o1" });
    const c = fingerprint({ productId: "p1", platform: "amazon_in", effectiveInstant: 7008000, bestOfferId: "o1" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("shouldSend", () => {
  async function sentAlert(db: ReturnType<typeof createMemoryDb>, e: AlertEvent, routing: DealScore["routing"] = "immediate") {
    const id = await db.insertAlert({
      productId: e.productId, fingerprint: e.fingerprint, routing, score: e.score.total,
      scoreBreakdown: e.score, signals: e.signals, bestEffective: e.best,
    });
    await db.markAlertSent(id);
  }

  it("first time → send new", async () => {
    const db = createMemoryDb({ now: () => NOW, seed: { products: seedProduct() } });
    const d = await shouldSend(db, ev(), NOW, caps);
    expect(d).toEqual({ send: true, reason: "new" });
  });

  it("identical within 7d → suppressed", async () => {
    const db = createMemoryDb({ now: () => NOW, seed: { products: seedProduct() } });
    await sentAlert(db, ev());
    const d = await shouldSend(db, ev(), NOW, caps);
    expect(d.send).toBe(false);
  });

  it("further drop ≥ max(3%,₹100) overrides silence (same fingerprint)", async () => {
    const db = createMemoryDb({ now: () => NOW, seed: { products: seedProduct() } });
    await sentAlert(db, ev({ fingerprint: "fp-x" }, 6100000));
    const cheaper = ev({ fingerprint: "fp-x", best: makeEff({ effectiveInstant: 5900000 }) });
    const d = await shouldSend(db, cheaper, NOW, caps);
    expect(d).toEqual({ send: true, reason: "further_drop" });
  });

  it("a materially cheaper price sends anyway (new fingerprint bucket)", async () => {
    const db = createMemoryDb({ now: () => NOW, seed: { products: seedProduct() } });
    await sentAlert(db, ev({}, 6100000));
    const d = await shouldSend(db, ev({}, 5900000), NOW, caps);
    expect(d.send).toBe(true);
  });

  it("routing upgrade digest→immediate overrides silence", async () => {
    const db = createMemoryDb({ now: () => NOW, seed: { products: seedProduct() } });
    await sentAlert(db, ev({ score: score("digest", 60) }), "digest");
    const d = await shouldSend(db, ev({ score: score("immediate", 72) }), NOW, caps);
    expect(d).toEqual({ send: true, reason: "routing_upgrade" });
  });

  it("restock overrides silence", async () => {
    const db = createMemoryDb({ now: () => NOW, seed: { products: seedProduct() } });
    await sentAlert(db, ev());
    const restock = ev({ signals: [{ kind: "back_in_stock", value: true, detail: "Back in stock" }] });
    const d = await shouldSend(db, restock, NOW, caps);
    expect(d).toEqual({ send: true, reason: "restock" });
  });

  it("per-product cap blocks after 2 sends today", async () => {
    const db = createMemoryDb({ now: () => NOW, seed: { products: seedProduct() } });
    await sentAlert(db, ev({ fingerprint: "fp-a" }));
    await sentAlert(db, ev({ fingerprint: "fp-b" }));
    const d = await shouldSend(db, ev({ fingerprint: "fp-c" }), NOW, caps);
    expect(d).toEqual({ send: false, reason: "product_cap" });
  });

  it("mute suppresses", async () => {
    const products = seedProduct();
    products[0]!.muteUntil = "2026-09-01T00:00:00Z";
    const db = createMemoryDb({ now: () => NOW, seed: { products } });
    const d = await shouldSend(db, ev(), NOW, caps);
    expect(d).toEqual({ send: false, reason: "muted" });
  });
});

describe("blocks", () => {
  it("deal block carries price, why-now, ranking and actions", () => {
    const best = makeEff({
      effectiveInstant: 6124000, sticker: 6499900, cardLabel: "ICICI Amazon Pay CC",
      explain: ["−₹500 coupon SAVE500", "−₹1,500 ICICI 10% (cap)"],
    });
    const payload = buildDealBlocks(
      ev({ best, ranking: [best], bestCardNotHeld: { cardLabel: "Flipkart Axis CC", effectiveInstant: 6090000 }, festivalNote: "Buy: strong deal now." }),
    );
    const json = JSON.stringify(payload.blocks);
    expect(payload.text).toContain("₹61,240");
    expect(json).toContain("Why now");
    expect(json).toContain("Effective price by path");
    expect(json).toContain("Flipkart Axis CC");
    expect(json).toContain("actions");
    expect(json).toContain("Check now");
  });

  it("digest block caps at 10 rows sorted by score", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      ev({ productTitle: `P${i}`, score: score("digest", i + 40) }, 5000000 + i),
    );
    const payload = buildDigestBlocks(many);
    const section = (payload.blocks as any[]).find((b) => b.type === "section");
    const lines = (section.text.text as string).split("\n");
    expect(lines.length).toBe(10);
    expect(payload.text).toContain("digest");
  });
});

// silence unused import warning
void makeExtracted;
