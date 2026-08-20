/**
 * config.ts — the ONLY module that reads process.env.
 * Everything downstream receives a validated Config object.
 */
import { z } from "zod";

export interface Config {
  dryRun: boolean;
  supabase: { url: string; serviceRoleKey: string } | null;
  firecrawlKey: string | null;
  serpapiKey: string | null;
  scraperapiKey: string | null;
  slackWebhookUrl: string | null;
  slackOpsWebhookUrl: string | null;
  llm: {
    provider: "openai" | "anthropic" | "mock";
    apiKey: string | null;
    extractModel: string;
    reasoningModel: string;
    baseUrl?: string;
  };
  defaultPincode: string | null;
  appUrl: string | null;
  minimalLlm: boolean;
  disableLlmExtract: boolean;
  thresholds: { immediate: number; digest: number };
  caps: { perProductPerDay: number; globalPerDay: number };
  github: { token: string | null; repo: string | null };
}

const bool = (v: string | undefined, dflt = false): boolean => {
  if (v === undefined || v === "") return dflt;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
};

const num = (v: string | undefined, dflt: number): number => {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

const nullable = (v: string | undefined): string | null =>
  v === undefined || v === "" ? null : v;

/**
 * Load and validate config from an env bag (defaults to process.env).
 * In DRY_RUN mode every external key is optional and the LLM provider is forced to 'mock'.
 * Otherwise, missing required keys throw an error naming exactly what's missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dryRun = bool(env.DRY_RUN, false);

  const rawProvider = (env.LLM_PROVIDER ?? "openai").toLowerCase();
  const provider = dryRun
    ? "mock"
    : (["openai", "anthropic", "mock"].includes(rawProvider)
        ? (rawProvider as "openai" | "anthropic" | "mock")
        : "openai");

  const apiKey =
    provider === "anthropic"
      ? nullable(env.ANTHROPIC_API_KEY)
      : nullable(env.OPENAI_API_KEY);

  const extractModel =
    provider === "anthropic"
      ? env.ANTHROPIC_MODEL || "claude-sonnet-5"
      : env.OPENAI_MODEL || "gpt-4o-mini";

  const reasoningModel = nullable(env.LLM_REASONING_MODEL) ?? extractModel;

  const supabaseUrl = nullable(env.SUPABASE_URL);
  const supabaseKey = nullable(env.SUPABASE_SERVICE_ROLE_KEY);

  const cfg: Config = {
    dryRun,
    supabase:
      supabaseUrl && supabaseKey
        ? { url: supabaseUrl, serviceRoleKey: supabaseKey }
        : null,
    firecrawlKey: nullable(env.FIRECRAWL_API_KEY),
    serpapiKey: nullable(env.SERPAPI_KEY) ?? nullable(env.SERPAPI_API_KEY),
    scraperapiKey: nullable(env.SCRAPERAPI_KEY),
    slackWebhookUrl: nullable(env.SLACK_WEBHOOK_URL),
    slackOpsWebhookUrl:
      nullable(env.SLACK_OPS_WEBHOOK_URL) ?? nullable(env.SLACK_WEBHOOK_URL),
    llm: {
      provider,
      apiKey,
      extractModel,
      reasoningModel,
      baseUrl: nullable(env.OPENAI_BASE_URL) ?? undefined,
    },
    defaultPincode: nullable(env.DEFAULT_PINCODE) ?? nullable(env.USER_PINCODE),
    appUrl: (nullable(env.APP_URL) ?? "").replace(/\/$/, "") || null,
    minimalLlm: bool(env.MINIMAL_LLM, true),
    disableLlmExtract: bool(env.DISABLE_LLM_EXTRACT, false),
    thresholds: {
      immediate: num(env.ALERT_THRESHOLD_IMMEDIATE, 70),
      digest: num(env.ALERT_THRESHOLD_DIGEST, 55),
    },
    caps: {
      perProductPerDay: num(env.CAP_PER_PRODUCT_PER_DAY, 2),
      globalPerDay: num(env.CAP_GLOBAL_PER_DAY, 8),
    },
    github: {
      token: nullable(env.GITHUB_DISPATCH_TOKEN) ?? nullable(env.GITHUB_TOKEN),
      repo: nullable(env.GITHUB_REPO),
    },
  };

  if (!dryRun) {
    const missing: string[] = [];
    if (!cfg.supabase) missing.push("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
    if (!cfg.llm.apiKey)
      missing.push(
        provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY",
      );
    if (missing.length > 0) {
      throw new ConfigError(
        `Missing required env for live mode (set DRY_RUN=1 to run without keys): ${missing.join(
          ", ",
        )}`,
      );
    }
  }

  return cfg;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Zod schema kept for documentation / external validation of the raw env bag. */
export const EnvSchema = z.object({
  DRY_RUN: z.string().optional(),
  LLM_PROVIDER: z.enum(["openai", "anthropic", "mock"]).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  LLM_REASONING_MODEL: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  SERPAPI_KEY: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().url().optional(),
});
