import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getEnv } from "@/env";
import { rawDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { findAgencySlugByDomain } from "@/server/services/custom-domain";
import { getRedis } from "@/server/redis";
import { RedisRateLimitStore } from "@/server/rate-limit";
import { sendResetPasswordEmail, sendVerifyEmail } from "@/server/services/email";
import { AuthRateLimitError, clientIp, enforceAuthRateLimit } from "./auth-rate-limit";

function createAuth() {
  const env = getEnv();
  const store = new RedisRateLimitStore(getRedis());

  return betterAuth({
    appName: env.APP_NAME,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(rawDb, { provider: "postgresql" }),
    advanced: {
      database: { generateId: () => createId() },
      useSecureCookies: env.COOKIE_SECURE,
    },
    // Agencies' own domains (Step 18) sign in on their own origin, so a verified custom domain
    // is a trusted origin for requests that come from it.
    trustedOrigins: async (request) => {
      if (!env.CUSTOM_DOMAINS_ENABLED) return [];
      const origin = request?.headers.get("origin");
      if (!origin) return [];
      try {
        const host = new URL(origin).hostname;
        return (await findAgencySlugByDomain(host)) ? [origin] : [];
      } catch {
        return [];
      }
    },
    session: {
      // Sessions live in the database (Session table), not only in a signed cookie.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        isSuperAdmin: { type: "boolean", defaultValue: false, input: false },
        timezone: { type: "string", defaultValue: "UTC", input: true },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendResetPasswordEmail(user, url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerifyEmail(user, url);
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = ctx.body as { email?: unknown } | undefined;
        try {
          await enforceAuthRateLimit(
            store,
            {
              path: ctx.path,
              ip: clientIp(ctx.headers),
              email: typeof body?.email === "string" ? body.email : undefined,
            },
            { limit: env.AUTH_RATE_LIMIT_MAX, windowSec: env.AUTH_RATE_LIMIT_WINDOW_SECONDS },
          );
        } catch (error) {
          if (error instanceof AuthRateLimitError) {
            throw new APIError("TOO_MANY_REQUESTS", { message: error.message });
          }
          // If Redis is down we let the request through rather than lock everyone out.
          logger.warn({ err: error }, "auth rate limit check failed");
        }
      }),
    },
    plugins: [nextCookies()],
  });
}

const globalForAuth = globalThis as unknown as { auth?: ReturnType<typeof createAuth> };

/** The Better Auth instance. Created on first use so `next build` does not need secrets. */
export function getAuth(): ReturnType<typeof createAuth> {
  globalForAuth.auth ??= createAuth();
  return globalForAuth.auth;
}
