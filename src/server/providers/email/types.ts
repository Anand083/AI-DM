export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name for the From address. Defaults to the platform name. */
  fromName?: string;
  replyTo?: string;
};

export interface EmailProvider {
  readonly name: "console" | "smtp" | "ses";
  send(message: EmailMessage): Promise<void>;
}
