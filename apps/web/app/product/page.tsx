"use client";
import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatINR, timeAgo, pct, PLATFORM_LABEL } from "@/lib/format";
import { PriceChart } from "@/components/PriceChart";
import { OffersTable } from "@/components/OffersTable";
import { CompetitorTable } from "@/components/CompetitorTable";
import { AlertExplain } from "@/components/AlertExplain";
import type { ProductRow, PricePointRow, OfferRow, CardRow, CompetitorRow, StatsRow, AlertRow } from "@/lib/types";

function detectPlatform(url: string): string {
  if (/amazon\.in/i.test(url)) return "amazon_in";
  if (/flipkart\.com/i.test(url)) return "flipkart";
  if (/croma\.com/i.test(url)) return "croma";
  if (/nykaa\.com/i.test(url)) return "nykaa";
  if (/samsung\.com\/in/i.test(url)) return "samsung_in";
  return "other";
}

function ProductInner() {
  const id = useSearchParams().get("id") ?? "";
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [points, setPoints] = useState<PricePointRow[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([]);
  const [stats, setStats] = useState<StatsRow | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) { setErr("No product id."); setLoading(false); return; }
    try {
      const sb = supabase();
      const [p, ph, of, cd, cm, st, al] = await Promise.all([
        sb.from("tracked_products").select("*").eq("id", id).single(),
        sb.from("price_history").select("*").eq("product_id", id).order("checked_at", { ascending: true }).limit(1000),
        sb.from("offers").select("*").eq("product_id", id).eq("active", true),
        sb.from("credit_cards").select("*").eq("active", true),
        sb.from("competitor_matches").select("*").eq("product_id", id).eq("active", true),
        sb.from("v_product_stats").select("*").eq("product_id", id).maybeSingle(),
        sb.from("alerts").select("*").eq("product_id", id).order("created_at", { ascending: false }).limit(20),
      ]);
      if (p.error) throw p.error;
      setProduct(p.data as ProductRow);
      setPoints((ph.data as PricePointRow[]) ?? []);
      setOffers((of.data as OfferRow[]) ?? []);
      setCards((cd.data as CardRow[]) ?? []);
      setCompetitors((cm.data as CompetitorRow[]) ?? []);
      setStats((st.data as StatsRow) ?? null);
      setAlerts((al.data as AlertRow[]) ?? []);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function checkNow() {
    await supabase().from("tracked_products").update({ requested_check_at: new Date().toISOString() }).eq("id", id);
    alert("Queued — checked within a few hours on the next run.");
  }
  async function addCompetitor(compUrl: string) {
    const u = compUrl.trim();
    if (!u) return;
    const platform = detectPlatform(u);
    const { error } = await supabase().from("competitor_matches").insert({
      product_id: id, source: "manual", merchant: PLATFORM_LABEL[platform] ?? "Other",
      url: u.split("?")[0], title: product?.title ?? u, matched_by: "manual", confidence: 1,
    });
    if (error) { alert(/duplicate|unique/i.test(error.message) ? "That link is already attached." : error.message); return; }
    await load();
  }
  async function delCompetitor(cid: string) {
    await supabase().from("competitor_matches").delete().eq("id", cid);
    await load();
  }

  if (loading) return <div className="empty">Loading…</div>;
  if (err) return <div className="banner">{err}</div>;
  if (!product) return <div className="empty">Not found.</div>;
  const cur = stats?.current_effective ?? stats?.current_price ?? null;
  const baseline = product.baseline_price;
  const devBaseline = baseline && baseline > 0 && cur != null ? (baseline - cur) / baseline : null;

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link href={product.collection_id ? `/collection/?id=${product.collection_id}` : "/collection/"}>← Back</Link>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div className="grow" style={{ minWidth: 200 }}>
          <h1>{product.title ?? product.url}</h1>
          <p className="sub">
            <span className="chip">{PLATFORM_LABEL[product.platform] ?? product.platform}</span>{" "}
            <a href={product.url} target="_blank" rel="noreferrer">view on site ↗</a> · checked {timeAgo(product.last_checked_at)}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="price eff num" style={{ fontSize: 26 }}>{formatINR(cur)}</div>
          {devBaseline != null && devBaseline > 0.0001 && (
            <div className="chip good" style={{ marginTop: 4 }}>▼ {pct(devBaseline)} below add-price</div>
          )}
          <div><button className="btn primary" style={{ marginTop: 8 }} onClick={checkNow}>Check now</button></div>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 8 }}>
        <Stat label="Add-price (baseline)" value={formatINR(baseline)} />
        <Stat label="Target" value={product.target_price ? formatINR(product.target_price) : "—"} />
        <Stat label="All-time low" value={formatINR(stats?.all_time_low)} />
        <Stat label="90-day low" value={formatINR(stats?.low_90d)} />
        <Stat label="90-day median" value={formatINR(stats?.median_90d ? Math.round(stats.median_90d) : null)} />
        <Stat label="Samples (90d)" value={String(stats?.samples_90d ?? 0)} />
      </div>
      <p className="sub" style={{ marginTop: 10, fontSize: 12 }}>
        Alerts fire when the effective price is ≥5% below your add-price{product.target_price ? " or reaches your target" : ""} — whichever comes first. (Full upfront price; no-cost-EMI isn't counted as a discount.)
      </p>

      <Section title="Price history">
        <div className="card" style={{ padding: 16 }}><PriceChart points={points} /></div>
      </Section>
      <Section title="Offers · effective for your cards">
        <div className="card" style={{ padding: 4 }}><OffersTable offers={offers} cards={cards} /></div>
      </Section>
      <Section title="Across platforms · same product on other sites">
        <div className="card" style={{ padding: 4 }}>
          <CompetitorTable rows={competitors} current={cur} onDelete={delCompetitor} />
        </div>
        <CompetitorAdd onAdd={addCompetitor} />
        <p className="sub" style={{ fontSize: 12, marginTop: 8 }}>
          Paste the same product on Flipkart / Croma / Samsung etc. DropWatch scrapes each daily and the alert shows the lowest across all of them.
        </p>
      </Section>
      <Section title="Alert history · why each fired">
        <div className="card">
          {alerts.length === 0 ? <div className="empty">No alerts yet.</div> : alerts.map((a) => <AlertExplain key={a.id} alert={a} />)}
        </div>
      </Section>
    </>
  );
}

function CompetitorAdd({ onAdd }: { onAdd: (url: string) => void | Promise<void> }) {
  const [u, setU] = useState("");
  return (
    <div className="formrow" style={{ marginTop: 12, marginBottom: 0 }}>
      <input className="url" placeholder="Paste the same product's link on another site" value={u} onChange={(e) => setU(e.target.value)} />
      <button className="btn primary" disabled={!u.trim()} onClick={async () => { await onAdd(u); setU(""); }}>Add link</button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: "14px 18px" }}>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 13, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  );
}

export default function ProductPage() {
  return (
    <Suspense fallback={<div className="empty">Loading…</div>}>
      <ProductInner />
    </Suspense>
  );
}
