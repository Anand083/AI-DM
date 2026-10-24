import type { Job } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/providers/seo/errors";
import { LimitExceededError } from "@/server/services/errors";
import { createAudit } from "@/server/services/audits";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

let startAuditImpl: () => Promise<{ taskId: string }> = async () => ({ taskId: "task" });

vi.mock("@/server/services/seo-gateway-instance", () => ({
  getSeoGateway: () => ({
    startAudit: () => startAuditImpl(),
    getAuditStatus: async () => ({ status: "running", progress: 10 }),
    getAuditResult: async () => {
      throw new Error("not used");
    },
  }),
}));

const prisma = createTestClient();

async function newAudit() {
  const { agency, members } = await createAgencyWithMembers(prisma, ["OWNER"], undefined, "GROWTH");
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "C" } });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "P",
      domain: "p.com",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  const audit = await createAudit(members[0]!.ctx, project.id, null, async () => {});
  return { agencyId: agency.id, auditId: audit.id };
}

const fakeJob = (name: string, data: object, attemptsMade: number, attempts = 3) =>
  ({ id: "j1", name, data, attemptsMade, opts: { attempts } }) as unknown as Job;

const statusOf = async (id: string) =>
  prisma.audit.findUniqueOrThrow({ where: { id }, select: { status: true, error: true } });

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("audit worker error handling", () => {
  it("fails the audit at once for a problem that retrying cannot fix", async () => {
    const { processors } = await import("@/server/jobs/processors");
    const { agencyId, auditId } = await newAudit();
    startAuditImpl = async () => {
      throw new ProviderError("Not enough credit with the data provider", false, "NO_FUNDS");
    };
    const result = await processors.audits!(fakeJob("run", { auditId, agencyId }, 0));
    expect(result).toEqual({ error: "Not enough credit with the data provider" });
    expect(await statusOf(auditId)).toEqual({
      status: "FAILED",
      error: "Not enough credit with the data provider",
    });
  });

  it("fails the audit with the plan or budget message", async () => {
    const { processors } = await import("@/server/jobs/processors");
    const { agencyId, auditId } = await newAudit();
    startAuditImpl = async () => {
      throw new LimitExceededError("New data requests are paused for now. Please try again later.");
    };
    await processors.audits!(fakeJob("run", { auditId, agencyId }, 0));
    expect(await statusOf(auditId)).toEqual({
      status: "FAILED",
      error: "New data requests are paused for now. Please try again later.",
    });
  });

  it("retries a temporary problem and only marks the audit failed on the last try", async () => {
    const { processors } = await import("@/server/jobs/processors");
    const { agencyId, auditId } = await newAudit();
    startAuditImpl = async () => {
      throw new ProviderError("timeout", true, "NETWORK");
    };
    await expect(processors.audits!(fakeJob("run", { auditId, agencyId }, 0))).rejects.toThrow(
      "timeout",
    );
    expect((await statusOf(auditId)).status).toBe("QUEUED");
    await expect(processors.audits!(fakeJob("run", { auditId, agencyId }, 1))).rejects.toThrow(
      "timeout",
    );
    expect((await statusOf(auditId)).status).toBe("QUEUED");
    await expect(processors.audits!(fakeJob("run", { auditId, agencyId }, 2))).rejects.toThrow(
      "timeout",
    );
    expect(await statusOf(auditId)).toEqual({
      status: "FAILED",
      error: "The audit could not be completed. Please try again.",
    });
  });

  it("starts the audit when all is well and queues the first progress check", async () => {
    const { processors } = await import("@/server/jobs/processors");
    const { agencyId, auditId } = await newAudit();
    startAuditImpl = async () => ({ taskId: "mock-audit.1.100.ZXhhbXBsZS5jb20" });
    const result = await processors.audits!(fakeJob("run", { auditId, agencyId }, 0));
    expect(result).toBe("started");
    expect((await statusOf(auditId)).status).toBe("RUNNING");
    const { getQueue } = await import("@/server/jobs/queues");
    const delayed = await getQueue("audits").getJobs(["delayed"]);
    expect(delayed.map((j) => j.name)).toEqual(["poll"]);
    expect(delayed[0]!.data).toMatchObject({ auditId, attempt: 1 });
    await getQueue("audits").obliterate({ force: true });
    await getQueue("audits").close();
  });
});
