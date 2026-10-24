import { PrismaClient, type MemberRole } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { DEMO_AGENCIES, DEMO_PASSWORD, DEMO_USERS, PLANS } from "./seed-data";

/** Idempotent seed. Safe to run many times. Demo data is created outside production only. */
export async function seed(prisma: PrismaClient, options: { demo: boolean }): Promise<void> {
  const plans = new Map<string, string>();
  for (const plan of PLANS) {
    const row = await prisma.plan.upsert({
      where: { code: plan.code },
      create: { ...plan, limits: plan.limits },
      update: {},
    });
    plans.set(plan.code, row.id);
  }
  if (!options.demo) return;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      create: { ...user, emailVerified: true },
      update: {},
    });
    const existing = await prisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
    });
    if (!existing) {
      await prisma.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: passwordHash,
        },
      });
    }
  }

  const now = new Date();
  const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000);

  for (const agency of DEMO_AGENCIES) {
    await prisma.agency.upsert({
      where: { slug: agency.slug },
      create: { id: agency.id, slug: agency.slug, name: agency.name, timezone: agency.timezone },
      update: {},
    });

    for (const [userId, role] of agency.members) {
      await prisma.agencyMember.upsert({
        where: { agencyId_userId: { agencyId: agency.id, userId } },
        create: { agencyId: agency.id, userId, role: role as MemberRole },
        update: {},
      });
    }

    const planId = plans.get(agency.plan);
    if (!planId) throw new Error(`Plan ${agency.plan} missing`);
    const trialing = agency.plan === "STARTER";
    await prisma.subscription.upsert({
      where: { agencyId: agency.id },
      create: {
        agencyId: agency.id,
        planId,
        status: trialing ? "TRIALING" : "ACTIVE",
        trialEndsAt: trialing ? inDays(14) : null,
        currentPeriodStart: trialing ? null : now,
        currentPeriodEnd: trialing ? null : inDays(30),
      },
      update: {},
    });

    for (const [index, [name, domain]] of agency.clients.entries()) {
      const clientId = `${agency.id}_client_${index + 1}`;
      await prisma.client.upsert({
        where: { id: clientId },
        create: {
          id: clientId,
          agencyId: agency.id,
          name,
          website: `https://${domain}`,
          contactName: "Contact Person",
          contactEmail: `hello@${domain}`,
        },
        update: {},
      });
      // Two projects per agency: on the first two clients.
      if (index < 2) {
        const projectId = `${agency.id}_project_${index + 1}`;
        await prisma.project.upsert({
          where: { id: projectId },
          create: {
            id: projectId,
            agencyId: agency.id,
            clientId,
            name: `${name} website`,
            domain,
            locationCode: 2840,
            languageCode: "en",
          },
          update: {},
        });
      }
    }
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const demo = process.env.NODE_ENV !== "production";
    await seed(prisma, { demo });
    if (demo) {
      console.log("Seed done. Demo password for every demo user:", DEMO_PASSWORD);
      console.log("Users:", DEMO_USERS.map((u) => u.email).join(", "));
    } else {
      console.log("Seed done (plans only, no demo data in production).");
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
