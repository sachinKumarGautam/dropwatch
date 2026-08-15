/**
 * alerts/ops.ts — operational (scraper/alert failure) notifications to Slack,
 * with per-day dedupe so a persistently-broken product alerts once, not every run.
 */
import type { Config } from "../config.js";
import type { Db } from "../db/interface.js";
import type { SlackSender } from "./slack.js";
import type { SlackPayload } from "../types.js";

export function istDayKey(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** Fire-and-forget ops message to the ops webhook (falls back to the main one). Never throws. */
export async function sendOps(cfg: Config, text: string, blocks?: unknown[]): Promise<void> {
  const url = cfg.slackOpsWebhookUrl ?? cfg.slackWebhookUrl;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error("[ops] (no webhook)", text);
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...(blocks ? { blocks } : {}) }),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[ops] send failed:", (e as Error).message, "—", text);
  }
}

export interface OpsDeps {
  db: Db;
  slack: SlackSender;
  cfg: Config;
  now(): Date;
}

/**
 * Send a health/ops alert at most once per (key, IST day). Uses the meta table
 * as the dedupe ledger. Never throws.
 */
export async function sendHealthOnce(
  deps: OpsDeps,
  key: string,
  payload: SlackPayload,
): Promise<boolean> {
  const metaKey = `health:${key}:${istDayKey(deps.now())}`;
  try {
    const seen = await deps.db.getMeta(metaKey);
    if (seen) return false;
    await deps.db.setMeta(metaKey, { at: deps.now().toISOString() });
  } catch {
    // if the dedupe ledger is unreachable, still try to alert once
  }
  try {
    await deps.slack.send(payload);
  } catch {
    await sendOps(deps.cfg, payload.text);
  }
  return true;
}
