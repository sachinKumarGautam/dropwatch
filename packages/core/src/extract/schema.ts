/**
 * extract/schema.ts — zod schemas. The domain schema validates final ExtractedProduct;
 * the LLM schema takes rupee values (what the model sees) and is converted to paise.
 */
import { z } from "zod";
import type { ExtractedProduct, Paise, Platform, RawOffer } from "../types.js";

export const RawOfferSchema = z.object({
  text: z.string(),
  sectionHint: z.string().optional(),
});

export const ExtractedProductSchema = z.object({
  title: z.string(),
  price: z.number().int(),
  mrp: z.number().int().nullable(),
  currency: z.literal("INR"),
  inStock: z.boolean(),
  isLightningDeal: z.boolean(),
  dealEndsAt: z.string().nullable(),
  deliveryFee: z.number().int().nullable(),
  deliveryEtaDays: z.number().nullable(),
  unitCount: z.number().nullable(),
  unitLabel: z.string().nullable(),
  seller: z.string().nullable(),
  modelNumber: z.string().nullable(),
  ean: z.string().nullable(),
  offers: z.array(RawOfferSchema),
  evidence: z.object({
    priceRaw: z.string(),
    source: z.enum(["jsonld", "embedded_state", "dom", "llm"]),
  }),
  confidence: z.number(),
});

/** What the LLM returns — rupees, not paise. */
// No zod .default() here: it makes input/output types diverge, which breaks the
// generic inference in LlmClient.jsonCall. All fields are required-nullable instead.
export const LlmExtractSchema = z.object({
  title: z.string(),
  priceRupees: z.number(),
  mrpRupees: z.number().nullable(),
  inStock: z.boolean(),
  isLightningDeal: z.boolean(),
  dealEndsAt: z.string().nullable(),
  deliveryFeeRupees: z.number().nullable(),
  deliveryEtaDays: z.number().nullable(),
  unitCount: z.number().nullable(),
  unitLabel: z.string().nullable(),
  seller: z.string().nullable(),
  modelNumber: z.string().nullable(),
  ean: z.string().nullable(),
  priceRaw: z.string(),
});
export type LlmExtract = z.infer<typeof LlmExtractSchema>;

const toPaise = (r: number | null): Paise | null =>
  r == null ? null : Math.round(r * 100);

export function llmToExtracted(
  d: LlmExtract,
  offers: RawOffer[],
  platform: Platform,
): ExtractedProduct {
  void platform;
  return {
    title: d.title,
    price: Math.round(d.priceRupees * 100),
    mrp: toPaise(d.mrpRupees),
    currency: "INR",
    inStock: d.inStock,
    isLightningDeal: d.isLightningDeal,
    dealEndsAt: d.dealEndsAt,
    deliveryFee: toPaise(d.deliveryFeeRupees),
    deliveryEtaDays: d.deliveryEtaDays,
    unitCount: d.unitCount,
    unitLabel: d.unitLabel,
    seller: d.seller,
    modelNumber: d.modelNumber,
    ean: d.ean,
    offers,
    evidence: { priceRaw: d.priceRaw, source: "llm" },
    confidence: 0.85,
  };
}

/** Merge a deterministic (Tier-0) partial into a full ExtractedProduct. */
export function structuredToExtracted(
  s: Partial<ExtractedProduct>,
  offers: RawOffer[],
): ExtractedProduct | null {
  if (s.price == null || s.title == null) return null;
  return {
    title: s.title,
    price: s.price,
    mrp: s.mrp ?? null,
    currency: "INR",
    inStock: s.inStock ?? true,
    isLightningDeal: s.isLightningDeal ?? false,
    dealEndsAt: s.dealEndsAt ?? null,
    deliveryFee: s.deliveryFee ?? null,
    deliveryEtaDays: s.deliveryEtaDays ?? null,
    unitCount: s.unitCount ?? null,
    unitLabel: s.unitLabel ?? null,
    seller: s.seller ?? null,
    modelNumber: s.modelNumber ?? null,
    ean: s.ean ?? null,
    offers,
    evidence: s.evidence ?? { priceRaw: String(s.price / 100), source: "jsonld" },
    confidence: s.confidence ?? 1,
  };
}
