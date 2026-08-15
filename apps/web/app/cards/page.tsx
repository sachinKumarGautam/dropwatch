"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase, hasSupabaseEnv } from "@/lib/supabase";
import type { CardRow } from "@/lib/types";

const EMPTY = {
  issuer: "HDFC", network: "visa", kind: "credit",
  product_name: "", cobrand: "", base_online_reward_pct: "1", emi_eligible: true,
};

export default function CardsPage() {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!hasSupabaseEnv()) { setErr("Supabase env not set."); setLoading(false); return; }
    try {
      const { data, error } = await supabase().from("credit_cards").select("*").order("issuer");
      if (error) throw error;
      setCards((data as CardRow[]) ?? []);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!form.product_name.trim()) { alert("Give the card a name (e.g. Millennia)"); return; }
    const { error } = await supabase().from("credit_cards").insert({
      issuer: form.issuer,
      network: form.network,
      kind: form.kind,
      product_name: form.product_name.trim(),
      cobrand: form.cobrand || null,
      base_online_reward_pct: Number(form.base_online_reward_pct) || 0,
      emi_eligible: form.emi_eligible,
      active: true,
    });
    if (error) { alert(error.message); return; }
    setForm({ ...EMPTY });
    await load();
  }
  async function del(id: string) {
    await supabase().from("credit_cards").delete().eq("id", id);
    await load();
  }

  return (
    <>
      <h1>Your cards</h1>
      <p className="sub">Offers are matched to these, and effective prices computed for your wallet.</p>

      <div className="card" style={{ padding: 16, marginBottom: 22 }}>
        <div className="formrow" style={{ marginBottom: 0 }}>
          <select value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })}>
            {["HDFC","ICICI","Axis","SBI","Kotak","Amex","IDFC","RBL","IndusInd","Yes","AU","HSBC","OneCard"].map((x) => <option key={x}>{x}</option>)}
          </select>
          <input placeholder="Card name (e.g. Millennia)" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="credit">Credit</option><option value="debit">Debit</option>
          </select>
          <select value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })}>
            {["visa","mastercard","rupay","amex","diners"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={form.cobrand} onChange={(e) => setForm({ ...form, cobrand: e.target.value })}>
            <option value="">No co-brand</option>
            <option value="amazon_in">Amazon co-brand</option>
            <option value="flipkart">Flipkart co-brand</option>
          </select>
          <input style={{ width: 110 }} placeholder="Reward %" value={form.base_online_reward_pct} onChange={(e) => setForm({ ...form, base_online_reward_pct: e.target.value })} />
          <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--muted)" }}>
            <input type="checkbox" checked={form.emi_eligible} onChange={(e) => setForm({ ...form, emi_eligible: e.target.checked })} style={{ width: "auto" }} /> EMI
          </label>
          <button className="btn primary" onClick={add}>Add card</button>
        </div>
      </div>

      {err && <div className="banner">{err}</div>}
      {loading ? <div className="empty">Loading…</div> : cards.length === 0 ? (
        <div className="empty">No cards yet. Add the cards you actually own for accurate effective pricing.</div>
      ) : (
        <div className="card">
          {cards.map((c) => (
            <div className="row" key={c.id}>
              <div className="grow">
                <div className="title">{c.issuer} {c.product_name} <span className="chip">{c.kind}</span> <span className="chip">{c.network}</span></div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                  {c.cobrand ? `Co-brand: ${c.cobrand} · ` : ""}{c.base_online_reward_pct}% base reward{c.emi_eligible ? " · EMI-eligible" : ""}
                </div>
              </div>
              <button className="btn ghost danger" onClick={() => del(c.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
