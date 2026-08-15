/**
 * deps.ts — the dependency seam. createDeps wires real integrations in live mode
 * and mocks in DRY_RUN. Every external boundary is swappable via `overrides`.
 */
import type { Config } from "./config.js";
import type { Db } from "./db/interface.js";
import { createMemoryDb } from "./db/memory.js";
import { createDb } from "./db/supabase.js";
import { demoSeed } from "./demo-seed.js";
import { createFixtureResolverFromDir } from "./fixtures.js";
import { createLlm, createMockLlm, type LlmClient } from "./llm/client.js";
import { createFixtureSerp, createSerp, type SerpClient } from "./match/serpapi.js";
import { parseSerp } from "./match/serpapi.js";
import { readFixtureJson } from "./fixtures.js";
import { createRealScraper, } from "./scrape/live.js";
import { createFixtureScraper, type Scraper } from "./scrape/router.js";
import { createCapturingSlack, createSlack, type SlackSender } from "./alerts/slack.js";
import type { SerpCandidate } from "./types.js";

export interface Deps {
  cfg: Config;
  db: Db;
  llm: LlmClient;
  scraper: Scraper;
  slack: SlackSender;
  serpapi: SerpClient;
  now(): Date;
}

export function createDeps(cfg: Config, overrides: Partial<Deps> = {}): Deps {
  const now = overrides.now ?? (() => new Date());

  let db: Db;
  if (overrides.db) db = overrides.db;
  else if (cfg.dryRun) db = createMemoryDb({ now, seed: demoSeed(now()) });
  else db = createDb(cfg.supabase!);

  const llm =
    overrides.llm ?? (cfg.dryRun || cfg.llm.provider === "mock" ? createMockLlm() : createLlm(cfg));

  const scraper =
    overrides.scraper ??
    (cfg.dryRun
      ? createFixtureScraper(createFixtureResolverFromDir())
      : createRealScraper(cfg));

  const slack =
    overrides.slack ??
    (cfg.dryRun || !cfg.slackWebhookUrl
      ? createCapturingSlack(true)
      : createSlack(cfg.slackWebhookUrl));

  let serpapi: SerpClient;
  if (overrides.serpapi) serpapi = overrides.serpapi;
  else if (cfg.dryRun) {
    const demo = parseSerp(readFixtureJson("serpapi/iphone.json"));
    serpapi = createFixtureSerp(demo as SerpCandidate[]);
  } else if (cfg.serpapiKey) {
    serpapi = createSerp(cfg.serpapiKey, db, now);
  } else {
    serpapi = createFixtureSerp([]);
  }

  return { cfg, db, llm, scraper, slack, serpapi, now };
}
