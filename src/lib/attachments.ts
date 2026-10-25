export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TASK = 10;

export type AttachmentKind = { contentType: string; extension: string };

const startsWith = (bytes: Uint8Array, magic: number[]) =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

/**
 * What a file really is, from its first bytes. The file name and the browser's type are not
 * trusted. Allowed: PNG, JPG, WebP, GIF, PDF, and plain text or CSV (valid UTF-8 without
 * control characters). Anything else, including SVG, HTML and office files, is refused.
 */
export function detectAttachment(bytes: Uint8Array, fileName: string): AttachmentKind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { contentType: "image/png", extension: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg", extension: "jpg" };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]))
    return { contentType: "image/gif", extension: "gif" };
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { contentType: "application/pdf", extension: "pdf" };
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return { contentType: "image/webp", extension: "webp" };
  const ext = /\.(txt|csv)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (ext && isPlainText(bytes))
    return ext === "csv"
      ? { contentType: "text/csv", extension: "csv" }
      : { contentType: "text/plain", extension: "txt" };
  return null;
}

/** Valid UTF-8 with no control characters other than tab, newline and carriage return. */
export function isPlainText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
}

/** A file name that is safe to show and to put in a download header. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f"<>:|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "file").slice(0, 120);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
