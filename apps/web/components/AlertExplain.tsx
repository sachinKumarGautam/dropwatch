"use client";
import { useState } from "react";
import { formatINR, timeAgo, pct, scoreColor } from "@/lib/format";
import type { AlertRow } from "@/lib/types";

export function AlertExplain({ alert: a, appName }: { alert: AlertRow; appName?: string }) {
  const [open, setOpen] = useState(false);
  const ctx = a.context;
  const be = a.best_effective;
  const sb = a.score_breakdown;
  const discount = ctx?.mrp && ctx.mrp > ctx.price ? (ctx.mrp - ctx.price) / ctx.mrp : null;
  const eff = be?.effectiveInstant ?? ctx?.effective ?? null;
  const baseline = ctx?.baseline ?? null;
  const devBaseline = baseline && baseline > 0 && eff != null ? (baseline - eff) / baseline : null;

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="row" style={{ borderBottom: "none", cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <div className="scoredot" style={{ background: scoreColor(a.score) }}>{a.score}</div>
        <div className="grow">
          <div className="title">
            {formatINR(be?.effectiveInstant)} · {be?.cardLabel ?? "—"}
            {appName && <span className="chip" style={{ marginLeft: 8 }}>{appName}</span>}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
            {(a.signals ?? []).slice(0, 2).map((s) => s.detail).join(" · ") || "—"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className={`chip ${a.sent_at ? "good" : a.suppressed_reason ? "warn" : ""}`}>
            {a.sent_at ? "sent" : a.suppressed_reason ?? a.routing}
          </span>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{timeAgo(a.created_at)} {open ? "▲" : "▼"}</div>
        </div>
      </div>

      {open && (
        <div style={{ padding: "4px 18px 18px", display: "grid", gap: 14 }}>
          <div className="explain-grid">
            <Field label="Scraped price" value={formatINR(ctx?.price)} />
            <Field label="Original (MRP)" value={ctx?.mrp != null ? formatINR(ctx.mrp) : "—"} sub={discount != null ? `${pct(discount, 0)} off` : undefined} />
            <Field label="Effective (your card)" value={formatINR(be?.effectiveInstant)} good sub={be?.cardLabel} />
            <Field label="90-day median" value={ctx?.median90d != null ? formatINR(Math.round(ctx.median90d)) : "—"} sub={ctx ? `${ctx.samples90d} samples` : undefined} />
            {baseline != null && (
              <Field
                label="vs add-price"
                value={formatINR(baseline)}
                good={devBaseline != null && devBaseline > 0}
                sub={devBaseline != null && devBaseline > 0.0001 ? `▼ ${pct(devBaseline)} below` : "no change yet"}
              />
            )}
          </div>

          {be?.explain && be.explain.length > 0 && (
            <div>
              <div className="explain-h">How the effective price was reached</div>
              <div className="num" style={{ fontSize: 13, color: "var(--muted)" }}>{be.explain.join("  ·  ")}</div>
            </div>
          )}

          <div>
            <div className="explain-h">Why it triggered</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text)" }}>
              {(a.signals ?? []).map((s, i) => (
                <li key={i} style={{ marginBottom: 2 }}>{s.detail} <span style={{ color: "var(--muted)", fontSize: 11 }}>({s.kind})</span></li>
              ))}
              {(a.signals ?? []).length === 0 && <li style={{ color: "var(--muted)" }}>—</li>}
            </ul>
          </div>

          {sb && (
            <div>
              <div className="explain-h">Score breakdown</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  ["depth", sb.depth, 35], ["rarity", sb.rarity, 25], ["cross-platform", sb.crossPlatform, 15],
                  ["offer", sb.offerQuality, 10], ["trust", sb.trustLogistics, 10], ["urgency", sb.urgency, 5],
                ].map(([label, val, max]) => (
                  <div key={label as string} className="chip" title={`${val} / ${max}`}>{label}: <b style={{ color: "var(--text)" }}>{val as number}</b>/{max}</div>
                ))}
              </div>
            </div>
          )}

          {ctx?.competitors && ctx.competitors.length > 0 && (
            <div>
              <div className="explain-h">Across other sites</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ctx.competitors.map((c, i) => (
                  <span key={i} className="chip">{c.merchant}: <b style={{ color: "var(--text)" }}>{c.price != null ? formatINR(c.price) : "—"}</b></span>
                ))}
              </div>
            </div>
          )}

          {a.suppressed_reason && (
            <div style={{ color: "var(--warn)", fontSize: 12 }}>Not sent to Slack — reason: {a.suppressed_reason}</div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
      <div className="num" style={{ fontSize: 17, fontWeight: 700, color: good ? "var(--good)" : "var(--text)" }}>{value}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 11 }}>{sub}</div>}
    </div>
  );
}
