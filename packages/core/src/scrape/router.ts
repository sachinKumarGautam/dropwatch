/**
 * scrape/router.ts — tier-escalating scrape dispatcher.
 * Obtains HTML/markdown via the cheapest viable tier, always attempts a free
 * Tier-0 deterministic parse on whatever content it gets, and hands the rest
 * (LLM extraction) to the worker.
 */
import type { ExtractedProduct, ScrapeResult, ScrapeTarget, Tier } from "../types.js";
import { parseJsonLd } from "./jsonld.js";
import { adapterFor, platformOf, type FirecrawlAction, type SiteAdapter } from "./sites/index.js";

export interface FirecrawlOpts {
  proxy: "auto";
  formats: ["markdown", "html"];
  actions?: FirecrawlAction[];
  timeoutMs?: number;
}

export interface Scraper {
  fetchTier0Html(url: string): Promise<string>;
  fetchTier1(url: string, opts: FirecrawlOpts): Promise<ScrapeResult>;
  fetchTier2(url: string, adapter: SiteAdapter, pincode?: string): Promise<ScrapeResult>;
}

export interface ScrapeDeps {
  scraper: Scraper;
  now(): Date;
}

function deterministicParse(
  html: string | undefined,
  adapter: SiteAdapter,
): Partial<ExtractedProduct> | null {
  if (!html) return null;
  if (adapter.parseEmbedded) {
    const e = adapter.parseEmbedded(html);
    if (e?.price != null) return e;
  }
  return parseJsonLd(html);
}

export async function scrapeProduct(
  target: ScrapeTarget,
  deps: ScrapeDeps,
): Promise<ScrapeResult> {
  const adapter = adapterFor(target.url);
  const canonical = adapter.canonicalize(target.url);
  const platform = platformOf(target.url);
  const start = deps.now().getTime();

  let html: string | undefined;
  let markdown: string | undefined;
  let structured: Partial<ExtractedProduct> | null = null;
  let tierUsed: Tier = 0;
  let attempts = 0;
  let proxyUsed = false;
  let lastError: ScrapeResult["error"];

  for (const tier of adapter.tierOrder) {
    if (tier === 3) break; // LLM extraction is the worker's job
    attempts++;
    try {
      if (tier === 0) {
        html = await deps.scraper.fetchTier0Html(canonical);
        tierUsed = 0;
      } else if (tier === 1) {
        const r = await deps.scraper.fetchTier1(canonical, {
          proxy: "auto",
          formats: ["markdown", "html"],
          actions: adapter.offerModalActions,
        });
        proxyUsed = proxyUsed || r.meta.proxyUsed;
        if (r.ok) {
          html = r.html ?? html;
          markdown = r.markdown ?? markdown;
          tierUsed = 1;
        } else lastError = r.error;
      } else if (tier === 2) {
        const r = await deps.scraper.fetchTier2(canonical, adapter, target.pincode ?? undefined);
        if (r.ok) {
          html = r.html ?? html;
          markdown = r.markdown ?? markdown;
          tierUsed = 2;
        } else lastError = r.error;
      }
    } catch (e) {
      lastError = { code: "network", message: (e as Error).message };
      continue;
    }

    structured = deterministicParse(html, adapter);
    if (structured?.price != null) {
      return {
        ok: true,
        tierUsed,
        url: canonical,
        platform,
        fetchedAt: deps.now().toISOString(),
        html,
        markdown,
        structured,
        meta: { attempts, durationMs: deps.now().getTime() - start, proxyUsed },
      };
    }
  }

  if (markdown || html) {
    return {
      ok: true,
      tierUsed,
      url: canonical,
      platform,
      fetchedAt: deps.now().toISOString(),
      html,
      markdown,
      structured: structured ?? undefined,
      meta: { attempts, durationMs: deps.now().getTime() - start, proxyUsed },
    };
  }

  return {
    ok: false,
    tierUsed,
    url: canonical,
    platform,
    fetchedAt: deps.now().toISOString(),
    error: lastError ?? { code: "not_found", message: "no content from any tier" },
    meta: { attempts, durationMs: deps.now().getTime() - start, proxyUsed },
  };
}

/** A single confirming re-scrape (used by the >60% jump gate / price-error path). */
export async function confirmRescrape(
  target: ScrapeTarget,
  deps: ScrapeDeps,
): Promise<ScrapeResult> {
  return scrapeProduct(target, deps);
}

// ── Fixture scraper (DRY_RUN + tests) ───────────────────────────────────────

export interface FixtureEntry {
  html?: string;
  markdown?: string;
  error?: { code: "blocked" | "timeout" | "not_found" | "parse" | "network"; message: string };
}

export function createFixtureScraper(
  resolve: (url: string) => FixtureEntry | null,
): Scraper {
  const build = (url: string, tier: Tier): ScrapeResult => {
    const f = resolve(url);
    if (!f || f.error) {
      return {
        ok: false,
        tierUsed: tier,
        url,
        platform: platformOf(url),
        fetchedAt: new Date(0).toISOString(),
        error: f?.error ?? { code: "not_found", message: `no fixture for ${url}` },
        meta: { attempts: 1, durationMs: 0, proxyUsed: false },
      };
    }
    return {
      ok: true,
      tierUsed: tier,
      url,
      platform: platformOf(url),
      fetchedAt: new Date(0).toISOString(),
      html: f.html,
      markdown: f.markdown,
      meta: { attempts: 1, durationMs: 0, proxyUsed: tier === 1 },
    };
  };
  return {
    async fetchTier0Html(url) {
      const f = resolve(url);
      if (!f?.html) throw new Error(`no tier0 fixture for ${url}`);
      return f.html;
    },
    async fetchTier1(url) {
      return build(url, 1);
    },
    async fetchTier2(url) {
      return build(url, 2);
    },
  };
}
