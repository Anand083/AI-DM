export type Language = { code: string; name: string };

export const LANGUAGES: readonly Language[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "sv", name: "Swedish" },
  { code: "no", name: "Norwegian" },
  { code: "da", name: "Danish" },
  { code: "pl", name: "Polish" },
  { code: "tr", name: "Turkish" },
  { code: "ar", name: "Arabic" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "ru", name: "Russian" },
  { code: "zh", name: "Chinese" },
];

export const LANGUAGE_CODES: ReadonlySet<string> = new Set(LANGUAGES.map((l) => l.code));

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
