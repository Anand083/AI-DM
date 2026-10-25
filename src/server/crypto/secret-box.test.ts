import { describe, expect, it } from "vitest";
import { open, seal } from "./secret-box";

const secret = "a-real-encryption-key-32-bytes!!";

describe("secret box", () => {
  it("gives back what was sealed, including unicode and empty text", () => {
    for (const text of ["ya29.a0AfH6SMB-token", "", "tokén 🔒 with spaces"]) {
      expect(open(seal(text, secret), secret)).toBe(text);
    }
  });

  it("never shows the text and never repeats the same output", () => {
    const a = seal("ya29.token", secret);
    const b = seal("ya29.token", secret);
    expect(a).not.toContain("ya29");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
  });

  it("refuses a wrong key", () => {
    expect(() => open(seal("token", secret), "another-key-another-key-another!!")).toThrow();
  });

  it("refuses a value that was changed or is not sealed", () => {
    const parts = seal("token", secret).split(".");
    const flipped = parts[3]!.startsWith("A") ? `B${parts[3]!.slice(1)}` : `A${parts[3]!.slice(1)}`;
    expect(() => open([...parts.slice(0, 3), flipped].join("."), secret)).toThrow();
    expect(() => open("plain text", secret)).toThrow("Not an encrypted value.");
    expect(() => open("v2.a.b.c", secret)).toThrow("Not an encrypted value.");
  });
});
