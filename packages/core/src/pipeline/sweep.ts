/**
 * pipeline/sweep.ts — cross-platform competitor discovery (blueprint §3.3).
 * SerpApi Google Shopping → LLM/EAN/model adjudication → competitor_matches.
 */
import type { Deps } from "../deps.js";
import { adjudicateMatches } from "../match/llm-match.js";
import { BudgetExceeded } from "../match/serpapi.js";
import type { NewCompetitorMatch, TrackedProductRow } from "../types.js";

const STALE_MS = 7 * 86_400_000;

function query(p: TrackedProductRow): string {
  return [p.brand, p.title, p.modelNumber].filter(Boolean).join(" ").slice(0, 120).trim();
}

export interface SweepSummary {
  swept: number;
  matched: number;
  budgetExhausted: boolean;
  undercuts: Array<{ productId: string; merchant: string; price: number }>;
}

export async function sweep(deps: Deps, onlyProductId?: string): Promise<SweepSummary> {
  const { db, now } = deps;
  const all = await db.getTrackedProducts({ activeOnly: true });
  let targets = onlyProductId ? all.filter((p) => p.id === onlyProductId) : all;

  // stalest-first: products whose newest match is older than 7d (or none)
  const staleness = new Map<string, number>();
  for (const p of targets) {
    const matches = await db.getCompetitorMatches(p.id);
    const newest = matches.reduce(
      (mx, m) => (m.latestCheckedAt ? Math.max(mx, Date.parse(m.latestCheckedAt)) : mx),
      0,
    );
    staleness.set(p.id, newest);
  }
  targets = targets
    .filter((p) => now().getTime() - (staleness.get(p.id) ?? 0) >= STALE_MS)
    // Without LLM adjudication, auto-matching needs an EAN or model number to match on.
    // Skip the rest so we don't waste SerpApi quota on products we can't confirm.
    .filter((p) => !deps.cfg.minimalLlm || !!p.ean || !!p.modelNumber)
    .sort((a, b) => (staleness.get(a.id) ?? 0) - (staleness.get(b.id) ?? 0));

  let matched = 0;
  let budgetExhausted = false;
  const undercuts: SweepSummary["undercuts"] = [];

  for (const p of targets) {
    let candidates;
    try {
      candidates = await deps.serpapi.shoppingSearch(query(p));
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        budgetExhausted = true;
        break;
      }
      continue;
    }
    const matches = await adjudicateMatches(
      { title: p.title ?? "", brand: p.brand, modelNumber: p.modelNumber, ean: p.ean },
      candidates,
      deps.llm,
      { useLlm: !deps.cfg.minimalLlm },
    );
    const rows: NewCompetitorMatch[] = matches.map((m) => ({
      merchant: m.candidate.merchant,
      url: m.candidate.url,
      title: m.candidate.title,
      matchedBy: m.matchedBy,
      confidence: m.confidence,
      latestPrice: m.candidate.price,
      latestCheckedAt: now().toISOString(),
    }));
    await db.upsertCompetitorMatches(p.id, rows);
    matched += rows.length;

    const min = await db.getCompetitorMin(p.id);
    const latest = (await db.latestPricePoints(p.id, 1))[0];
    if (min && latest && min.price < latest.price * 0.95) {
      undercuts.push({ productId: p.id, merchant: min.merchant, price: min.price });
    }
  }

  return { swept: targets.length, matched, budgetExhausted, undercuts };
}
