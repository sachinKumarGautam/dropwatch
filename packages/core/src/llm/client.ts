/**
 * llm/client.ts — provider-agnostic JSON LLM client.
 *
 * Model IDs come ONLY from Config (env). Never hardcode a model id here.
 * jsonCall validates the response against a zod schema and retries once on failure.
 */
import { z } from "zod";
import type { Config } from "../config.js";

export type LlmModelTier = "extract" | "reasoning";
export type LlmTask = "extract" | "offers" | "match" | "reason";

export interface LlmCallOpts<T> {
  model: LlmModelTier;
  task: LlmTask;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface LlmResult<T> {
  data: T;
  raw: string;
  usage: { in: number; out: number };
}

export interface LlmClient {
  jsonCall<T>(opts: LlmCallOpts<T>): Promise<LlmResult<T>>;
}

const approxTokens = (s: string): number => Math.ceil(s.length / 4);

function extractJson(raw: string): string {
  // Tolerate ```json fences and leading/trailing prose.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) return fence[1].trim();
  const first = raw.indexOf("{");
  const firstArr = raw.indexOf("[");
  const start =
    first === -1
      ? firstArr
      : firstArr === -1
        ? first
        : Math.min(first, firstArr);
  if (start === -1) return raw.trim();
  const lastObj = raw.lastIndexOf("}");
  const lastArr = raw.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  return end === -1 ? raw.slice(start).trim() : raw.slice(start, end + 1).trim();
}

function parseWithSchema<T>(raw: string, schema: z.ZodType<T>): T {
  const json = JSON.parse(extractJson(raw));
  return schema.parse(json);
}

// ─────────────────────────────── OpenAI ────────────────────────────────────

function createOpenAiLlm(cfg: Config): LlmClient {
  const apiKey = cfg.llm.apiKey!;
  const baseUrl = cfg.llm.baseUrl ?? "https://api.openai.com/v1";
  const modelFor = (t: LlmModelTier) =>
    t === "reasoning" ? cfg.llm.reasoningModel : cfg.llm.extractModel;

  async function call(
    model: string,
    system: string,
    user: string,
    maxTokens: number,
  ): Promise<{ text: string; usage: { in: number; out: number } }> {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 400)}`);
    }
    const data: any = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    const usage = {
      in: data?.usage?.prompt_tokens ?? approxTokens(system + user),
      out: data?.usage?.completion_tokens ?? approxTokens(text),
    };
    return { text, usage };
  }

  return {
    async jsonCall<T>(opts: LlmCallOpts<T>): Promise<LlmResult<T>> {
      const model = modelFor(opts.model);
      const maxTokens = opts.maxTokens ?? 1200;
      const { text, usage } = await call(
        model,
        opts.system,
        opts.user,
        maxTokens,
      );
      try {
        return { data: parseWithSchema(text, opts.schema), raw: text, usage };
      } catch (e) {
        // One retry with the validation error appended.
        const retryUser = `${opts.user}\n\nYour previous response failed validation: ${
          (e as Error).message
        }\nReturn ONLY valid JSON matching the required shape.`;
        const retry = await call(model, opts.system, retryUser, maxTokens);
        return {
          data: parseWithSchema(retry.text, opts.schema),
          raw: retry.text,
          usage: {
            in: usage.in + retry.usage.in,
            out: usage.out + retry.usage.out,
          },
        };
      }
    },
  };
}

// ─────────────────────────────── Anthropic ─────────────────────────────────

function createAnthropicLlm(cfg: Config): LlmClient {
  const apiKey = cfg.llm.apiKey!;
  const modelFor = (t: LlmModelTier) =>
    t === "reasoning" ? cfg.llm.reasoningModel : cfg.llm.extractModel;

  async function call(
    model: string,
    system: string,
    user: string,
    maxTokens: number,
  ): Promise<{ text: string; usage: { in: number; out: number } }> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system: `${system}\nRespond with ONLY a single JSON value, no prose.`,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 400)}`);
    }
    const data: any = await res.json();
    const text: string = data?.content?.[0]?.text ?? "";
    const usage = {
      in: data?.usage?.input_tokens ?? approxTokens(system + user),
      out: data?.usage?.output_tokens ?? approxTokens(text),
    };
    return { text, usage };
  }

  return {
    async jsonCall<T>(opts: LlmCallOpts<T>): Promise<LlmResult<T>> {
      const model = modelFor(opts.model);
      const maxTokens = opts.maxTokens ?? 1200;
      const { text, usage } = await call(
        model,
        opts.system,
        opts.user,
        maxTokens,
      );
      try {
        return { data: parseWithSchema(text, opts.schema), raw: text, usage };
      } catch (e) {
        const retryUser = `${opts.user}\n\nYour previous response failed validation: ${
          (e as Error).message
        }\nReturn ONLY valid JSON.`;
        const retry = await call(model, opts.system, retryUser, maxTokens);
        return {
          data: parseWithSchema(retry.text, opts.schema),
          raw: retry.text,
          usage: {
            in: usage.in + retry.usage.in,
            out: usage.out + retry.usage.out,
          },
        };
      }
    },
  };
}

// ─────────────────────────────── Mock ──────────────────────────────────────

export type MockResponder = (opts: {
  model: LlmModelTier;
  task: LlmTask;
  system: string;
  user: string;
}) => unknown;

/**
 * Mock LLM for DRY_RUN and tests. Pass a responder to control output.
 * Default responder returns safe empties so the pipeline never blocks:
 *  - task 'offers' → []   (no extra offers beyond regex)
 *  - task 'match'  → []
 *  - task 'reason' → { text: "" }
 *  - task 'extract'→ throws (extraction should come from Tier-0 in DRY_RUN;
 *                    tests that exercise llmExtract must inject a responder)
 */
export function createMockLlm(responder?: MockResponder): LlmClient {
  const respond: MockResponder =
    responder ??
    ((o) => {
      switch (o.task) {
        case "offers":
        case "match":
          return [];
        case "reason":
          return { text: "" };
        default:
          throw new Error(
            `MockLlm: no responder registered for task='${o.task}'. Inject one in the test.`,
          );
      }
    });

  return {
    async jsonCall<T>(opts: LlmCallOpts<T>): Promise<LlmResult<T>> {
      const data = respond({
        model: opts.model,
        task: opts.task,
        system: opts.system,
        user: opts.user,
      });
      const raw = JSON.stringify(data);
      return {
        data: opts.schema.parse(data),
        raw,
        usage: { in: approxTokens(opts.system + opts.user), out: approxTokens(raw) },
      };
    },
  };
}

export function createLlm(cfg: Config): LlmClient {
  switch (cfg.llm.provider) {
    case "openai":
      return createOpenAiLlm(cfg);
    case "anthropic":
      return createAnthropicLlm(cfg);
    case "mock":
      return createMockLlm();
  }
}
