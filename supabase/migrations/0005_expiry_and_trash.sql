-- Soft-delete (trash) + auto-expiry (end date) for products and apps.

alter table tracked_products add column deleted_at timestamptz;  -- null = active; set = in Trash
alter table tracked_products add column expires_at timestamptz;  -- auto-move to Trash after this
alter table collections     add column expires_at timestamptz;  -- app-level end date

-- Deleting an app must NOT destroy its products (they go to Trash instead), so the
-- cascade becomes SET NULL. The worker/UI soft-delete products before removing the app.
alter table tracked_products drop constraint if exists tracked_products_collection_id_fkey;
alter table tracked_products
  add constraint tracked_products_collection_id_fkey
  foreign key (collection_id) references collections(id) on delete set null;

create index if not exists idx_tp_active on tracked_products (deleted_at) where deleted_at is null;
