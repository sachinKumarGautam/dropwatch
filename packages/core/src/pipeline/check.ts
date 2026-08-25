/**
 * pipeline/check.ts — the per-product check pipeline (blueprint §3.1).
 * scrape → extract → validate → offers → effective price → stats → score → alert.
 * Lives in core so it is fully testable under DRY_RUN with mocks.
 */
import type { Deps } from "../deps.js";
import { buildDealBlocks, buildHealthBlocks } from "../alerts/blocks.js";
import { sendHealthOnce, sendOps } from "../alerts/ops.js";
import { fingerprint, shouldSend } from "../alerts/dedup.js";
import { harvestRawOffers } from "../scrape/jsonld.js";
import { scrapeProduct, confirmRescrape } from "../scrape/router.js";
import { adapterFor } from "../scrape/sites/index.js";
import { llmExtract } from "../extract/llm.js";
import { structuredToExtracted } from "../extract/schema.js";
import { validateExtraction } from "../extract/validate.js";
import { parseOfferStrings, llmParseOffers } from "../offers/parse.js";
import {
  bestCardNotHeld,
  computeEffectivePrices,
  rankEffective,
} from "../offers/effective-price.js";
import { deriveSignals } from "../stats.js";
import { refreshCompetitors } from "./competitors.js";
import { scoreDeal } from "../score.js";
import { activeOrUpcomingWindow, buyWaitAdvice } from "../festival.js";
import type {
  AlertEvent,
  EffectivePrice,
  ExtractedProduct,
  ScrapeResult,
  TrackedProductRow,
} from "../types.js";

export interface CheckSummary {
  productId: string;
  ok: boolean;
  skipped?: string;
  failed?: boolean;
  error?: string;
  price?: number;
  effInstant?: number;
  score?: number;
  routing?: string;
  sent?: boolean;
  suppressedReason?: string | null;
}

function sourceText(s: ScrapeResult): string {
  return s.markdown ?? s.html ?? "";
}

async function extractFrom(
  scrape: ScrapeResult,
  product: TrackedProductRow,
  deps: Deps,
  offers: ExtractedProduct["offers"],
): Promise<ExtractedProduct> {
  if (scrape.structured?.price != null) {
    const merged = {
      ...scrape.structured,
      title: scrape.structured.title ?? product.title ?? "Product",
    };
    const e = structuredToExtracted(merged, offers);
    if (e) return e;
  }
  if (deps.cfg.disableLlmExtract) {
    throw new Error("no deterministic price found (LLM extraction disabled)");
  }
  const md = sourceText(scrape);
  return llmExtract(md, { platform: scrape.platform, knownTitle: product.title ?? undefined, offers }, deps.llm);
}

function harvestOffers(scrape: ScrapeResult, product: TrackedProductRow) {
  const adapter = adapterFor(product.url);
  const text = `${scrape.html ?? ""}\n${scrape.markdown ?? ""}`;
  return harvestRawOffers(text, adapter.offerSectionHints);
}

async function handleFailure(
  deps: Deps,
  product: TrackedProductRow,
  message: string,
): Promise<CheckSummary> {
  const failures = product.consecutiveFailures + 1;
  await deps.db.updateTrackedProduct(product.id, {
    consecutiveFailures: failures,
    lastError: message.slice(0, 500),
    lastCheckedAt: deps.now().toISOString(),
  });
  if (failures >= 2) {
    await sendHealthOnce(
      deps,
      product.id,
      buildHealthBlocks({ productId: product.id, title: product.title ?? "", failures, lastError: message }),
    );
  }
  return { productId: product.id, ok: false, failed: true, error: message };
}

export async function checkProduct(deps: Deps, productId: string): Promise<CheckSummary> {
  const { db, cfg } = deps;
  const t = deps.now();
  const nowIso = t.toISOString();

  const product = await db.getTrackedProduct(productId);
  if (!product) throw new Error(`product not found: ${productId}`);
  if (product.paused) return { productId, ok: true, skipped: "paused" };

  const pincode = product.pincode ?? cfg.defaultPincode;
  const target = { productId, url: product.url, platform: product.platform, pincode };

  const recent = await db.latestPricePoints(productId, 5);
  const lastAccepted = recent[0]?.price ?? null;
  const prevLatest = recent[0]
    ? { price: recent[0].price, inStock: recent[0].inStock, checkedAt: recent[0].checkedAt }
    : null;
  const prevEffective = recent[0]?.effectiveInstant ?? null;
  const history72 = await db.pointsSince(
    productId,
    new Date(t.getTime() - 72 * 3_600_000).toISOString(),
  );

  // ── scrape ──
  let scrape = await scrapeProduct(target, deps);
  if (!scrape.ok) return handleFailure(deps, product, `scrape failed: ${scrape.error?.message ?? "unknown"}`);

  // ── extract (+ offers harvest) ── extraction errors (e.g. LLM quota) are non-fatal
  let rawOffers = harvestOffers(scrape, product);
  let extracted: ExtractedProduct;
  let validation: ReturnType<typeof validateExtraction>;
  try {
    extracted = await extractFrom(scrape, product, deps, []);
    validation = validateExtraction(extracted, sourceText(scrape), lastAccepted);
    if (validation.verdict === "needs_rescrape") {
      const re = await confirmRescrape(target, deps);
      if (re.ok) {
        scrape = re;
        rawOffers = harvestOffers(scrape, product);
        extracted = await extractFrom(scrape, product, deps, []);
        validation = validateExtraction(extracted, sourceText(scrape), lastAccepted);
      }
    }
  } catch (e) {
    return handleFailure(deps, product, `extract failed: ${(e as Error).message}`);
  }
  if (validation.verdict !== "ok") {
    return handleFailure(deps, product, `validation ${validation.verdict}: ${(validation as any).reason ?? ""}`);
  }

  // ── offers ──
  const { parsed, unparsed } = parseOfferStrings(rawOffers, { productId, platform: product.platform });
  let llmParsed: typeof parsed = [];
  if (unparsed.length > 0) {
    llmParsed = await llmParseOffers(unparsed, { productId, platform: product.platform }, deps.llm).catch(() => []);
  }
  const allParsed = [...parsed, ...llmParsed];

  // ── DB writes ──
  const evidencePath = await db.storeEvidence(productId, nowIso, sourceText(scrape)).catch(() => "");
  const offerDiff = await db.upsertOffers(productId, allParsed);
  const cards = await db.getCards();
  const effRows = computeEffectivePrices({
    productId,
    platform: product.platform,
    sticker: extracted.price,
    offers: offerDiff.current,
    cards,
  });
  // Alerts use the full upfront price — exclude the no-cost-EMI path (EMI is not a discount).
  const upfrontRows = effRows.filter((r) => r.paymentPath !== "no_cost_emi");
  const ranked = rankEffective(upfrontRows.length ? upfrontRows : effRows);
  const best: EffectivePrice = ranked[0] ?? {
    productId,
    platform: product.platform,
    cardId: null,
    cardLabel: "No card offer",
    paymentPath: "plain",
    sticker: extracted.price,
    couponDiscount: 0,
    bankInstantDiscount: 0,
    emiGstCost: 0,
    effectiveInstant: extracted.price,
    walletCashbackValue: 0,
    statementCashbackValue: 0,
    cobrandRewardValue: 0,
    effectiveNet: extracted.price,
    appliedOfferIds: [],
    explain: [],
  };

  await db.insertPricePoint({
    productId,
    checkedAt: nowIso,
    price: extracted.price,
    mrp: extracted.mrp,
    inStock: extracted.inStock,
    isLightning: extracted.isLightningDeal,
    dealEndsAt: extracted.dealEndsAt,
    deliveryFee: extracted.deliveryFee,
    deliveryEtaDays: extracted.deliveryEtaDays,
    effectiveInstant: best.effectiveInstant,
    effectiveNet: best.effectiveNet,
    bestCardId: best.cardId,
    bestOfferIds: best.appliedOfferIds,
    sourceTier: scrape.tierUsed,
    extractSource: extracted.evidence.source,
    confidence: extracted.confidence,
    evidencePath: evidencePath || null,
  });
  // Baseline = the effective price when the product was first added (set once).
  const baselinePrice = product.baselinePrice ?? best.effectiveInstant;

  await db.updateTrackedProduct(productId, {
    consecutiveFailures: 0,
    lastError: null,
    lastCheckedAt: nowIso,
    baselinePrice,
    title: product.title ?? extracted.title,
    ean: product.ean ?? extracted.ean,
    modelNumber: product.modelNumber ?? extracted.modelNumber,
    unitCount: product.unitCount ?? extracted.unitCount,
    unitLabel: product.unitLabel ?? extracted.unitLabel,
  });

  // ── stats + signals + score ──
  const stats = await db.getStats(productId);
  if (!stats) return { productId, ok: true, price: extracted.price, effInstant: best.effectiveInstant };
  // Refresh linked / cross-platform prices (deterministic scrape, no AI credits).
  const competitors = await refreshCompetitors(deps, product);
  const competitorMin = await db.getCompetitorMin(productId);
  const signals = deriveSignals({
    stats,
    latest: extracted,
    prevLatest,
    prevEffective,
    history72h: history72.map((p) => ({ price: p.price, checkedAt: p.checkedAt })),
    offerDiff,
    best,
    targetPrice: product.targetPrice,
    baselinePrice,
    competitorMin,
    unit: { count: extracted.unitCount, label: extracted.unitLabel },
    now: t,
  });
  const score = scoreDeal({
    signals,
    stats,
    best,
    offers: offerDiff.current,
    cards,
    latest: extracted,
    competitorMin,
    thresholds: cfg.thresholds,
    now: t,
  });
  const win = activeOrUpcomingWindow(t);
  const festivalNote = buyWaitAdvice(score, win);
  const notHeld = bestCardNotHeld(offerDiff.current, cards, extracted.price);

  const ev: AlertEvent = {
    productId,
    platform: product.platform,
    fingerprint: fingerprint({
      productId,
      platform: product.platform,
      effectiveInstant: best.effectiveInstant,
      bestOfferId: best.appliedOfferIds[0] ?? null,
    }),
    score,
    signals,
    best,
    ranking: ranked.slice(0, 3),
    bestCardNotHeld: notHeld,
    festivalNote,
    baseline: baselinePrice,
    competitors: competitors.slice(0, 5).map((c) => ({ merchant: c.merchant, url: c.url, price: c.price })),
    productTitle: extracted.title || product.title || "Product",
    url: product.url,
    dropwatchUrl: cfg.appUrl ? `${cfg.appUrl}/product/?id=${productId}` : null,
    createdAt: nowIso,
  };

  // ── alert routing ──
  const alertContext = {
    price: extracted.price,
    mrp: extracted.mrp,
    median90d: stats.median90d,
    samples90d: stats.samples90d,
    baseline: baselinePrice,
    effective: best.effectiveInstant,
    competitors: competitors.slice(0, 5).map((c) => ({ merchant: c.merchant, price: c.price })),
  };
  let sent = false;
  let suppressedReason: string | null = null;
  if (score.routing === "immediate") {
    const decision = await shouldSend(db, ev, t, cfg.caps);
    if (decision.send) {
      const payload = buildDealBlocks(ev);
      const id = await db.insertAlert({
        productId,
        fingerprint: ev.fingerprint,
        routing: "immediate",
        score: score.total,
        scoreBreakdown: score,
        signals,
        bestEffective: best,
        context: alertContext,
        blocks: payload.blocks,
      });
      try {
        await deps.slack.send(payload);
        await db.markAlertSent(id);
        sent = true;
      } catch (e) {
        // Hook 4: a Slack outage must not fail the check. Alert stays unsent
        // (visible in /alerts) and we best-effort ping the ops channel.
        // eslint-disable-next-line no-console
        console.error(JSON.stringify({ event: "slack_send_failed", productId, error: (e as Error).message }));
        await sendOps(cfg, `DropWatch: Slack send failed for ${ev.productTitle} — ${(e as Error).message}`);
        suppressedReason = "slack_send_failed";
      }
    } else {
      suppressedReason = decision.reason;
      await db.insertAlert({
        productId,
        fingerprint: ev.fingerprint,
        routing: "immediate",
        score: score.total,
        scoreBreakdown: score,
        signals,
        bestEffective: best,
        context: alertContext,
        blocks: buildDealBlocks(ev).blocks,
        suppressedReason,
      });
    }
  } else {
    await db.insertAlert({
      productId,
      fingerprint: ev.fingerprint,
      routing: score.routing,
      score: score.total,
      scoreBreakdown: score,
      signals,
      bestEffective: best,
      context: alertContext,
      blocks: score.routing === "digest" ? buildDealBlocks(ev).blocks : null,
    });
  }

  return {
    productId,
    ok: true,
    price: extracted.price,
    effInstant: best.effectiveInstant,
    score: score.total,
    routing: score.routing,
    sent,
    suppressedReason,
  };
}
