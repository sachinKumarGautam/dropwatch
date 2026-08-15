/**
 * score.ts — deal score 0–100 + routing. See docs/product-spec.md §4.
 * depth(35) + rarity(25) + cross_platform(15) + offer(10) + trust(10) + urgency(5) − penalties.
 */
import { hasSignal } from "./stats.js";
import type {
  Card,
  DealScore,
  EffectivePrice,
  ExtractedProduct,
  Offer,
  ProductStats,
  Routing,
  Signal,
} from "./types.js";

const FIRST_PARTY_SELLERS =
  /appario|clicktech|cloudtail|retailnet|croma|reliance|samsung|brand store|official store|omnitech|darshita/i;

export interface ScoreInput {
  signals: Signal[];
  stats: ProductStats;
  best: EffectivePrice;
  offers: Offer[];
  cards: Card[];
  latest: ExtractedProduct;
  competitorMin: { price: number; merchant: string } | null;
  thresholds: { immediate: number; digest: number };
  now: Date;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function scoreDeal(input: ScoreInput): DealScore {
  const { stats, best, signals, latest } = input;
  const eff = best.effectiveInstant;
  const median = stats.median90d;

  // ── depth (35) ──
  let depth = 0;
  if (median != null && median > 0) {
    const pct = clamp((median - eff) / median, 0, 1);
    const denom = stats.platform === "nykaa" ? 0.5 : 0.25;
    depth = clamp(pct / denom, 0, 1) * 35;
  }

  // ── rarity (25) ──
  let lowTerm = 0;
  if (stats.allTimeLow != null && latest.price <= stats.allTimeLow) lowTerm = 25;
  else if (stats.low180d != null && latest.price <= stats.low180d) lowTerm = 20;
  else if (stats.low90d != null && latest.price <= stats.low90d) lowTerm = 15;
  else if (stats.low30d != null && latest.price <= stats.low30d) lowTerm = 6;
  let zTerm = 0;
  if (median != null && stats.stddev90d != null && stats.stddev90d > 0 && stats.samples90d >= 8) {
    const z = (median - latest.price) / stats.stddev90d;
    zTerm = clamp(10 * z, 0, 25);
  }
  const rarity = clamp(Math.max(lowTerm, zTerm), 0, 25);

  // ── cross-platform (15) ──
  let crossPlatform = 7; // neutral when we have no competitor data
  if (input.competitorMin) {
    const min = input.competitorMin.price;
    if (eff <= min * 0.97) crossPlatform = 15;
    else if (eff <= min * 1.03) crossPlatform = 8;
    else crossPlatform = 0;
  }

  // ── offer quality (10) ──
  let offerQuality = 0;
  const heldInstant =
    best.paymentPath === "card_instant" && best.bankInstantDiscount > 0;
  if (heldInstant) offerQuality += 6;
  if (input.offers.some((o) => o.active !== false && o.kind === "coupon"))
    offerQuality += 2;
  const nceUsable =
    input.offers.some((o) => o.active !== false && o.kind === "no_cost_emi") &&
    input.cards.some((c) => c.active && c.emiEligible);
  if (nceUsable) offerQuality += 2;
  offerQuality = clamp(offerQuality, 0, 10);

  // ── trust & logistics (10) ──
  let trustLogistics = 0;
  if (latest.seller && FIRST_PARTY_SELLERS.test(latest.seller)) trustLogistics += 6;
  if (latest.deliveryEtaDays != null && latest.deliveryEtaDays <= 3) trustLogistics += 2;
  if (latest.deliveryFee != null && latest.deliveryFee === 0) trustLogistics += 2;
  trustLogistics = clamp(trustLogistics, 0, 10);

  // ── urgency (5) ──
  let urgency = 0;
  if (hasSignal(signals, "lightning_deal")) urgency = 5;
  else if (
    latest.dealEndsAt &&
    Date.parse(latest.dealEndsAt) - input.now.getTime() < 24 * 3_600_000
  )
    urgency = 3;
  else if (
    hasSignal(signals, "drop_velocity_24h") ||
    hasSignal(signals, "drop_velocity_72h")
  )
    urgency = 2;

  // ── penalties ──
  const fakeMrp = hasSignal(signals, "fake_mrp") ? 10 : 0;
  const volatility =
    median != null && stats.stddev90d != null && median > 0 && stats.stddev90d / median > 0.15
      ? 5
      : 0;
  const staleData =
    stats.lastCheckedAt != null &&
    input.now.getTime() - Date.parse(stats.lastCheckedAt) > 48 * 3_600_000
      ? 5
      : 0;

  const rawTotal =
    depth +
    rarity +
    crossPlatform +
    offerQuality +
    trustLogistics +
    urgency -
    fakeMrp -
    volatility -
    staleData;
  const total = clamp(Math.round(rawTotal), 0, 100);

  const bypass: DealScore["bypass"] = hasSignal(signals, "price_error")
    ? "price_error"
    : hasSignal(signals, "target_hit")
      ? "target_hit"
      : hasSignal(signals, "baseline_drop")
        ? "baseline_drop"
        : null;

  const routing: Routing = bypass
    ? "immediate"
    : total >= input.thresholds.immediate
      ? "immediate"
      : total >= input.thresholds.digest
        ? "digest"
        : "log";

  return {
    total,
    depth: Math.round(depth),
    rarity: Math.round(rarity),
    crossPlatform,
    offerQuality,
    trustLogistics,
    urgency,
    penalties: { fakeMrp, volatility, staleData },
    bypass,
    routing,
  };
}
