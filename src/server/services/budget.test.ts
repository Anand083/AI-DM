import { describe, expect, it } from "vitest";
import { evaluateBudget } from "./budget";

const usd = (n: number) => n * 1_000_000;

describe("evaluateBudget", () => {
  it("is ok below 80%", () => {
    expect(evaluateBudget(usd(39.5), usd(50))).toEqual({ state: "ok", percent: 79 });
    expect(evaluateBudget(usd(39.5), usd(50)).state).toBe("ok");
  });
  it("warns from 80% up to 99%", () => {
    expect(evaluateBudget(usd(40), usd(50))).toEqual({ state: "warn", percent: 80 });
    expect(evaluateBudget(usd(49.9), usd(50))).toMatchObject({ state: "warn" });
  });
  it("pauses at 100% and above", () => {
    expect(evaluateBudget(usd(50), usd(50))).toEqual({ state: "paused", percent: 100 });
    expect(evaluateBudget(usd(75), usd(50))).toEqual({ state: "paused", percent: 150 });
  });
  it("a budget of 0 turns the guard off", () => {
    expect(evaluateBudget(usd(1000), 0)).toEqual({ state: "ok", percent: 0 });
  });
  it("starts at ok with no spending", () => {
    expect(evaluateBudget(0, usd(50))).toEqual({ state: "ok", percent: 0 });
  });
});
