"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ageDays, freqLabel } from "@/lib/format";
import type { CollectionRow, ProductRow } from "@/lib/types";

export default function AppsHome() {
  const [cols, setCols] = useState<CollectionRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ungrouped, setUngrouped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try {
      const sb = supabase();
      const [c, p] = await Promise.all([
        sb.from("collections").select("*").order("created_at", { ascending: false }),
        sb.from("tracked_products").select("id, collection_id").is("deleted_at", null),
      ]);
      if (c.error) throw c.error;
      if (p.error) throw p.error;
      setCols((c.data as CollectionRow[]) ?? []);
      const cnt: Record<string, number> = {};
      let ung = 0;
      for (const row of (p.data as Pick<ProductRow, "id" | "collection_id">[]) ?? []) {
        if (row.collection_id) cnt[row.collection_id] = (cnt[row.collection_id] ?? 0) + 1;
        else ung++;
      }
      setCounts(cnt); setUngrouped(ung);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createApp() {
    if (!name.trim()) return;
    const { error } = await supabase().from("collections").insert({ name: name.trim(), check_interval_minutes: 1440 });
    if (error) { alert(error.message); return; }
    setName("");
    await load();
  }

  return (
    <>
      <h1>Apps</h1>
      <p className="sub">Group the URLs you're hunting. Delete the whole app once you've bought.</p>

      <div className="formrow">
        <input className="url" placeholder='New app name (e.g. "Fridge Search")' value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createApp()} />
        <button className="btn primary" onClick={createApp} disabled={!name.trim()}>Create app</button>
      </div>

      {err && <div className="banner">{err}</div>}
      {loading ? <div className="empty">Loading…</div> : (
        <div className="card">
          {cols.map((c) => (
            <Link className="row rowlink" key={c.id} href={`/collection/?id=${c.id}`}>
              <div className="grow">
                <div className="title">{c.name}</div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="chip">{counts[c.id] ?? 0} URLs</span>
                  <span className="chip">{freqLabel(c.check_interval_minutes)}</span>
                  <span className="chip">{ageDays(c.created_at)}</span>
                </div>
              </div>
              <span style={{ color: "var(--muted)" }}>›</span>
            </Link>
          ))}
          <Link className="row rowlink" href="/collection/">
            <div className="grow">
              <div className="title">Ungrouped</div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                <span className="chip">{ungrouped} URLs</span> <span className="chip">daily</span>
              </div>
            </div>
            <span style={{ color: "var(--muted)" }}>›</span>
          </Link>
        </div>
      )}
    </>
  );
}
