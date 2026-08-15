/**
 * extract/llm.ts — LLM extraction of price/availability/offers from trimmed markdown.
 * Only used when Tier-0 deterministic parsing missed the price.
 */
import type { LlmClient } from "../llm/client.js";
import { trimMarkdown } from "../scrape/trim.js";
import type { ExtractedProduct, Platform, RawOffer } from "../types.js";
import { LlmExtractSchema, llmToExtracted } from "./schema.js";

export async function llmExtract(
  markdown: string,
  hints: { platform: Platform; knownTitle?: string; offers?: RawOffer[] },
  llm: LlmClient,
): Promise<ExtractedProduct> {
  const md = trimMarkdown(markdown, 12_000);
  const system =
    "You extract structured product data from an Indian e-commerce product page (markdown). " +
    "Return prices in RUPEES as numbers (no ₹, no commas). priceRaw MUST be the exact price " +
    "string as it appears on the page (e.g. '₹1,29,900'). If the item is out of stock set inStock=false. " +
    "unitCount/unitLabel only for consumables sold by volume/weight/count (e.g. 30 / 'ml').";
  const user =
    (hints.knownTitle ? `Known title: ${hints.knownTitle}\n\n` : "") +
    "Page markdown:\n" +
    md +
    "\n\nReturn a JSON object with keys: title, priceRupees, mrpRupees, inStock, isLightningDeal, " +
    "dealEndsAt, deliveryFeeRupees, deliveryEtaDays, unitCount, unitLabel, seller, modelNumber, ean, priceRaw.";

  const { data } = await llm.jsonCall({
    model: "extract",
    task: "extract",
    system,
    user,
    schema: LlmExtractSchema,
    maxTokens: 700,
  });
  return llmToExtracted(data, hints.offers ?? [], hints.platform);
}
