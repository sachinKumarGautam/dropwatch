"use client";
import { formatINR } from "@/lib/format";
import type { CardRow, OfferRow } from "@/lib/types";

const KIND_LABEL: Record<string, string> = {
  instant_bank_discount: "Bank instant",
  no_cost_emi: "No-cost EMI",
  standard_emi: "EMI",
  coupon: "Coupon",
  cashback_wallet: "Wallet cashback",
  cashback_statement: "Statement cashback",
  exchange_bonus: "Exchange bonus",
  partner_upi: "UPI",
  cobrand_reward: "Co-brand reward",
  gst_invoice: "GST invoice",
};

function usableByHeld(o: OfferRow, cards: CardRow[]): boolean {
  if (!o.issuer) return o.kind === "coupon" || o.kind === "partner_upi" || o.kind === "no_cost_emi";
  return cards.some((c) => c.active && c.issuer.toLowerCase() === o.issuer!.toLowerCase());
}

export function OffersTable({ offers, cards }: { offers: OfferRow[]; cards: CardRow[] }) {
  if (offers.length === 0) return <div className="empty">No active offers detected.</div>;
  return (
    <div className="overflow">
      <table>
        <thead>
          <tr><th>Type</th><th>Issuer</th><th>Value</th><th className="num">Cap</th><th className="num">Min spend</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const held = usableByHeld(o, cards);
            return (
              <tr key={o.id} style={{ background: held ? "rgba(63,185,80,0.06)" : undefined }}>
                <td>{KIND_LABEL[o.kind] ?? o.kind} {held && <span className="chip good">yours</span>}</td>
                <td>{o.issuer ?? "—"}</td>
                <td className="num">{o.value_pct != null ? `${o.value_pct}%` : o.value_flat != null ? formatINR(o.value_flat) : "—"}</td>
                <td className="num">{o.cap != null ? formatINR(o.cap) : "—"}</td>
                <td className="num">{o.min_spend != null ? formatINR(o.min_spend) : "—"}</td>
                <td style={{ color: "var(--muted)", maxWidth: 320, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={o.raw_text}>
                  {o.coupon_code ? <span className="chip">{o.coupon_code}</span> : null} {o.raw_text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
