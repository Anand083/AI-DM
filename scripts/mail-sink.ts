/**
 * Tiny stand-in for Mailpit, for machines without Docker (for example cloud sandboxes).
 * Receives mail on SMTP (default 1025) and serves the small part of the Mailpit HTTP API
 * that our tests use (default 8025). Mailpit is still the tool used in docker-compose and CI.
 *
 *   pnpm tsx scripts/mail-sink.ts
 */
import { createServer as createHttp } from "node:http";
import { createServer as createSmtp } from "node:net";

type Stored = {
  ID: string;
  From: string;
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
  Created: string;
};

const messages: Stored[] = [];
const smtpPort = Number(process.env.SMTP_PORT ?? 1025);
const httpPort = Number(process.env.MAILPIT_HTTP_PORT ?? 8025);

function decodeBody(body: string, encoding: string): string {
  const enc = encoding.toLowerCase();
  if (enc === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (enc === "quoted-printable") {
    const bytes: number[] = [];
    const joined = body.replace(/=\r?\n/g, "");
    for (let i = 0; i < joined.length; i++) {
      const c = joined[i]!;
      if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
        bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(...Buffer.from(c, "utf8"));
      }
    }
    return Buffer.from(bytes).toString("utf8");
  }
  return body;
}

function parseHeaders(raw: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) headers.set(line.slice(0, idx).toLowerCase(), line.slice(idx + 1).trim());
  }
  return headers;
}

function splitPart(raw: string): { headers: Map<string, string>; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match) return { headers: parseHeaders(raw), body: "" };
  return {
    headers: parseHeaders(raw.slice(0, match.index)),
    body: raw.slice(match.index + match[0].length),
  };
}

function collect(raw: string, out: { text: string; html: string }): void {
  const { headers, body } = splitPart(raw);
  const type = headers.get("content-type") ?? "text/plain";
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (type.toLowerCase().startsWith("multipart/") && boundary) {
    for (const part of body.split(`--${boundary}`)) {
      const trimmed = part.replace(/^\r?\n/, "");
      if (trimmed.startsWith("--") || trimmed.trim() === "") continue;
      collect(trimmed, out);
    }
    return;
  }
  const decoded = decodeBody(body, headers.get("content-transfer-encoding") ?? "7bit");
  if (type.toLowerCase().startsWith("text/html")) out.html += decoded;
  else if (type.toLowerCase().startsWith("text/plain")) out.text += decoded;
}

function decodeWords(value: string): string {
  return value.replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_m, kind: string, data: string) =>
    kind.toLowerCase() === "b"
      ? Buffer.from(data, "base64").toString("utf8")
      : decodeBody(data.replace(/_/g, " "), "quoted-printable"),
  );
}

function store(data: string, from: string, to: string[]): void {
  const { headers, body } = splitPart(data);
  const out = { text: "", html: "" };
  collect(`${[...headers].map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n${body}`, out);
  messages.unshift({
    ID: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    From: from,
    To: to.map((Address) => ({ Address })),
    Subject: decodeWords(headers.get("subject") ?? ""),
    Text: out.text,
    HTML: out.html,
    Created: new Date().toISOString(),
  });
}

createSmtp((socket) => {
  let from = "";
  let to: string[] = [];
  let inData = false;
  let data = "";
  let buffer = "";
  socket.write("220 mail-sink ESMTP\r\n");
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          store(data, from, to);
          data = "";
          socket.write("250 OK\r\n");
        } else {
          data += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
        }
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) socket.write("250 mail-sink\r\n");
      else if (cmd.startsWith("MAIL FROM")) {
        from = /<([^>]*)>/.exec(line)?.[1] ?? "";
        to = [];
        socket.write("250 OK\r\n");
      } else if (cmd.startsWith("RCPT TO")) {
        to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
        socket.write("250 OK\r\n");
      } else if (cmd === "DATA") {
        inData = true;
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (cmd === "QUIT") {
        socket.write("221 Bye\r\n");
        socket.end();
      } else socket.write("250 OK\r\n");
    }
  });
  socket.on("error", () => {});
}).listen(smtpPort, () => console.log(`mail-sink SMTP on ${smtpPort}`));

createHttp((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (body: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "DELETE" && url.pathname === "/api/v1/messages") {
    messages.length = 0;
    return json({});
  }
  if (url.pathname === "/api/v1/messages") {
    return json({
      total: messages.length,
      messages: messages.map((m) => ({
        ID: m.ID,
        From: { Address: m.From },
        To: m.To,
        Subject: m.Subject,
        Created: m.Created,
      })),
    });
  }
  const single = /^\/api\/v1\/message\/([^/]+)$/.exec(url.pathname);
  if (single) {
    const id = single[1] === "latest" ? messages[0]?.ID : single[1];
    const found = messages.find((m) => m.ID === id);
    return found
      ? json({ ...found, From: { Address: found.From } })
      : json({ error: "not found" }, 404);
  }
  if (url.pathname === "/api/v1/info") return json({ Version: "mail-sink" });
  json({ error: "not found" }, 404);
}).listen(httpPort, () => console.log(`mail-sink HTTP on ${httpPort}`));
