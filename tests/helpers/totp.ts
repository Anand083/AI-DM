import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  let bits = "";
  for (const char of text.toUpperCase().replace(/=+$/, "")) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`Not a base32 character: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The 6-digit authenticator code for a secret at a moment (RFC 6238: SHA-1, 30 second steps). */
export function totp(secret: string, at: Date = new Date(), digits = 6, stepSeconds = 30): string {
  const counter = Math.floor(at.getTime() / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}
