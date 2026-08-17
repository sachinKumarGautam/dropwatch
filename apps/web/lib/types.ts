// Row shapes as returned by Supabase (snake_case).

export interface CollectionRow {
  id: string;
  name: string;
  check_interval_minutes: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  url: string;
  canonical_url: string;
  platform: string;
  title: string | null;
  brand: string | null;
  image_url: string | null;
  target_price: number | null;
  baseline_price: number | null;
  pincode: string | null;
  collection_id: string | null;
  check_interval_minutes: number | null;
  last_checked_at: string | null;
  requested_check_at: string | null;
  expires_at: string | null;
  deleted_at: string | null;
  paused: boolean;
  consecutive_failures: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PricePointRow {
  id: number;
  product_id: string;
  checked_at: string;
  price: number;
  mrp: number | null;
  in_stock: boolean;
  effective_instant: number | null;
  effective_net: number | null;
  extract_source?: string | null;
  source_tier?: number | null;
}

export interface OfferRow {
  id: string;
  product_id: string;
  kind: string;
  raw_text: string;
  issuer: string | null;
  value_pct: number | null;
  value_flat: number | null;
  cap: number | null;
  min_spend: number | null;
  coupon_code: string | null;
  active: boolean;
}

export interface CardRow {
  id: string;
  issuer: string;
  network: string;
  kind: string;
  product_name: string;
  cobrand: string | null;
  base_online_reward_pct: number;
  emi_eligible: boolean;
  active: boolean;
}

export interface AlertRow {
  id: string;
  product_id: string;
  routing: string;
  score: number;
  best_effective:
    | { effectiveInstant: number; sticker?: number; cardLabel: string; explain?: string[] }
    | null;
  score_breakdown: {
    depth: number; rarity: number; crossPlatform: number;
    offerQuality: number; trustLogistics: number; urgency: number;
  } | null;
  context: {
    price: number; mrp: number | null; median90d: number | null; samples90d: number;
    baseline?: number | null; effective?: number | null;
    competitors?: { merchant: string; price: number | null }[];
  } | null;
  signals: { kind: string; detail: string }[] | null;
  suppressed_reason: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface CompetitorRow {
  id: string;
  product_id: string;
  merchant: string;
  url: string;
  title: string;
  matched_by: string;
  confidence: number;
  latest_price: number | null;
}

export interface StatsRow {
  product_id: string;
  current_price: number | null;
  current_effective: number | null;
  all_time_low: number | null;
  low_90d: number | null;
  low_30d: number | null;
  median_90d: number | null;
  samples_90d: number;
}
