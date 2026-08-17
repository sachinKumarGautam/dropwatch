"use client";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { formatINR } from "@/lib/format";
import type { PricePointRow } from "@/lib/types";

export function PriceChart({ points }: { points: PricePointRow[] }) {
  const data = points.map((p) => ({
    t: new Date(p.checked_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    ts: p.checked_at,
    price: p.price / 100,
    effective: p.effective_instant != null ? p.effective_instant / 100 : null,
    mrp: p.mrp != null ? p.mrp / 100 : null,
  }));

  if (data.length === 0) return <div className="empty">No price history yet.</div>;

  // Domain hugs the actual sticker/effective range (NOT zero, NOT MRP) so movement is visible.
  const vals = data.flatMap((d) => [d.price, d.effective]).filter((v): v is number => v != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.25, hi * 0.02, 300);
  const domain: [number, number] = [
    Math.floor((lo - pad) / 100) * 100,
    Math.ceil((hi + pad) / 100) * 100,
  ];

  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#263041" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" stroke="#8b98a9" fontSize={11} minTickGap={40} />
          <YAxis
            stroke="#8b98a9"
            fontSize={11}
            width={66}
            domain={domain}
            allowDecimals={false}
            tickFormatter={(v) => formatINR(v * 100)}
          />
          <Tooltip
            contentStyle={{ background: "#141922", border: "1px solid #263041", borderRadius: 8, color: "#e6edf3" }}
            labelFormatter={(_l, p) => {
              const iso = (p?.[0]?.payload as { ts?: string })?.ts;
              return iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
            }}
            formatter={(v: number, name: string) => [formatINR(v * 100), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="price" name="Sticker" stroke="#5b9dff" dot={{ r: 2 }} strokeWidth={2} />
          <Line type="monotone" dataKey="effective" name="Effective" stroke="#3fb950" dot={{ r: 2 }} strokeWidth={2} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
