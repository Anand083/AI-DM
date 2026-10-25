import { describe, expect, it } from "vitest";
import { cleanFileName, detectAttachment, formatBytes, isPlainText } from "./attachments";

const bytes = (...n: number[]) => new Uint8Array(n);
const text = (s: string) => new TextEncoder().encode(s);

describe("detectAttachment", () => {
  it("knows images and PDFs from their first bytes, whatever the name says", () => {
    expect(
      detectAttachment(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "x.pdf")
        ?.contentType,
    ).toBe("image/png");
    expect(detectAttachment(bytes(0xff, 0xd8, 0xff, 0xe0), "a.png")?.contentType).toBe(
      "image/jpeg",
    );
    expect(detectAttachment(text("GIF89a...."), "a.gif")?.contentType).toBe("image/gif");
    expect(detectAttachment(text("%PDF-1.7 ..."), "a.png")?.contentType).toBe("application/pdf");
    expect(detectAttachment(text("RIFF\0\0\0\0WEBPVP8 "), "a.webp")?.contentType).toBe(
      "image/webp",
    );
  });
  it("accepts text and csv only with a matching name and clean text", () => {
    expect(detectAttachment(text("a,b\n1,2"), "data.csv")?.contentType).toBe("text/csv");
    expect(detectAttachment(text("hello"), "notes.TXT")?.contentType).toBe("text/plain");
    expect(detectAttachment(text("hello"), "notes.md")).toBeNull();
    expect(detectAttachment(bytes(0x41, 0x00, 0x42), "notes.txt")).toBeNull();
  });
  it("refuses SVG, HTML and scripts", () => {
    expect(detectAttachment(text("<svg onload=alert(1)>"), "a.svg")).toBeNull();
    expect(detectAttachment(text("<html><script>x</script>"), "a.html")).toBeNull();
    expect(detectAttachment(text("<svg></svg>"), "a.txt")?.contentType).toBe("text/plain");
  });
});

describe("helpers", () => {
  it("checks plain text", () => {
    expect(isPlainText(text("line\r\nline\tok"))).toBe(true);
    expect(isPlainText(bytes(0xc3, 0x28))).toBe(false);
    expect(isPlainText(bytes(0x07))).toBe(false);
  });
  it("cleans names", () => {
    expect(cleanFileName("..\\..\\evil/../report.pdf")).toBe("report.pdf");
    expect(cleanFileName('a"b<c>.png')).toBe("abc.png");
    expect(cleanFileName("")).toBe("file");
    expect(cleanFileName("x".repeat(300))).toHaveLength(120);
  });
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
