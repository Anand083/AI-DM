import "server-only";
import { render } from "@react-email/components";
import { getEnv } from "@/env";
import { BillingNotice, type BillingNoticeProps } from "@/emails/billing-notice";
import { ClientInvite, type ClientInviteProps } from "@/emails/client-invite";
import { Invite, type InviteProps } from "@/emails/invite";
import { ResetPassword } from "@/emails/reset-password";
import { VerifyEmail } from "@/emails/verify-email";
import { enqueueEmail } from "@/server/jobs/enqueue";

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

export async function sendResetPasswordEmail(to: { email: string; name: string }, url: string) {
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
