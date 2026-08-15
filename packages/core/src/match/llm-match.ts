/**
 * match/llm-match.ts — resolve "is this the same product?".
 * Pass 1: exact EAN / model-number token match (confidence 0.98, no LLM).
 * Pass 2: remaining candidates adjudicated by one batched reasoning LLM call.
 */
import { z } from "zod";
import type { LlmClient } from "../llm/client.js";
import type { CompetitorMatch, SerpCandidate } from "../types.js";

export interface MatchProduct {
  title: string;
  brand?: string | null;
  modelNumber?: string | null;
  ean?: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_/]/g, "");

const LlmMatchSchema = z.array(
  z.object({
    index: z.number().int(),
    isSame: z.boolean(),
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  }),
);

export async function adjudicateMatches(
  product: MatchProduct,
  candidates: SerpCandidate[],
  llm: LlmClient,
  opts: { minConfidence?: number; useLlm?: boolean } = {},
): Promise<CompetitorMatch[]> {
  const minConfidence = opts.minConfidence ?? 0.75;
  const useLlm = opts.useLlm ?? true;
  const results: CompetitorMatch[] = [];
  const deferred: Array<{ i: number; c: SerpCandidate }> = [];

  candidates.forEach((c, i) => {
    const hay = norm(c.title + " " + c.url);
    if (product.ean && hay.includes(norm(product.ean))) {
      results.push({ candidate: c, matchedBy: "ean", confidence: 0.98 });
    } else if (product.modelNumber && norm(product.modelNumber).length >= 4 && hay.includes(norm(product.modelNumber))) {
      results.push({ candidate: c, matchedBy: "model", confidence: 0.98 });
    } else {
      deferred.push({ i, c });
    }
  });

  if (deferred.length > 0 && useLlm) {
    const system =
      "You decide whether shopping-search results are the SAME product (same model, storage, " +
      "colour where it matters) as a reference product. Return ONLY a JSON array with one object " +
      "per candidate: {index, isSame, confidence (0-1), reason}. Different storage/variant/refurbished = not same.";
    const user =
      `Reference: ${product.title}` +
      (product.brand ? ` | brand ${product.brand}` : "") +
      (product.modelNumber ? ` | model ${product.modelNumber}` : "") +
      "\n\nCandidates:\n" +
      deferred.map((d) => `${d.i}. ${d.c.title} (${d.c.merchant})`).join("\n");
    try {
      const { data } = await llm.jsonCall({
        model: "reasoning",
        task: "match",
        system,
        user,
        schema: LlmMatchSchema,
        maxTokens: 500,
      });
      for (const d of data) {
        if (d.isSame && d.confidence >= minConfidence) {
          const cand = candidates[d.index];
          if (cand) results.push({ candidate: cand, matchedBy: "llm", confidence: d.confidence });
        }
      }
    } catch {
      /* LLM match is best-effort; deterministic matches still stand */
    }
  }

  return results;
}
