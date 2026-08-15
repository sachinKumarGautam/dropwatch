import { describe, it, expect } from "vitest";
import { parseJsonLd, harvestRawOffers, parseAmazon } from "./jsonld.js";
import { trimMarkdown } from "./trim.js";
import { scrapeProduct, createFixtureScraper } from "./router.js";
import { adapterFor, platformOf } from "./sites/index.js";
import { createFixtureResolverFromDir, readFixture } from "../fixtures.js";
import { rupees } from "../money.js";

const NOW = new Date("2026-08-15T12:00:00Z");
const deps = { scraper: createFixtureScraper(createFixtureResolverFromDir()), now: () => NOW };

describe("jsonld", () => {
  it("parses Amazon iPhone JSON-LD", () => {
    const p = parseJsonLd(readFixture("amazon/iphone.html"))!;
    expect(p.price).toBe(rupees(129900));
    expect(p.title).toContain("iPhone 15");
    expect(p.inStock).toBe(true);
    expect(p.seller).toContain("Appario");
    expect(p.modelNumber).toBe("MTP43HN/A");
    expect(p.ean).toBe("0195949036194");
  });
  it("reads OutOfStock", () => {
    const p = parseJsonLd(readFixture("amazon/oos.html"))!;
    expect(p.inStock).toBe(false);
  });
  it("reads a price-error page verbatim (no clamping)", () => {
    const p = parseJsonLd(readFixture("amazon/price-error.html"))!;
    expect(p.price).toBe(rupees(12990));
  });
});

describe("parseAmazon (deterministic buy-box, no LLM)", () => {
  // Mirrors amazon.in HTML: empty priceToPay a-offscreen, price in a-price-whole,
  // MRP in apex-basisprice-value. This is what the live Samsung fridge page looked like.
  const html = `
    <span id="productTitle" class="a-size-large">  Samsung 633 L Convertible Refrigerator  </span>
    <div id="corePriceDisplay_desktop_feature_div">
      <span class="a-price reinventPricePriceToPayMargin priceToPay apex-pricetopay-value" data-a-size="xl" data-a-color="base">
        <span class="a-offscreen"></span>
        <span aria-hidden="true"><span class="a-price-whole">99,990<span class="a-price-decimal">.</span></span><span class="a-price-fraction">00</span></span>
      </span>
      <span class="a-price a-text-price a-size-base apexBasisPrice"><span class="basisprice-label">M.R.P.:</span></span>
      <span class="a-price a-text-price apex-basisprice-value" data-a-strike="true"><span class="a-offscreen">₹1,52,000</span></span>
    </div>
    <div id="availability" class="a-section"><span class="a-size-medium a-color-success">In stock</span></div>
    <div id="merchant-info">Sold by <a id="sellerProfileTriggerId">Appario Retail Private Ltd</a></div>`;

  it("reads price, MRP, availability, title", () => {
    const p = parseAmazon(html)!;
    expect(p.price).toBe(rupees(99990));
    expect(p.mrp).toBe(rupees(152000));
    expect(p.inStock).toBe(true);
    expect(p.title).toContain("Samsung 633 L");
    expect(p.evidence?.source).toBe("dom");
  });

  it("detects out of stock", () => {
    const oos = html.replace("In stock", "Currently unavailable.");
    expect(parseAmazon(oos)!.inStock).toBe(false);
  });
});

describe("harvestRawOffers", () => {
  it("finds the offer lines in the Amazon page", () => {
    const offers = harvestRawOffers(readFixture("amazon/iphone.html"), adapterFor("https://amazon.in/dp/x").offerSectionHints);
    const text = offers.map((o) => o.text).join(" | ");
    expect(text).toMatch(/HDFC Bank Credit Card/);
    expect(text).toMatch(/IPHONE2000/);
  });
});

describe("site adapters", () => {
  it("routes URLs to platforms and canonicalizes Amazon", () => {
    expect(platformOf("https://www.amazon.in/gp/product/B0IPHONE15/ref=x?tag=y")).toBe("amazon_in");
    expect(adapterFor("https://amazon.in/dp/B0IPHONE15?th=1").canonicalize("https://amazon.in/dp/B0IPHONE15?th=1")).toBe(
      "https://www.amazon.in/dp/B0IPHONE15",
    );
    expect(platformOf("https://www.flipkart.com/x/p/itm?pid=abc")).toBe("flipkart");
    expect(platformOf("https://www.croma.com/x/p/1")).toBe("croma");
    expect(platformOf("https://www.example.com/x")).toBe("other");
  });
});

describe("router", () => {
  it("scrapes via fixtures and attaches Tier-0 structured price", async () => {
    const r = await scrapeProduct(
      { productId: "p1", url: "https://www.amazon.in/dp/B0IPHONE15", platform: "amazon_in" },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(r.tierUsed).toBe(1);
    expect(r.structured?.price).toBe(rupees(129900));
  });
  it("returns not_found for an unmapped URL", async () => {
    const r = await scrapeProduct(
      { productId: "p1", url: "https://www.amazon.in/dp/B0MISSING0", platform: "amazon_in" },
      deps,
    );
    expect(r.ok).toBe(false);
  });
});

describe("trimMarkdown", () => {
  it("keeps ₹ tokens when shrinking", () => {
    const filler = "x".repeat(20_000);
    const md = filler + "\nPrice ₹1,29,900 here\n" + filler;
    const trimmed = trimMarkdown(md, 4000);
    expect(trimmed.length).toBeLessThanOrEqual(4200);
    expect(trimmed).toContain("₹1,29,900");
  });
});
