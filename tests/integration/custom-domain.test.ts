import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CUSTOM_DOMAINS_ENABLED = "true";
  process.env.APP_URL = "http://app.platform.test";
  process.env.BETTER_AUTH_URL = "http://app.platform.test";
});

import { GET as allowed } from "@/app/api/internal/domain-allowed/route";
import { GET as resolve } from "@/app/api/internal/domain-resolve/route";
import {
  checkDns,
  findAgencySlugByDomain,
  getCustomDomain,
  removeCustomDomain,
  setCustomDomain,
  verifyCustomDomain,
  type DnsResolver,
} from "@/server/services/custom-domain";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();

function resolver(
  records: Partial<{ txt: string[][]; cname: string[]; a: Record<string, string[]> }>,
): DnsResolver {
  return {
    resolveTxt: async () => records.txt ?? [],
    resolveCname: async () => records.cname ?? [],
    resolve4: async (name) => records.a?.[name] ?? [],
  };
}

async function setup(plan = "AGENCY") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    "Agency One",
    plan,
  );
  return { agency, owner: members[0]!, member: members[1]! };
}

beforeEach(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("setting a domain", () => {
  it("saves it as pending with DNS steps", async () => {
    const { owner } = await setup();
    const view = await setCustomDomain(owner.ctx, "https://Reports.Agency-One.test/x");
    expect(view).toMatchObject({
      domain: "reports.agency-one.test",
      status: "PENDING",
      enabled: true,
      allowedByPlan: true,
    });
    expect(view.records.map((r) => r.type)).toEqual(["CNAME", "TXT"]);
    expect(view.records[0]!.value).toBe("app.platform.test");
    expect(view.records[1]!.name).toBe("_portal-verify.reports.agency-one.test");
    expect(view.records[1]!.value).toMatch(/^portal-verify=\S{10,}$/);
  });

  it("checks permission, plan, spelling, platform hosts and other agencies", async () => {
    const a = await setup();
    const b = await setup();
    await expect(setCustomDomain(a.member.ctx, "reports.a.test")).rejects.toThrow(ForbiddenError);
    await expect(setCustomDomain(a.owner.ctx, "not a domain")).rejects.toThrow(ValidationError);
    await expect(setCustomDomain(a.owner.ctx, "app.platform.test")).rejects.toThrow(
      /belongs to us/,
    );
    await setCustomDomain(a.owner.ctx, "reports.a.test");
    await expect(setCustomDomain(b.owner.ctx, "reports.a.test")).rejects.toThrow(ConflictError);
    // The same agency may save the same domain again.
    await setCustomDomain(a.owner.ctx, "reports.a.test");
    const starter = await setup("STARTER");
    await expect(setCustomDomain(starter.owner.ctx, "reports.s.test")).rejects.toThrow(
      /does not include a custom domain/,
    );
  });

  it("starts verification again when the domain changes", async () => {
    const { owner } = await setup();
    const first = await setCustomDomain(owner.ctx, "one.agency.test");
    const second = await setCustomDomain(owner.ctx, "two.agency.test");
    expect(second.records[1]!.value).not.toBe(first.records[1]!.value);
    expect(second.status).toBe("PENDING");
  });
});

describe("verifying", () => {
  it("needs the TXT token and a CNAME to us", async () => {
    const { owner } = await setup();
    const view = await setCustomDomain(owner.ctx, "reports.agency.test");
    const token = view.records[1]!.value;
    const txt = [[token]];

    expect(await verifyCustomDomain(owner.ctx, resolver({}))).toMatchObject({
      status: "FAILED",
      txt: false,
      routing: false,
    });
    expect(await verifyCustomDomain(owner.ctx, resolver({ txt }))).toMatchObject({
      status: "FAILED",
      txt: true,
      routing: false,
    });
    expect(
      await verifyCustomDomain(owner.ctx, resolver({ cname: ["app.platform.test"] })),
    ).toMatchObject({ status: "FAILED", txt: false, routing: true });
    expect((await getCustomDomain(owner.ctx)).status).toBe("FAILED");
    expect(
      await verifyCustomDomain(owner.ctx, resolver({ txt, cname: ["App.Platform.Test."] })),
    ).toMatchObject({ status: "VERIFIED" });
    expect((await getCustomDomain(owner.ctx)).status).toBe("VERIFIED");
  });

  it("accepts matching A records for a bare domain, and split TXT strings", async () => {
    const result = await checkDns(
      "agency.test",
      "tok",
      "app.platform.test",
      resolver({
        txt: [["portal-verify=", "tok"]],
        a: { "agency.test": ["1.2.3.4"], "app.platform.test": ["1.2.3.4", "5.6.7.8"] },
      }),
    );
    expect(result).toEqual({ txt: true, routing: true });
    const wrong = await checkDns(
      "agency.test",
      "tok",
      "app.platform.test",
      resolver({
        txt: [["portal-verify=other"]],
        a: { "agency.test": ["9.9.9.9"], "app.platform.test": ["1.2.3.4"] },
      }),
    );
    expect(wrong).toEqual({ txt: false, routing: false });
  });

  it("survives DNS errors", async () => {
    const broken: DnsResolver = {
      resolveTxt: async () => {
        throw new Error("ENOTFOUND");
      },
      resolveCname: async () => {
        throw new Error("ENODATA");
      },
      resolve4: async () => {
        throw new Error("ENOTFOUND");
      },
    };
    expect(await checkDns("agency.test", "tok", "app.platform.test", broken)).toEqual({
      txt: false,
      routing: false,
    });
  });

  it("needs a domain first", async () => {
    const { owner } = await setup();
    await expect(verifyCustomDomain(owner.ctx, resolver({}))).rejects.toThrow(NotFoundError);
  });
});

describe("lookup and endpoints", () => {
  async function verified() {
    const s = await setup();
    const view = await setCustomDomain(s.owner.ctx, "reports.agency.test");
    await verifyCustomDomain(
      s.owner.ctx,
      resolver({ txt: [[view.records[1]!.value]], cname: ["app.platform.test"] }),
    );
    const slug = (await prisma.agency.findUniqueOrThrow({ where: { id: s.agency.id } })).slug;
    return { ...s, slug };
  }
  const req = (path: string) => new Request(`http://app.platform.test${path}`);

  it("finds the agency only for verified domains of active agencies", async () => {
    const s = await verified();
    expect(await findAgencySlugByDomain("Reports.Agency.test")).toBe(s.slug);
    expect(await findAgencySlugByDomain("other.agency.test")).toBeNull();
    await prisma.agency.update({ where: { id: s.agency.id }, data: { status: "SUSPENDED" } });
    expect(await findAgencySlugByDomain("reports.agency.test")).toBeNull();
  });

  it("does not find pending domains or removed domains", async () => {
    const s = await setup();
    await setCustomDomain(s.owner.ctx, "pending.agency.test");
    expect(await findAgencySlugByDomain("pending.agency.test")).toBeNull();
    await removeCustomDomain(s.owner.ctx);
    expect((await getCustomDomain(s.owner.ctx)).status).toBe("NONE");
  });

  it("domain-allowed answers 200 only for verified domains", async () => {
    await verified();
    expect(
      (await allowed(req("/api/internal/domain-allowed?domain=reports.agency.test"))).status,
    ).toBe(200);
    expect(
      (await allowed(req("/api/internal/domain-allowed?domain=nope.agency.test"))).status,
    ).toBe(404);
    expect((await allowed(req("/api/internal/domain-allowed"))).status).toBe(404);
    expect((await allowed(req("/api/internal/domain-allowed?domain=%20%20"))).status).toBe(404);
  });

  it("domain-resolve gives the slug of a verified domain", async () => {
    const s = await verified();
    const ok = await resolve(req("/api/internal/domain-resolve?host=reports.agency.test"));
    expect(await ok.json()).toEqual({ slug: s.slug });
    expect((await resolve(req("/api/internal/domain-resolve?host=x.agency.test"))).status).toBe(
      404,
    );
  });
});
