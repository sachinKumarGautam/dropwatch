/**
 * pipeline/competitors.ts — refresh prices for a product's competitor / alternate
 * links (auto-discovered via SerpApi, or manually attached). Scrapes each URL
 * deterministically (no LLM → no AI credits) and returns their current prices.
 */
import type { Deps } from "../deps.js";
import { scrapeProduct } from "../scrape/router.js";
import { platformOf } from "../scrape/sites/index.js";
import type { Paise, TrackedProductRow } from "../types.js";

const STALE_MS = 20 * 3_600_000; // re-scrape a competitor at most ~once/day
const MAX_COMPETITORS = 6;

export interface CompetitorPrice {
  merchant: string;
  url: string;
  price: Paise | null;
  matchedBy: string;
}

export async function refreshCompetitors(
  deps: Deps,
  product: TrackedProductRow,
): Promise<CompetitorPrice[]> {
  const matches = await deps.db.getCompetitorMatches(product.id);
  if (matches.length === 0) return [];
  const now = deps.now();
  const pincode = product.pincode ?? deps.cfg.defaultPincode ?? undefined;

  for (const m of matches.slice(0, MAX_COMPETITORS)) {
    const age = m.latestCheckedAt ? now.getTime() - Date.parse(m.latestCheckedAt) : Infinity;
    if (m.latestPrice != null && age < STALE_MS) continue; // fresh enough
    try {
      const r = await scrapeProduct(
        { productId: product.id, url: m.url, platform: platformOf(m.url), pincode },
        deps,
      );
      const price = r.structured?.price ?? null; // deterministic parse only
      if (price != null) {
        await deps.db.setCompetitorPrice(m.id, price, now.toISOString(), r.structured?.title ?? null);
      }
    } catch {
      /* competitor scrape is best-effort */
    }
  }

  const fresh = await deps.db.getCompetitorMatches(product.id);
  return fresh
    .filter((c) => c.latestPrice != null)
    .map((c) => ({ merchant: c.merchant, url: c.url, price: c.latestPrice, matchedBy: c.matchedBy }))
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}
