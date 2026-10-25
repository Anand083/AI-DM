import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const good = { BETTER_AUTH_SECRET: "x".repeat(32) };

describe("parseEnv", () => {
  it("accepts a minimal valid set and applies defaults", () => {
    const env = parseEnv(good);
    expect(env.SEO_PROVIDER).toBe("mock");
    expect(env.BILLING_PROVIDER).toBe("mock");
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it("rejects a missing secret and says which variable is wrong", () => {
    expect(() => parseEnv({})).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects a short secret", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("rejects bad values and lists all problems at once", () => {
    const run = () => parseEnv({ ...good, SMTP_PORT: "abc", SEO_PROVIDER: "nope", APP_URL: "x" });
    expect(run).toThrow(/SMTP_PORT/);
    expect(run).toThrow(/SEO_PROVIDER/);
    expect(run).toThrow(/APP_URL/);
  });

  it("rejects a failure rate outside 0 to 1", () => {
    expect(() => parseEnv({ ...good, MOCK_FAILURE_RATE: "2" })).toThrow(/MOCK_FAILURE_RATE/);
  });

  describe("SEO_PROVIDER_OVERRIDES", () => {
    it("accepts a valid list and rejects a bad one", () => {
      expect(
        parseEnv({ ...good, SEO_PROVIDER_OVERRIDES: "rankings=dataforseo,audit=mock" })
          .SEO_PROVIDER_OVERRIDES,
      ).toBe("rankings=dataforseo,audit=mock");
      expect(() => parseEnv({ ...good, SEO_PROVIDER_OVERRIDES: "rankings=nope" })).toThrow(
        /SEO_PROVIDER_OVERRIDES/,
      );
    });
  });

  describe("production", () => {
    const prod = {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "a-real-secret-that-is-long-enough-1234",
      ENCRYPTION_KEY: "a-real-encryption-key-32-bytes!!",
      MOCK_BILLING_WEBHOOK_SECRET: "a-real-webhook-secret-1234",
      DATAFORSEO_CALLBACK_SECRET: "a-real-callback-secret-1234",
      GOOGLE_PROVIDER: "google",
      GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "a-real-google-secret",
    };

    it("refuses the mock SEO provider unless allowed", () => {
      expect(() => parseEnv(prod)).toThrow(/ALLOW_MOCK_IN_PROD/);
      expect(() => parseEnv({ ...prod, ALLOW_MOCK_IN_PROD: "true" })).not.toThrow();
    });

    it("checks the Google settings", () => {
      const env = { ...prod, ALLOW_MOCK_IN_PROD: "true" };
      expect(() => parseEnv({ ...env, GOOGLE_PROVIDER: "mock" })).not.toThrow();
      expect(() =>
        parseEnv({ ...env, GOOGLE_PROVIDER: "mock", ALLOW_MOCK_IN_PROD: "false" }),
      ).toThrow(/GOOGLE_PROVIDER/);
      expect(() => parseEnv({ ...env, GOOGLE_CLIENT_ID: "" })).toThrow(/GOOGLE_CLIENT_ID/);
      expect(() => parseEnv({ ...env, GOOGLE_CLIENT_SECRET: "" })).toThrow(/GOOGLE_CLIENT_ID/);
      expect(() => parseEnv({ ...env, ENCRYPTION_KEY: "short-but-real-key" })).toThrow(
        /at least 32 characters/,
      );
    });

    it("refuses placeholder secrets", () => {
      const env = { ...prod, ALLOW_MOCK_IN_PROD: "true" };
      expect(() => parseEnv({ ...env, BETTER_AUTH_SECRET: "change-me-" + "x".repeat(30) })).toThrow(
        /BETTER_AUTH_SECRET/,
      );
      expect(() => parseEnv({ ...env, ENCRYPTION_KEY: "change-me-32-bytes" })).toThrow(
        /ENCRYPTION_KEY/,
      );
    });

    it("refuses placeholder webhook and callback secrets", () => {
      const env = { ...prod, ALLOW_MOCK_IN_PROD: "true" };
      expect(() => parseEnv({ ...env, MOCK_BILLING_WEBHOOK_SECRET: "change-me" })).toThrow(
        /MOCK_BILLING_WEBHOOK_SECRET/,
      );
      expect(() => parseEnv({ ...env, MOCK_BILLING_WEBHOOK_SECRET: "short" })).toThrow(
        /MOCK_BILLING_WEBHOOK_SECRET/,
      );
      const real = {
        ...prod,
        SEO_PROVIDER: "dataforseo",
        DATAFORSEO_LOGIN: "a",
        DATAFORSEO_PASSWORD: "b",
      };
      expect(() => parseEnv({ ...real, DATAFORSEO_CALLBACK_SECRET: "change-me" })).toThrow(
        /DATAFORSEO_CALLBACK_SECRET/,
      );
      expect(() => parseEnv(real)).not.toThrow();
    });

    it("looks at overrides too: a mock override needs the flag, a DataForSEO override needs credentials", () => {
      const real = {
        ...prod,
        SEO_PROVIDER: "dataforseo",
        DATAFORSEO_LOGIN: "a",
        DATAFORSEO_PASSWORD: "b",
      };
      expect(() => parseEnv(real)).not.toThrow();
      expect(() => parseEnv({ ...real, SEO_PROVIDER_OVERRIDES: "audit=mock" })).toThrow(
        /ALLOW_MOCK_IN_PROD/,
      );
      expect(() =>
        parseEnv({
          ...prod,
          ALLOW_MOCK_IN_PROD: "true",
          SEO_PROVIDER_OVERRIDES: "rankings=dataforseo",
        }),
      ).toThrow(/DATAFORSEO_LOGIN/);
    });

    it("requires DataForSEO credentials when that provider is chosen", () => {
      expect(() => parseEnv({ ...prod, SEO_PROVIDER: "dataforseo" })).toThrow(/DATAFORSEO_LOGIN/);
    });
  });
});
