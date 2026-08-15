# DropWatch — Architecture & Existing-Solutions Decision

> Source: Fable architecture pass. The "how".

## 30-second verdict

**BUILD THIS:** GitHub Actions cron → TypeScript worker → Firecrawl (`/scrape`, stealth proxy for
Amazon/Flipkart) + Playwright fallback (friendly sites) → deterministic JSON-LD parse first,
LLM structured extraction second → **Supabase Postgres** (free tier) → Slack incoming webhook →
**Next.js on Vercel Hobby** for the UI. SerpApi Google Shopping (free ~100/mo) + LLM matching for
cross-platform lowest. **~$3–8/mo** strict-free; **~$20–25/mo** with Firecrawl Hobby for multi-daily
checks of 50+ URLs.

**AWS-native variant:** swap GitHub Actions → EventBridge Scheduler + Lambda, Supabase → DynamoDB.
Everything else identical. Not built in v1.

## Existing solutions — verdicts
- **Keepa** — covers amazon.in, but API has **no free tier** (€49/mo). Skip API; use free site/extension as manual Amazon-history reference. Upgrade path if multi-user later.
- **CamelCamelCamel** — no amazon.in. Skip.
- **pricehistory.app / BuyHatke** — India-first, but **no public API**. Great manual reference; don't scrape (fragile + ToS). BuyHatke's "Lookalike" validates LLM cross-store matching as the right idea.
- **SerpApi Google Shopping** — `google_domain=google.co.in, gl=in`. ~100 free searches/mo. **USE** for competitor discovery (weekly sweep).
- **Firecrawl** — site-agnostic, stealth proxies handle Amazon-class anti-bot. 1,000 free credits/mo; `/scrape`=1 credit, stealth=5. **USE as primary scraper**; extract with our own OpenAI key (cheaper/controllable than their `/extract`).
- **ScraperAPI** — documented overflow pool only. **Playwright** — primary for friendly sites + offer-modal clicks + fallback. **OSS trackers** (changedetection.io, Discount-Bandit) — steal patterns, don't adopt (none do Indian bank-offer/effective-price/cross-platform).

**Short-list: Firecrawl + Playwright + SerpApi + your OpenAI key.**

## Scraping strategy (route by hostility, escalate on failure, parse deterministically first)
```
Tier 0  Deterministic parse (free): JSON-LD (Nykaa, Croma, Samsung, Flipkart product schema)
        or embedded state (Flipkart __INITIAL_STATE__, Samsung product API) → price/MRP/availability.
Tier 1  Firecrawl /scrape (primary for Amazon.in + Flipkart): formats [markdown,html],
        proxy:"auto" + actions [{click offers},{wait}] so bank-offer modal lands in markdown.
Tier 2  Playwright: primary for Croma/Nykaa/Samsung (0 credits); fallback for Amazon/Flipkart
        (mobile UA + m.site). Clicks offer accordions/modals natively.
Tier 3  LLM extraction on trimmed markdown → {price, mrp, currency, availability, seller, offers[]}.
```
Store raw markdown snapshot (Supabase Storage, 1GB free) per scrape for debuggable re-parse.
Anti-bot hygiene: jitter ±20min, randomize order, concurrency 3–5, mobile UAs, per-site backoff,
self-alert on 3+ consecutive failures.

## AI usage
| Job | Model tier | Trigger | Tokens |
|---|---|---|---|
| Structured extraction (markdown→price/MRP/availability) | cheap (env `OPENAI_MODEL`) | Tier-0 miss | ~4–8k in / 300 out |
| Offer parsing (text→offers[]) | cheap | every check | ~1.5–3k in / 400 out |
| Product matching (SerpApi vs tracked) | reasoning (env `LLM_REASONING_MODEL`) | weekly + on add | ~2–4k in / 300 out |
| Deal reasoning (Slack verdict) | reasoning | on alert | ~3k in / 500 out |

**Guardrails:** extractor returns price as **verbatim substring** of source markdown; validator
re-checks substring + sanity bounds (`price ≤ mrp`; ±60% jumps need confirming re-scrape) before
any DB write. LLM never invents a stored number. Blended ≈ $0.0015/check → ~$5–7/mo at 4,500 checks.
**Model IDs are env vars** — never hardcoded.

## Storage — Supabase Postgres
500MB DB + 1GB storage + REST + auth. 50 URLs × 3/day × 365 ≈ 55k rows/yr ≈ a few MB.
"min over last 3 months" = one indexed SQL FILTER clause. Schema: `tracked_products`,
`price_history`, `offers`, `credit_cards`, `competitor_matches`, `alerts`, view `v_product_stats`.

## Scheduling — GitHub Actions cron (PICK)
Private repo 2,000 free min/mo; 3 runs/day × ~12min ≈ 1,100 min. Handle: cron drift (fine),
auto-disable after 60 commit-less days (monthly keepalive workflow), avoid :00 stampede
(09:30/15:30/21:30 IST), `workflow_dispatch` = free "Check now". Hourly burst during BBD/GIF = one cron edit.

## UI — Next.js on Vercel Hobby → Supabase directly (RLS, single magic-link user)
Pages: `/products`, `/products/[id]`, `/cards`, `/alerts`. Charts via Recharts/uPlot.
"Check now" → GitHub `workflow_dispatch` via API.

## Cost (~50 URLs, 2–3/day)
Free-first: **$3–8/mo** strict, **$19–24** with Firecrawl Hobby. AWS-native: same.
Only real cost = scraping hostile sites more often.

## Keys/credentials
`SLACK_WEBHOOK_URL` · `OPENAI_API_KEY` · `FIRECRAWL_API_KEY` · `SERPAPI_API_KEY` ·
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (worker) · `NEXT_PUBLIC_SUPABASE_URL` +
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (UI) · fine-grained `GITHUB_TOKEN` with `actions:write` ·
Vercel account · optional `SCRAPERAPI_KEY`, `KEEPA_API_KEY`; AWS IAM (AWS variant only).
