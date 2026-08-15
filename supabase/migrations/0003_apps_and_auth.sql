-- Phase 2: collections ("apps"), per-app scrape frequency, alert explainability,
-- and single-owner auth (magic-link email pin) so a public deployment is safe.

-- ── 1. Collections ("apps") ──────────────────────────────────────────────────
create table collections (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null unique,
  check_interval_minutes int  not null default 1440 check (check_interval_minutes >= 30),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ── 2. tracked_products additions ────────────────────────────────────────────
alter table tracked_products
  add column collection_id          uuid references collections(id) on delete cascade,
  add column check_interval_minutes int check (check_interval_minutes >= 30),
  add column last_checked_at        timestamptz,
  add column requested_check_at     timestamptz;

create index idx_tp_collection on tracked_products (collection_id);

update tracked_products p
set last_checked_at = (select max(checked_at) from price_history h where h.product_id = p.id);

-- ── 3. Alert explainability ──────────────────────────────────────────────────
alter table alerts add column context jsonb;
-- shape: { "price": paise, "mrp": paise|null, "median90d": number|null, "samples90d": int }

-- ── 4. Auth + RLS rewrite (single-owner pin) ─────────────────────────────────
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(auth.jwt() ->> 'email', '') = 'sachin@onequince.com' $$;

drop policy if exists products_all on tracked_products;
drop policy if exists cards_all    on credit_cards;
drop policy if exists ph_read      on price_history;
drop policy if exists offers_read  on offers;
drop policy if exists cm_read      on competitor_matches;
drop policy if exists alerts_read  on alerts;

alter table collections enable row level security;

create policy col_owner      on collections        for all    to authenticated using (is_owner()) with check (is_owner());
create policy products_owner on tracked_products   for all    to authenticated using (is_owner()) with check (is_owner());
create policy cards_owner    on credit_cards       for all    to authenticated using (is_owner()) with check (is_owner());
create policy ph_owner       on price_history      for select to authenticated using (is_owner());
create policy offers_owner   on offers             for select to authenticated using (is_owner());
create policy cm_owner       on competitor_matches for select to authenticated using (is_owner());
create policy alerts_owner   on alerts             for select to authenticated using (is_owner());

revoke all on all tables in schema public from anon;
alter view v_product_stats set (security_invoker = on);
grant select on v_product_stats to authenticated;
