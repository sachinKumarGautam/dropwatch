"use client";
import { formatINR } from "@/lib/format";
import type { CompetitorRow } from "@/lib/types";

export function CompetitorTable({
  rows,
  current,
  onDelete,
}: {
  rows: CompetitorRow[];
  current: number | null;
  onDelete?: (id: string) => void;
}) {
  if (rows.length === 0)
    return <div className="empty">No other links yet — add one below, or the weekly sweep will find some.</div>;
  const sorted = [...rows].sort((a, b) => (a.latest_price ?? Infinity) - (b.latest_price ?? Infinity));
  const min = Math.min(...sorted.filter((r) => r.latest_price != null).map((r) => r.latest_price!));
  return (
    <div className="overflow">
      <table>
        <thead>
          <tr><th>Site</th><th className="num">Price</th><th>Source</th><th></th><th></th></tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const cheaper = current != null && r.latest_price != null && r.latest_price < current;
            const isMin = r.latest_price != null && r.latest_price === min;
            return (
              <tr key={r.id}>
                <td>{r.merchant} {isMin && <span className="chip good">lowest</span>}</td>
                <td className="num" style={{ color: cheaper ? "var(--bad)" : undefined }}>{formatINR(r.latest_price)}</td>
                <td><span className="chip">{r.matched_by === "manual" ? "you added" : r.matched_by}</span></td>
                <td><a href={r.url} target="_blank" rel="noreferrer">open ↗</a></td>
                <td>{onDelete && <button className="btn ghost danger" style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => onDelete(r.id)}>✕</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
