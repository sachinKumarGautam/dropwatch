# DropWatch

A personal, India-first **price-drop intelligence agent**. It watches a list of product
URLs across Amazon.in, Flipkart, Croma, Nykaa, Samsung (and more), and alerts you on Slack
when something is genuinely worth buying — not just when a number moves.

**The moat:** it computes the **effective price for _your_ credit cards** (bank instant
discounts, no-cost-EMI GST, coupons, co-brand rewards, UPI cashback) and compares it
_across platforms_. Sticker-price tracking is a commodity; card-aware effective pricing is not.

```
79/100  Apple iPhone 15 (128 GB)
₹1,22,900 effective  (sticker ₹1,29,900)
  HDFC Millennia CC · −₹2,000 coupon IPHONE2000 · −₹5,000 HDFC 10% (cap)
Why now: new effective all-time low · new all-time low · 18% below 90-day median
Lowest across platforms · Buy: inside the Independence Day sale window
```

## What it checks

All-time low · 90/180-day low · % below 90-day median · statistical rarity (z-score) ·
drop velocity · **fake-MRP / inflated-discount detection** · price-per-unit · **effective-price
all-time low** · coupon appearance · back-in-stock · lightning deals · **price-error
detection** · target-price hit · rising-price warning · **cross-platform lowest** · festival
proximity (buy-now-vs-wait). Everything is ranked by a 0–100 deal score; only ≥70 pings you
immediately, 55–69 goes to a daily digest, and duplicates are suppressed for 7 days.

See [`docs/product-spec.md`](docs/product-spec.md), [`docs/architecture.md`](docs/architecture.md),
and [`docs/blueprint.md`](docs/blueprint.md) for the full design.

## Architecture

```
GitHub Actions cron ──> worker (TS) ──> Firecrawl / Playwright ──> JSON-LD first, LLM fallback
                          │                                          (verbatim-price validated)
                          ├─> Supabase Postgres (history, offers, alerts, v_product_stats)
                          ├─> SerpApi + LLM  (cross-platform matching)
                          └─> Slack webhook  (Block Kit alerts + daily digest)
Next.js on Vercel ──> Supabase (add/delete URLs, manage cards, charts, alert feed)
```

Monorepo: `packages/core` (all logic + tests), `packages/worker` (CLI), `apps/web` (UI).

## Quick start (no keys needed)

```bash
pnpm install
pnpm --filter @dropwatch/core test          # 73 tests, incl. real SQL via pglite
DRY_RUN=1 pnpm --filter @dropwatch/worker start -- check-all   # prints a real Slack block
```

`DRY_RUN=1` swaps in fixtures, a mock LLM, and a captured Slack sender — the entire pipeline
runs and is fully tested with zero external services.

## Going live

### 1. Supabase (storage — free tier)
1. Create a project at supabase.com.
2. Run `supabase/migrations/0001_init.sql` then `0002_rls.sql` in the SQL editor
   (optionally `supabase/seed.sql` for demo data).
3. Storage → create a **private** bucket named `evidence` (stores offer snapshots).
4. Copy the project URL, the **service-role** key (worker) and the **anon** key (UI).

### 2. Worker `.env` (local runs)
Copy `.env.example` → `.env`, set `DRY_RUN=0` and fill the keys (§ below). Then:
```bash
pnpm --filter @dropwatch/worker start -- add "https://www.amazon.in/dp/XXXX" --target 60000
pnpm --filter @dropwatch/worker start -- check-all
pnpm --filter @dropwatch/worker start -- sweep     # cross-platform
```

### 3. GitHub Actions (the scheduler — free)
Push to a **private** repo. Add repository **secrets**:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`,
`SERPAPI_KEY`, `SLACK_WEBHOOK_URL`.
Add repository **variables** (optional): `LLM_PROVIDER`, `OPENAI_MODEL`, `LLM_REASONING_MODEL`,
`DEFAULT_PINCODE`.
The three workflows then run automatically:
`check-prices` (3×/day IST + digest at 09:00), `competitor-sweep` (weekly), `keepalive` (weekly).
Use **Run workflow** on `check-prices` for an on-demand check.

### 4. Vercel (the UI — free Hobby)
Import the repo, set root to `apps/web`. Env: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus `GITHUB_TOKEN` (fine-grained PAT, `actions:write`) and
`GITHUB_REPO` (`you/dropwatch`) so the **Check now** button can trigger a run.

### Keys checklist
| Key | Where | Free tier |
|---|---|---|
| `OPENAI_API_KEY` | worker / GH secret | pay-as-you-go (~$3–8/mo here) |
| `FIRECRAWL_API_KEY` | worker / GH secret | 1,000 credits/mo |
| `SERPAPI_KEY` | worker / GH secret | ~100 searches/mo |
| `SLACK_WEBHOOK_URL` | worker / GH secret | free |
| `SUPABASE_URL` + service-role + anon | worker + UI | free |
| `GITHUB_TOKEN` (actions:write) | Vercel | free |

**Estimated cost:** ~$3–8/mo strict-free (daily checks), ~$20–25/mo with Firecrawl Hobby for
50+ URLs checked a few times a day. Only hostile-site scraping costs real money.

## Commands

```
worker check <productId>        worker check --url <url>        worker check-all
worker sweep [--product <id>]   worker digest                   worker health
worker add <url> [--target ₹] [--pincode P]        (--dry-run forces mock mode)
```

## Notes & roadmap
- **Scraping** routes by hostility: JSON-LD/embedded-state first (free), Firecrawl for
  Amazon/Flipkart, Playwright for friendlier sites. Run `pnpm exec playwright install chromium`
  for the Playwright path locally.
- **Live browsers** and real keys are only needed in production; tasks 1–24 of the build are
  verified entirely on fixtures.
- **v1.1:** Slack buttons (snooze/mute/set-target) write-back — the endpoint verifies the
  signature today and returns 501 until wired.
- **P1/P2 ideas** (wishlist import, warranty/return-policy surfacing, open-box watch,
  price-protection after purchase, "best card you don't have" trends) are catalogued in
  `docs/product-spec.md §5`.
