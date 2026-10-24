import { normalizeHex, readableTextOn } from "./color";

export const DEFAULT_PRIMARY = "#18181b";
export const DEFAULT_ACCENT = "#2563eb";

export type BrandColors = { primaryColor: string; accentColor: string };

/**
 * CSS variables for a brand. Put them on a wrapper element; everything inside can use
 * `var(--brand-primary)` and so on. The "text" variables are black or white, whichever is
 * easier to read on top of that colour.
 */
export function brandCssVars(colors: Partial<BrandColors>): Record<string, string> {
  const primary = normalizeHex(colors.primaryColor ?? "") ?? DEFAULT_PRIMARY;
  const accent = normalizeHex(colors.accentColor ?? "") ?? DEFAULT_ACCENT;
  return {
    "--brand-primary": primary,
    "--brand-primary-text": readableTextOn(primary),
    "--brand-accent": accent,
    "--brand-accent-text": readableTextOn(accent),
  };
}

/** Two letters for a round logo placeholder: "Bright Dental" gives "BD". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1 ? words[0]!.slice(0, 2) : words[0]![0]! + words[words.length - 1]![0]!;
  return letters.toUpperCase();
}
