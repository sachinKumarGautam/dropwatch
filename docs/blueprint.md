# DropWatch — Locked Implementation Blueprint (v1)

> Source: Fable synthesis pass. This is the executable spec. Where it names a file, type,
> signature, or threshold, that is the decision. **Money is integer paise everywhere**
> (`₹1 = 100`). Timestamps are `timestamptz` in the DB, ISO-8601 strings in TS. IST at the
> edges, UTC in storage.

The full contract lives in code now (`packages/core/src/types.ts` is the single source of
truth for types; `supabase/migrations/0001_init.sql` for the schema; the module files for the
signatures). This document is the human-readable index of the decisions.

## Build phases (P0→P8)
- **P0 Skeleton** — pnpm workspace, turbo, tsconfig, vitest. (tasks 1–3)
- **P1 Data layer** — schema + RLS + `v_product_stats` + `Db` (supabase & memory) parity. (4–6)
- **P2 Scrape+extract** — jsonld, adapters, router, trim, llm extract, validate. (7–12)
- **P3 Offers+effective price** — regex corpus, llm fallback, effective-price math. (13–15)
- **P4 Intelligence** — deriveSignals, score, festival. (16–18)
- **P5 Alerts** — dedup, blocks, slack. (19–20)
- **P6 Worker E2E (mocked)** — check, check-all, sweep, digest. (21–24)
- **P7 Real integrations** — live Supabase, Firecrawl+Playwright, LLM+Slack+SerpApi, GH Actions. (25–28)
- **P8 UI** — /products, /cards, /alerts, /products/[id], Check-now. (29–30)

Tasks 1–24 require **zero external keys** and constitute a fully verified system on fixtures.

## Key locked decisions
- Scrape tiers: 0 deterministic (JSON-LD/embedded state) → 1 Firecrawl → 2 Playwright → 3 LLM.
  Per-site `tierOrder`. After any HTML/MD obtained, always retry Tier-0 parse (free upgrade).
- Extraction validation: price must be a **verbatim substring** of source (LLM sources only),
  `price ≤ mrp`, `confidence ≥ 0.5`, `|Δ|>60%` vs last accepted ⇒ confirming re-scrape.
- Effective price: per (card × payment-path). `effectiveInstant = base − coupon − bankInstant + emiGst`;
  instant vs no-cost-EMI are separate rows (never stack); ranking picks the winner.
- Deal score 0–100: depth 35 + rarity 25 + cross-platform 15 + offer 10 + trust 10 + urgency 5 − penalties.
  Routing ≥70 immediate / 55–69 digest / <55 log; price-error & target-hit bypass.
- De-dup fingerprint = `sha1(product|platform|round(effInstant/5000)*5000|bestOfferId)`; 7-day silence
  unless further drop ≥max(3%,₹100), routing upgrade, or restock. Caps 2/product/day, 8/global/day.
- LLM model IDs come **only** from env (`OPENAI_MODEL` default `gpt-4o-mini`, `LLM_REASONING_MODEL`).
- `DRY_RUN=1` swaps db→MemoryDb, scraper→FixtureScraper, llm→MockLlm, slack→CapturingSlack,
  serpapi→FixtureSerp, `now()`→injectable clock. Whole pipeline runs & tests with no keys.

See `product-spec.md` (what/why) and `architecture.md` (stack/existing-solutions) for rationale.
