"use client";
import { useState } from "react";
import { formatINR } from "@/lib/format";

/**
 * Target picker: "5% / 10% / 15% / 20% down" (computed from a reference price —
 * the add-price, else current price) plus a custom ₹ target. Emits paise, or null.
 */
export function TargetPicker({
  value,
  reference,
  onChange,
}: {
  value: number | null;
  reference: number | null;
  onChange: (paise: number | null) => void;
}) {
  const [custom, setCustom] = useState(value != null ? String(Math.round(value / 100)) : "");
  const pcts = [5, 10, 15, 20];
  const target = (pc: number) => (reference ? Math.round(reference * (1 - pc / 100)) : null);

  return (
    <div className="freqpick">
      <button className={`btn ${value === null ? "primary" : "ghost"}`} onClick={() => { setCustom(""); onChange(null); }}>
        None
      </button>
      {reference != null &&
        pcts.map((pc) => {
          const t = target(pc)!;
          const on = value != null && Math.abs(value - t) <= 100;
          return (
            <button key={pc} className={`btn ${on ? "primary" : "ghost"}`} onClick={() => { setCustom(""); onChange(t); }} title={formatINR(t)}>
              {pc}% ↓ · {formatINR(t)}
            </button>
          );
        })}
      <span className="freq-custom">
        <input
          type="number" placeholder="₹" value={custom} inputMode="numeric"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onChange(custom ? Math.round(Number(custom) * 100) : null); }}
          style={{ width: 96 }}
        />
        <button className="btn ghost" onClick={() => onChange(custom ? Math.round(Number(custom) * 100) : null)}>set ₹</button>
      </span>
    </div>
  );
}
