import { logger } from "@/server/logger";
import type { EmailMessage, EmailProvider } from "./types";

/** Prints emails to the log instead of sending them. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console" as const;

  async send(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, text: message.text },
      "email (console)",
    );
  }
}
