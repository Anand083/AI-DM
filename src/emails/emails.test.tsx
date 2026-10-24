import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";
import { Invite } from "./invite";
import { ResetPassword } from "./reset-password";
import { VerifyEmail } from "./verify-email";

describe("email templates", () => {
  it("verify email contains the link and the name", async () => {
    const html = await render(
      VerifyEmail({ brandName: "Acme", name: "Sam", url: "http://x.test/v?t=1" }),
    );
    expect(html).toContain("http://x.test/v?t=1");
    expect(html).toContain("Sam");
  });

  it("reset password email contains the link", async () => {
    const html = await render(
      ResetPassword({ brandName: "Acme", name: "Sam", url: "http://x.test/r" }),
    );
    expect(html).toContain("http://x.test/r");
  });

  it("invite shows only the brand name it was given", async () => {
    const html = await render(
      Invite({
        brandName: "Agency One",
        inviterName: "Olivia",
        roleLabel: "a client",
        url: "http://x.test/i",
      }),
    );
    expect(html).toContain("Agency One");
    expect(html).not.toContain("SEO Platform");
  });
});
