-- DropWatch schema. Money is integer paise (₹1 = 100). Times are timestamptz (UTC).
-- gen_random_uuid() and md5() are built into Postgres 13+ (Supabase is PG15+).

create table tracked_products (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  canonical_url text not null,
  platform text not null check (platform in ('amazon_in','flipkart','croma','nykaa','samsung_in','other')),
  title text, brand text, model_number text, ean text, image_url text, category text,
  unit_count numeric, unit_label text,
  target_price integer,                       -- paise
  pincode text,
  paused boolean not null default false,
  mute_until timestamptz, snooze_until timestamptz,
  consecutive_failures int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_url)
);

create table credit_cards (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  network text not null check (network in ('visa','mastercard','rupay','amex','diners')),
  kind text not null check (kind in ('credit','debit')),
  product_name text not null,
  cobrand text check (cobrand in ('amazon_in','flipkart')),
  base_online_reward_pct numeric not null default 0,
  emi_eligible boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table price_history (
  id bigint generated always as identity primary key,
  product_id uuid not null references tracked_products(id) on delete cascade,
  checked_at timestamptz not null default now(),
  price integer not null,                     -- paise
  mrp integer,
  in_stock boolean not null default true,
  is_lightning boolean not null default false,
  deal_ends_at timestamptz,
  delivery_fee integer, delivery_eta_days int,
  effective_instant integer,                  -- first-class effective series (paise)
  effective_net integer,
  best_card_id uuid references credit_cards(id) on delete set null,
  best_offer_ids uuid[],
  source_tier smallint not null,
  extract_source text not null,               -- jsonld | embedded_state | dom | llm
  confidence real not null default 1,
  evidence_path text
);
create index idx_ph_product_time on price_history (product_id, checked_at desc);

create table offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references tracked_products(id) on delete cascade,
  platform text not null,
  kind text not null check (kind in ('instant_bank_discount','no_cost_emi','standard_emi','coupon',
    'cashback_wallet','cashback_statement','exchange_bonus','partner_upi','cobrand_reward','gst_invoice')),
  raw_text text not null,
  raw_hash text generated always as (md5(raw_text)) stored,
  issuer text, network text, card_kind text,
  emi_only boolean not null default false,
  value_pct numeric, value_flat integer, cap integer, min_spend integer,
  emi_months int[], coupon_code text, stackable boolean not null default false,
  valid_till timestamptz,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (product_id, raw_hash)
);
create index idx_offers_product on offers (product_id, active);

create table competitor_matches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references tracked_products(id) on delete cascade,
  source text not null default 'google_shopping',
  merchant text not null, url text not null, title text not null,
  matched_by text not null check (matched_by in ('ean','model','llm')),
  confidence real not null,
  latest_price integer, latest_checked_at timestamptz,
  active boolean not null default true,
  unique (product_id, url)
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references tracked_products(id) on delete cascade,
  fingerprint text not null,
  routing text not null check (routing in ('immediate','digest','log')),
  score int not null,
  score_breakdown jsonb not null,
  signals jsonb not null,
  best_effective jsonb not null,
  blocks jsonb,
  suppressed_reason text,
  channel text not null default 'slack',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index idx_alerts_fp on alerts (fingerprint, sent_at desc);
create index idx_alerts_day on alerts (created_at desc);
create index idx_alerts_product on alerts (product_id, created_at desc);

create table meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── Stats view: 3-month-low, median, stddev etc. in one indexed query ──
create or replace view v_product_stats as
with latest as (
  select distinct on (product_id)
         product_id, price, effective_instant, in_stock, checked_at
  from price_history
  order by product_id, checked_at desc
),
valid as (
  select * from price_history where in_stock and price > 0
)
select
  p.id                                                            as product_id,
  p.platform,
  l.price                                                         as current_price,
  l.effective_instant                                            as current_effective,
  l.in_stock,
  l.checked_at                                                    as last_checked_at,
  min(v.price)                                                    as all_time_low,
  min(v.price) filter (where v.checked_at >= now() - interval '180 days') as low_180d,
  min(v.price) filter (where v.checked_at >= now() - interval '90 days')  as low_90d,
  min(v.price) filter (where v.checked_at >= now() - interval '30 days')  as low_30d,
  avg(v.price) filter (where v.checked_at >= now() - interval '30 days')  as avg_30d,
  percentile_cont(0.5) within group (order by v.price)
               filter (where v.checked_at >= now() - interval '90 days')  as median_90d,
  stddev_samp(v.price)
               filter (where v.checked_at >= now() - interval '90 days')  as stddev_90d,
  count(*)     filter (where v.checked_at >= now() - interval '90 days')  as samples_90d,
  min(v.effective_instant)                                       as eff_all_time_low,
  min(v.effective_instant)
               filter (where v.checked_at >= now() - interval '90 days')  as eff_low_90d
from tracked_products p
left join latest l on l.product_id = p.id
left join valid  v on v.product_id = p.id
group by p.id, p.platform, l.price, l.effective_instant, l.in_stock, l.checked_at;
