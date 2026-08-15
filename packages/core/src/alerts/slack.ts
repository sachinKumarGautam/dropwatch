/**
 * alerts/slack.ts — Slack incoming-webhook sender + a capturing mock for tests/DRY_RUN.
 */
import type { SlackPayload } from "../types.js";

export interface SlackSender {
  send(payload: SlackPayload): Promise<void>;
}

export function createSlack(webhookUrl: string): SlackSender {
  return {
    async send(payload: SlackPayload): Promise<void> {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: payload.text, blocks: payload.blocks }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Slack webhook ${res.status}: ${body.slice(0, 200)}`);
      }
    },
  };
}

export interface CapturingSlack extends SlackSender {
  sent: SlackPayload[];
}

export function createCapturingSlack(log = false): CapturingSlack {
  const sent: SlackPayload[] = [];
  return {
    sent,
    async send(payload: SlackPayload): Promise<void> {
      sent.push(payload);
      if (log) {
        // eslint-disable-next-line no-console
        console.log("\n─── SLACK ───\n" + JSON.stringify(payload, null, 2) + "\n");
      }
    },
  };
}
