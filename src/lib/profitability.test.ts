import { describe, expect, it } from "vitest";
import {
  computeProfit,
  daysInUtcMonth,
  forecastMonth,
  timeCostCents,
  totalProfit,
} from "./profitability";

const row = {
  clientId: "c1",
  name: "Acme",
  revenueCents: 100_000,
  providerCents: 10_000,
  taskMinutes: 120,
};

describe("profitability", () => {
  it("costs time", () => {
    expect(timeCostCents(90, 4000)).toBe(6000);
    expect(timeCostCents(0, 4000)).toBe(0);
  });
  it("forecasts a month in a straight line", () => {
    expect(forecastMonth(1000, 10, 30)).toBe(3000);
    expect(forecastMonth(1000, 0, 30)).toBe(1000);
    expect(daysInUtcMonth(new Date("2026-02-10T00:00:00Z"))).toBe(28);
  });
  it("computes the margin", () => {
    const p = computeProfit(row, 3000, 15, 30);
    expect(p.timeCents).toBe(6000);
    expect(p.marginCents).toBe(84_000);
    expect(p.marginPercent).toBe(84);
    expect(p.forecastProviderCents).toBe(20_000);
  });
  it("leaves the margin empty when a number is missing", () => {
    const p = computeProfit({ ...row, revenueCents: null }, 3000, 15, 30);
    expect(p.marginCents).toBeNull();
    expect(p.marginPercent).toBeNull();
  });
  it("totals and counts skipped clients", () => {
    const a = computeProfit(row, 0, 30, 30);
    const b = computeProfit({ ...row, clientId: "c2", providerCents: null }, 0, 30, 30);
    const t = totalProfit([a, b]);
    expect(t.revenueCents).toBe(100_000);
    expect(t.marginCents).toBe(90_000);
    expect(t.skipped).toBe(1);
  });
});
