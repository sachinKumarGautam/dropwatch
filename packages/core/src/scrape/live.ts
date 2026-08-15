/**
 * scrape/live.ts — assembles the production Scraper from the tier implementations.
 * Tier-0 is a plain fetch with a desktop UA; Tier-1 is Firecrawl (if a key is set,
 * else a plain-fetch fallback); Tier-2 is Playwright.
 */
import type { Config } from "../config.js";
import type { ScrapeResult } from "../types.js";
import { createFirecrawl } from "./firecrawl.js";
import { createPlaywrightScraper } from "./playwright.js";
import { platformOf } from "./sites/index.js";
import type { FirecrawlOpts, Scraper } from "./router.js";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function plainFetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": DESKTOP_UA,
      "accept-language": "en-IN,en;q=0.9",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`fetch ${res.status} for ${url}`);
  return res.text();
}

export function createRealScraper(cfg: Config): Scraper {
  const firecrawl = cfg.firecrawlKey ? createFirecrawl(cfg.firecrawlKey) : null;
  const playwright = createPlaywrightScraper();

  const tier1Fallback = async (url: string): Promise<ScrapeResult> => {
    try {
      const html = await plainFetchHtml(url);
      return {
        ok: true,
        tierUsed: 1,
        url,
        platform: platformOf(url),
        fetchedAt: new Date().toISOString(),
        html,
        meta: { attempts: 1, durationMs: 0, proxyUsed: false },
      };
    } catch (e) {
      return {
        ok: false,
        tierUsed: 1,
        url,
        platform: platformOf(url),
        fetchedAt: new Date().toISOString(),
        error: { code: "blocked", message: (e as Error).message },
        meta: { attempts: 1, durationMs: 0, proxyUsed: false },
      };
    }
  };

  return {
    fetchTier0Html: plainFetchHtml,
    async fetchTier1(url: string, opts: FirecrawlOpts): Promise<ScrapeResult> {
      if (firecrawl) return firecrawl.fetchTier1(url, opts);
      return tier1Fallback(url);
    },
    fetchTier2: playwright.fetchTier2,
  };
}
