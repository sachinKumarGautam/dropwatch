/**
 * db/supabase.ts — production Db over supabase-js (service role, bypasses RLS).
 * Row mappers translate snake_case columns ↔ camelCase domain types.
 * Verified against a live project in phase P7.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
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
  TrackedProductRow,
} from "../types.js";
import {
  OFFER_STALE_MS,
  type CompetitorMatchRow,
  type Db,
  type FingerprintSend,
  type OfferDiff,
} from "./interface.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// ── mappers ──────────────────────────────────────────────────────────────
const toCollection = (r: any): CollectionRow => ({
  id: r.id,
  name: r.name,
  checkIntervalMinutes: r.check_interval_minutes,
  expiresAt: r.expires_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toProduct = (r: any): TrackedProductRow => ({
  id: r.id,
  url: r.url,
  canonicalUrl: r.canonical_url,
  platform: r.platform,
  title: r.title,
  brand: r.brand,
  modelNumber: r.model_number,
  ean: r.ean,
  imageUrl: r.image_url,
  category: r.category,
  unitCount: r.unit_count,
  unitLabel: r.unit_label,
  targetPrice: r.target_price,
  baselinePrice: r.baseline_price,
  pincode: r.pincode,
  collectionId: r.collection_id,
  checkIntervalMinutes: r.check_interval_minutes,
  lastCheckedAt: r.last_checked_at,
  requestedCheckAt: r.requested_check_at,
  expiresAt: r.expires_at ?? null,
  deletedAt: r.deleted_at ?? null,
  paused: r.paused,
  muteUntil: r.mute_until,
  snoozeUntil: r.snooze_until,
  consecutiveFailures: r.consecutive_failures,
  lastError: r.last_error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const productPatch = (p: Partial<TrackedProductRow>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const map: Record<string, string> = {
    title: "title",
    brand: "brand",
    modelNumber: "model_number",
    ean: "ean",
    imageUrl: "image_url",
    category: "category",
    unitCount: "unit_count",
    unitLabel: "unit_label",
    targetPrice: "target_price",
    baselinePrice: "baseline_price",
    pincode: "pincode",
    collectionId: "collection_id",
    checkIntervalMinutes: "check_interval_minutes",
    lastCheckedAt: "last_checked_at",
    requestedCheckAt: "requested_check_at",
    expiresAt: "expires_at",
    deletedAt: "deleted_at",
    paused: "paused",
    muteUntil: "mute_until",
    snoozeUntil: "snooze_until",
    consecutiveFailures: "consecutive_failures",
    lastError: "last_error",
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in p) out[col] = (p as Record<string, unknown>)[k];
  }
  out.updated_at = new Date().toISOString();
  return out;
};

const toPoint = (r: any): PricePointRow => ({
  id: r.id,
  productId: r.product_id,
  checkedAt: r.checked_at,
  price: r.price,
  mrp: r.mrp,
  inStock: r.in_stock,
  isLightning: r.is_lightning,
  dealEndsAt: r.deal_ends_at,
  deliveryFee: r.delivery_fee,
  deliveryEtaDays: r.delivery_eta_days,
  effectiveInstant: r.effective_instant,
  effectiveNet: r.effective_net,
  bestCardId: r.best_card_id,
  bestOfferIds: r.best_offer_ids,
  sourceTier: r.source_tier,
  extractSource: r.extract_source,
  confidence: r.confidence,
  evidencePath: r.evidence_path,
});

const toOffer = (r: any): Offer => ({
  id: r.id,
  productId: r.product_id,
  platform: r.platform,
  kind: r.kind,
  rawText: r.raw_text,
  issuer: r.issuer,
  network: r.network,
  cardKind: r.card_kind,
  emiOnly: r.emi_only,
  valuePct: r.value_pct,
  valueFlat: r.value_flat,
  cap: r.cap,
  minSpend: r.min_spend,
  emiMonths: r.emi_months,
  couponCode: r.coupon_code,
  stackable: r.stackable,
  validTill: r.valid_till,
  active: r.active,
  firstSeenAt: r.first_seen_at,
  lastSeenAt: r.last_seen_at,
});

const toCard = (r: any): Card => ({
  id: r.id,
  issuer: r.issuer,
  network: r.network,
  kind: r.kind,
  productName: r.product_name,
  cobrand: r.cobrand,
  baseOnlineRewardPct: Number(r.base_online_reward_pct),
  emiEligible: r.emi_eligible,
  active: r.active,
});

const toStats = (r: any, platform: Platform): ProductStats => ({
  productId: r.product_id,
  platform,
  currentPrice: r.current_price,
  currentEffective: r.current_effective,
  inStock: r.in_stock,
  lastCheckedAt: r.last_checked_at,
  allTimeLow: r.all_time_low,
  low180d: r.low_180d,
  low90d: r.low_90d,
  low30d: r.low_30d,
  avg30d: r.avg_30d == null ? null : Number(r.avg_30d),
  median90d: r.median_90d == null ? null : Number(r.median_90d),
  stddev90d: r.stddev_90d == null ? null : Number(r.stddev_90d),
  samples90d: Number(r.samples_90d ?? 0),
  effAllTimeLow: r.eff_all_time_low,
  effLow90d: r.eff_low_90d,
});

const toAlert = (r: any): AlertRow => ({
  id: r.id,
  productId: r.product_id,
  fingerprint: r.fingerprint,
  routing: r.routing,
  score: r.score,
  scoreBreakdown: r.score_breakdown,
  signals: r.signals,
  bestEffective: r.best_effective,
  context: r.context ?? null,
  blocks: r.blocks,
  suppressedReason: r.suppressed_reason,
  channel: r.channel,
  createdAt: r.created_at,
  sentAt: r.sent_at,
});

const toCompetitor = (r: any): CompetitorMatchRow => ({
  id: r.id,
  productId: r.product_id,
  merchant: r.merchant,
  url: r.url,
  title: r.title,
  matchedBy: r.matched_by,
  confidence: r.confidence,
  latestPrice: r.latest_price,
  latestCheckedAt: r.latest_checked_at,
  active: r.active,
});

function must<T>(res: { data: T | null; error: unknown }, ctx: string): T {
  if (res.error) throw new Error(`DB ${ctx}: ${JSON.stringify(res.error)}`);
  return res.data as T;
}

export function createDb(cfg: { url: string; serviceRoleKey: string }): Db {
  const sb: SupabaseClient = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false },
  });

  return {
    async getCollections() {
      const rows = must(
        await sb.from("collections").select("*").order("created_at", { ascending: false }),
        "getCollections",
      ) as any[];
      return rows.map(toCollection);
    },
    async getTrackedProducts(f) {
      let q = sb.from("tracked_products").select("*").is("deleted_at", null);
      if (f?.activeOnly) q = q.eq("paused", false);
      const rows = must(await q, "getTrackedProducts") as any[];
      return rows.map(toProduct);
    },
    async getTrackedProduct(id) {
      const { data, error } = await sb
        .from("tracked_products")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`DB getTrackedProduct: ${error.message}`);
      return data ? toProduct(data) : null;
    },
    async insertTrackedProduct(row: NewTrackedProduct) {
      const { data, error } = await sb
        .from("tracked_products")
        .upsert(
          {
            url: row.url,
            canonical_url: row.canonicalUrl,
            platform: row.platform,
            title: row.title ?? null,
            brand: row.brand ?? null,
            model_number: row.modelNumber ?? null,
            ean: row.ean ?? null,
            image_url: row.imageUrl ?? null,
            category: row.category ?? null,
            unit_count: row.unitCount ?? null,
            unit_label: row.unitLabel ?? null,
            target_price: row.targetPrice ?? null,
            pincode: row.pincode ?? null,
            collection_id: row.collectionId ?? null,
            check_interval_minutes: row.checkIntervalMinutes ?? null,
          },
          { onConflict: "canonical_url" },
        )
        .select("*")
        .single();
      if (error) throw new Error(`DB insertTrackedProduct: ${error.message}`);
      return toProduct(data);
    },
    async updateTrackedProduct(id, patch) {
      const { error } = await sb
        .from("tracked_products")
        .update(productPatch(patch))
        .eq("id", id);
      if (error) throw new Error(`DB updateTrackedProduct: ${error.message}`);
    },
    async deleteTrackedProduct(id) {
      const { error } = await sb.from("tracked_products").delete().eq("id", id);
      if (error) throw new Error(`DB deleteTrackedProduct: ${error.message}`);
    },

    async insertPricePoint(row: NewPricePoint) {
      const { error } = await sb.from("price_history").insert({
        product_id: row.productId,
        checked_at: row.checkedAt ?? new Date().toISOString(),
        price: row.price,
        mrp: row.mrp,
        in_stock: row.inStock,
        is_lightning: row.isLightning,
        deal_ends_at: row.dealEndsAt,
        delivery_fee: row.deliveryFee,
        delivery_eta_days: row.deliveryEtaDays,
        effective_instant: row.effectiveInstant,
        effective_net: row.effectiveNet,
        best_card_id: row.bestCardId,
        best_offer_ids: row.bestOfferIds,
        source_tier: row.sourceTier,
        extract_source: row.extractSource,
        confidence: row.confidence,
        evidence_path: row.evidencePath,
      });
      if (error) throw new Error(`DB insertPricePoint: ${error.message}`);
    },
    async latestPricePoints(productId, n) {
      const rows = must(
        await sb
          .from("price_history")
          .select("*")
          .eq("product_id", productId)
          .order("checked_at", { ascending: false })
          .limit(n),
        "latestPricePoints",
      ) as any[];
      return rows.map(toPoint);
    },
    async pointsSince(productId, since) {
      const rows = must(
        await sb
          .from("price_history")
          .select("*")
          .eq("product_id", productId)
          .gte("checked_at", since)
          .order("checked_at", { ascending: true }),
        "pointsSince",
      ) as any[];
      return rows.map(toPoint);
    },

    async upsertOffers(productId, incoming: ParsedOffer[]): Promise<OfferDiff> {
      const beforeRows = must(
        await sb.from("offers").select("*").eq("product_id", productId).eq("active", true),
        "upsertOffers.before",
      ) as any[];
      const before = beforeRows.map(toOffer);
      const beforeHashes = new Set(before.map((o) => md5(o.rawText)));
      const seen = new Set<string>();
      const nowIso = new Date().toISOString();

      for (const po of incoming) {
        const hash = md5(po.rawText);
        seen.add(hash);
        const { error } = await sb.from("offers").upsert(
          {
            product_id: productId,
            platform: po.platform,
            kind: po.kind,
            raw_text: po.rawText,
            issuer: po.issuer,
            network: po.network,
            card_kind: po.cardKind,
            emi_only: po.emiOnly,
            value_pct: po.valuePct,
            value_flat: po.valueFlat,
            cap: po.cap,
            min_spend: po.minSpend,
            emi_months: po.emiMonths,
            coupon_code: po.couponCode,
            stackable: po.stackable,
            valid_till: po.validTill,
            active: true,
            last_seen_at: nowIso,
          },
          { onConflict: "product_id,raw_hash" },
        );
        if (error) throw new Error(`DB upsertOffers: ${error.message}`);
      }

      // Deactivate only offers missing this run AND last seen beyond the grace window.
      const cutoffIso = new Date(Date.now() - OFFER_STALE_MS).toISOString();
      const staleGone = before.filter(
        (o) => !seen.has(md5(o.rawText)) && o.lastSeenAt < cutoffIso,
      );
      if (staleGone.length > 0) {
        await sb.from("offers").update({ active: false }).in("id", staleGone.map((o) => o.id));
      }

      const afterRows = must(
        await sb.from("offers").select("*").eq("product_id", productId).eq("active", true),
        "upsertOffers.after",
      ) as any[];
      const current = afterRows.map(toOffer);
      const appeared = current.filter((o) => !beforeHashes.has(md5(o.rawText)));
      return { appeared, disappeared: staleGone, current };
    },
    async getActiveOffers(productId) {
      const rows = must(
        await sb.from("offers").select("*").eq("product_id", productId).eq("active", true),
        "getActiveOffers",
      ) as any[];
      return rows.map(toOffer);
    },

    async getCards() {
      const rows = must(
        await sb.from("credit_cards").select("*").eq("active", true),
        "getCards",
      ) as any[];
      return rows.map(toCard);
    },
    async insertCard(card) {
      const { data, error } = await sb
        .from("credit_cards")
        .insert({
          issuer: card.issuer,
          network: card.network,
          kind: card.kind,
          product_name: card.productName,
          cobrand: card.cobrand,
          base_online_reward_pct: card.baseOnlineRewardPct,
          emi_eligible: card.emiEligible,
          active: card.active,
        })
        .select("*")
        .single();
      if (error) throw new Error(`DB insertCard: ${error.message}`);
      return toCard(data);
    },
    async deleteCard(id) {
      const { error } = await sb.from("credit_cards").delete().eq("id", id);
      if (error) throw new Error(`DB deleteCard: ${error.message}`);
    },

    async getStats(productId): Promise<ProductStats | null> {
      const { data, error } = await sb
        .from("v_product_stats")
        .select("*")
        .eq("product_id", productId)
        .maybeSingle();
      if (error) throw new Error(`DB getStats: ${error.message}`);
      if (!data) return null;
      return toStats(data, data.platform);
    },

    async upsertCompetitorMatches(productId, rows: NewCompetitorMatch[]) {
      if (rows.length === 0) return;
      const nowIso = new Date().toISOString();
      const { error } = await sb.from("competitor_matches").upsert(
        rows.map((r) => ({
          product_id: productId,
          merchant: r.merchant,
          url: r.url,
          title: r.title,
          matched_by: r.matchedBy,
          confidence: r.confidence,
          latest_price: r.latestPrice,
          latest_checked_at: r.latestCheckedAt ?? nowIso,
          active: true,
        })),
        { onConflict: "product_id,url" },
      );
      if (error) throw new Error(`DB upsertCompetitorMatches: ${error.message}`);
    },
    async getCompetitorMatches(productId) {
      const rows = must(
        await sb
          .from("competitor_matches")
          .select("*")
          .eq("product_id", productId)
          .eq("active", true),
        "getCompetitorMatches",
      ) as any[];
      return rows.map(toCompetitor);
    },
    async setCompetitorPrice(id, price, checkedAt, title) {
      const patch: Record<string, unknown> = { latest_price: price, latest_checked_at: checkedAt };
      if (title) patch.title = title;
      const { error } = await sb.from("competitor_matches").update(patch).eq("id", id);
      if (error) throw new Error(`DB setCompetitorPrice: ${error.message}`);
    },
    async getCompetitorMin(productId) {
      const rows = must(
        await sb
          .from("competitor_matches")
          .select("merchant, latest_price, confidence")
          .eq("product_id", productId)
          .eq("active", true)
          .gte("confidence", 0.75)
          .not("latest_price", "is", null)
          .order("latest_price", { ascending: true })
          .limit(1),
        "getCompetitorMin",
      ) as any[];
      const r = rows[0];
      return r ? { price: r.latest_price as Paise, merchant: r.merchant } : null;
    },

    async insertAlert(row: NewAlert): Promise<string> {
      const { data, error } = await sb
        .from("alerts")
        .insert({
          product_id: row.productId,
          fingerprint: row.fingerprint,
          routing: row.routing,
          score: row.score,
          score_breakdown: row.scoreBreakdown,
          signals: row.signals,
          best_effective: row.bestEffective,
          context: row.context ?? null,
          blocks: row.blocks ?? null,
          suppressed_reason: row.suppressedReason ?? null,
          channel: row.channel ?? "slack",
        })
        .select("id")
        .single();
      if (error) throw new Error(`DB insertAlert: ${error.message}`);
      return data.id as string;
    },
    async markAlertSent(id) {
      const { error } = await sb
        .from("alerts")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`DB markAlertSent: ${error.message}`);
    },
    async lastSentForFingerprint(fp): Promise<FingerprintSend | null> {
      const rows = must(
        await sb
          .from("alerts")
          .select("sent_at, routing, best_effective")
          .eq("fingerprint", fp)
          .not("sent_at", "is", null)
          .order("sent_at", { ascending: false })
          .limit(1),
        "lastSentForFingerprint",
      ) as any[];
      const r = rows[0];
      if (!r) return null;
      return {
        sentAt: r.sent_at,
        effectiveInstant: r.best_effective?.effectiveInstant ?? 0,
        routing: r.routing,
      };
    },
    async sentCountToday(productId, istDayStart) {
      let q = sb
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .not("sent_at", "is", null)
        .gte("sent_at", istDayStart);
      if (productId != null) q = q.eq("product_id", productId);
      const { count, error } = await q;
      if (error) throw new Error(`DB sentCountToday: ${error.message}`);
      return count ?? 0;
    },
    async pendingDigestAlerts(since): Promise<AlertRow[]> {
      const rows = must(
        await sb
          .from("alerts")
          .select("*")
          .eq("routing", "digest")
          .is("sent_at", null)
          .is("suppressed_reason", null)
          .gte("created_at", since),
        "pendingDigestAlerts",
      ) as any[];
      return rows.map(toAlert);
    },

    async storeEvidence(productId, ts, markdown): Promise<string> {
      const safeTs = ts.replace(/[:.]/g, "-");
      const path = `evidence/${productId}/${safeTs}.md.gz`;
      const { error } = await sb.storage
        .from("evidence")
        .upload(path, gzipSync(Buffer.from(markdown, "utf8")), {
          contentType: "application/gzip",
          upsert: true,
        });
      if (error) {
        // Non-fatal: evidence is best-effort.
        return "";
      }
      return path;
    },
    async getMeta(key) {
      const { data, error } = await sb
        .from("meta")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw new Error(`DB getMeta: ${error.message}`);
      return data?.value ?? null;
    },
    async setMeta(key, v) {
      const { error } = await sb
        .from("meta")
        .upsert(
          { key, value: v as any, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );
      if (error) throw new Error(`DB setMeta: ${error.message}`);
    },
    async ping() {
      const { error } = await sb.from("meta").select("key").limit(1);
      if (error) throw new Error(`DB ping: ${error.message}`);
    },
  };
}
