/**
 * scrape/jsonld.ts — Tier-0 deterministic extraction.
 *   - parseJsonLd: schema.org Product/Offer(s) from <script type="application/ld+json">
 *   - parseEmbeddedState: platform-specific embedded JSON (Flipkart, Croma, etc.)
 * Prices in these sources are in rupees (major units) → converted to paise.
 */
import type { ExtractedProduct, Paise, Platform, RawOffer } from "../types.js";

const toPaise = (v: unknown): Paise | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

function scriptBlocks(html: string, type: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `<script[^>]*type=["']${type}["'][^>]*>([\\s\\S]*?)</script>`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) if (m[1]) out.push(m[1].trim());
  return out;
}

function flatten(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (Array.isArray(o["@graph"])) return (o["@graph"] as unknown[]).flatMap(flatten);
    return [node];
  }
  return node == null ? [] : [node];
}

function isProduct(o: Record<string, unknown>): boolean {
  const t = o["@type"];
  if (typeof t === "string") return /product/i.test(t);
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && /product/i.test(x));
  return false;
}

function availabilityInStock(a: unknown): boolean {
  if (typeof a !== "string") return true;
  return /InStock|LimitedAvailability|PreOrder|BackOrder/i.test(a) && !/OutOfStock|SoldOut|Discontinued/i.test(a);
}

export function parseJsonLd(html: string): Partial<ExtractedProduct> | null {
  for (const raw of scriptBlocks(html, "application/ld\\+json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes = flatten(parsed).filter(
      (n): n is Record<string, unknown> => !!n && typeof n === "object",
    );
    const product = nodes.find(isProduct);
    if (!product) continue;

    let offersNode = product["offers"] as Record<string, unknown> | Record<string, unknown>[] | undefined;
    if (Array.isArray(offersNode)) offersNode = offersNode[0];
    const price =
      toPaise(offersNode?.["price"]) ??
      toPaise(offersNode?.["lowPrice"]) ??
      toPaise((offersNode?.["priceSpecification"] as any)?.price);
    const high = toPaise(offersNode?.["highPrice"]);
    const availability = offersNode?.["availability"];
    const sellerNode = offersNode?.["seller"] as Record<string, unknown> | undefined;

    if (price == null) continue;

    const result: Partial<ExtractedProduct> = {
      title: typeof product["name"] === "string" ? (product["name"] as string) : undefined,
      price,
      mrp: high && high > price ? high : null,
      currency: "INR",
      inStock: availabilityInStock(availability),
      seller: typeof sellerNode?.["name"] === "string" ? (sellerNode!["name"] as string) : null,
      modelNumber:
        (typeof product["mpn"] === "string" && product["mpn"]) ||
        (typeof product["model"] === "string" && product["model"]) ||
        null,
      ean:
        (typeof product["gtin13"] === "string" && product["gtin13"]) ||
        (typeof product["gtin"] === "string" && product["gtin"]) ||
        null,
      evidence: { priceRaw: String(offersNode?.["price"] ?? price / 100), source: "jsonld" },
      confidence: 1,
    };
    return result;
  }
  return null;
}

// ── platform-specific embedded state (best-effort) ──────────────────────────

export function parseEmbeddedState(
  html: string,
  platform: Platform,
): Partial<ExtractedProduct> | null {
  if (platform === "amazon_in") return parseAmazon(html);
  if (platform === "flipkart") return parseFlipkart(html);
  // Croma/Nykaa/Samsung ship schema.org JSON-LD reliably; fall through to JSON-LD.
  return null;
}

/**
 * Deterministic Amazon.in buy-box parser (no JSON-LD, no LLM). Reads the
 * price-to-pay, M.R.P., availability, title and seller straight from the HTML.
 */
export function parseAmazon(html: string): Partial<ExtractedProduct> | null {
  // Scope to the buy-box region so variant-swatch prices don't win.
  const region =
    html.match(
      /id="(?:corePriceDisplay_desktop_feature_div|corePrice_feature_div|apex_desktop|buyBoxAccordion|price)"[\s\S]{0,5000}/i,
    )?.[0] ?? html;
  const priceToPayWhole = (s: string) =>
    toPaise(s.match(/priceToPay[\s\S]{0,320}?a-price-whole">\s*([\d,]+)/i)?.[1]);
  const offscreenRupees = (s: string) =>
    toPaise(s.match(/a-offscreen">\s*(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i)?.[1]);
  const anyWhole = (s: string) => toPaise(s.match(/a-price-whole">\s*([\d,]+)/i)?.[1]);
  const legacyBlock = (s: string) =>
    toPaise(s.match(/priceblock_(?:our|deal|sale)price[^>]*>\s*(?:₹|Rs\.?)\s*([\d,]+)/i)?.[1]);

  const price =
    priceToPayWhole(region) ??
    offscreenRupees(region) ??
    anyWhole(region) ??
    legacyBlock(html) ??
    priceToPayWhole(html) ??
    offscreenRupees(html) ??
    anyWhole(html);
  if (price == null) return null;

  const mrp =
    toPaise(html.match(/apex-basisprice-value[\s\S]{0,160}?a-offscreen">\s*(?:₹|Rs\.?)?\s*([\d,]+)/i)?.[1]) ??
    toPaise(html.match(/M\.?R\.?P\.?:?[\s\S]{0,180}?a-offscreen">\s*(?:₹|Rs\.?)?\s*([\d,]+)/i)?.[1]);

  const title = html.match(/id="productTitle"[^>]*>\s*([^<]{3,300})/i)?.[1]?.trim();
  const availText = html.match(/id="availability"[\s\S]{0,220}?<span[^>]*>\s*([^<]+)/i)?.[1] ?? "";
  const inStock = !/unavailable|out of stock|sold out|currently unavailable/i.test(availText);
  const seller =
    html.match(/id="sellerProfileTriggerId"[^>]*>\s*([^<]{2,60})/i)?.[1]?.trim() ??
    html.match(/Sold by[\s\S]{0,80}?>\s*([^<]{3,60})</i)?.[1]?.trim() ??
    null;
  const model = html.match(/Item model number[\s\S]{0,120}?>\s*([A-Za-z0-9/\-]{4,30})\s*</i)?.[1] ?? null;

  return {
    title,
    price,
    mrp: mrp && mrp > price ? mrp : null,
    currency: "INR",
    inStock,
    seller,
    modelNumber: model,
    evidence: { priceRaw: String(price / 100), source: "dom" },
    confidence: 1,
  };
}

function parseFlipkart(html: string): Partial<ExtractedProduct> | null {
  // Flipkart embeds pricing in __INITIAL_STATE__; grab the first finalPrice/decimalValue.
  const final = html.match(/"finalPrice"\s*:\s*\{[^}]*"decimalValue"\s*:\s*"?([\d.]+)"?/);
  const mrpM = html.match(/"mrp"\s*:\s*\{[^}]*"decimalValue"\s*:\s*"?([\d.]+)"?/);
  const titleM = html.match(/"title"\s*:\s*"([^"]{6,200})"/);
  const price = final ? toPaise(final[1]) : null;
  if (price == null) return null;
  const mrp = mrpM ? toPaise(mrpM[1]) : null;
  return {
    title: titleM ? titleM[1] : undefined,
    price,
    mrp: mrp && mrp > price ? mrp : null,
    currency: "INR",
    inStock: !/"outOfStock"\s*:\s*true|SOLD OUT|Currently unavailable/i.test(html),
    evidence: { priceRaw: String(final?.[1] ?? price / 100), source: "embedded_state" },
    confidence: 1,
  };
}

/** Harvest raw offer strings from HTML text near known offer-section hints. */
export function harvestRawOffers(text: string, hints: string[]): RawOffer[] {
  const out: RawOffer[] = [];
  const seen = new Set<string>();
  const lines = text
    .replace(/<[^>]+>/g, "\n")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const hint = hints.find((h) => line.toLowerCase().includes(h.toLowerCase()));
    const looksOffer =
      /(instant discount|cashback|no[\s-]?cost emi|coupon|% off|₹\s*\d|exchange|gst invoice|bank offer|unlimited)/i.test(
        line,
      );
    if ((hint || looksOffer) && line.length > 12 && line.length < 320) {
      const key = line.slice(0, 80).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ text: line, sectionHint: hint });
      }
    }
  }
  return out;
}
