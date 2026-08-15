/**
 * schema.pg.test.ts — applies the real SQL migrations to an in-memory Postgres
 * (pglite) and verifies the schema + v_product_stats math (incl. percentile_cont,
 * FILTER windows, stddev_samp, and OOS exclusion).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { percentileCont, stddevSamp } from "./interface.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = resolve(HERE, "..", "..", "..", "..", "supabase", "migrations");

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(resolve(MIG, "0001_init.sql"), "utf8"));
  // Supabase provides these roles + the auth.jwt() helper; stub them so RLS DDL applies.
  await db.exec(`
    do $$ begin
      if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists (select from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create schema if not exists auth;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  `);
  await db.exec(readFileSync(resolve(MIG, "0002_rls.sql"), "utf8"));
  await db.exec(readFileSync(resolve(MIG, "0003_apps_and_auth.sql"), "utf8"));
});

describe("SQL migrations + v_product_stats", () => {
  it("applies cleanly and computes stats matching the TS reference", async () => {
    const prod = await db.query<{ id: string }>(
      `insert into tracked_products (url, canonical_url, platform, title)
       values ('u', 'https://www.amazon.in/dp/B0PGTEST01', 'amazon_in', 'Test')
       returning id`,
    );
    const id = prod.rows[0]!.id;

    // 10 in-stock samples over the last 90 days + 1 OUT-OF-STOCK cheap outlier (excluded)
    const prices = [149900, 145000, 145000, 139900, 142000, 138000, 135000, 141000, 137000, 129900].map(
      (r) => r * 100,
    );
    for (let i = 0; i < prices.length; i++) {
      await db.query(
        `insert into price_history (product_id, checked_at, price, effective_instant, in_stock, source_tier, extract_source)
         values ($1, now() - ($2 || ' days')::interval, $3, $3, true, 1, 'jsonld')`,
        [id, String(i + 1), prices[i]],
      );
    }
    // out-of-stock ₹1,000 outlier — must NOT count toward stats
    await db.query(
      `insert into price_history (product_id, checked_at, price, effective_instant, in_stock, source_tier, extract_source)
       values ($1, now() - interval '1 days', 100000, 100000, false, 1, 'jsonld')`,
      [id],
    );

    const r = await db.query<any>(
      `select * from v_product_stats where product_id = $1`,
      [id],
    );
    const s = r.rows[0]!;

    const sortedAsc = [...prices].sort((a, b) => a - b);
    expect(Number(s.all_time_low)).toBe(Math.min(...prices)); // 129900*100, outlier excluded
    expect(Number(s.low_90d)).toBe(Math.min(...prices));
    expect(Number(s.samples_90d)).toBe(prices.length);
    expect(Number(s.median_90d)).toBeCloseTo(percentileCont(sortedAsc, 0.5)!, 0);
    expect(Number(s.stddev_90d)).toBeCloseTo(stddevSamp(prices)!, 0);
    expect(Number(s.current_price)).toBe(100000); // latest row is the OOS one
    expect(s.in_stock).toBe(false);
  });

  it("phase-2: collections + new product columns + cascade exist", async () => {
    const col = await db.query<{ id: string }>(
      `insert into collections (name, check_interval_minutes) values ('Fridge Search', 360) returning id`,
    );
    const cid = col.rows[0]!.id;
    const prod = await db.query<{ id: string }>(
      `insert into tracked_products (url, canonical_url, platform, collection_id, check_interval_minutes)
       values ('u2','https://www.amazon.in/dp/B0CASCADE0','amazon_in',$1, null) returning id`,
      [cid],
    );
    await db.query(
      `insert into price_history (product_id, price, effective_instant, in_stock, source_tier, extract_source)
       values ($1, 100000, 100000, true, 1, 'jsonld')`,
      [prod.rows[0]!.id],
    );
    // deleting the collection cascades to products and their history
    await db.query(`delete from collections where id = $1`, [cid]);
    const left = await db.query<{ n: number }>(
      `select count(*)::int n from tracked_products where id = $1`,
      [prod.rows[0]!.id],
    );
    expect(left.rows[0]!.n).toBe(0);
  });
});
