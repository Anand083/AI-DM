import { inflateRawSync } from "node:zlib";

/**
 * Reads a zip file from memory (no extra library): lists the files and gives their text.
 * Handles the stored and deflate methods, which is what our exports use.
 */
export function readZip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  // The end-of-central-directory record is the last 22 bytes (no comment).
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("Not a zip file");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Bad central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    files.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
