import { describe, it, expect } from "vitest";
import { loadConfig } from "../config.js";
import { createDeps } from "../deps.js";
import { checkProduct } from "./check.js";
import { checkAll } from "./check-all.js";
import { sweep } from "./sweep.js";
import { digest } from "./digest.js";
import { createCapturingSlack } from "../alerts/slack.js";
import { createMemoryDb } from "../db/memory.js";
import { demoSeed, DEMO_PRODUCT_ID } from "../demo-seed.js";
import { rupees } from "../money.js";

const NOW = new Date("2026-08-15T12:00:00Z");

describe("worker check — E2E on fixtures (no keys)", () => {
  it("scrapes, extracts, prices, scores ≥70 and emits one Slack deal", async () => {
    const cfg = loadConfig({ DRY_RUN: "1" });
    const slack = createCapturingSlack();
    const deps = createDeps(cfg, { now: () => NOW, slack });

    const res = await checkProduct(deps, DEMO_PRODUCT_ID);

    expect(res.ok).toBe(true);
    expect(res.price).toBe(rupees(129900));
    expect(res.effInstant!).toBeLessThan(rupees(129900)); // card offer applied
    expect(res.score!).toBeGreaterThanOrEqual(70);
    expect(res.routing).toBe("immediate");
    expect(res.sent).toBe(true);
    expect(slack.sent).toHaveLength(1);

    // db side-effects
    const pts = await deps.db.latestPricePoints(DEMO_PRODUCT_ID, 1);
    expect(pts[0]!.price).toBe(rupees(129900));
    expect(pts[0]!.effectiveInstant).toBe(res.effInstant);
    const offers = await deps.db.getActiveOffers(DEMO_PRODUCT_ID);
    expect(offers.length).toBeGreaterThanOrEqual(4);

    // the Slack block mentions the effective price and a card
    const json = JSON.stringify(slack.sent[0]!.blocks);
    expect(json).toContain("effective");
    expect(json).toContain("HDFC");
  });

  it("dedups a second identical check (no new Slack send)", async () => {
    const cfg = loadConfig({ DRY_RUN: "1" });
    const slack = createCapturingSlack();
    const deps = createDeps(cfg, { now: () => NOW, slack });
    await checkProduct(deps, DEMO_PRODUCT_ID);
    await checkProduct(deps, DEMO_PRODUCT_ID);
    expect(slack.sent).toHaveLength(1); // second suppressed by fingerprint silence
  });
});

describe("check-all + failure isolation", () => {
  it("one missing fixture fails softly; others succeed", async () => {
    const seed = demoSeed(NOW);
    // add a second product that has no fixture → will fail
    seed.products!.push({
      ...seed.products![0]!,
      id: "broken",
      url: "https://www.amazon.in/dp/B0MISSING0",
      canonicalUrl: "https://www.amazon.in/dp/B0MISSING0",
    });
    const db = createMemoryDb({ now: () => NOW, seed });
    const cfg = loadConfig({ DRY_RUN: "1" });
    const deps = createDeps(cfg, { now: () => NOW, db, slack: createCapturingSlack() });

    const summary = await checkAll(deps);
    expect(summary.checked).toBe(2);
    expect(summary.failed).toBe(1);

    const broken = await deps.db.getTrackedProduct("broken");
    expect(broken!.consecutiveFailures).toBe(1);
  });
});

describe("sweep + digest", () => {
  it("sweep records competitor matches for the demo product", async () => {
    // make the demo product's competitor data stale so it is swept
    const seed = demoSeed(NOW);
    seed.competitorMatches = [];
    const db = createMemoryDb({ now: () => NOW, seed });
    const cfg = loadConfig({ DRY_RUN: "1" });
    // mock LLM adjudication so non-deterministic candidates match
    const deps = createDeps(cfg, {
      now: () => NOW,
      db,
      slack: createCapturingSlack(),
    });
    const summary = await sweep(deps, DEMO_PRODUCT_ID);
    expect(summary.swept).toBe(1);
    const matches = await deps.db.getCompetitorMatches(DEMO_PRODUCT_ID);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("digest sends nothing when there are no pending digest alerts", async () => {
    const cfg = loadConfig({ DRY_RUN: "1" });
    const slack = createCapturingSlack();
    const deps = createDeps(cfg, { now: () => NOW, slack });
    const r = await digest(deps);
    expect(r.sent).toBe(false);
  });
});
