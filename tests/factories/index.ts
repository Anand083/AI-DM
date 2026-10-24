import { createId } from "@paralleldrive/cuid2";
import type { MemberRole, PrismaClient } from "@prisma/client";
import { PLANS } from "../../prisma/seed-data";
import type { TenantContext } from "@/server/auth/tenant-context";

export async function seedPlans(prisma: PrismaClient): Promise<void> {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: { ...plan, limits: plan.limits },
      update: {},
    });
  }
}

let counter = 0;

export async function createUser(
  prisma: PrismaClient,
  overrides: Partial<{ name: string; email: string; emailVerified: boolean }> = {},
) {
  counter += 1;
  return prisma.user.create({
    data: {
      name: overrides.name ?? `User ${counter}`,
      email: overrides.email ?? `user${counter}-${createId().slice(0, 6)}@example.test`,
      emailVerified: overrides.emailVerified ?? true,
    },
  });
}

/** An agency with the given members. The first member is the owner unless roles say otherwise. */
export async function createAgencyWithMembers(
  prisma: PrismaClient,
  roles: MemberRole[] = ["OWNER"],
  name = `Agency ${++counter}`,
  /** Plan code. When given, the agency gets an ACTIVE subscription (plans must be seeded). */
  plan?: string,
) {
  const agency = await prisma.agency.create({
    data: { name, slug: `agency-${createId().slice(0, 8).toLowerCase()}` },
  });
  if (plan) {
    const planRow = await prisma.plan.findUniqueOrThrow({ where: { code: plan } });
    await prisma.subscription.create({
      data: { agencyId: agency.id, planId: planRow.id, status: "ACTIVE" },
    });
  }
  const members = [];
  for (const role of roles) {
    const user = await createUser(prisma);
    const member = await prisma.agencyMember.create({
      data: { agencyId: agency.id, userId: user.id, role },
    });
    const ctx: TenantContext = { userId: user.id, agencyId: agency.id, role };
    members.push({ user, member, ctx });
  }
  return { agency, members };
}
