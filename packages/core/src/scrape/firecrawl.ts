/**
 * scrape/firecrawl.ts — Tier-1 scraper via the Firecrawl /scrape API (fetch-based,
 * no SDK). proxy:"auto" retries with stealth only when a page is blocked. Optional
 * click/wait actions surface bank-offer modals into the returned markdown.
 */
import type { ScrapeResult } from "../types.js";
import { platformOf } from "./sites/index.js";
import type { FirecrawlOpts, Scraper } from "./router.js";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape";

export function createFirecrawl(apiKey: string): Pick<Scraper, "fetchTier1"> {
  return {
    async fetchTier1(url: string, opts: FirecrawlOpts): Promise<ScrapeResult> {
      const start = Date.now();
      const actions = (opts.actions ?? []).map((a) =>
        a.type === "click"
          ? { type: "click", selector: a.selector }
          : a.type === "scroll"
            ? { type: "scroll", direction: "down" }
            : { type: "wait", milliseconds: a.milliseconds ?? 1500 },
      );
      try {
        const res = await fetch(FIRECRAWL_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            url,
            formats: ["markdown", "html"],
            proxy: "auto",
            onlyMainContent: false,
            timeout: opts.timeoutMs ?? 45_000,
            ...(actions.length ? { actions } : {}),
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          return {
            ok: false,
            tierUsed: 1,
            url,
            platform: platformOf(url),
            fetchedAt: new Date().toISOString(),
            error: {
              code: res.status === 403 || res.status === 429 ? "blocked" : "network",
              message: `firecrawl ${res.status}: ${body.slice(0, 200)}`,
            },
            meta: { attempts: 1, durationMs: Date.now() - start, proxyUsed: true },
          };
        }
        const data: any = await res.json();
        const doc = data?.data ?? data;
        return {
          ok: true,
          tierUsed: 1,
          url,
          platform: platformOf(url),
          fetchedAt: new Date().toISOString(),
          markdown: doc?.markdown,
          html: doc?.html ?? doc?.rawHtml,
          meta: { attempts: 1, durationMs: Date.now() - start, proxyUsed: true },
        };
      } catch (e) {
        return {
          ok: false,
          tierUsed: 1,
          url,
          platform: platformOf(url),
          fetchedAt: new Date().toISOString(),
          error: { code: "network", message: (e as Error).message },
          meta: { attempts: 1, durationMs: Date.now() - start, proxyUsed: true },
        };
      }
    },
  };
}
