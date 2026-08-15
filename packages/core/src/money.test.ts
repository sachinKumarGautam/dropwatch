import { describe, it, expect } from "vitest";
import { formatINR, formatPct, rupees } from "./money.js";

describe("money", () => {
  it("formats Indian digit grouping", () => {
    expect(formatINR(12990000)).toBe("₹1,29,900");
    expect(formatINR(6199900)).toBe("₹61,999");
    expect(formatINR(50000)).toBe("₹500");
    expect(formatINR(100)).toBe("₹1");
    expect(formatINR(150)).toBe("₹1.50");
    expect(formatINR(0)).toBe("₹0");
    expect(formatINR(100000000)).toBe("₹10,00,000");
  });
  it("rupees → paise", () => {
    expect(rupees(1299)).toBe(129900);
    expect(rupees(61999)).toBe(6199900);
  });
  it("formats percent", () => {
    expect(formatPct(0.183)).toBe("18.3%");
  });
});
