"use client";
import { useState } from "react";
import { FREQ_OPTIONS, freqLabel } from "@/lib/format";

/**
 * Frequency picker: preset chips + a custom "every N minutes" input.
 * value is minutes, or null (= inherit app default) when allowInherit.
 */
export function FrequencyPicker({
  value,
  onChange,
  allowInherit,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
  allowInherit?: boolean;
}) {
  const isPreset = value != null && FREQ_OPTIONS.some((o) => o.minutes === value);
  const [custom, setCustom] = useState(value != null && !isPreset ? String(value) : "");

  return (
    <div className="freqpick">
      {allowInherit && (
        <button className={`btn ${value === null ? "primary" : "ghost"}`} onClick={() => onChange(null)}>
          Inherit
        </button>
      )}
      {FREQ_OPTIONS.map((o) => (
        <button
          key={o.minutes}
          className={`btn ${value === o.minutes ? "primary" : "ghost"}`}
          onClick={() => { setCustom(""); onChange(o.minutes); }}
        >
          {o.label}
        </button>
      ))}
      <span className="freq-custom">
        <input
          type="number" min={30} placeholder="min" value={custom} inputMode="numeric"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && custom) onChange(Math.max(30, Number(custom)));
          }}
          style={{ width: 74 }}
        />
        <button
          className={`btn ${value != null && !isPreset ? "primary" : "ghost"}`}
          disabled={!custom}
          onClick={() => onChange(Math.max(30, Number(custom)))}
        >
          every {custom || "N"}m
        </button>
      </span>
      <span className="chip" style={{ marginLeft: 4 }}>now: {freqLabel(value)}</span>
    </div>
  );
}
