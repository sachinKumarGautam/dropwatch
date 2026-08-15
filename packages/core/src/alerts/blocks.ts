/**
 * alerts/blocks.ts — Slack Block Kit builders for deal / digest / health messages.
 * Blocks are plain JSON so they can be replayed in the /alerts UI feed.
 */
import { formatINR } from "../money.js";
import type { AlertEvent, SlackPayload } from "../types.js";

const WHY_NOW_ORDER = [
  "price_error",
  "target_hit",
  "baseline_drop",
  "eff_all_time_low",
  "all_time_low",
  "low_180d",
  "low_90d",
  "below_median_pct",
  "cross_platform_lowest",
  "coupon_appeared",
  "drop_velocity_24h",
  "drop_velocity_72h",
  "lightning_deal",
  "back_in_stock",
] as const;

function whyNow(ev: AlertEvent): string[] {
  const byKind = new Map(ev.signals.map((s) => [s.kind, s.detail]));
  const picks: string[] = [];
  for (const k of WHY_NOW_ORDER) {
    const d = byKind.get(k);
    if (d) picks.push(d);
    if (picks.length >= 3) break;
  }
  return picks;
}

export function buildDealBlocks(ev: AlertEvent): SlackPayload {
  const b = ev.best;
  const scoreTag = `DEAL ${ev.score.total}/100${ev.score.bypass ? " ⚠︎" : ""}`;
  const devSticker = b.sticker > 0 ? (b.sticker - b.effectiveInstant) / b.sticker : 0;
  const devBaseline =
    ev.baseline && ev.baseline > 0 ? (ev.baseline - b.effectiveInstant) / ev.baseline : null;
  const devParts: string[] = [];
  if (devSticker > 0.001) devParts.push(`▼ ${(devSticker * 100).toFixed(1)}% below list`);
  if (devBaseline != null && devBaseline > 0.001)
    devParts.push(`▼ ${(devBaseline * 100).toFixed(1)}% below your add-price (${formatINR(ev.baseline!)})`);

  const priceLine =
    `*${formatINR(b.effectiveInstant)}* effective` +
    (b.sticker !== b.effectiveInstant ? `  (sticker ${formatINR(b.sticker)})` : "") +
    (devParts.length ? `\n${devParts.join("  ·  ")}` : "") +
    `\n_${b.cardLabel}_ · ${b.explain.join(" · ") || "no offers applied"}`;

  const ranking = ev.ranking
    .slice(0, 3)
    .map(
      (r, i) =>
        `${i + 1}. ${formatINR(r.effectiveInstant)} — ${r.cardLabel} (${r.paymentPath})`,
    )
    .join("\n");

  const contextParts: string[] = [];
  if (ev.bestCardNotHeld)
    contextParts.push(
      `Best card you don't have: ${ev.bestCardNotHeld.cardLabel} → ${formatINR(ev.bestCardNotHeld.effectiveInstant)}`,
    );
  if (ev.festivalNote) contextParts.push(ev.festivalNote);
  contextParts.push(`Checked ${new Date(ev.createdAt).toISOString()}`);

  const why = whyNow(ev);

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `[${scoreTag}] ${ev.productTitle.slice(0, 130)}`, emoji: true },
    },
    { type: "section", text: { type: "mrkdwn", text: priceLine } },
  ];
  if (why.length)
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Why now*\n" + why.map((w) => `• ${w}`).join("\n") },
    });
  if (ranking)
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Effective price by path*\n" + ranking },
    });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: contextParts.join("  ·  ") }],
  });
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", text: { type: "plain_text", text: "Buy" }, url: ev.url, style: "primary" },
      { type: "button", text: { type: "plain_text", text: "Snooze 7d" }, action_id: "snooze", value: ev.productId },
      { type: "button", text: { type: "plain_text", text: "Mute" }, action_id: "mute", value: ev.productId },
      { type: "button", text: { type: "plain_text", text: "Set target" }, action_id: "set_target", value: ev.productId },
      { type: "button", text: { type: "plain_text", text: "Check now" }, action_id: "check_now", value: ev.productId },
    ],
  });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "_Buttons active in v1.1_" }],
  });

  const text = `${ev.productTitle} — ${formatINR(b.effectiveInstant)} (deal ${ev.score.total}/100)`;
  return { blocks, text };
}

export function buildDigestBlocks(evs: AlertEvent[]): SlackPayload {
  const sorted = [...evs].sort((a, b) => b.score.total - a.score.total).slice(0, 10);
  const rows = sorted
    .map(
      (e) =>
        `• *${e.score.total}* · ${formatINR(e.best.effectiveInstant)} · ${e.productTitle.slice(0, 60)} (${e.best.cardLabel})`,
    )
    .join("\n");
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `DropWatch digest — ${sorted.length} deals`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: rows || "_no deals_" } },
    { type: "context", elements: [{ type: "mrkdwn", text: `Generated ${new Date().toISOString()}` }] },
  ];
  return { blocks, text: `DropWatch digest — ${sorted.length} deals` };
}

export function buildHealthBlocks(h: {
  productId: string;
  title: string;
  failures: number;
  lastError: string;
}): SlackPayload {
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: "⚠️ DropWatch scraper health", emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${h.title || h.productId}* has failed ${h.failures} consecutive checks.\nLast error: \`${h.lastError.slice(0, 200)}\``,
      },
    },
  ];
  return { blocks, text: `Scraper health: ${h.title} failing (${h.failures})` };
}
