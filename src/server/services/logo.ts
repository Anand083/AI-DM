import sharp from "sharp";
import { ValidationError } from "./errors";

export const MAX_LOGO_BYTES = 1024 * 1024;
export const MAX_LOGO_SIDE = 512;
const MAX_PIXELS = 40_000_000;

export type ProcessedLogo = {
  bytes: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
};

type Kind = "png" | "jpeg" | "webp";

/** What the file really is, from its first bytes. The file name and the browser's type are not trusted. */
export function detectImageKind(bytes: Buffer): Kind | "svg" | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  const head = bytes.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") || head.includes("<svg")) return "svg";
  return null;
}

const TYPES: Record<Kind, { contentType: string; extension: string }> = {
  png: { contentType: "image/png", extension: "png" },
  jpeg: { contentType: "image/jpeg", extension: "jpg" },
  webp: { contentType: "image/webp", extension: "webp" },
};

/**
 * Checks and shrinks an uploaded logo. Only PNG, JPG and WebP up to 1 MB are accepted (SVG is
 * refused because it can carry scripts). The image is decoded and written again, which removes
 * hidden data, fixes the rotation, and fits it inside 512 by 512 pixels.
 */
export async function processLogo(bytes: Buffer): Promise<ProcessedLogo> {
  if (bytes.length === 0)
    throw new ValidationError("Choose an image to upload.", { logo: "Choose an image to upload." });
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new ValidationError("The logo must be 1 MB or smaller.", {
      logo: "The logo must be 1 MB or smaller.",
    });
  }
  const kind = detectImageKind(bytes);
  if (kind === "svg") {
    throw new ValidationError("SVG images are not allowed. Use a PNG, JPG or WebP image.", {
      logo: "SVG images are not allowed. Use a PNG, JPG or WebP image.",
    });
  }
  if (!kind)
    throw new ValidationError("Use a PNG, JPG or WebP image.", {
      logo: "Use a PNG, JPG or WebP image.",
    });

  try {
    const pipeline = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize({
        width: MAX_LOGO_SIDE,
        height: MAX_LOGO_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      });
    const { data, info } =
      kind === "png"
        ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
        : kind === "jpeg"
          ? await pipeline
              .jpeg({ quality: 88, mozjpeg: true })
              .toBuffer({ resolveWithObject: true })
          : await pipeline.webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
    return { bytes: data, ...TYPES[kind], width: info.width, height: info.height };
  } catch {
    throw new ValidationError(
      "This image could not be read. Try saving it again as PNG, JPG or WebP.",
      {
        logo: "This image could not be read. Try saving it again as PNG, JPG or WebP.",
      },
    );
  }
}
