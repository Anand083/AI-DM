import "server-only";
import { getEnv } from "@/env";
import { ConsoleEmailProvider } from "./console";
import { SmtpEmailProvider } from "./smtp";
import type { EmailProvider } from "./types";

export type { EmailMessage, EmailProvider } from "./types";

let provider: EmailProvider | undefined;

/** Picks the email provider from `EMAIL_PROVIDER`. */
export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  const env = getEnv();
  switch (env.EMAIL_PROVIDER) {
    case "console":
      provider = new ConsoleEmailProvider();
      break;
    case "smtp":
      provider = new SmtpEmailProvider({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        from: env.EMAIL_FROM,
      });
      break;
    case "ses":
      throw new Error("EMAIL_PROVIDER=ses is not implemented yet. Use smtp or console.");
  }
  return provider;
}
