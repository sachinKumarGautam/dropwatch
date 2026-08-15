"use client";
import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatINR, timeAgo, ageDays, freqLabel, FREQ_OPTIONS, PLATFORM_LABEL } from "@/lib/format";
import type { CollectionRow, ProductRow, StatsRow } from "@/lib/types";

function detectPlatform(url: string): string {
  if (/amazon\.in/i.test(url)) return "amazon_in";
  if (/flipkart\.com/i.test(url)) return "flipkart";
  if (/croma\.com/i.test(url)) return "croma";
  if (/nykaa\.com/i.test(url)) return "nykaa";
  if (/samsung\.com\/in/i.test(url)) return "samsung_in";
  return "other";
}

function CollectionInner() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id"); // null → Ungrouped
  const [col, setCol] = useState<CollectionRow | null>(null);
  const [allCols, setAllCols] = useState<CollectionRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stats, setStats] = useState<Record<string, StatsRow>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState("");

  const load = useCallback(async () => {
    try {
      const sb = supabase();
      const pq = sb.from("tracked_products").select("*").order("created_at", { ascending: false });
      const [pr, st, cs] = await Promise.all([
        id ? pq.eq("collection_id", id) : pq.is("collection_id", null),
        sb.from("v_product_stats").select("*"),
        sb.from("collections").select("*").order("created_at"),
      ]);
      if (pr.error) throw pr.error;
      setProducts((pr.data as ProductRow[]) ?? []);
      const sMap: Record<string, StatsRow> = {};
      for (const s of (st.data as StatsRow[]) ?? []) sMap[s.product_id] = s;
      setStats(sMap);
      setAllCols((cs.data as CollectionRow[]) ?? []);
      setCol(id ? ((cs.data as CollectionRow[]) ?? []).find((c) => c.id === id) ?? null : null);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function addUrl() {
    if (!url.trim()) return;
    const canonical = url.split("?")[0]!;
    const { error } = await supabase().from("tracked_products").insert({
      url: url.trim(), canonical_url: canonical, platform: detectPlatform(url),
      collection_id: id, target_price: target ? Math.round(Number(target) * 100) : null,
    });
    if (error) { alert(error.message); return; }
    setUrl(""); setTarget(""); await load();
  }
  async function delUrl(pid: string) {
    if (!confirm("Delete this URL and its history?")) return;
    await supabase().from("tracked_products").delete().eq("id", pid); await load();
  }
  async function checkNow(pid: string) {
    await supabase().from("tracked_products").update({ requested_check_at: new Date().toISOString() }).eq("id", pid);
    alert("Queued — it will be checked within a few hours on the next run.");
  }
  async function setTargetPrice(p: ProductRow) {
    const v = prompt("Target ₹ (effective). Blank to clear:", p.target_price ? String(p.target_price / 100) : "");
    if (v === null) return;
    await supabase().from("tracked_products").update({ target_price: v ? Math.round(Number(v) * 100) : null }).eq("id", p.id); await load();
  }
  async function overrideFreq(p: ProductRow) {
    const v = prompt("Per-URL check interval in minutes (blank = inherit app):", p.check_interval_minutes ? String(p.check_interval_minutes) : "");
    if (v === null) return;
    await supabase().from("tracked_products").update({ check_interval_minutes: v ? Math.max(30, Number(v)) : null }).eq("id", p.id); await load();
  }
  async function moveTo(pid: string, cid: string) {
    await supabase().from("tracked_products").update({ collection_id: cid || null }).eq("id", pid); await load();
  }
  async function setFrequency(minutes: number) {
    if (!id) return;
    await supabase().from("collections").update({ check_interval_minutes: minutes }).eq("id", id); await load();
  }
  async function rename() {
    if (!col) return;
    const v = prompt("Rename app:", col.name);
    if (!v?.trim()) return;
    await supabase().from("collections").update({ name: v.trim() }).eq("id", col.id); await load();
  }
  async function deleteApp() {
    if (!col) return;
    if (!confirm(`Delete "${col.name}" and ALL ${products.length} URLs in it? This cannot be undone.`)) return;
    await supabase().from("collections").delete().eq("id", col.id);
    router.push("/");
  }

  const title = id ? col?.name ?? "App" : "Ungrouped";

  return (
    <>
      <div style={{ marginBottom: 8 }}><Link href="/">← Apps</Link></div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }} onClick={id ? rename : undefined} title={id ? "tap to rename" : ""}>{title}</h1>
        {id && <button className="btn ghost danger" style={{ marginLeft: "auto" }} onClick={deleteApp}>Delete app</button>}
      </div>

      {id && col && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0 20px" }}>
          <span className="sub" style={{ margin: 0, alignSelf: "center", marginRight: 4 }}>Frequency:</span>
          {FREQ_OPTIONS.map((o) => (
            <button key={o.minutes}
              className={`btn ${col.check_interval_minutes === o.minutes ? "primary" : "ghost"}`}
              onClick={() => setFrequency(o.minutes)}>{o.label}</button>
          ))}
        </div>
      )}

      <div className="formrow">
        <input className="url" placeholder="Paste a product URL to track in this app" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input style={{ width: 120 }} placeholder="Target ₹" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button className="btn primary" onClick={addUrl} disabled={!url.trim()}>Add URL</button>
      </div>

      {err && <div className="banner">{err}</div>}
      {loading ? <div className="empty">Loading…</div> : products.length === 0 ? (
        <div className="empty">No URLs here yet. Paste one above.</div>
      ) : (
        <div className="card">
          {products.map((p) => {
            const s = stats[p.id];
            const cur = s?.current_effective ?? s?.current_price ?? null;
            return (
              <div className="row" key={p.id} style={{ opacity: p.paused ? 0.55 : 1 }}>
                <div className="grow">
                  <div className="title"><Link href={`/product/?id=${p.id}`}>{p.title ?? p.url}</Link></div>
                  <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="chip">{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                    <span className="chip">{ageDays(p.created_at)}</span>
                    {p.check_interval_minutes && <span className="chip">{freqLabel(p.check_interval_minutes)}</span>}
                    {p.consecutive_failures > 0 && <span className="chip bad">{p.consecutive_failures} fails</span>}
                    {p.last_checked_at && <span className="chip">checked {timeAgo(p.last_checked_at)}</span>}
                    {p.target_price && <span className="chip">target {formatINR(p.target_price)}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 96 }}>
                  <div className="price eff num">{formatINR(cur)}</div>
                </div>
                <div className="rowactions">
                  <button className="btn ghost" onClick={() => checkNow(p.id)}>Check</button>
                  <button className="btn ghost" onClick={() => setTargetPrice(p)}>Target</button>
                  <button className="btn ghost" onClick={() => overrideFreq(p)}>Freq</button>
                  {!id && (
                    <select defaultValue="" onChange={(e) => moveTo(p.id, e.target.value)} style={{ fontSize: 12, padding: "5px 8px" }}>
                      <option value="" disabled>Move to…</option>
                      {allCols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  <button className="btn ghost danger" onClick={() => delUrl(p.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function CollectionPage() {
  return (
    <Suspense fallback={<div className="empty">Loading…</div>}>
      <CollectionInner />
    </Suspense>
  );
}
