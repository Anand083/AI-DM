import "server-only";
import dns from "node:dns/promises";
import { getEnv } from "@/env";
import { dnsInstructions, normalizeHost } from "@/lib/custom-domain";
import type { PlanLimits } from "@/lib/plan-limits";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db, rawDb } from "@/server/db/client";
import { generateToken } from "@/server/tokens";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { getPlanLimits } from "./plan";

/** The DNS lookups we need. Tests pass their own. */
export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
}

export const systemResolver: DnsResolver = dns;

/** The host agencies point their CNAME at. */
export function cnameTarget(): string {
  const env = getEnv();
  return env.CUSTOM_DOMAIN_CNAME_TARGET || new URL(env.APP_URL).hostname;
}

/** Hosts that belong to the platform itself (never allowed as a custom domain). */
export function platformHosts(): string[] {
  const env = getEnv();
  return [new URL(env.APP_URL).hostname, new URL(env.BETTER_AUTH_URL).hostname, cnameTarget()].map(
    (h) => h.toLowerCase(),
  );
}

function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "branding.edit")) throw new ForbiddenError();
}

function requireEnabled(): void {
  if (!getEnv().CUSTOM_DOMAINS_ENABLED)
    throw new ForbiddenError("Custom domains are not turned on.");
}

export type CustomDomainView = {
  enabled: boolean;
  allowedByPlan: boolean;
  domain: string | null;
  status: "NONE" | "PENDING" | "VERIFIED" | "FAILED";
  records: { type: string; name: string; value: string }[];
};

export async function getCustomDomain(ctx: TenantContext): Promise<CustomDomainView> {
  if (!can(ctx.role, "branding.edit")) throw new ForbiddenError();
  const enabled = getEnv().CUSTOM_DOMAINS_ENABLED;
  const [branding, plan] = await Promise.all([
    db.branding.findFirst({
      where: { agencyId: ctx.agencyId },
      select: { customDomain: true, customDomainStatus: true, domainVerifyToken: true },
    }),
    getPlanLimits(ctx).catch(() => null),
  ]);
  const limits = plan?.limits as PlanLimits | undefined;
  const domain = branding?.customDomain ?? null;
  return {
    enabled,
    allowedByPlan: limits?.customDomain ?? false,
    domain,
    status: branding?.customDomainStatus ?? "NONE",
    records:
      domain && branding?.domainVerifyToken
        ? dnsInstructions(domain, cnameTarget(), branding.domainVerifyToken).map((r) => ({ ...r }))
        : [],
  };
}

/** Saves a new domain as PENDING with a fresh token. Changing the domain starts verification again. */
export async function setCustomDomain(ctx: TenantContext, input: string) {
  requireEdit(ctx);
  requireEnabled();
  const { limits, planName } = await getPlanLimits(ctx);
  if (!limits.customDomain) {
    throw new ForbiddenError(
      `Your ${planName} plan does not include a custom domain. Upgrade your plan to use one.`,
    );
  }
  const domain = normalizeHost(input);
  if (!domain) {
    throw new ValidationError("Enter a domain like reports.youragency.com.", {
      domain: "Enter a domain like reports.youragency.com.",
    });
  }
  if (platformHosts().includes(domain)) {
    throw new ValidationError("This domain belongs to us. Use your own domain.", {
      domain: "This domain belongs to us. Use your own domain.",
    });
  }
  // The domain is unique across agencies, so this lookup has no single agency.
  const taken = await rawDb.branding.findFirst({
    where: { customDomain: domain, NOT: { agencyId: ctx.agencyId } },
    select: { id: true },
  });
  if (taken) throw new ConflictError("This domain is already used by another account.");

  const agency = await db.agency.findUniqueOrThrow({
    where: { id: ctx.agencyId },
    select: { name: true },
  });
  const data = {
    customDomain: domain,
    customDomainStatus: "PENDING" as const,
    domainVerifyToken: generateToken(16),
  };
  await db.branding.upsert({
    where: { agencyId: ctx.agencyId },
    create: { agencyId: ctx.agencyId, displayName: agency.name, ...data },
    update: data,
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "branding.domain_set",
    targetType: "Branding",
    targetId: ctx.agencyId,
    metadata: { domain },
  });
  return getCustomDomain(ctx);
}

export async function removeCustomDomain(ctx: TenantContext) {
  requireEdit(ctx);
  await db.branding.updateMany({
    where: { agencyId: ctx.agencyId },
    data: { customDomain: null, customDomainStatus: "NONE", domainVerifyToken: null },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "branding.domain_removed",
    targetType: "Branding",
    targetId: ctx.agencyId,
  });
}

const settle = async <T>(promise: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await promise;
  } catch {
    return fallback;
  }
};

/**
 * Checks the two DNS records. The TXT record proves the agency owns the domain. The CNAME (or,
 * for a bare domain, matching A records) proves traffic will reach us.
 */
export async function checkDns(
  domain: string,
  token: string,
  target: string,
  resolver: DnsResolver,
): Promise<{ txt: boolean; routing: boolean }> {
  const txtRecords = await settle(resolver.resolveTxt(`_portal-verify.${domain}`), []);
  const txt = txtRecords.some((parts) => parts.join("") === `portal-verify=${token}`);
  const cnames = await settle(resolver.resolveCname(domain), []);
  let routing = cnames.some((c) => c.replace(/\.$/, "").toLowerCase() === target.toLowerCase());
  if (!routing) {
    const [mine, ours] = await Promise.all([
      settle(resolver.resolve4(domain), []),
      settle(resolver.resolve4(target), []),
    ]);
    routing = mine.length > 0 && mine.every((ip) => ours.includes(ip));
  }
  return { txt, routing };
}

export type VerifyResult = {
  status: "VERIFIED" | "FAILED";
  txt: boolean;
  routing: boolean;
};

export async function verifyCustomDomain(
  ctx: TenantContext,
  resolver: DnsResolver = systemResolver,
): Promise<VerifyResult> {
  requireEdit(ctx);
  requireEnabled();
  const branding = await db.branding.findFirst({
    where: { agencyId: ctx.agencyId },
    select: { customDomain: true, domainVerifyToken: true },
  });
  if (!branding?.customDomain || !branding.domainVerifyToken) {
    throw new NotFoundError("Add a domain first.");
  }
  const result = await checkDns(
    branding.customDomain,
    branding.domainVerifyToken,
    cnameTarget(),
    resolver,
  );
  const status = result.txt && result.routing ? "VERIFIED" : "FAILED";
  await db.branding.updateMany({
    where: { agencyId: ctx.agencyId },
    data: { customDomainStatus: status },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "branding.domain_verified",
    targetType: "Branding",
    targetId: ctx.agencyId,
    metadata: { status, ...result },
  });
  return { status, ...result };
}

/**
 * Finds the agency for a verified custom domain. Used by host routing and by the "is this domain
 * allowed" check, before anyone is signed in, so it uses the plain client.
 */
export async function findAgencySlugByDomain(host: string): Promise<string | null> {
  const branding = await rawDb.branding.findFirst({
    where: {
      customDomain: host.toLowerCase(),
      customDomainStatus: "VERIFIED",
      agency: { status: "ACTIVE", deletedAt: null },
    },
    select: { agency: { select: { slug: true } } },
  });
  return branding?.agency.slug ?? null;
}
