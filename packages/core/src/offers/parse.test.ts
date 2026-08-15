import { describe, it, expect } from "vitest";
import { parseOne, parseOfferStrings, llmParseOffers } from "./parse.js";
import { createMockLlm } from "../llm/client.js";
import { rupees } from "../money.js";
import type { RawOffer } from "../types.js";

const ctx = { productId: "p1", platform: "amazon_in" as const };
const raw = (text: string): RawOffer => ({ text });

describe("offer parser — corpus", () => {
  it("1. HDFC 10% instant with cap + min", () => {
    const o = parseOne(
      raw(
        "10% Instant Discount up to ₹1,500 on HDFC Bank Credit Card Transactions. Minimum purchase value ₹5,000",
      ),
      ctx,
    )!;
    expect(o.kind).toBe("instant_bank_discount");
    expect(o.issuer).toBe("HDFC");
    expect(o.cardKind).toBe("credit");
    expect(o.valuePct).toBe(10);
    expect(o.cap).toBe(rupees(1500));
    expect(o.minSpend).toBe(rupees(5000));
    expect(o.emiOnly).toBe(false);
  });

  it("2. ICICI flat ₹3,000 EMI-only", () => {
    const o = parseOne(
      raw(
        "Flat ₹3,000 Instant Discount on ICICI Bank Credit Card EMI Trxns. Min Txn Value: ₹49,999",
      ),
      ctx,
    )!;
    expect(o.kind).toBe("instant_bank_discount");
    expect(o.issuer).toBe("ICICI");
    expect(o.valueFlat).toBe(rupees(3000));
    expect(o.minSpend).toBe(rupees(49999));
    expect(o.emiOnly).toBe(true);
  });

  it("3. Flipkart Axis 5% unlimited cashback → cobrand", () => {
    const o = parseOne(raw("5% Unlimited Cashback on Flipkart Axis Bank Credit Card"), ctx)!;
    expect(o.kind).toBe("cobrand_reward");
    expect(o.issuer).toBe("Axis");
    expect(o.valuePct).toBe(5);
    expect(o.cap).toBeNull();
  });

  it("4. No Cost EMI above ₹2,999", () => {
    const o = parseOne(raw("No Cost EMI available on select cards for orders above ₹2,999"), ctx)!;
    expect(o.kind).toBe("no_cost_emi");
    expect(o.minSpend).toBe(rupees(2999));
  });

  it("5. Coupon SAVE500", () => {
    const o = parseOne(raw("Save ₹500 with coupon. Apply coupon SAVE500 at checkout"), ctx)!;
    expect(o.kind).toBe("coupon");
    expect(o.valueFlat).toBe(rupees(500));
    expect(o.couponCode).toBe("SAVE500");
  });

  it("6. Paytm UPI ₹50 cashback", () => {
    const o = parseOne(
      raw(
        "Get ₹50 Cashback on Paytm UPI Transactions. Minimum Order Value ₹500. Valid once per Paytm account",
      ),
      ctx,
    )!;
    expect(o.kind).toBe("partner_upi");
    expect(o.valueFlat).toBe(rupees(50));
    expect(o.minSpend).toBe(rupees(500));
  });

  it("7. Exchange bonus", () => {
    const o = parseOne(raw("Up to ₹1,250 off on Exchange of your old phone"), ctx)!;
    expect(o.kind).toBe("exchange_bonus");
  });

  it("8. Amazon Pay ICICI 5% back → cobrand", () => {
    const o = parseOne(
      raw("5% back with Amazon Pay ICICI Bank Credit Card for Prime members"),
      ctx,
    )!;
    expect(o.kind).toBe("cobrand_reward");
    expect(o.issuer).toBe("ICICI");
    expect(o.valuePct).toBe(5);
  });

  it("9. SBI debit 10% off with cap + min", () => {
    const o = parseOne(raw("10% off up to ₹1,000 on SBI Debit Card. Min purchase ₹4,990"), ctx)!;
    expect(o.kind).toBe("instant_bank_discount");
    expect(o.issuer).toBe("SBI");
    expect(o.cardKind).toBe("debit");
    expect(o.valuePct).toBe(10);
    expect(o.cap).toBe(rupees(1000));
    expect(o.minSpend).toBe(rupees(4990));
  });

  it("10. GST invoice", () => {
    const o = parseOne(raw("Get GST invoice and save up to 28% on business purchases"), ctx)!;
    expect(o.kind).toBe("gst_invoice");
  });

  it("11. Times Prime signup → unparsed (falls to LLM)", () => {
    const o = parseOne(
      raw("Sign up for Flipkart Pay Later and get free Times Prime Membership worth ₹1,199"),
      ctx,
    );
    expect(o).toBeNull();
  });

  it("parseOfferStrings splits parsed vs unparsed", () => {
    const { parsed, unparsed } = parseOfferStrings(
      [
        raw("10% Instant Discount up to ₹1,500 on HDFC Bank Credit Card. Minimum purchase value ₹5,000"),
        raw("Sign up for Flipkart Pay Later and get free Times Prime Membership worth ₹1,199"),
      ],
      ctx,
    );
    expect(parsed).toHaveLength(1);
    expect(unparsed).toHaveLength(1);
  });

  it("LLM fallback classifies leftover strings", async () => {
    const llm = createMockLlm(() => [
      {
        kind: "cobrand_reward",
        issuer: null,
        cardKind: null,
        emiOnly: false,
        valuePct: null,
        valueFlatRupees: null,
        capRupees: null,
        minSpendRupees: null,
        couponCode: null,
        rawText: "Sign up for Flipkart Pay Later ...",
      },
    ]);
    const out = await llmParseOffers(
      [raw("Sign up for Flipkart Pay Later and get free Times Prime Membership worth ₹1,199")],
      ctx,
      llm,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("cobrand_reward");
  });
});
