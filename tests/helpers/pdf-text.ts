import { inflateSync } from "node:zlib";

/**
 * Reads the text out of a PDF made by react-pdf, without any extra library.
 * The page content is compressed (Flate) and text is written as hex codes in `TJ` operators.
 * Standard fonts use one byte per letter, so the hex codes are plain character codes.
 * Returns the text of every show-text operator, joined with newlines, plus the raw document text
 * (for the Info dictionary: title, author, creator, producer).
 */
export function readPdf(buffer: Buffer): { text: string; raw: string } {
  const raw = buffer.toString("latin1");
  const contents: string[] = [raw];
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      contents.push(inflateSync(buffer.subarray(start, end)).toString("latin1"));
    } catch {
      // Not a Flate stream (an image or a font). Skip it.
    }
  }
  const pieces: string[] = [];
  const hex = (h: string) => Buffer.from(h.length % 2 ? `${h}0` : h, "hex").toString("latin1");
  for (const content of contents) {
    for (const op of content.matchAll(
      /\[((?:<[0-9a-fA-F]*>|\s|-?[\d.]+)*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g,
    )) {
      if (op[1] !== undefined) {
        pieces.push([...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => hex(m[1]!)).join(""));
      } else {
        pieces.push(hex(op[2]!));
      }
    }
  }
  return { text: pieces.join("\n"), raw };
}
