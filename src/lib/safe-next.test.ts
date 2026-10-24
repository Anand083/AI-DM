import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps paths inside the app", () => {
    expect(safeNext("/app/acme/team")).toBe("/app/acme/team");
    expect(safeNext("/invite/abc")).toBe("/invite/abc");
  });
  it("falls back for anything else", () => {
    for (const bad of [
      undefined,
      "",
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "javascript:1",
    ]) {
      expect(safeNext(bad)).toBe("/app");
    }
    expect(safeNext(["/a", "/b"])).toBe("/a");
  });
});
