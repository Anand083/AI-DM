import { describe, expect, it } from "vitest";
import { checkHealth } from "./health";

const ok = async () => "ok";
const fail = async () => {
  throw new Error("down");
};

describe("checkHealth", () => {
  it("is ok when every probe passes", async () => {
    const report = await checkHealth({ database: ok, redis: ok });
    expect(report.ok).toBe(true);
  });

  it("reports which dependency failed without throwing", async () => {
    const report = await checkHealth({ database: ok, redis: fail });
    expect(report.ok).toBe(false);
    expect(report.checks.database.ok).toBe(true);
    expect(report.checks.redis).toEqual({ ok: false, error: "down" });
  });
});
