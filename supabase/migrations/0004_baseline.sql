-- Baseline price = the effective price when a URL was added. Powers the
-- "≥5% below the price when you added it" alert (a bypass, like target_hit).

alter table tracked_products add column baseline_price integer; -- paise

-- Backfill existing products from their earliest recorded effective price.
update tracked_products p
set baseline_price = (
  select coalesce(ph.effective_instant, ph.price)
  from price_history ph
  where ph.product_id = p.id
  order by ph.checked_at asc
  limit 1
)
where baseline_price is null;
