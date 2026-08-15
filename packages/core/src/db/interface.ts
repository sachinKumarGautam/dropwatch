/**
 * db/interface.ts — the Db port. Two implementations satisfy it:
 *   - createDb(cfg)        → Supabase-backed (production)  [db/supabase.ts]
 *   - createMemoryDb(seed) → in-memory (DRY_RUN + tests)   [db/memory.ts]
 * A conformance suite runs the same tests over both.
 */
import type {
  AlertRow,
  Card,
  CollectionRow,
  IsoTs,
  NewAlert,
  NewCompetitorMatch,
  NewPricePoint,
  NewTrackedProduct,
  Offer,
  Paise,
  ParsedOffer,
  Platform,
  PricePointRow,
  ProductStats,
  Routing,
  TrackedProductRow,
} from "../types.js";

export interface CompetitorMatchRow {
  id: string;
  productId: string;
  merchant: string;
  url: string;
  title: string;
  matchedBy: "ean" | "model" | "llm" | "manual";
  confidence: number;
  latestPrice: Paise | null;
  latestCheckedAt: IsoTs | null;
  active: boolean;
}

export interface OfferDiff {
  appeared: Offer[];
  disappeared: Offer[];
  current: Offer[];
}

export interface FingerprintSend {
  sentAt: IsoTs;
  effectiveInstant: Paise;
  routing: Routing;
}

export interface Db {
  // collections ("apps")
  getCollections(): Promise<CollectionRow[]>;

  // products
  getTrackedProducts(f?: { activeOnly?: boolean }): Promise<TrackedProductRow[]>;
  getTrackedProduct(id: string): Promise<TrackedProductRow | null>;
  insertTrackedProduct(row: NewTrackedProduct): Promise<TrackedProductRow>;
  updateTrackedProduct(
    id: string,
    patch: Partial<TrackedProductRow>,
  ): Promise<void>;
  deleteTrackedProduct(id: string): Promise<void>;

  // price history
  insertPricePoint(row: NewPricePoint): Promise<void>;
  latestPricePoints(productId: string, n: number): Promise<PricePointRow[]>;
  pointsSince(productId: string, since: IsoTs): Promise<PricePointRow[]>;

  // offers
  upsertOffers(productId: string, offers: ParsedOffer[]): Promise<OfferDiff>;
  getActiveOffers(productId: string): Promise<Offer[]>;

  // cards
  getCards(): Promise<Card[]>;
  insertCard(card: Omit<Card, "id">): Promise<Card>;
  deleteCard(id: string): Promise<void>;

  // stats
  getStats(productId: string): Promise<ProductStats | null>;

  // competitor matches
  upsertCompetitorMatches(
    productId: string,
    rows: NewCompetitorMatch[],
  ): Promise<void>;
  getCompetitorMatches(productId: string): Promise<CompetitorMatchRow[]>;
  setCompetitorPrice(
    id: string,
    price: Paise | null,
    checkedAt: IsoTs,
    title?: string | null,
  ): Promise<void>;
  getCompetitorMin(
    productId: string,
  ): Promise<{ price: Paise; merchant: string } | null>;

  // alerts
  insertAlert(row: NewAlert): Promise<string>;
  markAlertSent(id: string): Promise<void>;
  lastSentForFingerprint(fp: string): Promise<FingerprintSend | null>;
  sentCountToday(
    productId: string | null,
    istDayStart: IsoTs,
  ): Promise<number>;
  pendingDigestAlerts(since: IsoTs): Promise<AlertRow[]>;

  // evidence + meta + health
  storeEvidence(
    productId: string,
    ts: IsoTs,
    markdown: string,
  ): Promise<string>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, v: unknown): Promise<void>;
  ping(): Promise<void>;
}

export interface SeedData {
  collections?: CollectionRow[];
  products?: TrackedProductRow[];
  pricePoints?: PricePointRow[];
  cards?: Card[];
  offers?: Offer[];
  competitorMatches?: CompetitorMatchRow[];
}

// ── Shared stats math (used by MemoryDb; mirrors v_product_stats exactly) ────

/** percentile_cont(0.5) — linear interpolation, matching Postgres semantics. */
export function percentileCont(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0]!;
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * frac;
}

/** stddev_samp — sample standard deviation (n-1). Null for n<2 (matches Postgres). */
export function stddevSamp(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  return Math.sqrt(variance);
}

const DAY_MS = 86_400_000;

/**
 * Compute ProductStats from a product's full price-history, matching the SQL view.
 * Only in-stock, price>0 samples count toward the aggregates ("valid" CTE).
 */
export function computeStats(
  productId: string,
  platform: Platform,
  points: PricePointRow[],
  now: Date,
): ProductStats | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort(
    (a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt),
  );
  const latest = sorted[sorted.length - 1]!;

  const valid = sorted.filter((p) => p.inStock && p.price > 0);
  const within = (days: number) =>
    valid.filter(
      (p) => Date.parse(p.checkedAt) >= now.getTime() - days * DAY_MS,
    );

  const minOf = (arr: PricePointRow[]): Paise | null =>
    arr.length ? Math.min(...arr.map((p) => p.price)) : null;
  const minEff = (arr: PricePointRow[]): Paise | null => {
    const effs = arr
      .map((p) => p.effectiveInstant)
      .filter((v): v is number => v != null);
    return effs.length ? Math.min(...effs) : null;
  };

  const v90 = within(90);
  const v30 = within(30);
  const prices90 = v90.map((p) => p.price).sort((a, b) => a - b);

  return {
    productId,
    platform,
    currentPrice: latest.price,
    currentEffective: latest.effectiveInstant,
    inStock: latest.inStock,
    lastCheckedAt: latest.checkedAt,
    allTimeLow: minOf(valid),
    low180d: minOf(within(180)),
    low90d: minOf(v90),
    low30d: minOf(v30),
    avg30d: v30.length
      ? v30.reduce((a, b) => a + b.price, 0) / v30.length
      : null,
    median90d: percentileCont(prices90, 0.5),
    stddev90d: stddevSamp(prices90),
    samples90d: v90.length,
    effAllTimeLow: minEff(valid),
    effLow90d: minEff(v90),
  };
}
