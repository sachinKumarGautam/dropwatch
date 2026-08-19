"use client";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine,
} from "recharts";
import { formatINR } from "@/lib/format";
import type { PricePointRow } from "@/lib/types";

export interface AlertMarker {
  ts: number;
  score: number;
  sent: boolean;
}

export function PriceChart({ points, alerts = [] }: { points: PricePointRow[]; alerts?: AlertMarker[] }) {
  const data = points.map((p) => ({
    ts: Date.parse(p.checked_at),
    price: p.price / 100,
    effective: p.effective_instant != null ? p.effective_instant / 100 : null,
  }));
  if (data.length === 0) return <div className="empty">No price history yet.</div>;

  const vals = data.flatMap((d) => [d.price, d.effective]).filter((v): v is number => v != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.25, hi * 0.02, 300);
  const domain: [number, number] = [Math.floor((lo - pad) / 100) * 100, Math.ceil((hi + pad) / 100) * 100];

  const fmtDay = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const fmtFull = (ts: number) => new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#263041" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]}
            stroke="#8b98a9" fontSize={11} minTickGap={50} tickFormatter={fmtDay}
          />
          <YAxis stroke="#8b98a9" fontSize={11} width={66} domain={domain} allowDecimals={false} tickFormatter={(v) => formatINR(v * 100)} />
          <Tooltip
            contentStyle={{ background: "#141922", border: "1px solid #263041", borderRadius: 8, color: "#e6edf3" }}
            labelFormatter={(ts) => fmtFull(ts as number)}
            formatter={(v: number, name: string) => [formatINR(v * 100), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {alerts.map((a, i) => (
            <ReferenceLine
              key={i}
              x={a.ts}
              stroke={a.sent ? "#d29922" : "#556070"}
              strokeDasharray="4 3"
              label={{ value: `⚑${a.score}`, position: "top", fill: a.sent ? "#d29922" : "#8b98a9", fontSize: 10 }}
            />
          ))}
          <Line type="monotone" dataKey="price" name="Sticker" stroke="#5b9dff" dot={{ r: 2 }} strokeWidth={2} />
          <Line type="monotone" dataKey="effective" name="Effective" stroke="#3fb950" dot={{ r: 2 }} strokeWidth={2} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
