import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { passwordSchema } from "@/lib/auth-schemas";
import { getAuth } from "@/server/auth/better-auth";
import { rawDb } from "@/server/db/client";
import { hashToken } from "@/server/tokens";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export type PortalInvitePreview =
  | { status: "invalid" | "expired" | "used" }
  | { status: "valid"; email: string; agencyName: string; hasAccount: boolean };

async function findClientInvitation(agencySlug: string, token: string) {
  const invitation = await rawDb.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      agency: { select: { slug: true, status: true, deletedAt: true } },
    },
  });
  if (
    !invitation ||
    invitation.role !== "CLIENT" ||
    invitation.agency.slug !== agencySlug ||
    invitation.agency.status !== "ACTIVE" ||
    invitation.agency.deletedAt
  ) {
    return null;
  }
  return invitation;
}

/** What the portal invite page needs. The token (sent to the invited address) is the proof of access. */
export async function previewPortalInvite(
  agencySlug: string,
  token: string,
  agencyName: string,
): Promise<PortalInvitePreview> {
  const invitation = await findClientInvitation(agencySlug, token);
  if (!invitation) return { status: "invalid" };
  if (invitation.acceptedAt) return { status: "used" };
  if (invitation.expiresAt <= new Date()) return { status: "expired" };
  const account = await rawDb.user.findUnique({
    where: { email: invitation.email.toLowerCase() },
    select: { id: true },
  });
  return { status: "valid", email: invitation.email, agencyName, hasAccount: account !== null };
}

/**
 * Makes an account for the invited address. The invitation email proves they own the address, so
 * the account starts verified and no platform email is sent. Only for people who have no account yet.
 */
export async function createClientAccount(
  agencySlug: string,
  token: string,
  input: { name: string; password: string },
): Promise<{ email: string }> {
  const invitation = await findClientInvitation(agencySlug, token);
  if (!invitation) throw new NotFoundError("This invitation is not valid.");
  if (invitation.acceptedAt) throw new ConflictError("This invitation was already used.");
  if (invitation.expiresAt <= new Date())
    throw new ConflictError("This invitation has expired. Ask for a new one.");

  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) {
    throw new ValidationError("Enter your name.", { name: "Enter your name." });
  }
  const password = passwordSchema.safeParse(input.password);
  if (!password.success) {
    const message = password.error.issues[0]?.message ?? "Choose a stronger password.";
    throw new ValidationError(message, { password: message });
  }

  const email = invitation.email.toLowerCase();
  if (await rawDb.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new ConflictError("An account with this email already exists. Sign in instead.");
  }
  const hash = await (await getAuth().$context).password.hash(password.data);
  const userId = createId();
  await rawDb.user.create({
    data: {
      id: userId,
      name,
      email,
      emailVerified: true,
      accounts: {
        create: { id: createId(), accountId: userId, providerId: "credential", password: hash },
      },
    },
  });
  return { email };
}
