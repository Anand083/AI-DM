import "server-only";
import { z } from "zod";
import { emailSchema } from "@/lib/auth-schemas";
import { rawDb } from "@/server/db/client";
import { enqueueEmail } from "@/server/jobs/enqueue";
import { ValidationError } from "./errors";

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100, "Use 100 characters or fewer."),
  email: emailSchema,
  message: z
    .string()
    .trim()
    .min(10, "Write a little more, at least 10 characters.")
    .max(4000, "Use 4000 characters or fewer."),
  /** A hidden field. People leave it empty; many bots fill it in. */
  company: z.string().max(200).optional(),
});

export type ContactResult = { stored: boolean };

/**
 * Saves a message from the public contact form and emails the super admins. A filled-in hidden
 * field means a bot: we say thank you and drop it. This is public, so the caller limits requests.
 */
export async function submitContactMessage(
  rawInput: unknown,
  meta: { ip?: string } = {},
): Promise<ContactResult> {
  const parsed = contactSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    throw new ValidationError("Please check the form.", fieldErrors);
  }
  const input = parsed.data;
  if (input.company && input.company.trim() !== "") return { stored: false };

  const message = await rawDb.contactMessage.create({
    data: { name: input.name, email: input.email, message: input.message, ip: meta.ip ?? null },
    select: { id: true },
  });
  const admins = await rawDb.user.findMany({
    where: { isSuperAdmin: true },
    select: { email: true },
    take: 20,
  });
  for (const admin of admins) {
    await enqueueEmail(
      {
        to: admin.email,
        subject: `New contact message from ${input.name}`,
        text: `From: ${input.name} <${input.email}>\n\n${input.message}`,
        html: `<p><strong>From:</strong> ${escapeHtml(input.name)} &lt;${escapeHtml(input.email)}&gt;</p><p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>`,
        replyTo: input.email,
      },
      `contact_${message.id}_${admin.email}`,
    );
  }
  return { stored: true };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
