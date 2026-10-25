export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name for the From address. Defaults to the platform name. */
  fromName?: string;
  replyTo?: string;
  /** Files to attach. The content is base64 text so the message can travel through the queue. */
  attachments?: { filename: string; contentType: string; contentBase64: string }[];
};

export interface EmailProvider {
  readonly name: "console" | "smtp" | "ses";
  send(message: EmailMessage): Promise<void>;
}
