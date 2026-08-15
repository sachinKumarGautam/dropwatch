"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { timeAgo, PLATFORM_LABEL } from "@/lib/format";
import type { ProductRow, CollectionRow } from "@/lib/types";

export default function ArchivePage() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [colName, setColName] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const sb = supabase();
      const [p, c] = await Promise.all([
        sb.from("tracked_products").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
        sb.from("collections").select("id, name"),
      ]);
      if (p.error) throw p.error;
      setRows((p.data as ProductRow[]) ?? []);
      const m: Record<string, string> = {};
      for (const c2 of (c.data as CollectionRow[]) ?? []) m[c2.id] = c2.name;
      setColName(m);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function restore(id: string) {
    await supabase().from("tracked_products").update({ deleted_at: null }).eq("id", id);
    await load();
  }
  async function purge(id: string) {
    if (!confirm("Delete forever? This removes the URL and its full price history.")) return;
    await supabase().from("tracked_products").delete().eq("id", id);
    await load();
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}><Link href="/">← Apps</Link></div>
      <h1>Trash</h1>
      <p className="sub">Deleted and expired URLs are kept here. Restore them, or delete forever.</p>

      {err && <div className="banner">{err}</div>}
      {loading ? <div className="empty">Loading…</div> : rows.length === 0 ? (
        <div className="empty">Trash is empty.</div>
      ) : (
        <div className="card">
          {rows.map((p) => (
            <div className="row" key={p.id}>
              <div className="grow">
                <div className="title">{p.title ?? p.url}</div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="chip">{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                  <span className="chip">{p.collection_id ? colName[p.collection_id] ?? "app" : "ungrouped"}</span>
                  <span className="chip">deleted {timeAgo(p.deleted_at)}</span>
                </div>
              </div>
              <div className="rowactions">
                <button className="btn ghost" onClick={() => restore(p.id)}>Restore</button>
                <button className="btn ghost danger" onClick={() => purge(p.id)}>Delete forever</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
