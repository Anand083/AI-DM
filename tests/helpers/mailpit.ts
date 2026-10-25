/** Reads emails from Mailpit (or scripts/mail-sink.ts, which has the same API). */
const base = process.env.MAILPIT_URL ?? "http://localhost:8025";
// For a mailbox behind a password ("user:password"), as on the server.
const auth = process.env.MAILPIT_AUTH
  ? { Authorization: `Basic ${Buffer.from(process.env.MAILPIT_AUTH).toString("base64")}` }
  : undefined;
const get = (url: string) => fetch(url, { headers: auth });

export type MailMessage = {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  HTML: string;
  Text: string;
  FromName?: string;
  ReplyTo?: { Address: string }[];
  Attachments?: { FileName: string; ContentType: string; Size: number }[];
};

export async function clearMail(): Promise<void> {
  await fetch(`${base}/api/v1/messages`, { method: "DELETE", headers: auth });
}

/** Waits until an email to `to` with a matching subject arrives, then returns its full content. */
export async function waitForEmail(
  to: string,
  subject: RegExp | string,
  timeoutMs = 15_000,
): Promise<MailMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await get(`${base}/api/v1/messages`)).json()) as {
      messages: { ID: string; Subject: string; To: { Address: string }[] }[];
    };
    const hit = list.messages.find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) &&
        (typeof subject === "string" ? m.Subject.includes(subject) : subject.test(m.Subject)),
    );
    if (hit) return (await (await get(`${base}/api/v1/message/${hit.ID}`)).json()) as MailMessage;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No email to ${to} matching ${String(subject)} within ${timeoutMs}ms`);
}

/** First http link in the email text that matches `pattern`. */
export function extractLink(message: MailMessage, pattern: RegExp): string {
  const source = `${message.Text}\n${message.HTML}`;
  const links = source.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const link = links.map((l) => l.replace(/&amp;/g, "&")).find((l) => pattern.test(l));
  if (!link) throw new Error(`No link matching ${pattern} in email "${message.Subject}"`);
  return link;
}
