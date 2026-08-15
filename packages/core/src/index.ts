/**
 * @dropwatch/core — public API barrel.
 */
export * from "./types.js";
export { loadConfig, ConfigError, type Config } from "./config.js";
export { createDeps, type Deps } from "./deps.js";

// pipeline
export { checkProduct, type CheckSummary } from "./pipeline/check.js";
export { checkAll, type CheckAllSummary } from "./pipeline/check-all.js";
export { sweep, type SweepSummary } from "./pipeline/sweep.js";
export { digest, type DigestSummary } from "./pipeline/digest.js";
export { health, addProduct, type AddResult } from "./pipeline/ops.js";
export { watchdog, type WatchdogResult } from "./pipeline/watchdog.js";
export { isDue, intervalFor, DEFAULT_INTERVAL_MIN } from "./pipeline/gate.js";
export { sendOps, sendHealthOnce } from "./alerts/ops.js";

// building blocks (useful for the UI / tests / scripts)
export { computeEffectivePrices, rankEffective, bestCardNotHeld } from "./offers/effective-price.js";
export { parseOfferStrings, parseOne, llmParseOffers } from "./offers/parse.js";
export { deriveSignals, readStats } from "./stats.js";
export { scoreDeal } from "./score.js";
export { FESTIVALS, activeOrUpcomingWindow, buyWaitAdvice } from "./festival.js";
export { fingerprint, shouldSend, istDayStart, type Caps } from "./alerts/dedup.js";
export { buildDealBlocks, buildDigestBlocks, buildHealthBlocks } from "./alerts/blocks.js";
export { formatINR, formatPct, rupees } from "./money.js";
export { platformOf, adapterFor } from "./scrape/sites/index.js";

// db
export { createMemoryDb } from "./db/memory.js";
export { createDb } from "./db/supabase.js";
export type { Db, SeedData, CompetitorMatchRow } from "./db/interface.js";

// demo
export { demoSeed, demoCards, DEMO_PRODUCT_ID, DEMO_URL } from "./demo-seed.js";
