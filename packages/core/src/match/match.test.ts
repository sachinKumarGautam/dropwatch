import { describe, it, expect } from "vitest";
import { adjudicateMatches } from "./llm-match.js";
import { parseSerp, createSerp, BudgetExceeded } from "./serpapi.js";
import { createMockLlm } from "../llm/client.js";
import { createMemoryDb } from "../db/memory.js";
import { readFixtureJson } from "../fixtures.js";

const candidates = parseSerp(readFixtureJson("serpapi/iphone.json"));
const product = {
  title: "Apple iPhone 15 (128 GB) - Blue",
  brand: "Apple",
  modelNumber: "MTP43HN/A",
  ean: "0195949036194",
};

describe("adjudicateMatches", () => {
  it("model-number matches deterministically; LLM handles the rest; junk excluded", async () => {
    // LLM says Croma (0) and Vijay Sales (5) are the same; refurb (2) and Pro (3) not.
    const llm = createMockLlm((o) => {
      if (o.task !== "match") return [];
      return [
        { index: 0, isSame: true, confidence: 0.92 },
        { index: 2, isSame: false, confidence: 0.9 },
        { index: 3, isSame: false, confidence: 0.95 },
        { index: 4, isSame: false, confidence: 0.99 },
        { index: 5, isSame: true, confidence: 0.88 },
      ];
    });
    const matches = await adjudicateMatches(product, candidates, llm);
    const byMerchant = Object.fromEntries(matches.map((m) => [m.candidate.merchant, m]));
    expect(byMerchant["Reliance Digital"]!.matchedBy).toBe("model");
    expect(byMerchant["Croma"]!.matchedBy).toBe("llm");
    expect(byMerchant["Vijay Sales"]).toBeDefined();
    // the tempered-glass screen guard must never match
    expect(matches.some((m) => /screen guard/i.test(m.candidate.title))).toBe(false);
    expect(matches.length).toBe(3);
  });

  it("keeps only LLM matches ≥ 0.75 confidence", async () => {
    const llm = createMockLlm((o) =>
      o.task === "match" ? [{ index: 0, isSame: true, confidence: 0.5 }] : [],
    );
    const noEan = { title: product.title, brand: "Apple" };
    const matches = await adjudicateMatches(noEan, candidates, llm);
    expect(matches.every((m) => m.confidence >= 0.75)).toBe(true);
  });
});

describe("SerpApi budget guard", () => {
  it("throws BudgetExceeded past the monthly cap", async () => {
    const db = createMemoryDb();
    await db.setMeta("serpapi_2026_08", 90);
    const serp = createSerp("fake-key", db, () => new Date("2026-08-15T00:00:00Z"));
    await expect(serp.shoppingSearch("iphone")).rejects.toBeInstanceOf(BudgetExceeded);
  });
});
