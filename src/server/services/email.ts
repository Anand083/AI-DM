import "server-only";
import { render } from "@react-email/components";
import { getEnv } from "@/env";
import { Invite, type InviteProps } from "@/emails/invite";
import { ResetPassword } from "@/emails/reset-password";
import { VerifyEmail } from "@/emails/verify-email";
import { getEmailProvider } from "@/server/providers/email";

async function renderBoth(element: React.ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

/** Account emails come from the platform itself, so they use the platform name. */
export async function sendVerifyEmail(to: { email: string; name: string }, url: string) {
  const brandName = getEnv().APP_NAME;
  const body = await renderBoth(VerifyEmail({ brandName, name: to.name, url }));
  await getEmailProvider().send({ to: to.email, subject: "Confirm your email", ...body });
}

export async function sendResetPasswordEmail(to: { email: string; name: string }, url: string) {
  const brandName = getEnv().APP_NAME;
  const body = await renderBoth(ResetPassword({ brandName, name: to.name, url }));
  await getEmailProvider().send({ to: to.email, subject: "Reset your password", ...body });
}

/** Invites use the agency name. Client invites must never show the platform name. */
export async function sendInviteEmail(
  to: string,
  props: InviteProps & { replyTo?: string },
): Promise<void> {
  const body = await renderBoth(Invite(props));
  await getEmailProvider().send({
    to,
    subject: `You are invited to ${props.brandName}`,
    fromName: props.brandName,
    replyTo: props.replyTo,
    ...body,
  });
}
