/**
 * offers/parse.ts — deterministic Indian offer-string parser (regex-first),
 * with an LLM fallback for strings the regex layer can't classify.
 * See docs/blueprint.md §7 for the reference corpus.
 */
import { z } from "zod";
import type { LlmClient } from "../llm/client.js";
import type {
  Network,
  Offer,
  OfferKind,
  Paise,
  ParsedOffer,
  Platform,
  RawOffer,
} from "../types.js";

export interface OfferParseCtx {
  productId: string;
  platform: Platform;
}

const ISSUERS: Array<{ re: RegExp; issuer: string; network?: Network }> = [
  { re: /\bhdfc\b/i, issuer: "HDFC" },
  { re: /\bicici\b/i, issuer: "ICICI" },
  { re: /\baxis\b/i, issuer: "Axis" },
  { re: /\bsbi\b|state bank/i, issuer: "SBI" },
  { re: /\bkotak\b/i, issuer: "Kotak" },
  { re: /american express|\bamex\b/i, issuer: "Amex", network: "amex" },
  { re: /\brbl\b/i, issuer: "RBL" },
  { re: /\bidfc\b/i, issuer: "IDFC" },
  { re: /indusind/i, issuer: "IndusInd" },
  { re: /\byes bank\b/i, issuer: "Yes" },
  { re: /\bau (small finance|bank)\b/i, issuer: "AU" },
  { re: /\bhsbc\b/i, issuer: "HSBC" },
  { re: /federal bank/i, issuer: "Federal" },
  { re: /bank of baroda|\bbob\b/i, issuer: "BOB" },
  { re: /standard chartered/i, issuer: "StanChart" },
  { re: /onecard/i, issuer: "OneCard" },
];

const COBRANDS: RegExp[] = [
  /flipkart axis/i,
  /amazon pay icici/i,
  /tata neu/i,
  /swiggy hdfc/i,
  /myntra kotak/i,
  /airtel axis/i,
  /sbi cashback/i,
];

const UPI_WALLETS = /\b(upi|paytm|phonepe|gpay|google pay|mobikwik|cred|amazon pay balance)\b/i;

const amount = (s: string): Paise => Math.round(parseInt(s.replace(/,/g, ""), 10) * 100);

function findMoney(re: RegExp, text: string): Paise | null {
  const m = text.match(re);
  return m && m[1] ? amount(m[1]) : null;
}

function detectIssuer(text: string): { issuer: string | null; network: Network | null } {
  for (const e of ISSUERS) {
    if (e.re.test(text)) return { issuer: e.issuer, network: e.network ?? null };
  }
  return { issuer: null, network: null };
}

function detectCardKind(text: string): "credit" | "debit" | "any" | null {
  if (/debit card/i.test(text)) return "debit";
  if (/credit card/i.test(text)) return "credit";
  if (/\bcard\b/i.test(text)) return "any";
  return null;
}

const CAP_RE = /up\s*to\s*(?:₹|rs\.?)\s*([\d,]+)/i;
const PCT_RE = /(\d+(?:\.\d+)?)\s*%/;
const MIN_RE =
  /(?:min(?:imum)?\.?\s*(?:purchase|order|txn|transaction|cart)?\s*(?:value)?|orders?\s+(?:above|over)|above)\s*[:\-]?\s*(?:₹|rs\.?)\s*([\d,]+)/i;
const FLAT_RE = /(?:flat|save|get|extra)\s*(?:₹|rs\.?)\s*([\d,]+)/i;
const OFF_AMT_RE = /(?:₹|rs\.?)\s*([\d,]+)\s*(?:off|cashback|discount)/i;
const CODE_RE = /(?:coupon|code|apply)\s+(?:coupon\s+)?([A-Z0-9]{4,})/;
const MONTHS_RE = /(\d{1,2})\s*months?/gi;

function detectKind(text: string): OfferKind | null {
  const t = text.toLowerCase();
  if (/gst invoice|input tax credit|business purchase/.test(t)) return "gst_invoice";
  if (/exchange/.test(t) && /(off|bonus|extra)/.test(t)) return "exchange_bonus";
  if (/no[\s-]?cost emi/.test(t)) return "no_cost_emi";
  if (/\bcoupon\b|apply\s+code|promo code/.test(t)) return "coupon";
  if (UPI_WALLETS.test(text) && /(cashback|off|discount)/.test(t)) return "partner_upi";
  if (COBRANDS.some((re) => re.test(text))) return "cobrand_reward";
  if (/unlimited cashback/.test(t) && /card/.test(t)) return "cobrand_reward";
  const hasBank = ISSUERS.some((e) => e.re.test(text));
  if (hasBank && /(\d+%\s*(back|cashback)|reward)/.test(t) && !/instant/.test(t))
    return "cobrand_reward";
  if (hasBank && /(instant discount|instant|% off|off|discount|cashback)/.test(t)) {
    if (/cashback/.test(t) && !/instant/.test(t)) {
      return /statement/.test(t) ? "cashback_statement" : "cashback_wallet";
    }
    return "instant_bank_discount";
  }
  if (/cashback/.test(t)) return /statement/.test(t) ? "cashback_statement" : "cashback_wallet";
  return null;
}

/** Parse one raw offer string. Returns null if the regex layer can't classify it. */
export function parseOne(raw: RawOffer, ctx: OfferParseCtx): ParsedOffer | null {
  const text = raw.text.trim();
  const kind = detectKind(text);
  if (!kind) return null;

  const { issuer, network } = detectIssuer(text);
  const cardKind = detectCardKind(text);
  const emiOnly =
    kind === "instant_bank_discount" &&
    /(emi\s*tr?xn|emi\s*transaction|credit card emi|on emi|emi only)/i.test(text);

  const pctM = text.match(PCT_RE);
  const valuePct = pctM && pctM[1] ? Number(pctM[1]) : null;
  const cap = findMoney(CAP_RE, text);
  const min = findMoney(MIN_RE, text);
  let valueFlat: Paise | null = null;
  if (valuePct == null) {
    valueFlat = findMoney(FLAT_RE, text) ?? findMoney(OFF_AMT_RE, text);
  } else {
    // pct-based: a "Flat ₹X" would be contradictory; only take flat if no pct.
  }
  const codeM = text.match(CODE_RE);
  const couponCode = kind === "coupon" && codeM ? codeM[1]! : null;
  const months: number[] = [];
  let mm: RegExpExecArray | null;
  MONTHS_RE.lastIndex = 0;
  while ((mm = MONTHS_RE.exec(text)) !== null) months.push(Number(mm[1]));
  const emiMonths = months.length ? months.sort((a, b) => a - b) : null;

  // coupons/upi/cashback that are flat-only and matched a % elsewhere: keep flat.
  const stackable = kind === "coupon"; // coupons stack with a bank offer; bank offers don't stack with each other.

  return {
    productId: ctx.productId,
    platform: ctx.platform,
    kind,
    rawText: text,
    issuer,
    network,
    cardKind: kind === "instant_bank_discount" || kind === "cobrand_reward" ? cardKind : null,
    emiOnly,
    valuePct: kind === "exchange_bonus" || kind === "gst_invoice" ? null : valuePct,
    valueFlat,
    cap,
    minSpend: min,
    emiMonths,
    couponCode,
    stackable,
    validTill: null,
    active: true,
  };
}

export function parseOfferStrings(
  raw: RawOffer[],
  ctx: OfferParseCtx,
): { parsed: ParsedOffer[]; unparsed: RawOffer[] } {
  const parsed: ParsedOffer[] = [];
  const unparsed: RawOffer[] = [];
  for (const r of raw) {
    const p = parseOne(r, ctx);
    if (p) parsed.push(p);
    else unparsed.push(r);
  }
  return { parsed, unparsed };
}

// ── LLM fallback for unparsed strings ───────────────────────────────────────

const LlmOfferSchema = z.array(
  z.object({
    kind: z.enum([
      "instant_bank_discount",
      "no_cost_emi",
      "standard_emi",
      "coupon",
      "cashback_wallet",
      "cashback_statement",
      "exchange_bonus",
      "partner_upi",
      "cobrand_reward",
      "gst_invoice",
    ]),
    issuer: z.string().nullable(),
    cardKind: z.enum(["credit", "debit", "any"]).nullable(),
    emiOnly: z.boolean(),
    valuePct: z.number().nullable(),
    valueFlatRupees: z.number().nullable(),
    capRupees: z.number().nullable(),
    minSpendRupees: z.number().nullable(),
    couponCode: z.string().nullable(),
    rawText: z.string(),
  }),
);

export async function llmParseOffers(
  unparsed: RawOffer[],
  ctx: OfferParseCtx,
  llm: LlmClient,
): Promise<ParsedOffer[]> {
  if (unparsed.length === 0) return [];
  const system =
    "You extract structured data from Indian e-commerce offer strings. " +
    "Money values are in rupees (₹). Return ONLY a JSON array, one object per input line, " +
    "in the same order. If a line is not a real purchase offer, still include it with the " +
    "best-guess kind and null numeric fields.";
  const user =
    "Offer lines:\n" +
    unparsed.map((r, i) => `${i + 1}. ${r.text}`).join("\n") +
    '\n\nReturn a JSON array of objects with keys: kind, issuer, cardKind, emiOnly, ' +
    "valuePct, valueFlatRupees, capRupees, minSpendRupees, couponCode, rawText.";

  const { data } = await llm.jsonCall({
    model: "extract",
    task: "offers",
    system,
    user,
    schema: LlmOfferSchema,
    maxTokens: 900,
  });

  const toPaise = (r: number | null): Paise | null => (r == null ? null : Math.round(r * 100));
  return data.map((d) => ({
    productId: ctx.productId,
    platform: ctx.platform,
    kind: d.kind as OfferKind,
    rawText: d.rawText,
    issuer: d.issuer,
    network: null,
    cardKind: d.cardKind,
    emiOnly: d.emiOnly ?? false,
    valuePct: d.valuePct,
    valueFlat: toPaise(d.valueFlatRupees),
    cap: toPaise(d.capRupees),
    minSpend: toPaise(d.minSpendRupees),
    emiMonths: null,
    couponCode: d.couponCode,
    stackable: d.kind === "coupon",
    validTill: null,
    active: true,
  }));
}

/** Convenience for tests/UI: turn ParsedOffers into full Offers with placeholder ids. */
export function withPlaceholderIds(parsed: ParsedOffer[], ts: string): Offer[] {
  return parsed.map((p, i) => ({
    ...p,
    id: `parsed-${i}`,
    firstSeenAt: ts,
    lastSeenAt: ts,
  }));
}
