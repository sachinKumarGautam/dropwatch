/**
 * scrape/sites/index.ts — per-platform adapters + registry.
 * Consolidated here (small adapters) rather than one file per site.
 * Each adapter declares its tier order, URL canonicalization, offer-modal
 * actions (Firecrawl), Playwright prep, and offer-section hints.
 */
import type { ExtractedProduct, Platform, Tier } from "../../types.js";
import { parseEmbeddedState } from "../jsonld.js";

export interface FirecrawlAction {
  type: "click" | "wait" | "scroll";
  selector?: string;
  milliseconds?: number;
}

/** Playwright Page is typed loosely to avoid a hard dependency at type-check time. */
export type PageLike = {
  goto: (url: string, opts?: unknown) => Promise<unknown>;
  content: () => Promise<string>;
  click: (selector: string, opts?: unknown) => Promise<unknown>;
  fill: (selector: string, value: string, opts?: unknown) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
  [k: string]: unknown;
};

export interface SiteAdapter {
  platform: Platform;
  urlPattern: RegExp;
  tierOrder: Tier[];
  canonicalize(url: string): string;
  offerModalActions?: FirecrawlAction[];
  prepare?(page: PageLike, pincode?: string): Promise<void>;
  parseEmbedded?(html: string): Partial<ExtractedProduct> | null;
  offerSectionHints: string[];
}

const stripQuery = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
};

const amazon: SiteAdapter = {
  platform: "amazon_in",
  urlPattern: /amazon\.in/i,
  tierOrder: [1, 3],
  canonicalize(url) {
    const m = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? `https://www.amazon.in/dp/${m[1]!.toUpperCase()}` : stripQuery(url);
  },
  offerModalActions: [
    { type: "click", selector: "#itembox-InstantBankDiscount a, a[id*='offer']" },
    { type: "wait", milliseconds: 1500 },
  ],
  parseEmbedded: (html) => parseEmbeddedState(html, "amazon_in"),
  offerSectionHints: ["Bank Offer", "No Cost EMI", "Cashback", "Partner Offers", "Coupon"],
};

const flipkart: SiteAdapter = {
  platform: "flipkart",
  urlPattern: /flipkart\.com/i,
  tierOrder: [1, 0, 3],
  canonicalize(url) {
    try {
      const u = new URL(url);
      const pid = u.searchParams.get("pid");
      return pid ? `${u.origin}${u.pathname}?pid=${pid}` : `${u.origin}${u.pathname}`;
    } catch {
      return url;
    }
  },
  parseEmbedded: (html) => parseEmbeddedState(html, "flipkart"),
  offerSectionHints: ["Bank Offer", "No cost EMI", "Special Price", "Partner Offers"],
};

const croma: SiteAdapter = {
  platform: "croma",
  urlPattern: /croma\.com/i,
  tierOrder: [2, 0, 3],
  canonicalize: stripQuery,
  async prepare(page, pincode) {
    if (!pincode) return;
    try {
      await page.click("[data-testid='pincode-input'], #pincodeInput", { timeout: 3000 });
      await page.fill("[data-testid='pincode-input'], #pincodeInput", pincode);
      await page.waitForTimeout(1200);
    } catch {
      /* pincode widget optional */
    }
  },
  parseEmbedded: (html) => parseEmbeddedState(html, "croma"),
  offerSectionHints: ["Bank Offer", "No Cost EMI", "Cashback", "Exchange"],
};

const nykaa: SiteAdapter = {
  platform: "nykaa",
  urlPattern: /nykaa\.com/i,
  tierOrder: [2, 0, 3],
  canonicalize: stripQuery,
  parseEmbedded: (html) => parseEmbeddedState(html, "nykaa"),
  offerSectionHints: ["Offer", "Coupon", "Bank"],
};

const samsung: SiteAdapter = {
  platform: "samsung_in",
  urlPattern: /samsung\.com\/in/i,
  tierOrder: [2, 0, 3],
  canonicalize: stripQuery,
  parseEmbedded: (html) => parseEmbeddedState(html, "samsung_in"),
  offerSectionHints: ["Bank Offer", "Upgrade", "No Cost EMI", "Cashback"],
};

const generic: SiteAdapter = {
  platform: "other",
  urlPattern: /.*/,
  tierOrder: [0, 1, 3],
  canonicalize: stripQuery,
  offerSectionHints: ["Offer", "Bank", "Coupon", "EMI"],
};

const ADAPTERS: SiteAdapter[] = [amazon, flipkart, croma, nykaa, samsung];

export function adapterFor(url: string): SiteAdapter {
  return ADAPTERS.find((a) => a.urlPattern.test(url)) ?? generic;
}

export function platformOf(url: string): Platform {
  return adapterFor(url).platform;
}

export { amazon, flipkart, croma, nykaa, samsung, generic };
