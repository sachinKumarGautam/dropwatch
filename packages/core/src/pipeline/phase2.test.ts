import { describe, it, expect } from "vitest";
import { loadConfig } from "../config.js";
import { createDeps } from "../deps.js";
import { checkAll } from "./check-all.js";
import { sweep } from "./sweep.js";
import { watchdog } from "./watchdog.js";
import { sendHealthOnce } from "../alerts/ops.js";
import { createMemoryDb } from "../db/memory.js";
import { createCapturingSlack } from "../alerts/slack.js";
import { createMockLlm, type LlmClient } from "../llm/client.js";
import { demoSeed, DEMO_PRODUCT_ID } from "../demo-seed.js";

const NOW = new Date("2026-08-15T12:00:00Z");

describe("frequency gating in check-all", () => {
  it("second run skips the just-checked product (not due)", async () => {
    const cfg = loadConfig({ DRY_RUN: "1" });
    const deps = createDeps(cfg, { now: () => NOW, slack: createCapturingSlack() });
    const first = await checkAll(deps);
    expect(first.checked).toBe(1);
    const second = await checkAll(deps);
    expect(second.checked).toBe(0);
    expect(second.skipped).toBe(1);
  });
});

describe("MINIMAL_LLM sweep is deterministic-only", () => {
  it("issues zero LLM match calls but still records EAN/model matches", async () => {
    const seed = demoSeed(NOW);
    seed.competitorMatches = []; // force a sweep
    const db = createMemoryDb({ now: () => NOW, seed });
    const cfg = loadConfig({ DRY_RUN: "1" }); // minimalLlm defaults true
    expect(cfg.minimalLlm).toBe(true);

    let matchCalls = 0;
    const countingLlm: LlmClient = createMockLlm((o) => {
      if (o.task === "match") matchCalls++;
      return [];
    });
    const deps = createDeps(cfg, { now: () => NOW, db, llm: countingLlm, slack: createCapturingSlack() });

    const summary = await sweep(deps, DEMO_PRODUCT_ID);
    expect(matchCalls).toBe(0);
    expect(summary.matched).toBeGreaterThanOrEqual(1); // Reliance model-number match
  });
});

describe("watchdog", () => {
  it("alerts once when no successful run in >26h, then dedupes", async () => {
    const cfg = loadConfig({ DRY_RUN: "1" });
    const db = createMemoryDb({ now: () => NOW });
    const deps = createDeps(cfg, { now: () => NOW, db, slack: createCapturingSlack() });
    const first = await watchdog(deps);
    expect(first.stale).toBe(true);
    expect(first.alerted).toBe(true);
    const second = await watchdog(deps);
    expect(second.alerted).toBe(false); // same-day dedupe
  });

  it("stays quiet when a run succeeded recently", async () => {
    const cfg = loadConfig({ DRY_RUN: "1" });
    const db = createMemoryDb({ now: () => NOW });
    await db.setMeta("last_ok_run_at", { at: new Date(NOW.getTime() - 3_600_000).toISOString() });
    const deps = createDeps(cfg, { now: () => NOW, db, slack: createCapturingSlack() });
    const r = await watchdog(deps);
    expect(r.stale).toBe(false);
    expect(r.alerted).toBe(false);
  });
});

describe("health alert dedupe", () => {
  it("sends once per key per IST day", async () => {
    const cfg = loadConfig({ DRY_RUN: "1" });
    const db = createMemoryDb({ now: () => NOW });
    const slack = createCapturingSlack();
    const deps = { db, slack, cfg, now: () => NOW };
    const payload = { blocks: [], text: "health" };
    expect(await sendHealthOnce(deps, "p1", payload)).toBe(true);
    expect(await sendHealthOnce(deps, "p1", payload)).toBe(false);
    expect(slack.sent).toHaveLength(1);
  });
});
