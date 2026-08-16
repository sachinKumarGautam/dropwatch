"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { AlertExplain } from "@/components/AlertExplain";
import type { AlertRow, ProductRow, CollectionRow } from "@/lib/types";

export default function AlertsPage() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [appOf, setAppOf] = useState<Record<string, string>>({});
  const [urlOf, setUrlOf] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "sent">("all");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const sb = supabase();
      const [a, p, c] = await Promise.all([
        sb.from("alerts").select("*").order("created_at", { ascending: false }).limit(200),
        sb.from("tracked_products").select("id, title, url, collection_id"),
        sb.from("collections").select("id, name"),
      ]);
      if (a.error) throw a.error;
      setRows((a.data as AlertRow[]) ?? []);
      const colName: Record<string, string> = {};
      for (const c2 of (c.data as CollectionRow[]) ?? []) colName[c2.id] = c2.name;
      const map: Record<string, string> = {};
      const urls: Record<string, string> = {};
      for (const pr of (p.data as ProductRow[]) ?? []) {
        map[pr.id] = pr.collection_id ? colName[pr.collection_id] ?? "App" : "Ungrouped";
        urls[pr.id] = pr.url;
      }
      setAppOf(map);
      setUrlOf(urls);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = rows.filter((r) => (filter === "sent" ? r.sent_at : true));

  return (
    <>
      <h1>Alerts</h1>
      <p className="sub">Every evaluation — sent, digested, or suppressed. Tap a row for the full "why".</p>
      <div className="formrow">
        <button className={`btn ${filter === "all" ? "primary" : "ghost"}`} onClick={() => setFilter("all")}>All</button>
        <button className={`btn ${filter === "sent" ? "primary" : "ghost"}`} onClick={() => setFilter("sent")}>Sent only</button>
      </div>

      {err && <div className="banner">{err}</div>}
      {loading ? <div className="empty">Loading…</div> : shown.length === 0 ? (
        <div className="empty">No alerts yet.</div>
      ) : (
        <div className="card">
          {shown.map((a) => <AlertExplain key={a.id} alert={a} appName={appOf[a.product_id]} url={urlOf[a.product_id]} />)}
        </div>
      )}
    </>
  );
}
