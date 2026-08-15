# DropWatch — Product & Intelligence Spec (India)

> Source: Fable brainstorming pass. This is the "what & why". See `architecture.md` for the "how".

Scheduled watcher (hourly for electronics/high-value, daily for the rest) over a user-managed
URL list, with LLM-powered extraction, **card-aware effective pricing**, cross-platform
comparison, and ranked Slack alerts.

The differentiator to protect at every step: **nobody else computes _your-cards_ effective price
across platforms.** Sticker-price tracking alone is a commodity (BuyHatke, pricehistory.app already
do it). Effective price = the moat.

---

## 1. Price angles — signals, computation, alert thresholds

Track **two price series per product per platform**: `sticker_price` (listed sale price) and
`effective_price` (after best applicable card offer + coupons). All signals run on **both**;
effective-price signals dominate.

| # | Signal | Compute | Alert-worthy when |
|---|--------|---------|-------------------|
| 1 | All-time low (ATL) | `current <= min(full history)` | at/within **2%** of ATL |
| 2 | 90/180-day low | rolling `min()` over window on daily close | new 90-day low AND ≥5% below 90-day median; 180-day low alone at ≥3% below median |
| 3 | % below median | `(median_90d − current)/median_90d` (median resists sale spikes) | electronics ≥**12%**, fashion ≥**35%**, beauty ≥**25%** |
| 4 | z-score rarity | `(median_90d − current)/stddev_90d` | z ≥ **2.0**; AND-gate with #3 for volatile SKUs (stddev/median>8%) |
| 5 | Drop velocity | % change over trailing 24h/72h | ≥**8% in 24h** sticker or ≥5% effective |
| 6 | MRP vs sale | `(MRP − current)/MRP` | **display-only** (MRP is gamed); never alert alone |
| 7 | Fake-discount detector | MRP rose >10% in 60d while sale flat, or "70% off" ≈ 90d median | suppresses #6, −10 deal-score penalty |
| 8 | Price-per-unit | normalize to ₹/100ml, ₹/kg etc. from pack size | PPU is a 90-day low across pack sizes, or bigger pack beats tracked by ≥10% |
| 9 | Effective-price ATL | #1/#2 on the effective series | new effective 90-day low → immediate (signature move) |
| 10 | Coupon appearance/stacking | diff coupon set each run; evaluate stack legality per platform | new coupon pushes effective below 90d-eff-low, or coupon ≥₹500/≥5% |
| 11 | Back-in-stock | OOS→in-stock transition | item OOS >48h AND returns at ≤90d median |
| 12 | Lightning/limited deal | countdown timer / "% claimed" / "only N left" (LLM classify) | deal price also clears #2/#3 |
| 13 | Price-error heuristic | ≤50% of 90d median AND ≥30% below cross-platform min AND no matching sale | **bypass scoring** → instant, flagged "POSSIBLE PRICE ERROR" |
| 14 | Target price hit | user target (₹ or "20% below median") vs effective | always, once per crossing |
| 15 | Rising-price warning | ≥2 consecutive daily increases totaling ≥5%, still clears target | digest-level "window closing" |
| 16 | Cross-platform lowest-now | see §3 | competitor ≥3% or ≥₹200 cheaper (effective) |
| 17 | Festival proximity damper | mega-sale calendar | not an alert; modifies buy/wait + score (−10 if mega-sale <14d away and not within 3% of ATL) |

**Cadence:** hourly for items >₹10k or with an active deal timer; every 6h for ₹2k–10k; daily otherwise. Store one intraday min/max plus daily close.

---

## 2. Credit-card / offer intelligence (India)

### Offer taxonomy (real Indian PDP offers)
1. **Instant bank discount** — "10% off up to ₹1,500 on HDFC Credit Cards, min ₹5,000". Watch credit-only / debit-only / **EMI-only** variants (EMI-only ≠ full swipe).
2. **No-cost EMI** — not truly free: 18% GST on the interest component is still charged; frequently does **not stack** with instant discount (pick one).
3. **Cashback** — wallet (Amazon Pay / SuperCoins, near-cash, locked-in) vs statement (posted 45–90 days later).
4. **Coupons / promo codes** — Amazon clip-coupons, Flipkart "Extra ₹X off", Nykaa/Myntra code fields, Ajio codes.
5. **Exchange + exchange bonus** — track the **bonus** only; base trade-in value is not a discount.
6. **Partner/wallet/UPI** — Paytm/PhonePe/CRED cashback, small caps, relevant under ₹5k.
7. **Co-branded always-on rewards** — Flipkart Axis (5% on Flipkart), Amazon Pay ICICI (5%), SBI Cashback (5% online). Apply to everything → shift cross-platform rankings.
8. **Brand-store offers** — Samsung upgrade bonuses, bundled freebies (value at street price ×0.5 liquidity).
9. **GST invoice (business)** — input tax credit 18–28% for GST-registered buyers (opt-in flag).

### Card model
`{ issuer, network(Visa/MC/Amex/RuPay), kind(credit/debit), product_name, cobrand, base_online_reward_pct, emi_eligible }`

Issuers to model: HDFC, ICICI, Axis, SBI Card, Amex, Kotak, IDFC First, RBL, IndusInd, Yes, AU, HSBC, Federal, BOB, StanChart; fintech OneCard/Slice; co-brands Flipkart Axis, Amazon Pay ICICI, Tata Neu HDFC, Swiggy HDFC, Airtel Axis, Myntra Kotak. Networks matter (network-scoped offers).

### Offer parsing pipeline
1. Scrape offers block incl. **"See all offers"** expansion (hides fine print: min order, cap, EMI-only).
2. LLM-extract each string → `{ issuer, network|null, kind, txn(full|emi|both), mechanic, value_pct|value_flat, cap_inr, min_order_inr, valid_till, valid_days, once_per_card, stackable_with[], raw_text }`.
3. Validate value/cap consistency vs raw_text (re-prompt once); always store `raw_text` (goes into alert + evidence).
4. Match to user's cards: issuer+kind exact; EMI-only only if `emi_eligible`; network-scoped on network. Track offers the user **cannot** use separately ("best card you don't have").

### Effective price — single formula (per product, platform, card, path)
```
effective_instant = sticker
  − best legal coupon stack
  − instant bank discount (min(value, cap) if min_order met)
  + emi_gst_cost (18% GST on interest, if no-cost EMI path)
  [choose max(instant-discount path, no-cost-EMI path) when they don't stack]

effective_net = effective_instant
  − wallet cashback × 0.9
  − statement cashback × 0.7
  − co-brand/base reward × 0.9 (points-as-cashback) or ×0.5 (miles)
```
Rank card×path combos. **Best `effective_instant` drives alerts + deal score**; `effective_net` is a secondary line. Persist the winning breakdown for the alert.

---

## 3. Cross-platform / competitor intelligence

### Identity resolution (same product?)
1. EAN/GTIN (Croma/RD expose in specs) — exact match wins.
2. Brand + manufacturer model number (LLM-extract, e.g. "SM-S928B/DS", "OLED55C4PSA").
3. Persistent ASIN↔FSN↔SKU map — never re-match confirmed pairs.
4. LLM adjudication: `same | variant_of | different` + confidence + differing attributes. Auto-compare ≥0.9; 0.7–0.9 "verify"; <0.7 discard.

**Variants:** normalize storage/RAM, color, size, shade, pack size, model year. Compare only within same variant tuple; surface "cheaper variant exists" as a labeled secondary line.

### True lowest
`min` over platforms of `effective_instant + delivery fee − trust filter`. Trust exclusions (unless opt-in): seller rating <4.0 or <100 ratings; non-preferred fulfillment; counterfeit-prone combos (beauty/fragrance from 3P); grey import / no-India-warranty; bundle mismatch.

### Presentation
Ranked table: Platform | Effective ₹ (your card) | Sticker ₹ | Seller/trust | Delivery date. Header verdict + one footnote for cheaper-but-excluded options.

---

## 4. Deal score (0–100) + de-dup

```
score = depth(0–35) + rarity(0–25) + cross_platform(0–15)
      + offer_quality(0–10) + trust_logistics(0–10) + urgency(0–5) − penalties
```
- **Depth (35):** % below 90-day *effective* median, linear 0%→0, ≥30%→35 (fashion/beauty rescale 50%→35).
- **Rarity (25):** eff ATL=25; 180d low=18; 90d low=12; 30d low=6.
- **Cross-platform (15):** trusted lowest=15; within 2%=10; competitor >5% cheaper=0.
- **Offer quality (10):** full-cap capture=10; partial=4; none=0.
- **Trust/logistics (10):** first-party/assured +4, free ≤3-day delivery +3, ≥7-day returns +3.
- **Urgency (5):** timer/expiry <48h=5; "only N left"=3.
- **Penalties:** fake-MRP −10; mega-sale <14d away & not within 3% of ATL −10; match conf 0.7–0.9 −5.

**Routing:** ≥70 immediate Slack; 55–69 daily 9:00 IST digest; <55 log. Price-error & target-hit bypass.

**De-dup:** fingerprint `hash(product, platform, effective_price rounded ₹50, best_offer_id)` → silent **7 days** unless effective drops further ≥max(3%,₹100), or routing upgrades, or OOS→in-stock. Caps: ≤2 immediate/product/day, ≤8 global/day (highest scores win). One "expiring soon" reminder 6h before expiry for ≥80 scorers.

---

## 5. Gap analysis — what to add beyond the ask

**P0 (v1):** target price per product · pincode-aware pricing & serviceability · delivery cost + date in effective price · fake-discount detection · price-error detection · back-in-stock · offer evidence capture (screenshot/raw text/timestamp) · effective-price history first-class · festival calendar + prediction · buy-now-vs-wait one-liner · scraper-health monitoring.

**P1:** wishlist import + `/track` slash command · on-demand history chart · bank-offer calendar awareness · "best card you don't have" · warranty check (India vs seller/international) · return-policy surface + change detection · open-box/refurb watch · variant-basket watch · review-sentiment/rating-drop alert · GST-invoice pricing.

**P2:** post-purchase price-protection watch · exchange-value optimizer · wallet/points expiry utilization · alternative-product suggestions · household card pooling · CSV/Sheets export · WhatsApp mirror.

**Festival calendar (hardcode):** Republic Day (Jan), summer sales (May), Prime Day (Jul), Big Billion Days / Great Indian Festival (late Sep–Oct), Diwali (Oct–Nov), Nykaa Pink Friday (Nov), Myntra EORS (Jun & Dec–Jan), year-end clearance.

---

## 6. Slack alert anatomy (Block Kit, score ≥70)

Header carries score + product. Shows the **effective-price breakdown** (the math, not just the number). "Why now" = exactly 2–3 LLM-written bullets from structured signals only. Names offer expiry, seller, return window, check timestamp. Buttons: Buy · Compare all · Chart · Snooze 7d · Mute · Set target (write back to config). **Daily digest** 9:00 IST: compact table of 55–69 scorers, max 10 rows.

---

## Build order
- **v0:** URL list + scheduler + sticker history + Slack alerts on signals 1–5 + target price + dedup.
- **v1:** offer scraping + LLM offer parser + card matching + effective price + evidence + fake-MRP/price-error + deal score.
- **v2:** cross-platform matching + festival calendar + buy-vs-wait + digest + P1 gaps.
