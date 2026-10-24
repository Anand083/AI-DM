import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailProvider } from "./types";

export type SmtpOptions = { host: string; port: number; from: string };

/** Splits `Name <a@b.c>` into its parts. Falls back to the whole string as the address. */
export function parseFrom(from: string): { name?: string; address: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return { address: from.trim() };
  const name = match[1]?.trim();
  return { name: name || undefined, address: match[2]!.trim() };
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp" as const;
  private readonly transporter: Transporter;
  private readonly from: { name?: string; address: string };

  constructor(options: SmtpOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: false,
      ignoreTLS: options.host === "localhost" || options.host === "127.0.0.1",
    });
    this.from = parseFrom(options.from);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: { name: message.fromName ?? this.from.name ?? "", address: this.from.address },
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}
