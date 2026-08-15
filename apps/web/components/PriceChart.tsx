"use client";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { formatINR } from "@/lib/format";
import type { PricePointRow } from "@/lib/types";

export function PriceChart({ points }: { points: PricePointRow[] }) {
  const data = points.map((p) => ({
    t: new Date(p.checked_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    price: p.price / 100,
    effective: p.effective_instant != null ? p.effective_instant / 100 : null,
    mrp: p.mrp != null ? p.mrp / 100 : null,
  }));
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#263041" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" stroke="#8b98a9" fontSize={11} minTickGap={28} />
          <YAxis stroke="#8b98a9" fontSize={11} width={64} tickFormatter={(v) => formatINR(v * 100)} />
          <Tooltip
            contentStyle={{ background: "#141922", border: "1px solid #263041", borderRadius: 8, color: "#e6edf3" }}
            formatter={(v: number, name: string) => [formatINR(v * 100), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="mrp" name="MRP" stroke="#8b98a9" dot={false} strokeDasharray="4 4" />
          <Line type="monotone" dataKey="price" name="Sticker" stroke="#5b9dff" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="effective" name="Effective" stroke="#3fb950" dot={false} strokeWidth={2} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
