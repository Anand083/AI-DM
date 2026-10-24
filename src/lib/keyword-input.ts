export const MAX_KEYWORD_LENGTH = 100;
export const MAX_PASTE_LINES = 5000;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

/** Lowercase, trimmed, single spaces, no wrapping quotes. */
export function normalizePhrase(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type ParsedPaste = {
  /** Clean, unique phrases in the order they were pasted. */
  phrases: string[];
  /** Lines that were pasted more than once (not counting the first time). */
  duplicates: string[];
  /** Lines that were too long. */
  tooLong: string[];
  /** True when the text had more lines than we read. */
  truncated: boolean;
};

/** Reads a pasted list, one keyword per line. */
export function parseKeywordPaste(text: string): ParsedPaste {
  const lines = text.split(/\r?\n/);
  const result: ParsedPaste = {
    phrases: [],
    duplicates: [],
    tooLong: [],
    truncated: lines.length > MAX_PASTE_LINES,
  };
  const seen = new Set<string>();
  for (const line of lines.slice(0, MAX_PASTE_LINES)) {
    const phrase = normalizePhrase(line);
    if (!phrase) continue;
    if (phrase.length > MAX_KEYWORD_LENGTH) {
      result.tooLong.push(phrase.slice(0, 40) + "...");
      continue;
    }
    if (seen.has(phrase)) {
      result.duplicates.push(phrase);
      continue;
    }
    seen.add(phrase);
    result.phrases.push(phrase);
  }
  return result;
}

/** Tags typed as "brand, local seo": lowercase, unique, short. Throws nothing; bad tags are dropped. */
export function parseTags(text: string): string[] {
  const tags: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag || tag.length > MAX_TAG_LENGTH || !/^[a-z0-9][a-z0-9 _-]*$/.test(tag)) continue;
    if (!tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}
