"use client";
import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatINR, timeAgo, ageDays, freqLabel, PLATFORM_LABEL } from "@/lib/format";
import { FrequencyPicker } from "@/components/FrequencyPicker";
import { TargetPicker } from "@/components/TargetPicker";
import { Sparkline } from "@/components/Sparkline";
import type { CollectionRow, ProductRow, StatsRow } from "@/lib/types";

function detectPlatform(url: string): string {
  if (/amazon\.in/i.test(url)) return "amazon_in";
  if (/flipkart\.com/i.test(url)) return "flipkart";
  if (/croma\.com/i.test(url)) return "croma";
  if (/nykaa\.com/i.test(url)) return "nykaa";
  if (/samsung\.com\/in/i.test(url)) return "samsung_in";
  return "other";
}
const dateVal = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const toEndIso = (d: string) => (d ? new Date(d + "T23:59:59+05:30").toISOString() : null);
const daysLeft = (iso: string | null) => (iso ? Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000) : null);

function CollectionInner() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const [col, setCol] = useState<CollectionRow | null>(null);
  const [allCols, setAllCols] = useState<CollectionRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stats, setStats] = useState<Record<string, StatsRow>>({});
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const sb = supabase();
      const pq = sb.from("tracked_products").select("*").is("deleted_at", null).order("created_at", { ascending: false });
      const [pr, st, cs] = await Promise.all([
        id ? pq.eq("collection_id", id) : pq.is("collection_id", null),
        sb.from("v_product_stats").select("*"),
        sb.from("collections").select("*").order("created_at"),
      ]);
      if (pr.error) throw pr.error;
      const prods = (pr.data as ProductRow[]) ?? [];
      setProducts(prods);
      const sMap: Record<string, StatsRow> = {};
      for (const s of (st.data as StatsRow[]) ?? []) sMap[s.product_id] = s;
      setStats(sMap);
      setAllCols((cs.data as CollectionRow[]) ?? []);
      setCol(id ? ((cs.data as CollectionRow[]) ?? []).find((c) => c.id === id) ?? null : null);

      const ids = prods.map((p) => p.id);
      if (ids.length) {
        const hist = await sb
          .from("price_history")
          .select("product_id, price, effective_instant, checked_at")
          .in("product_id", ids)
          .order("checked_at", { ascending: true })
          .limit(3000);
        const spMap: Record<string, number[]> = {};
        for (const row of (hist.data as { product_id: string; price: number; effective_instant: number | null }[]) ?? [])
          (spMap[row.product_id] ??= []).push(row.effective_instant ?? row.price);
        setSpark(spMap);
      } else setSpark({});
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const appInterval = col?.check_interval_minutes ?? 1440;
  const effInterval = (p: ProductRow) => p.check_interval_minutes ?? (id ? appInterval : 1440);

  async function addUrl() {
    if (!url.trim()) return;
    const sb = supabase();
    const canonical = (url.split("?")[0] ?? url).trim();
    const targetPaise = target ? Math.round(Number(target) * 100) : null;
    // duplicate check (includes trashed rows — the unique index covers them)
    const existing = (await sb.from("tracked_products").select("id, deleted_at, collection_id, title").eq("canonical_url", canonical)).data as
      | { id: string; deleted_at: string | null; collection_id: string | null }[] | null;
    const dup = existing?.[0];
    if (dup && !dup.deleted_at) {
      alert("You're already tracking this URL" + (dup.collection_id === id ? " in this app." : " (in another app)."));
      return;
    }
    if (dup && dup.deleted_at) {
      if (!confirm("This URL is in Trash. Restore it here?")) return;
      await sb.from("tracked_products").update({ deleted_at: null, collection_id: id, target_price: targetPaise }).eq("id", dup.id);
      setUrl(""); setTarget(""); await load();
      return;
    }
    const { error } = await sb.from("tracked_products").insert({
      url: url.trim(), canonical_url: canonical, platform: detectPlatform(url),
      collection_id: id, target_price: targetPaise,
    });
    if (error) { alert(/duplicate|unique/i.test(error.message) ? "You're already tracking this URL." : error.message); return; }
    setUrl(""); setTarget(""); await load();
  }
  async function patch(pid: string, p: Record<string, unknown>) {
    const { error } = await supabase().from("tracked_products").update(p).eq("id", pid);
    if (error) alert(error.message);
    await load();
  }
  async function softDelete(pid: string) {
    if (!confirm("Move this URL to Trash? (You can restore it from Archive.)")) return;
    await patch(pid, { deleted_at: new Date().toISOString() });
  }
  async function checkNow(pid: string) {
    await patch(pid, { requested_check_at: new Date().toISOString() });
    alert("Queued — checked within a few hours on the next run.");
  }
  async function setAppFreq(minutes: number | null) {
    if (!id) return;
    await supabase().from("collections").update({ check_interval_minutes: minutes ?? 1440 }).eq("id", id);
    await load();
  }
  async function setAppEnd(d: string) {
    if (!id) return;
    await supabase().from("collections").update({ expires_at: toEndIso(d) }).eq("id", id);
    await load();
  }
  async function rename() {
    if (!col) return;
    const v = prompt("Rename app:", col.name);
    if (!v?.trim()) return;
    await supabase().from("collections").update({ name: v.trim() }).eq("id", col.id);
    await load();
  }
  async function deleteApp() {
    if (!col) return;
    if (!confirm(`Delete app "${col.name}"? Its ${products.length} URLs move to Trash (restorable).`)) return;
    await supabase().from("tracked_products").update({ deleted_at: new Date().toISOString() }).eq("collection_id", col.id);
    await supabase().from("collections").delete().eq("id", col.id);
    router.push("/");
  }

  const title = id ? col?.name ?? "App" : "Ungrouped";

  return (
    <>
      <div style={{ marginBottom: 8 }}><Link href="/">← Apps</Link> · <Link href="/archive">Trash</Link></div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, cursor: id ? "pointer" : "default" }} onClick={id ? rename : undefined} title={id ? "tap to rename" : ""}>{title}</h1>
        {id && <button className="btn ghost danger" style={{ marginLeft: "auto" }} onClick={deleteApp}>Delete app</button>}
      </div>

      {id && col && (
        <div className="card" style={{ padding: 14, margin: "14px 0 20px" }}>
          <div className="settingrow">
            <span className="settinglabel">Check frequency</span>
            <FrequencyPicker value={col.check_interval_minutes} onChange={setAppFreq} />
          </div>
          <div className="settingrow">
            <span className="settinglabel">End date (auto-move to Trash)</span>
            <input type="date" value={dateVal(col.expires_at)} onChange={(e) => setAppEnd(e.target.value)} />
            {col.expires_at && <span className="chip warn">{daysLeft(col.expires_at)}d left</span>}
            {col.expires_at && <button className="btn ghost" onClick={() => setAppEnd("")}>clear</button>}
          </div>
        </div>
      )}

      <div className="formrow">
        <input className="url" placeholder="Paste a product URL to track in this app" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input style={{ width: 110 }} placeholder="Target ₹" value={target} onChange={(e) => setTarget(e.target.value)} />
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
            const open = editing === p.id;
            const isSearch = /\/s\?|\/s\/|[?&]k=/.test(p.url);
            return (
              <div key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="row" style={{ borderBottom: "none" }}>
                  <div className="grow">
                    <div className="title"><Link href={`/product/?id=${p.id}`}>{p.title ?? p.url}</Link></div>
                    <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="chip">{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                      <span className="chip">{ageDays(p.created_at)}</span>
                      <span className="chip">⏱ {freqLabel(effInterval(p))}{p.check_interval_minutes ? "" : " (app)"}</span>
                      {p.expires_at && <span className="chip warn">ends in {daysLeft(p.expires_at)}d</span>}
                      {isSearch && <span className="chip bad">search page — use a product URL</span>}
                      {p.consecutive_failures > 0 && <span className="chip bad">{p.consecutive_failures} fails</span>}
                      {p.last_checked_at && <span className="chip">checked {timeAgo(p.last_checked_at)}</span>}
                      {p.target_price && <span className="chip">target {formatINR(p.target_price)}</span>}
                    </div>
                  </div>
                  {(spark[p.id]?.length ?? 0) >= 2 && (
                    <Link href={`/product/?id=${p.id}`} title="Open full price chart" style={{ opacity: p.paused ? 0.5 : 1 }}>
                      <Sparkline values={(spark[p.id] ?? []).slice(-40)} width={100} height={30} />
                    </Link>
                  )}
                  <div style={{ textAlign: "right", minWidth: 90 }}><div className="price eff num">{formatINR(cur)}</div></div>
                  <div className="rowactions">
                    <button className="btn ghost" onClick={() => checkNow(p.id)}>Check</button>
                    <button className="btn ghost" onClick={() => setEditing(open ? null : p.id)}>{open ? "Close" : "Edit"}</button>
                    <button className="btn ghost danger" onClick={() => softDelete(p.id)}>Delete</button>
                  </div>
                </div>
                {open && (
                  <div style={{ padding: "0 18px 16px", display: "grid", gap: 12 }}>
                    <div className="settingrow">
                      <span className="settinglabel">Frequency</span>
                      <FrequencyPicker value={p.check_interval_minutes} allowInherit onChange={(m) => patch(p.id, { check_interval_minutes: m })} />
                    </div>
                    <div className="settingrow">
                      <span className="settinglabel">End date</span>
                      <input type="date" value={dateVal(p.expires_at)} onChange={(e) => patch(p.id, { expires_at: toEndIso(e.target.value) })} />
                      {p.expires_at && <button className="btn ghost" onClick={() => patch(p.id, { expires_at: null })}>clear</button>}
                    </div>
                    <div className="settingrow">
                      <span className="settinglabel">Target</span>
                      <TargetPicker
                        value={p.target_price}
                        reference={p.baseline_price ?? s?.current_effective ?? s?.current_price ?? null}
                        onChange={(paise) => patch(p.id, { target_price: paise })}
                      />
                    </div>
                    {!id && (
                      <div className="settingrow">
                        <span className="settinglabel">Move to app</span>
                        <select defaultValue="" onChange={(e) => patch(p.id, { collection_id: e.target.value || null })}>
                          <option value="" disabled>Choose…</option>
                          {allCols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function CollectionPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><CollectionInner /></Suspense>;
}
