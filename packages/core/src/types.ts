/**
 * DropWatch — canonical types. Single source of truth.
 * Every module imports domain types from here.
 *
 * MONEY: integer paise everywhere (₹1 = 100). Never floats for money.
 * TIME: ISO-8601 strings in TS; timestamptz in DB. IST at edges, UTC in storage.
 */

export type Paise = number; // integer; ₹1 = 100
export type IsoTs = string; // ISO-8601 timestamp

export type Platform =
  | "amazon_in"
  | "flipkart"
  | "croma"
  | "nykaa"
  | "samsung_in"
  | "other";

export type Tier = 0 | 1 | 2 | 3;

export type Network = "visa" | "mastercard" | "rupay" | "amex" | "diners";

// ─────────────────────────────── scrape ────────────────────────────────────

export interface ScrapeTarget {
  productId: string;
  url: string;
  platform: Platform;
  pincode?: string | null;
}

export type ScrapeErrorCode =
  | "blocked"
  | "timeout"
  | "not_found"
  | "parse"
  | "network";

export interface ScrapeResult {
  ok: boolean;
  tierUsed: Tier;
  url: string;
  platform: Platform;
  fetchedAt: IsoTs;
  html?: string;
  markdown?: string;
  structured?: Partial<ExtractedProduct>;
  error?: { code: ScrapeErrorCode; message: string };
  meta: { attempts: number; durationMs: number; proxyUsed: boolean };
}

// ─────────────────────────────── extraction ────────────────────────────────

export interface RawOffer {
  text: string;
  sectionHint?: string; // e.g. "Bank Offer", "Coupon", "Partner Offers"
}

export type ExtractSource = "jsonld" | "embedded_state" | "dom" | "llm";

export interface ExtractedProduct {
  title: string;
  price: Paise;
  mrp: Paise | null;
  currency: "INR";
  inStock: boolean;
  isLightningDeal: boolean;
  dealEndsAt: IsoTs | null;
  deliveryFee: Paise | null;
  deliveryEtaDays: number | null;
  unitCount: number | null; // 30 (ml), 100 (tablets) — consumables
  unitLabel: string | null;
  seller: string | null;
  modelNumber: string | null;
  ean: string | null;
  offers: RawOffer[];
  evidence: { priceRaw: string; source: ExtractSource };
  confidence: number; // 0..1; deterministic paths emit 1.0
}

export type ValidationResult =
  | { verdict: "ok" }
  | { verdict: "needs_rescrape"; reason: string }
  | { verdict: "reject"; reason: string };

// ─────────────────────────────── offers & cards ────────────────────────────

export type OfferKind =
  | "instant_bank_discount"
  | "no_cost_emi"
  | "standard_emi"
  | "coupon"
  | "cashback_wallet"
  | "cashback_statement"
  | "exchange_bonus"
  | "partner_upi"
  | "cobrand_reward"
  | "gst_invoice";

export interface Offer {
  id: string;
  productId: string;
  platform: Platform;
  kind: OfferKind;
  rawText: string;
  issuer: string | null; // 'HDFC' | 'ICICI' | 'SBI' | 'Axis' | 'Paytm' | ...
  network: Network | null;
  cardKind: "credit" | "debit" | "any" | null;
  emiOnly: boolean; // instant discount that only applies on EMI transactions
  valuePct: number | null; // 10 = 10%
  valueFlat: Paise | null;
  cap: Paise | null;
  minSpend: Paise | null;
  emiMonths: number[] | null;
  couponCode: string | null;
  stackable: boolean;
  validTill: IsoTs | null;
  active: boolean;
  firstSeenAt: IsoTs;
  lastSeenAt: IsoTs;
}

/** Offer as parsed, before DB assigns id / first/last-seen. */
export type ParsedOffer = Omit<Offer, "id" | "firstSeenAt" | "lastSeenAt">;

export interface Card {
  id: string;
  issuer: string;
  network: Network;
  kind: "credit" | "debit";
  productName: string; // 'Millennia', 'Amazon Pay ICICI'
  cobrand: "amazon_in" | "flipkart" | null;
  baseOnlineRewardPct: number;
  emiEligible: boolean;
  active: boolean;
}

// ─────────────────────────────── effective price ───────────────────────────

export type PaymentPath = "card_instant" | "no_cost_emi" | "upi" | "plain";

export interface EffectivePrice {
  productId: string;
  platform: Platform;
  cardId: string | null;
  cardLabel: string; // 'HDFC Millennia CC' | 'Paytm UPI' | 'No card'
  paymentPath: PaymentPath;
  sticker: Paise;
  couponDiscount: Paise;
  bankInstantDiscount: Paise;
  emiGstCost: Paise; // ≥0, added back (a cost)
  effectiveInstant: Paise; // sticker − coupon − bankInstant + emiGst
  walletCashbackValue: Paise; // already ×0.9
  statementCashbackValue: Paise; // already ×0.7
  cobrandRewardValue: Paise;
  effectiveNet: Paise; // effectiveInstant − the three above
  appliedOfferIds: string[];
  explain: string[]; // ["−₹500 coupon SAVE500", "−₹1,500 HDFC 10% (cap)", "+₹269 EMI GST est."]
}

// ─────────────────────────────── stats & signals ───────────────────────────

export interface ProductStats {
  productId: string;
  platform: Platform;
  currentPrice: Paise;
  currentEffective: Paise | null;
  inStock: boolean;
  lastCheckedAt: IsoTs | null;
  allTimeLow: Paise | null;
  low180d: Paise | null;
  low90d: Paise | null;
  low30d: Paise | null;
  avg30d: number | null;
  median90d: number | null;
  stddev90d: number | null;
  samples90d: number;
  effAllTimeLow: Paise | null;
  effLow90d: Paise | null;
}

export type SignalKind =
  | "all_time_low"
  | "low_90d"
  | "low_180d"
  | "below_median_pct"
  | "z_rarity"
  | "drop_velocity_24h"
  | "drop_velocity_72h"
  | "mrp_discount_display"
  | "fake_mrp"
  | "price_per_unit"
  | "eff_all_time_low"
  | "eff_low_90d"
  | "coupon_appeared"
  | "back_in_stock"
  | "lightning_deal"
  | "price_error"
  | "target_hit"
  | "rising_price"
  | "cross_platform_lowest";

export interface Signal {
  kind: SignalKind;
  value: number | boolean | string;
  detail: string;
}

export type Routing = "immediate" | "digest" | "log";

export interface DealScore {
  total: number; // clamped 0..100
  depth: number;
  rarity: number;
  crossPlatform: number;
  offerQuality: number;
  trustLogistics: number;
  urgency: number;
  penalties: { fakeMrp: number; volatility: number; staleData: number };
  bypass: "price_error" | "target_hit" | null;
  routing: Routing;
}

// ─────────────────────────────── alerts ────────────────────────────────────

export interface AlertEvent {
  productId: string;
  platform: Platform;
  fingerprint: string;
  score: DealScore;
  signals: Signal[];
  best: EffectivePrice;
  ranking: EffectivePrice[]; // top few for the block
  bestCardNotHeld: { cardLabel: string; effectiveInstant: Paise } | null;
  festivalNote: string | null;
  productTitle: string;
  url: string;
  createdAt: IsoTs;
}

export type DedupDecision =
  | { send: true; reason: "new" | "further_drop" | "routing_upgrade" | "restock" }
  | {
      send: false;
      reason:
        | "fingerprint_silence"
        | "product_cap"
        | "global_cap"
        | "muted"
        | "snoozed";
    };

// ─────────────────────────────── competitor match ──────────────────────────

export interface SerpCandidate {
  title: string;
  merchant: string;
  url: string;
  price: Paise | null;
  thumbnail?: string;
}

export type MatchedBy = "ean" | "model" | "llm";

export interface CompetitorMatch {
  candidate: SerpCandidate;
  matchedBy: MatchedBy;
  confidence: number; // 0..1
}

// ─────────────────────────────── DB row types ──────────────────────────────
// Mirror the SQL schema. Money columns are Paise. camelCase in TS.

export interface CollectionRow {
  id: string;
  name: string;
  checkIntervalMinutes: number;
  createdAt: IsoTs;
  updatedAt: IsoTs;
}

export interface TrackedProductRow {
  id: string;
  url: string;
  canonicalUrl: string;
  platform: Platform;
  title: string | null;
  brand: string | null;
  modelNumber: string | null;
  ean: string | null;
  imageUrl: string | null;
  category: string | null;
  unitCount: number | null;
  unitLabel: string | null;
  targetPrice: Paise | null;
  pincode: string | null;
  collectionId: string | null;
  checkIntervalMinutes: number | null;
  lastCheckedAt: IsoTs | null;
  requestedCheckAt: IsoTs | null;
  paused: boolean;
  muteUntil: IsoTs | null;
  snoozeUntil: IsoTs | null;
  consecutiveFailures: number;
  lastError: string | null;
  createdAt: IsoTs;
  updatedAt: IsoTs;
}

export type NewTrackedProduct = {
  url: string;
  canonicalUrl: string;
  platform: Platform;
  title?: string | null;
  brand?: string | null;
  modelNumber?: string | null;
  ean?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  unitCount?: number | null;
  unitLabel?: string | null;
  targetPrice?: Paise | null;
  pincode?: string | null;
  collectionId?: string | null;
  checkIntervalMinutes?: number | null;
};

export interface PricePointRow {
  id: number;
  productId: string;
  checkedAt: IsoTs;
  price: Paise;
  mrp: Paise | null;
  inStock: boolean;
  isLightning: boolean;
  dealEndsAt: IsoTs | null;
  deliveryFee: Paise | null;
  deliveryEtaDays: number | null;
  effectiveInstant: Paise | null;
  effectiveNet: Paise | null;
  bestCardId: string | null;
  bestOfferIds: string[] | null;
  sourceTier: Tier;
  extractSource: ExtractSource;
  confidence: number;
  evidencePath: string | null;
}

export type NewPricePoint = Omit<PricePointRow, "id" | "checkedAt"> & {
  checkedAt?: IsoTs;
};

export interface NewCompetitorMatch {
  merchant: string;
  url: string;
  title: string;
  matchedBy: MatchedBy;
  confidence: number;
  latestPrice: Paise | null;
  latestCheckedAt: IsoTs | null;
}

export interface AlertContext {
  price: Paise;
  mrp: Paise | null;
  median90d: number | null;
  samples90d: number;
}

export interface AlertRow {
  id: string;
  productId: string;
  fingerprint: string;
  routing: Routing;
  score: number;
  scoreBreakdown: DealScore;
  signals: Signal[];
  bestEffective: EffectivePrice;
  context: AlertContext | null;
  blocks: unknown | null;
  suppressedReason: string | null;
  channel: string;
  createdAt: IsoTs;
  sentAt: IsoTs | null;
}

export type NewAlert = {
  productId: string;
  fingerprint: string;
  routing: Routing;
  score: number;
  scoreBreakdown: DealScore;
  signals: Signal[];
  bestEffective: EffectivePrice;
  context?: AlertContext | null;
  blocks?: unknown | null;
  suppressedReason?: string | null;
  channel?: string;
};

// ─────────────────────────────── Slack payload ─────────────────────────────

export interface SlackPayload {
  blocks: unknown[];
  text: string;
}
