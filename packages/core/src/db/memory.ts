/**
 * db/memory.ts — in-memory Db. Behavior-identical to the Supabase impl for the
 * operations the worker + tests exercise. Stats math mirrors v_product_stats via
 * computeStats() so mocks can't drift from production.
 */
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
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
  PricePointRow,
  ProductStats,
  TrackedProductRow,
} from "../types.js";
import {
  computeStats,
  type CompetitorMatchRow,
  type Db,
  type FingerprintSend,
  type OfferDiff,
  type SeedData,
} from "./interface.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

export interface MemoryDbOptions {
  now?: () => Date;
  evidenceDir?: string;
  seed?: SeedData;
}

export function createMemoryDb(opts: MemoryDbOptions = {}): Db {
  const now = opts.now ?? (() => new Date());
  const evidenceDir =
    opts.evidenceDir ?? mkdtempSync(join(tmpdir(), "dropwatch-evidence-"));

  const collections: CollectionRow[] = [...(opts.seed?.collections ?? [])];
  const products: TrackedProductRow[] = [...(opts.seed?.products ?? [])];
  let points: PricePointRow[] = [...(opts.seed?.pricePoints ?? [])];
  const cards: Card[] = [...(opts.seed?.cards ?? [])];
  const offers: Offer[] = [...(opts.seed?.offers ?? [])];
  const competitors: CompetitorMatchRow[] = [
    ...(opts.seed?.competitorMatches ?? []),
  ];
  const alerts: AlertRow[] = [];
  const meta = new Map<string, unknown>();
  let priceSeq =
    points.reduce((mx, p) => Math.max(mx, p.id), 0) + 1;

  const iso = () => now().toISOString();

  return {
    async getCollections() {
      return [...collections];
    },
    async getTrackedProducts(f) {
      return products.filter((p) => (f?.activeOnly ? !p.paused : true));
    },
    async getTrackedProduct(id) {
      return products.find((p) => p.id === id) ?? null;
    },
    async insertTrackedProduct(row: NewTrackedProduct) {
      const ts = iso();
      const rec: TrackedProductRow = {
        id: randomUUID(),
        url: row.url,
        canonicalUrl: row.canonicalUrl,
        platform: row.platform,
        title: row.title ?? null,
        brand: row.brand ?? null,
        modelNumber: row.modelNumber ?? null,
        ean: row.ean ?? null,
        imageUrl: row.imageUrl ?? null,
        category: row.category ?? null,
        unitCount: row.unitCount ?? null,
        unitLabel: row.unitLabel ?? null,
        targetPrice: row.targetPrice ?? null,
        pincode: row.pincode ?? null,
        collectionId: row.collectionId ?? null,
        checkIntervalMinutes: row.checkIntervalMinutes ?? null,
        lastCheckedAt: null,
        requestedCheckAt: null,
        paused: false,
        muteUntil: null,
        snoozeUntil: null,
        consecutiveFailures: 0,
        lastError: null,
        createdAt: ts,
        updatedAt: ts,
      };
      const existing = products.find((p) => p.canonicalUrl === rec.canonicalUrl);
      if (existing) return existing;
      products.push(rec);
      return rec;
    },
    async updateTrackedProduct(id, patch) {
      const p = products.find((x) => x.id === id);
      if (!p) return;
      Object.assign(p, patch, { updatedAt: iso() });
    },
    async deleteTrackedProduct(id) {
      const i = products.findIndex((p) => p.id === id);
      if (i >= 0) products.splice(i, 1);
      points = points.filter((pt) => pt.productId !== id);
    },

    async insertPricePoint(row: NewPricePoint) {
      points.push({
        id: priceSeq++,
        checkedAt: row.checkedAt ?? iso(),
        productId: row.productId,
        price: row.price,
        mrp: row.mrp,
        inStock: row.inStock,
        isLightning: row.isLightning,
        dealEndsAt: row.dealEndsAt,
        deliveryFee: row.deliveryFee,
        deliveryEtaDays: row.deliveryEtaDays,
        effectiveInstant: row.effectiveInstant,
        effectiveNet: row.effectiveNet,
        bestCardId: row.bestCardId,
        bestOfferIds: row.bestOfferIds,
        sourceTier: row.sourceTier,
        extractSource: row.extractSource,
        confidence: row.confidence,
        evidencePath: row.evidencePath,
      });
    },
    async latestPricePoints(productId, n) {
      return points
        .filter((p) => p.productId === productId)
        .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
        .slice(0, n);
    },
    async pointsSince(productId, since) {
      const t = Date.parse(since);
      return points
        .filter((p) => p.productId === productId && Date.parse(p.checkedAt) >= t)
        .sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
    },

    async upsertOffers(productId, incoming: ParsedOffer[]): Promise<OfferDiff> {
      const ts = iso();
      const appeared: Offer[] = [];
      const seenHashes = new Set<string>();
      for (const po of incoming) {
        const hash = md5(po.rawText);
        seenHashes.add(hash);
        const existing = offers.find(
          (o) => o.productId === productId && md5(o.rawText) === hash,
        );
        if (existing) {
          Object.assign(existing, po, { lastSeenAt: ts, active: true });
        } else {
          const rec: Offer = {
            ...po,
            id: randomUUID(),
            productId,
            firstSeenAt: ts,
            lastSeenAt: ts,
            active: true,
          };
          offers.push(rec);
          appeared.push(rec);
        }
      }
      const disappeared: Offer[] = [];
      for (const o of offers) {
        if (o.productId !== productId) continue;
        if (o.active && !seenHashes.has(md5(o.rawText))) {
          o.active = false;
          disappeared.push(o);
        }
      }
      const current = offers.filter((o) => o.productId === productId && o.active);
      return { appeared, disappeared, current };
    },
    async getActiveOffers(productId) {
      return offers.filter((o) => o.productId === productId && o.active);
    },

    async getCards() {
      return cards.filter((c) => c.active);
    },
    async insertCard(card) {
      const rec: Card = { ...card, id: randomUUID() };
      cards.push(rec);
      return rec;
    },
    async deleteCard(id) {
      const i = cards.findIndex((c) => c.id === id);
      if (i >= 0) cards.splice(i, 1);
    },

    async getStats(productId): Promise<ProductStats | null> {
      const p = products.find((x) => x.id === productId);
      if (!p) return null;
      const pts = points.filter((x) => x.productId === productId);
      return computeStats(productId, p.platform, pts, now());
    },

    async upsertCompetitorMatches(productId, rows: NewCompetitorMatch[]) {
      const ts = iso();
      for (const r of rows) {
        const existing = competitors.find(
          (c) => c.productId === productId && c.url === r.url,
        );
        if (existing) {
          Object.assign(existing, {
            merchant: r.merchant,
            title: r.title,
            matchedBy: r.matchedBy,
            confidence: r.confidence,
            latestPrice: r.latestPrice,
            latestCheckedAt: r.latestCheckedAt ?? ts,
            active: true,
          });
        } else {
          competitors.push({
            id: randomUUID(),
            productId,
            merchant: r.merchant,
            url: r.url,
            title: r.title,
            matchedBy: r.matchedBy,
            confidence: r.confidence,
            latestPrice: r.latestPrice,
            latestCheckedAt: r.latestCheckedAt ?? ts,
            active: true,
          });
        }
      }
    },
    async getCompetitorMatches(productId) {
      return competitors.filter((c) => c.productId === productId && c.active);
    },
    async getCompetitorMin(productId) {
      const priced = competitors
        .filter(
          (c) =>
            c.productId === productId &&
            c.active &&
            c.confidence >= 0.75 &&
            c.latestPrice != null,
        )
        .map((c) => ({ price: c.latestPrice as Paise, merchant: c.merchant }));
      if (priced.length === 0) return null;
      return priced.reduce((min, x) => (x.price < min.price ? x : min));
    },

    async insertAlert(row: NewAlert): Promise<string> {
      const rec: AlertRow = {
        id: randomUUID(),
        productId: row.productId,
        fingerprint: row.fingerprint,
        routing: row.routing,
        score: row.score,
        scoreBreakdown: row.scoreBreakdown,
        signals: row.signals,
        bestEffective: row.bestEffective,
        context: row.context ?? null,
        blocks: row.blocks ?? null,
        suppressedReason: row.suppressedReason ?? null,
        channel: row.channel ?? "slack",
        createdAt: iso(),
        sentAt: null,
      };
      alerts.push(rec);
      return rec.id;
    },
    async markAlertSent(id) {
      const a = alerts.find((x) => x.id === id);
      if (a) a.sentAt = iso();
    },
    async lastSentForFingerprint(fp): Promise<FingerprintSend | null> {
      const sent = alerts
        .filter((a) => a.fingerprint === fp && a.sentAt)
        .sort((a, b) => Date.parse(b.sentAt!) - Date.parse(a.sentAt!));
      const a = sent[0];
      if (!a) return null;
      return {
        sentAt: a.sentAt!,
        effectiveInstant: a.bestEffective.effectiveInstant,
        routing: a.routing,
      };
    },
    async sentCountToday(productId, istDayStart) {
      const t = Date.parse(istDayStart);
      return alerts.filter(
        (a) =>
          a.sentAt != null &&
          Date.parse(a.sentAt) >= t &&
          (productId == null || a.productId === productId),
      ).length;
    },
    async pendingDigestAlerts(since): Promise<AlertRow[]> {
      const t = Date.parse(since);
      return alerts.filter(
        (a) =>
          a.routing === "digest" &&
          a.sentAt == null &&
          a.suppressedReason == null &&
          Date.parse(a.createdAt) >= t,
      );
    },

    async storeEvidence(productId, ts, markdown): Promise<string> {
      const safeTs = ts.replace(/[:.]/g, "-");
      const path = join(evidenceDir, productId, `${safeTs}.md.gz`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, gzipSync(Buffer.from(markdown, "utf8")));
      return path;
    },
    async getMeta(key) {
      return meta.has(key) ? meta.get(key) : null;
    },
    async setMeta(key, v) {
      meta.set(key, v);
    },
    async ping() {
      /* always healthy */
    },
  };
}
