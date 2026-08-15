/**
 * scrape/playwright.ts — Tier-2 scraper via headless Chromium. Primary for
 * friendly sites (Croma/Nykaa/Samsung) and a fallback for Amazon/Flipkart.
 * Playwright is imported lazily so DRY_RUN and unit tests never load it.
 *
 * Requires browsers: `npx playwright install chromium` (see README).
 */
import type { ScrapeResult } from "../types.js";
import { platformOf, type PageLike, type SiteAdapter } from "./sites/index.js";
import type { Scraper } from "./router.js";

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

export function createPlaywrightScraper(): Pick<Scraper, "fetchTier2"> {
  return {
    async fetchTier2(
      url: string,
      adapter: SiteAdapter,
      pincode?: string,
    ): Promise<ScrapeResult> {
      const start = Date.now();
      let browser: any = null;
      try {
        const { chromium } = (await import("playwright")) as any;
        browser = await chromium.launch({ headless: true });
        const context = await (browser as any).newContext({
          userAgent: MOBILE_UA,
          locale: "en-IN",
          viewport: { width: 412, height: 915 },
        });
        await context.route("**/*", (route: any) => {
          const t = route.request().resourceType();
          if (t === "image" || t === "font" || t === "media") return route.abort();
          return route.continue();
        });
        const page: PageLike = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        if (adapter.prepare) await adapter.prepare(page, pincode);
        await page.waitForTimeout(1000);
        const html = await page.content();
        await browser.close();
        browser = null;
        return {
          ok: true,
          tierUsed: 2,
          url,
          platform: platformOf(url),
          fetchedAt: new Date().toISOString(),
          html,
          meta: { attempts: 1, durationMs: Date.now() - start, proxyUsed: false },
        };
      } catch (e) {
        if (browser) await browser.close().catch(() => {});
        return {
          ok: false,
          tierUsed: 2,
          url,
          platform: platformOf(url),
          fetchedAt: new Date().toISOString(),
          error: { code: "network", message: (e as Error).message },
          meta: { attempts: 1, durationMs: Date.now() - start, proxyUsed: false },
        };
      }
    },
  };
}
