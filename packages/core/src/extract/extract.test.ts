import { describe, it, expect } from "vitest";
import { llmExtract } from "./llm.js";
import { validateExtraction, assertVerbatimPrice } from "./validate.js";
import { structuredToExtracted } from "./schema.js";
import { createMockLlm } from "../llm/client.js";
import { parseJsonLd } from "../scrape/jsonld.js";
import { readFixture } from "../fixtures.js";
import { rupees } from "../money.js";
import { makeExtracted } from "../testkit.js";

describe("verbatim price", () => {
  it("matches Indian, Western, and decimal groupings", () => {
    expect(assertVerbatimPrice(rupees(129900), "Price ₹1,29,900 today").ok).toBe(true);
    expect(assertVerbatimPrice(rupees(129900), "MRP 129,900.00").ok).toBe(true);
    expect(assertVerbatimPrice(rupees(129900), "1 29 900").ok).toBe(true);
    expect(assertVerbatimPrice(rupees(129900), "some other 999 number").ok).toBe(false);
  });
});

describe("validateExtraction", () => {
  const src = "Price ₹1,29,900";
  it("accepts a verbatim LLM price", () => {
    const p = makeExtracted({ price: rupees(129900), mrp: rupees(149900), evidence: { priceRaw: "₹1,29,900", source: "llm" } });
    expect(validateExtraction(p, src, null).verdict).toBe("ok");
  });
  it("rejects an LLM price not in the source", () => {
    const p = makeExtracted({ price: rupees(9999), evidence: { priceRaw: "x", source: "llm" } });
    expect(validateExtraction(p, src, null).verdict).toBe("reject");
  });
  it("exempts deterministic (jsonld) sources from the substring check", () => {
    const p = makeExtracted({ price: rupees(55555), evidence: { priceRaw: "x", source: "jsonld" } });
    expect(validateExtraction(p, src, null).verdict).toBe("ok");
  });
  it("rejects price>mrp", () => {
    const p = makeExtracted({ price: rupees(160000), mrp: rupees(149900), evidence: { priceRaw: "x", source: "jsonld" } });
    expect(validateExtraction(p, src, null).verdict).toBe("reject");
  });
  it("flags a >60% jump for re-scrape (price-error path)", () => {
    const p = structuredToExtracted(parseJsonLd(readFixture("amazon/price-error.html"))!, [])!;
    const res = validateExtraction(p, "₹12,990", rupees(129900));
    expect(res.verdict).toBe("needs_rescrape");
  });
});

describe("llmExtract", () => {
  it("extracts a product via the mock LLM and validates verbatim", async () => {
    const llm = createMockLlm((o) => {
      if (o.task === "extract")
        return {
          title: "Apple iPhone 15 (128 GB) - Blue",
          priceRupees: 129900,
          mrpRupees: 149900,
          inStock: true,
          isLightningDeal: false,
          dealEndsAt: null,
          deliveryFeeRupees: 0,
          deliveryEtaDays: 1,
          unitCount: null,
          unitLabel: null,
          seller: "Appario Retail Private Ltd",
          modelNumber: "MTP43HN/A",
          ean: null,
          priceRaw: "₹1,29,900",
        };
      return [];
    });
    const md = readFixture("amazon/iphone.md");
    const p = await llmExtract(md, { platform: "amazon_in" }, llm);
    expect(p.price).toBe(rupees(129900));
    expect(p.evidence.source).toBe("llm");
    expect(validateExtraction(p, md, null).verdict).toBe("ok");
  });
});
