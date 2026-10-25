import { describe, expect, it } from "vitest";
import { createApiKeySchema, generateApiKey, hashApiKey, keyPrefix, parseBearer } from "./api-keys";

describe("api keys", () => {
  it("makes unique keys and stable hashes", () => {
    const a = generateApiKey();
    expect(a.startsWith("aidm_")).toBe(true);
    expect(a.length).toBeGreaterThan(30);
    expect(generateApiKey()).not.toBe(a);
    expect(hashApiKey(a)).toBe(hashApiKey(a));
    expect(hashApiKey(a)).not.toBe(hashApiKey(a + "x"));
    expect(keyPrefix(a)).toHaveLength(13);
  });
  it("reads bearer headers", () => {
    expect(parseBearer("Bearer aidm_abcdefghij")).toBe("aidm_abcdefghij");
    expect(parseBearer("bearer   aidm_abcdefghij")).toBe("aidm_abcdefghij");
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer short")).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });
  it("validates new keys", () => {
    expect(createApiKeySchema.safeParse({ name: "Zapier", scopes: ["read:clients"] }).success).toBe(
      true,
    );
    expect(createApiKeySchema.safeParse({ name: "Z", scopes: ["read:clients"] }).success).toBe(
      false,
    );
    expect(createApiKeySchema.safeParse({ name: "Zapier", scopes: [] }).success).toBe(false);
    expect(createApiKeySchema.safeParse({ name: "Zapier", scopes: ["write:all"] }).success).toBe(
      false,
    );
  });
});
