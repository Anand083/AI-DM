import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withTenantAction } from "@/server/auth/actions";
import { loadTenantContext } from "@/server/auth/tenant-context";
import {
  inviteMember,
  listMembers,
  listPendingInvitations,
  removeMember,
  resendInvitation,
  revokeInvitation,
  changeMemberRole,
} from "@/server/services/team";
import { getAgency } from "@/server/services/agency";
import { NotFoundError } from "@/server/services/errors";
import { z } from "zod";
import { createAgencyWithMembers } from "../../factories";
import { createGuardedTestClient, createTestClient, resetDb } from "../../helpers/db";

vi.mock("@/server/jobs/enqueue", () => ({
  enqueueEmail: async () => {},
}));

const prisma = createTestClient();
const guarded = createGuardedTestClient(prisma);

let A: Awaited<ReturnType<typeof createAgencyWithMembers>>;
let B: Awaited<ReturnType<typeof createAgencyWithMembers>>;
let inviteB: { id: string };

beforeAll(async () => {
  await resetDb(prisma);
  A = await createAgencyWithMembers(prisma, ["OWNER", "MEMBER"], "Agency A");
  B = await createAgencyWithMembers(prisma, ["OWNER", "MEMBER"], "Agency B");
  inviteB = await inviteMember(B.members[0]!.ctx, { email: "inv-b@example.test", role: "MEMBER" });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("tenant isolation: team and invitations", () => {
  it("a user of agency A has no context in agency B", async () => {
    expect(await loadTenantContext(A.members[0]!.user.id, B.agency.slug)).toBeNull();
    expect(await loadTenantContext(B.members[0]!.user.id, A.agency.slug)).toBeNull();
  });

  it("lists never include rows of another agency", async () => {
    const members = await listMembers(A.members[0]!.ctx);
    expect(members.rows.map((m) => m.user.id).sort()).toEqual(
      A.members.map((m) => m.user.id).sort(),
    );
    const invitations = await listPendingInvitations(A.members[0]!.ctx);
    expect(invitations.rows).toHaveLength(0);
  });

  it("A cannot touch B's members or invitations by id: always not found", async () => {
    const ctxA = A.members[0]!.ctx;
    await expect(removeMember(ctxA, B.members[1]!.member.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      changeMemberRole(ctxA, { memberId: B.members[1]!.member.id, role: "ADMIN" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(resendInvitation(ctxA, inviteB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(revokeInvitation(ctxA, inviteB.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.agencyMember.count({ where: { id: B.members[1]!.member.id } })).toBe(1);
    expect(await prisma.invitation.count({ where: { id: inviteB.id } })).toBe(1);
  });

  it("getAgency returns only the context's agency", async () => {
    expect((await getAgency(A.members[0]!.ctx)).id).toBe(A.agency.id);
  });

  it("the guarded client refuses queries without agencyId", async () => {
    await expect(guarded.agencyMember.findMany()).rejects.toThrow(/agencyId/);
    await expect(
      guarded.invitation.findMany({ where: { email: "inv-b@example.test" } }),
    ).rejects.toThrow(/agencyId/);
  });
});

describe("withTenantAction", () => {
  const schema = z.object({ note: z.string().min(3, "Too short.") });
  const handler = vi.fn(async (ctx: { agencyId: string }, input: { note: string }) => ({
    agencyId: ctx.agencyId,
    note: input.note,
  }));

  const makeAction = (userId: string | null, verified = true) =>
    withTenantAction({ permission: "team.manage", schema }, handler, {
      getUser: async () =>
        userId
          ? {
              id: userId,
              name: "n",
              email: "e@x.test",
              emailVerified: verified,
              isSuperAdmin: false,
              timezone: "UTC",
            }
          : null,
      loadContext: loadTenantContext,
    });

  it("rejects signed-out and unverified users", async () => {
    expect(await makeAction(null)(A.agency.slug, { note: "hello" })).toMatchObject({ ok: false });
    expect(
      await makeAction(A.members[0]!.user.id, false)(A.agency.slug, { note: "hello" }),
    ).toMatchObject({ ok: false });
  });

  it("says Not found for a non-member, without running the handler", async () => {
    handler.mockClear();
    const result = await makeAction(A.members[0]!.user.id)(B.agency.slug, { note: "hello" });
    expect(result).toEqual({ ok: false, error: "Not found." });
    expect(handler).not.toHaveBeenCalled();
  });

  it("checks the permission before the input", async () => {
    handler.mockClear();
    const result = await makeAction(A.members[1]!.user.id)(A.agency.slug, { note: "x" });
    expect(result).toEqual({ ok: false, error: "You do not have permission to do this." });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns field errors for bad input", async () => {
    const result = await makeAction(A.members[0]!.user.id)(A.agency.slug, { note: "x" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { note: "Too short." } });
  });

  it("runs the handler with the right context when everything is fine", async () => {
    const result = await makeAction(A.members[0]!.user.id)(A.agency.slug, { note: "hello" });
    expect(result).toEqual({ ok: true, data: { agencyId: A.agency.id, note: "hello" } });
  });

  it("turns service errors into messages and hides unexpected ones", async () => {
    const fail = withTenantAction(
      { permission: "team.manage", schema: z.object({}) },
      async () => {
        throw new NotFoundError("Thing not found.");
      },
      {
        getUser: async () => ({
          id: A.members[0]!.user.id,
          name: "n",
          email: "e@x.test",
          emailVerified: true,
          isSuperAdmin: false,
          timezone: "UTC",
        }),
        loadContext: loadTenantContext,
      },
    );
    expect(await fail(A.agency.slug, {})).toEqual({
      ok: false,
      error: "Thing not found.",
      fieldErrors: undefined,
    });
    const crash = withTenantAction(
      { permission: "team.manage", schema: z.object({}) },
      async () => {
        throw new Error("secret database detail");
      },
      {
        getUser: async () => ({
          id: A.members[0]!.user.id,
          name: "n",
          email: "e@x.test",
          emailVerified: true,
          isSuperAdmin: false,
          timezone: "UTC",
        }),
        loadContext: loadTenantContext,
      },
    );
    const result = await crash(A.agency.slug, {});
    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." });
  });
});
