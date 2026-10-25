import { describe, expect, it } from "vitest";
import { portalResetUrl } from "@/server/services/email";

describe("portalResetUrl", () => {
  it("sends the link to the agency's own reset page and keeps the token path", () => {
    const out = portalResetUrl(
      "https://app.example.com/api/auth/reset-password/tok123?callbackURL=%2Freset-password",
      "bright-studio",
    );
    const u = new URL(out);
    expect(u.pathname).toBe("/api/auth/reset-password/tok123");
    expect(u.searchParams.get("callbackURL")).toBe("/portal/bright-studio/reset-password");
  });
  it("adds the page when the link had none", () => {
    const u = new URL(portalResetUrl("https://app.example.com/api/auth/reset-password/t", "a-b"));
    expect(u.searchParams.get("callbackURL")).toBe("/portal/a-b/reset-password");
  });
});
