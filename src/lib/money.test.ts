import { describe, expect, it } from "vitest";
import { formatMoney, formatRate, microsToBaseCents, parseRate, toBaseCents } from "./money";

describe("money", () => {
  it("parses rates", () => {
    expect(parseRate("1.08")).toBe(1_080_000);
    expect(parseRate(" 83.5 ")).toBe(83_500_000);
    expect(parseRate("0")).toBeNull();
    expect(parseRate("abc")).toBeNull();
    expect(parseRate("-1")).toBeNull();
    expect(parseRate("1.1234567")).toBeNull();
  });
  it("formats rates", () => {
    expect(formatRate(1_080_000)).toBe("1.08");
    expect(formatRate(2_000_000)).toBe("2");
  });
  it("converts to the base currency", () => {
    expect(toBaseCents(10_000, "USD", "USD", {})).toBe(10_000);
    expect(toBaseCents(10_000, "EUR", "USD", { EUR: 1_080_000 })).toBe(10_800);
    expect(toBaseCents(10_000, "EUR", "USD", {})).toBeNull();
  });
  it("converts provider micro-dollars", () => {
    expect(microsToBaseCents(2_500_000, "USD", {})).toBe(250);
    expect(microsToBaseCents(2_500_000, "EUR", { USD: 920_000 })).toBe(230);
    expect(microsToBaseCents(2_500_000, "EUR", {})).toBeNull();
  });
  it("formats money", () => {
    expect(formatMoney(123456, "USD")).toBe("1,234.56 USD");
    expect(formatMoney(-5, "EUR")).toBe("-0.05 EUR");
  });
});
