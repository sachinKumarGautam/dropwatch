/**
 * match/serpapi.ts — cross-platform candidate discovery via SerpApi Google Shopping,
 * with a monthly budget guard (persisted in the meta table). Plus a fixture client.
 */
import type { Db } from "../db/interface.js";
import type { Paise, SerpCandidate } from "../types.js";

export interface SerpClient {
  shoppingSearch(q: string): Promise<SerpCandidate[]>;
}

export class BudgetExceeded extends Error {
  override name = "BudgetExceeded";
}

const MONTHLY_CAP = 90;

function monthKey(now: Date): string {
  return `serpapi_${now.getUTCFullYear()}_${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const toPaise = (n: unknown): Paise | null => {
  const v = typeof n === "number" ? n : Number(String(n ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
};

export function createSerp(apiKey: string, db: Db, now: () => Date = () => new Date()): SerpClient {
  return {
    async shoppingSearch(q: string): Promise<SerpCandidate[]> {
      const key = monthKey(now());
      const used = Number((await db.getMeta(key)) ?? 0);
      if (used >= MONTHLY_CAP)
        throw new BudgetExceeded(`SerpApi monthly cap ${MONTHLY_CAP} reached`);
      await db.setMeta(key, used + 1);

      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_shopping");
      url.searchParams.set("q", q);
      url.searchParams.set("gl", "in");
      url.searchParams.set("hl", "en");
      url.searchParams.set("google_domain", "google.co.in");
      url.searchParams.set("api_key", apiKey);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`serpapi ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data: any = await res.json();
      return parseSerp(data);
    },
  };
}

export function parseSerp(data: any): SerpCandidate[] {
  const rows: any[] = data?.shopping_results ?? [];
  return rows.map((r) => ({
    title: r.title ?? "",
    merchant: r.source ?? r.merchant ?? "",
    url: r.link ?? r.product_link ?? "",
    price: toPaise(r.extracted_price ?? r.price),
    thumbnail: r.thumbnail,
  }));
}

/** Fixture / DRY_RUN client. Ignores query, returns the provided candidates. */
export function createFixtureSerp(candidates: SerpCandidate[]): SerpClient {
  return { async shoppingSearch() { return candidates; } };
}
