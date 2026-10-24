/** Turns "#abc" or "#AABBCC" into "#aabbcc". Returns null if it is not a hex colour. */
export function normalizeHex(input: string): string | null {
  const value = input.trim().toLowerCase();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (!match) return null;
  const hex = match[1]!;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return `#${full}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`Not a hex colour: ${hex}`);
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Black or white, whichever is easier to read on this background. */
export function readableTextOn(background: string): "#000000" | "#ffffff" {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#000000")
    ? "#ffffff"
    : "#000000";
}

export const MIN_TEXT_CONTRAST = 4.5;

export type ColorWarning = { field: "primaryColor" | "accentColor"; message: string };

/**
 * Warnings (not errors) about brand colours. The main colour is used as a button background with
 * white text and for text on white, so it needs enough contrast with white. The accent colour is
 * used for links on white.
 */
export function checkBrandColors(colors: {
  primaryColor: string;
  accentColor: string;
}): ColorWarning[] {
  const warnings: ColorWarning[] = [];
  const check = (field: ColorWarning["field"], name: string, use: string) => {
    const hex = normalizeHex(colors[field]);
    if (!hex) return;
    const ratio = contrastRatio(hex, "#ffffff");
    if (ratio < MIN_TEXT_CONTRAST) {
      warnings.push({
        field,
        message: `Your ${name} is hard to read ${use} (contrast ${ratio.toFixed(1)}, it should be at least ${MIN_TEXT_CONTRAST}). Try a darker color.`,
      });
    }
  };
  check("primaryColor", "main color", "with white text on top");
  check("accentColor", "accent color", "as text on a white page");
  return warnings;
}
