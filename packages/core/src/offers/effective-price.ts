/**
 * offers/effective-price.ts — THE differentiator.
 *
 * Computes, per (card × payment-path), the real out-of-pocket price for the user's
 * own wallet, and ranks them. See docs/blueprint.md §2.11 for the locked rules.
 *
 * All money is integer paise.
 */
import { formatINR } from "../money.js";
import type {
  Card,
  EffectivePrice,
  Offer,
  Paise,
  PaymentPath,
  Platform,
} from "../types.js";

const EMI_GST_RATE = 0.18; // GST on interest
const EMI_APR_PROXY = 0.16; // 16% APR proxy for the "waived" interest GST is charged on
const CASHBACK_WALLET_WEIGHT = 0.9;
const CASHBACK_STATEMENT_WEIGHT = 0.7;
const CONSERVATIVE_MIN_SPEND_FLOOR: Paise = 500_00; // ₹5,000 — below this, skip offers with unknown minSpend

export interface EffectivePriceInput {
  productId: string;
  platform: Platform;
  sticker: Paise;
  offers: Offer[];
  cards: Card[];
}

function offerMatchesCard(o: Offer, card: Card): boolean {
  if (o.issuer && o.issuer.toLowerCase() !== card.issuer.toLowerCase())
    return false;
  if (o.cardKind && o.cardKind !== "any" && o.cardKind !== card.kind)
    return false;
  if (o.network && o.network !== card.network) return false;
  return true;
}

interface Applied {
  discount: Paise;
  offer: Offer;
}

/** Discount an offer yields against `amount`, honoring pct-with-cap, flat, and minSpend. */
function offerDiscount(o: Offer, amount: Paise): number | null {
  const minSpend = o.minSpend;
  if (minSpend == null) {
    // Unknown minimum: only trust it above the conservative floor for bank discounts.
    if (
      o.kind === "instant_bank_discount" &&
      amount < CONSERVATIVE_MIN_SPEND_FLOOR
    )
      return null;
  } else if (amount < minSpend) {
    return null;
  }
  if (o.valueFlat != null) return Math.min(o.valueFlat, amount);
  if (o.valuePct != null) {
    // Guard against mis-parsed offers inflating the effective price:
    //  - a bank instant discount always states a cap; a capless % one is unreliable → skip
    //  - an implausible % (>40) is almost certainly a parse error → skip
    if (o.valuePct > 40) return null;
    if (o.kind === "instant_bank_discount" && o.cap == null) return null;
    const raw = Math.round((amount * o.valuePct) / 100);
    return o.cap != null ? Math.min(raw, o.cap) : raw;
  }
  return null;
}

function bestOf(offers: Offer[], amount: Paise): Applied | null {
  let best: Applied | null = null;
  for (const o of offers) {
    const d = offerDiscount(o, amount);
    if (d != null && d > 0 && (!best || d > best.discount)) {
      best = { discount: d, offer: o };
    }
  }
  return best;
}

function maxMonths(...offers: (Offer | undefined)[]): number | null {
  let n: number | null = null;
  for (const o of offers) {
    if (o?.emiMonths && o.emiMonths.length) {
      const m = Math.max(...o.emiMonths);
      n = n == null ? m : Math.max(n, m);
    }
  }
  return n;
}

function emiGstCost(base: Paise, months: number): Paise {
  return Math.round(EMI_GST_RATE * base * EMI_APR_PROXY * ((months + 1) / 24));
}

function cardLabel(card: Card): string {
  return `${card.issuer} ${card.productName} ${card.kind === "credit" ? "CC" : "DC"}`;
}

export function computeEffectivePrices(
  input: EffectivePriceInput,
): EffectivePrice[] {
  const { productId, platform, sticker } = input;
  const active = input.offers.filter((o) => o.active !== false);
  const cards = input.cards.filter((c) => c.active);

  // 1. Best coupon reduces sticker → base.
  const coupons = active.filter((o) => o.kind === "coupon");
  const bestCoupon = bestOf(coupons, sticker);
  const couponDiscount = bestCoupon?.discount ?? 0;
  const base = sticker - couponDiscount;
  const couponIds = bestCoupon ? [bestCoupon.offer.id] : [];
  const couponExplain = bestCoupon
    ? [
        `−${formatINR(couponDiscount)} coupon${
          bestCoupon.offer.couponCode ? " " + bestCoupon.offer.couponCode : ""
        }`,
      ]
    : [];

  const walletOffers = active.filter((o) => o.kind === "cashback_wallet");
  const stmtOffers = active.filter((o) => o.kind === "cashback_statement");

  const rows: EffectivePrice[] = [];

  const makeRow = (args: {
    card: Card | null;
    path: PaymentPath;
    label: string;
    bankInstant: Paise;
    emiGst: Paise;
    appliedOfferIds: string[];
    explain: string[];
  }): EffectivePrice => {
    const { card } = args;
    const effectiveInstant = base - args.bankInstant + args.emiGst;

    // cashback offers apply against base, matched to the card (or generic).
    const walletApplicable = walletOffers.filter(
      (o) => !card || offerMatchesCard(o, card) || o.issuer == null,
    );
    const stmtApplicable = stmtOffers.filter(
      (o) => !card || offerMatchesCard(o, card) || o.issuer == null,
    );
    const walletRaw = bestOf(walletApplicable, base)?.discount ?? 0;
    const stmtRaw = bestOf(stmtApplicable, base)?.discount ?? 0;
    const walletCashbackValue = Math.round(walletRaw * CASHBACK_WALLET_WEIGHT);
    const statementCashbackValue = Math.round(
      stmtRaw * CASHBACK_STATEMENT_WEIGHT,
    );

    const cobrandRewardValue =
      card && card.cobrand === platform
        ? Math.round((effectiveInstant * card.baseOnlineRewardPct) / 100)
        : 0;

    const effectiveNet =
      effectiveInstant -
      walletCashbackValue -
      statementCashbackValue -
      cobrandRewardValue;

    const explain = [...couponExplain, ...args.explain];
    if (cobrandRewardValue > 0)
      explain.push(
        `−${formatINR(cobrandRewardValue)} ${card!.productName} ${card!.baseOnlineRewardPct}% reward`,
      );
    if (walletCashbackValue > 0)
      explain.push(`−${formatINR(walletCashbackValue)} wallet cashback (×0.9)`);
    if (statementCashbackValue > 0)
      explain.push(
        `−${formatINR(statementCashbackValue)} statement cashback (×0.7)`,
      );

    return {
      productId,
      platform,
      cardId: card?.id ?? null,
      cardLabel: args.label,
      paymentPath: args.path,
      sticker,
      couponDiscount,
      bankInstantDiscount: args.bankInstant,
      emiGstCost: args.emiGst,
      effectiveInstant,
      walletCashbackValue,
      statementCashbackValue,
      cobrandRewardValue,
      effectiveNet,
      appliedOfferIds: [...couponIds, ...args.appliedOfferIds],
      explain,
    };
  };

  // plain path (coupon only, pay by anything, no card offer)
  rows.push(
    makeRow({
      card: null,
      path: "plain",
      label: "No card offer",
      bankInstant: 0,
      emiGst: 0,
      appliedOfferIds: [],
      explain: [],
    }),
  );

  // upi path (best partner_upi applied to base, treated as instant reduction)
  const upi = bestOf(
    active.filter((o) => o.kind === "partner_upi"),
    base,
  );
  if (upi) {
    rows.push(
      makeRow({
        card: null,
        path: "upi",
        label: upi.offer.issuer ? `${upi.offer.issuer} UPI` : "UPI",
        bankInstant: upi.discount,
        emiGst: 0,
        appliedOfferIds: [upi.offer.id],
        explain: [`−${formatINR(upi.discount)} UPI offer`],
      }),
    );
  }

  for (const card of cards) {
    // card_instant path — best non-EMI-only bank discount matching this card.
    const instantOffers = active.filter(
      (o) =>
        o.kind === "instant_bank_discount" &&
        !o.emiOnly &&
        offerMatchesCard(o, card),
    );
    const bestInstant = bestOf(instantOffers, base);
    if (bestInstant || card.cobrand === platform) {
      const explain = bestInstant
        ? [
            `−${formatINR(bestInstant.discount)} ${card.issuer} ${
              bestInstant.offer.valuePct ? bestInstant.offer.valuePct + "%" : "flat"
            }${
              bestInstant.offer.cap != null &&
              bestInstant.offer.valuePct != null &&
              bestInstant.discount === bestInstant.offer.cap
                ? " (cap)"
                : ""
            }`,
          ]
        : [];
      rows.push(
        makeRow({
          card,
          path: "card_instant",
          label: cardLabel(card),
          bankInstant: bestInstant?.discount ?? 0,
          emiGst: 0,
          appliedOfferIds: bestInstant ? [bestInstant.offer.id] : [],
          explain,
        }),
      );
    }

    // no_cost_emi path — requires an active NCE offer + emi-eligible card.
    if (card.emiEligible) {
      const nce = bestOf(
        active.filter((o) => o.kind === "no_cost_emi"),
        base,
      );
      // NCE offers often have no valueFlat/valuePct → offerDiscount returns null.
      // Detect presence directly instead.
      const ncePresent = active.find(
        (o) =>
          o.kind === "no_cost_emi" &&
          (o.minSpend == null || base >= o.minSpend),
      );
      if (ncePresent) {
        const emiInstantOffers = active.filter(
          (o) =>
            o.kind === "instant_bank_discount" &&
            o.emiOnly &&
            offerMatchesCard(o, card),
        );
        const bestEmiInstant = bestOf(emiInstantOffers, base);
        const n = maxMonths(ncePresent, bestEmiInstant?.offer) ?? 9;
        const gst = emiGstCost(base, n);
        const explain: string[] = [`+${formatINR(gst)} EMI GST est. (${n}m)`];
        if (bestEmiInstant)
          explain.unshift(
            `−${formatINR(bestEmiInstant.discount)} ${card.issuer} EMI offer`,
          );
        rows.push(
          makeRow({
            card,
            path: "no_cost_emi",
            label: `${cardLabel(card)} · No-Cost EMI`,
            bankInstant: bestEmiInstant?.discount ?? 0,
            emiGst: gst,
            appliedOfferIds: [
              ncePresent.id,
              ...(bestEmiInstant ? [bestEmiInstant.offer.id] : []),
            ],
            explain,
          }),
        );
      }
      void nce;
    }
  }

  return rows;
}

/** Rank ascending by effectiveInstant (the money at checkout), tiebreak effectiveNet. */
export function rankEffective(rows: EffectivePrice[]): EffectivePrice[] {
  return [...rows].sort(
    (a, b) =>
      a.effectiveInstant - b.effectiveInstant ||
      a.effectiveNet - b.effectiveNet,
  );
}

/**
 * "Best card you don't have" — the best hypothetical instant bank discount from an
 * offer whose issuer/kind matches NONE of the held cards.
 */
export function bestCardNotHeld(
  offers: Offer[],
  heldCards: Card[],
  sticker: Paise,
): { cardLabel: string; effectiveInstant: Paise } | null {
  const active = offers.filter((o) => o.active !== false);
  const coupons = active.filter((o) => o.kind === "coupon");
  const base = sticker - (bestOf(coupons, sticker)?.discount ?? 0);

  const held = heldCards.filter((c) => c.active);
  let best: { cardLabel: string; effectiveInstant: Paise } | null = null;
  for (const o of active) {
    if (o.kind !== "instant_bank_discount" || o.emiOnly) continue;
    const matchesHeld = held.some((c) => offerMatchesCard(o, c));
    if (matchesHeld) continue;
    const d = offerDiscount(o, base);
    if (d == null || d <= 0) continue;
    const eff = base - d;
    if (!best || eff < best.effectiveInstant) {
      const label = `${o.issuer ?? "a"} ${o.cardKind === "debit" ? "Debit Card" : "Credit Card"}`;
      best = { cardLabel: label, effectiveInstant: eff };
    }
  }
  return best;
}
