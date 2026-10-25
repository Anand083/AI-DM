import { expect, test } from "@playwright/test";

test("pages and routes send the security headers", async ({ request }) => {
  for (const path of ["/login", "/", "/api/health", "/r/not-a-real-token"]) {
    const response = await request.get(path);
    const h = response.headers();
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["referrer-policy"], path).toBeTruthy();
    expect(h["permissions-policy"], path).toContain("camera=()");
    const csp = h["content-security-policy"] ?? "";
    expect(csp, path).toContain("default-src 'self'");
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).toContain("object-src 'none'");
  }
  // Public report links are never indexed or cached.
  const shared = await request.get("/r/not-a-real-token");
  expect(shared.headers()["x-robots-tag"]).toContain("noindex");
});

test("a page still works with the content security policy in place", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy/i.test(message.text())) {
      problems.push(message.text());
    }
  });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill("someone@example.test");
  await expect(page.getByLabel("Email")).toHaveValue("someone@example.test");
  expect(problems).toEqual([]);
});
