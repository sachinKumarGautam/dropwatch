/**
 * scrape/firecrawl.ts — Tier-1 scraper via the Firecrawl /scrape API (fetch-based).
 * Free tier is ~10 requests/minute, so requests are throttled and 429s are retried
 * with the server-suggested backoff.
 */
import type { ScrapeResult } from "../types.js";
import { platformOf } from "./sites/index.js";
import type { FirecrawlOpts, Scraper } from "./router.js";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape";
const MIN_GAP_MS = 7000; // ~8.5 req/min, safely under the 10/min free-tier limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared throttle across concurrent workers.
let nextAllowedAt = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = nextAllowedAt - now;
  nextAllowedAt = Math.max(now, nextAllowedAt) + MIN_GAP_MS;
  if (wait > 0) await sleep(wait);
}

// A real product page is large; a few KB means we got a bot-block/interstitial.
const THIN_HTML = 20_000;

export function createFirecrawl(apiKey: string): Pick<Scraper, "fetchTier1"> {
  async function call(url: string, opts: FirecrawlOpts, proxy: "auto" | "stealth"): Promise<Response> {
    const actions = (opts.actions ?? []).map((a) =>
      a.type === "click"
        ? { type: "click", selector: a.selector }
        : a.type === "scroll"
          ? { type: "scroll", direction: "down" }
          : { type: "wait", milliseconds: a.milliseconds ?? 1500 },
    );
    return fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        proxy,
        onlyMainContent: false,
        timeout: opts.timeoutMs ?? 45_000,
        ...(actions.length ? { actions } : {}),
      }),
    });
  }

  return {
    async fetchTier1(url: string, opts: FirecrawlOpts): Promise<ScrapeResult> {
      const start = Date.now();
      let attempts = 0;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          await throttle();
          attempts++;
          const res = await call(url, opts, "auto");
          if (res.status === 429) {
            const body = await res.text();
            const m = body.match(/retry after (\d+)s/i);
            const waitS = m ? Math.min(Number(m[1]) + 2, 60) : 30;
            if (attempt === 0) {
              await sleep(waitS * 1000);
              continue; // retry once
            }
            return fail(url, "blocked", `firecrawl 429 (rate limit): ${body.slice(0, 120)}`, start, attempts);
          }
          if (!res.ok) {
            const body = await res.text();
            return fail(
              url,
              res.status === 403 ? "blocked" : "network",
              `firecrawl ${res.status}: ${body.slice(0, 200)}`,
              start,
              attempts,
            );
          }
          const j1: any = await res.json();
          let doc: any = j1?.data ?? j1 ?? {};
          let html: string = doc?.html ?? doc?.rawHtml ?? "";
          // Thin content = anti-bot interstitial. Escalate to the stealth proxy once.
          if (html.length < THIN_HTML) {
            await throttle();
            attempts++;
            const sres = await call(url, opts, "stealth");
            if (sres.ok) {
              const j2: any = await sres.json();
              const sdoc: any = j2?.data ?? j2 ?? {};
              const shtml: string = sdoc?.html ?? sdoc?.rawHtml ?? "";
              if (shtml.length > html.length) {
                doc = sdoc;
                html = shtml;
              }
            }
          }
          if (html.length < THIN_HTML || /Continue shopping|Robot Check|Enter the characters you see below/i.test(html)) {
            return fail(url, "blocked", "anti-bot wall (interstitial) — will retry next run", start, attempts);
          }
          return {
            ok: true,
            tierUsed: 1,
            url,
            platform: platformOf(url),
            fetchedAt: new Date().toISOString(),
            markdown: doc?.markdown,
            html,
            meta: { attempts, durationMs: Date.now() - start, proxyUsed: true },
          };
        }
        return fail(url, "network", "firecrawl: exhausted retries", start, attempts);
      } catch (e) {
        return fail(url, "network", (e as Error).message, start, attempts);
      }
    },
  };
}

function fail(
  url: string,
  code: "blocked" | "network",
  message: string,
  start: number,
  attempts: number,
): ScrapeResult {
  return {
    ok: false,
    tierUsed: 1,
    url,
    platform: platformOf(url),
    fetchedAt: new Date().toISOString(),
    error: { code, message },
    meta: { attempts, durationMs: Date.now() - start, proxyUsed: true },
  };
}
