-- Optional demo seed so the UI has something to show before the first real check.
-- Safe to skip. Run after the migrations.

insert into credit_cards (issuer, network, kind, product_name, cobrand, base_online_reward_pct, emi_eligible)
values
  ('HDFC',  'visa', 'credit', 'Millennia',   null,        1, true),
  ('ICICI', 'visa', 'credit', 'Amazon Pay',  'amazon_in', 5, true)
on conflict do nothing;

insert into tracked_products (url, canonical_url, platform, title, brand, model_number, ean, category, target_price, pincode)
values (
  'https://www.amazon.in/dp/B0IPHONE15',
  'https://www.amazon.in/dp/B0IPHONE15',
  'amazon_in',
  'Apple iPhone 15 (128 GB) - Blue',
  'Apple', 'MTP43HN/A', '0195949036194', 'electronics',
  12500000, '560102'
)
on conflict (canonical_url) do nothing;

-- 30 days of flat history at ₹1,45,000 + a fresh ₹1,29,900 low, for one product.
do $$
declare pid uuid;
begin
  select id into pid from tracked_products where canonical_url = 'https://www.amazon.in/dp/B0IPHONE15';
  if pid is not null then
    insert into price_history (product_id, checked_at, price, mrp, in_stock, effective_instant, effective_net, source_tier, extract_source)
    select pid, now() - (g || ' days')::interval, 14500000, 14990000, true, 14500000, 14500000, 1, 'jsonld'
    from generate_series(1, 30) g;
    insert into price_history (product_id, checked_at, price, mrp, in_stock, effective_instant, effective_net, source_tier, extract_source)
    values (pid, now(), 12990000, 14990000, true, 12290000, 12290000, 1, 'jsonld');
  end if;
end $$;
