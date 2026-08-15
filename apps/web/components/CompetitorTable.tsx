"use client";
import { formatINR } from "@/lib/format";
import type { CompetitorRow } from "@/lib/types";

export function CompetitorTable({ rows, current }: { rows: CompetitorRow[]; current: number | null }) {
  if (rows.length === 0) return <div className="empty">No competitor matches yet — run a sweep.</div>;
  const sorted = [...rows].sort((a, b) => (a.latest_price ?? Infinity) - (b.latest_price ?? Infinity));
  return (
    <div className="overflow">
      <table>
        <thead>
          <tr><th>Merchant</th><th className="num">Price</th><th>Match</th><th>Confidence</th><th></th></tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const cheaper = current != null && r.latest_price != null && r.latest_price < current;
            return (
              <tr key={r.id}>
                <td>{r.merchant}</td>
                <td className="num" style={{ color: cheaper ? "var(--bad)" : undefined }}>{formatINR(r.latest_price)}</td>
                <td><span className="chip">{r.matched_by}</span></td>
                <td className="num">{(r.confidence * 100).toFixed(0)}%</td>
                <td><a href={r.url} target="_blank" rel="noreferrer">open</a></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
