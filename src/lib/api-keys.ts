import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/** What a public API key may read. Every scope is read-only. */
export const API_SCOPES = [
  "read:clients",
  "read:projects",
  "read:rankings",
  "read:alerts",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABEL: Record<ApiScope, string> = {
  "read:clients": "Read clients",
  "read:projects": "Read projects",
  "read:rankings": "Read rankings",
  "read:alerts": "Read alerts",
};

export const KEY_PREFIX = "aidm_";

export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The part of the key shown in lists, for example "aidm_AbCd1234". */
export const keyPrefix = (key: string) => key.slice(0, KEY_PREFIX.length + 8);

/** Reads "Bearer <key>". Returns null for anything else. */
export function parseBearer(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S{10,200})$/i.exec(header?.trim() ?? "");
  return m ? m[1]! : null;
}

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(60, "Use 60 characters or fewer."),
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1, "Choose at least one permission.")
    .max(API_SCOPES.length),
});

export function hasScope(scopes: readonly string[], needed: ApiScope): boolean {
  return scopes.includes(needed);
}
