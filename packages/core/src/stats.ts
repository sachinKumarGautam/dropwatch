/**
 * stats.ts — read ProductStats and derive the signal set that drives scoring.
 * All detectors are deterministic and unit-tested. See docs/product-spec.md §1.
 */
import type { Db } from "./db/interface.js";
import type {
  EffectivePrice,
  ExtractedProduct,
  Offer,
  Paise,
  ProductStats,
  Signal,
} from "./types.js";

export async function readStats(
  db: Db,
  productId: string,
): Promise<ProductStats | null> {
  return db.getStats(productId);
}

export interface DeriveInput {
  stats: ProductStats;
  latest: ExtractedProduct;
  prevLatest: { price: Paise; inStock: boolean; checkedAt: string } | null;
  history72h: Array<{ price: Paise; checkedAt: string }>;
  offerDiff: { appeared: Offer[]; disappeared: Offer[] };
  best: EffectivePrice;
  targetPrice: Paise | null;
  competitorMin: { price: Paise; merchant: string } | null;
  unit: { count: number | null; label: string | null };
  now: Date;
}

const belowMedianThreshold = (platform: string): number =>
  platform === "nykaa" ? 0.25 : 0.12;

export function deriveSignals(input: DeriveInput): Signal[] {
  const { stats, latest, best } = input;
  const out: Signal[] = [];
  const price = latest.price;
  const eff = best.effectiveInstant;
  const median = stats.median90d;

  // ── sticker lows ──
  if (stats.allTimeLow != null && price <= stats.allTimeLow * 1.02) {
    out.push({
      kind: "all_time_low",
      value: price,
      detail:
        price <= stats.allTimeLow
          ? "New all-time low"
          : "Within 2% of all-time low",
    });
  }
  if (
    stats.low90d != null &&
    price <= stats.low90d &&
    median != null &&
    price <= median * 0.95
  ) {
    out.push({ kind: "low_90d", value: price, detail: "New 90-day low, ≥5% below median" });
  }
  if (
    stats.low180d != null &&
    price <= stats.low180d &&
    median != null &&
    price <= median * 0.97
  ) {
    out.push({ kind: "low_180d", value: price, detail: "New 180-day low" });
  }

  // ── below-median % (on effective) ──
  if (median != null && median > 0) {
    const pct = (median - eff) / median;
    if (pct >= belowMedianThreshold(stats.platform)) {
      out.push({
        kind: "below_median_pct",
        value: pct,
        detail: `${(pct * 100).toFixed(1)}% below 90-day median (effective)`,
      });
    }
    // ── z-score rarity ──
    if (stats.stddev90d != null && stats.stddev90d > 0 && stats.samples90d >= 8) {
      const z = (median - price) / stats.stddev90d;
      if (z >= 2) {
        out.push({ kind: "z_rarity", value: z, detail: `Statistically rare (z=${z.toFixed(1)})` });
      }
    }
  }

  // ── effective lows (signature) ──
  if (stats.effAllTimeLow != null && eff <= stats.effAllTimeLow) {
    out.push({ kind: "eff_all_time_low", value: eff, detail: "New effective all-time low (card-adjusted)" });
  } else if (stats.effLow90d != null && eff <= stats.effLow90d) {
    out.push({ kind: "eff_low_90d", value: eff, detail: "New effective 90-day low (card-adjusted)" });
  }

  // ── velocity ──
  if (input.prevLatest) {
    const ageH =
      (input.now.getTime() - Date.parse(input.prevLatest.checkedAt)) / 3_600_000;
    if (ageH <= 30 && input.prevLatest.price > 0) {
      const drop = (input.prevLatest.price - price) / input.prevLatest.price;
      if (drop >= 0.05) {
        out.push({
          kind: "drop_velocity_24h",
          value: drop,
          detail: `${(drop * 100).toFixed(1)}% drop since last check`,
        });
      }
    }
  }
  if (input.history72h.length > 0) {
    const ref = Math.max(...input.history72h.map((p) => p.price));
    if (ref > 0) {
      const drop = (ref - price) / ref;
      if (drop >= 0.08) {
        out.push({
          kind: "drop_velocity_72h",
          value: drop,
          detail: `${(drop * 100).toFixed(1)}% below its 72h high`,
        });
      }
    }
  }

  // ── MRP display + fake-MRP detector ──
  const mrp = latest.mrp;
  let fakeMrp = false;
  if (mrp != null && mrp > 0 && median != null) {
    if (mrp >= 1.8 * median && (mrp - price) / mrp >= 0.4 && price >= 0.97 * median) {
      fakeMrp = true;
      out.push({
        kind: "fake_mrp",
        value: true,
        detail: "Inflated MRP — headline discount is cosmetic",
      });
    }
  }
  if (mrp != null && mrp > price && !fakeMrp) {
    out.push({
      kind: "mrp_discount_display",
      value: (mrp - price) / mrp,
      detail: `${(((mrp - price) / mrp) * 100).toFixed(0)}% off MRP`,
    });
  }

  // ── price-per-unit (informational) ──
  if (input.unit.count && input.unit.count > 0) {
    const ppu = Math.round(price / input.unit.count);
    out.push({
      kind: "price_per_unit",
      value: ppu,
      detail: `${(ppu / 100).toFixed(2)} per ${input.unit.label ?? "unit"}`,
    });
  }

  // ── coupon appearance ──
  const newCoupons = input.offerDiff.appeared.filter(
    (o) => o.kind === "coupon" || o.kind === "instant_bank_discount",
  );
  if (newCoupons.length > 0) {
    out.push({
      kind: "coupon_appeared",
      value: newCoupons.length,
      detail: "New coupon / bank offer available",
    });
  }

  // ── stock transitions ──
  if (input.prevLatest && !input.prevLatest.inStock && latest.inStock) {
    out.push({ kind: "back_in_stock", value: true, detail: "Back in stock" });
  }
  if (latest.isLightningDeal) {
    out.push({ kind: "lightning_deal", value: true, detail: "Lightning / limited-time deal" });
  }

  // ── price-error heuristic (bypass) ──
  if (
    median != null &&
    price <= 0.25 * median &&
    latest.inStock &&
    stats.samples90d >= 10
  ) {
    out.push({
      kind: "price_error",
      value: price,
      detail: "Possible price error — 75%+ below median",
    });
  }

  // ── target hit (bypass) ──
  if (input.targetPrice != null && eff <= input.targetPrice) {
    out.push({ kind: "target_hit", value: eff, detail: "Target price reached (effective)" });
  }

  // ── rising price (window closing) ──
  const seq = [...input.history72h]
    .sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt))
    .map((p) => p.price)
    .concat(price);
  if (seq.length >= 4) {
    const last4 = seq.slice(-4);
    const rising =
      last4[1]! > last4[0]! && last4[2]! > last4[1]! && last4[3]! > last4[2]!;
    if (rising && stats.low30d != null && price >= stats.low30d * 1.05) {
      out.push({ kind: "rising_price", value: price, detail: "Price rising — window may be closing" });
    }
  }

  // ── cross-platform lowest ──
  if (input.competitorMin && eff <= input.competitorMin.price * 0.99) {
    out.push({
      kind: "cross_platform_lowest",
      value: eff,
      detail: `Lowest across platforms (vs ${input.competitorMin.merchant})`,
    });
  }

  return out;
}

export function hasSignal(signals: Signal[], kind: Signal["kind"]): boolean {
  return signals.some((s) => s.kind === kind);
}
