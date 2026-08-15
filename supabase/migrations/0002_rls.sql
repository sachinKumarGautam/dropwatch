-- RLS for the single-user app. The worker uses the service role (bypasses RLS).
-- The UI uses the anon key: full CRUD on products + cards, read-only elsewhere.

alter table tracked_products enable row level security;
alter table credit_cards     enable row level security;
alter table price_history    enable row level security;
alter table offers           enable row level security;
alter table competitor_matches enable row level security;
alter table alerts           enable row level security;
alter table meta             enable row level security;

-- products + cards: anon can read & write (single-user personal tool)
create policy products_all on tracked_products for all to anon using (true) with check (true);
create policy cards_all    on credit_cards    for all to anon using (true) with check (true);

-- read-only for the rest
create policy ph_read      on price_history      for select to anon using (true);
create policy offers_read  on offers             for select to anon using (true);
create policy cm_read      on competitor_matches for select to anon using (true);
create policy alerts_read  on alerts             for select to anon using (true);
-- meta: no anon access (worker/service-role only)
