import "server-only";
import { render } from "@react-email/components";
import { getEnv } from "@/env";
import { BillingNotice, type BillingNoticeProps } from "@/emails/billing-notice";
import { ClientInvite, type ClientInviteProps } from "@/emails/client-invite";
import { Invite, type InviteProps } from "@/emails/invite";
import { ResetPassword } from "@/emails/reset-password";
import { VerifyEmail } from "@/emails/verify-email";
import { rawDb } from "@/server/db/client";
import { enqueueEmail } from "@/server/jobs/enqueue";
import { loadBranding } from "./branding";

async function renderBoth(element: React.ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

/** Account emails come from the platform itself, so they use the platform name. */
export async function sendVerifyEmail(to: { email: string; name: string }, url: string) {
  const brandName = getEnv().APP_NAME;
  const body = await renderBoth(VerifyEmail({ brandName, name: to.name, url }));
  await enqueueEmail({ to: to.email, subject: "Confirm your email", ...body });
}

/**
 * Someone who only has client access (no agency team role) is shown the agency, never the
 * platform. Returns that agency's brand, or null for everyone else.
 */
async function clientOnlyBrand(userId: string) {
  if ((await rawDb.agencyMember.count({ where: { userId } })) > 0) return null;
  const link = await rawDb.clientUser.findFirst({
    where: { userId, agency: { status: "ACTIVE", deletedAt: null } },
    select: { agency: { select: { id: true, slug: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!link) return null;
  const brand = await loadBranding(link.agency.id);
  return { slug: link.agency.slug, name: brand.displayName, supportEmail: brand.supportEmail };
}

/** Points the link at the branded portal page instead of the platform's reset page. */
export function portalResetUrl(url: string, slug: string): string {
  const u = new URL(url);
  u.searchParams.set("callbackURL", `/portal/${slug}/reset-password`);
  return u.toString();
}

export async function sendResetPasswordEmail(
  to: { id?: string; email: string; name: string },
  url: string,
) {
  const portal = to.id ? await clientOnlyBrand(to.id) : null;
  if (portal) {
    const body = await renderBoth(
      ResetPassword({
        brandName: portal.name,
        name: to.name,
        url: portalResetUrl(url, portal.slug),
      }),
    );
    await enqueueEmail({
      to: to.email,
      subject: "Reset your password",
      fromName: portal.name,
      replyTo: portal.supportEmail ?? undefined,
      ...body,
    });
    return;
  }
  const brandName = getEnv().APP_NAME;
  const body = await renderBoth(ResetPassword({ brandName, name: to.name, url }));
  await enqueueEmail({ to: to.email, subject: "Reset your password", ...body });
}

/** Invites use the agency name. Client invites must never show the platform name. */
export async function sendInviteEmail(
  to: string,
  props: InviteProps & { replyTo?: string },
): Promise<void> {
  const body = await renderBoth(Invite(props));
  await enqueueEmail({
    to,
    subject: `You are invited to ${props.brandName}`,
    fromName: props.brandName,
    replyTo: props.replyTo,
    ...body,
  });
}

/** Client invites show only the agency name, link to the portal, and reply to the agency. */
export async function sendClientInviteEmail(to: string, props: ClientInviteProps): Promise<void> {
  const body = await renderBoth(ClientInvite(props));
  await enqueueEmail({
    to,
    subject: `${props.brandName} invited you`,
    fromName: props.brandName,
    replyTo: props.supportEmail ?? undefined,
    ...body,
  });
}

/** Billing notices go to agency owners, so they use the platform name. `key` stops repeats. */
export async function sendBillingNoticeEmail(
  to: string,
  subject: string,
  props: Omit<BillingNoticeProps, "brandName">,
  key: string,
): Promise<void> {
  const body = await renderBoth(BillingNotice({ brandName: getEnv().APP_NAME, ...props }));
  await enqueueEmail({ to, subject, ...body }, key);
}

/** Tells a team member a task was given to them. Team emails use the platform name. */
export async function sendTaskAssignedEmail(
  to: string,
  props: { assigner: string; title: string; url: string },
  key: string,
): Promise<void> {
  const body = await renderBoth(
    BillingNotice({
      brandName: getEnv().APP_NAME,
      preview: `${props.assigner} gave you a task`,
      heading: "A task is yours",
      paragraphs: [`${props.assigner} assigned you: ${props.title}`],
      actionLabel: "Open the task",
      url: props.url,
    }),
  );
  await enqueueEmail({ to, subject: `Task: ${props.title}`.slice(0, 120), ...body }, key);
}

/** A new lead goes to the agency's team, so it uses the platform name like other team emails. */
export async function sendLeadNoticeEmail(
  to: string,
  subject: string,
  props: Omit<BillingNoticeProps, "brandName">,
  key: string,
): Promise<void> {
  const body = await renderBoth(BillingNotice({ brandName: getEnv().APP_NAME, ...props }));
  await enqueueEmail({ to, subject, ...body }, key);
}
