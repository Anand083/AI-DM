import { MAX_KEYWORD_LENGTH, MAX_PASTE_LINES, normalizePhrase, parseTags } from "./keyword-input";

type CsvLine = { cells: string[]; line: number };

/** Reads CSV text into rows with the line each row starts on. Blank rows are left out. */
function parseCsvLines(text: string): CsvLine[] {
  const rows: CsvLine[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  const input = text.replace(/^\uFEFF/, "");
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((x) => x.trim() !== "")) rows.push({ cells: row, line: startLine });
    row = [];
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === "\n") line++;
        cell += c;
      }
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      endRow();
      line++;
      startLine = line;
    } else cell += c;
  }
  endRow();
  return rows;
}

/** Reads CSV text into rows of cells. Handles quoted cells, doubled quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  return parseCsvLines(text).map((r) => r.cells);
}

export type ImportRow = { phrase: string; tags: string[]; targetUrl: string | null };
export type ImportProblem = { line: number; message: string };

const KEYWORD_HEADERS = ["keyword", "keywords", "phrase", "query", "search term"];
const TAG_HEADERS = ["tag", "tags"];
const URL_HEADERS = ["url", "target", "target url", "target_url", "page", "landing page"];

/** An exported cell may start with an apostrophe that protects it from spreadsheet formulas. */
const unprotect = (v: string) => v.replace(/^'(?=[=+\-@])/, "");

/**
 * Reads a keyword CSV. The first row may name the columns (keyword, tags, url). Without names
 * the columns are keyword, tags, url. Bad rows are listed with their line, good rows are kept.
 */
export function parseKeywordCsv(text: string): {
  rows: ImportRow[];
  problems: ImportProblem[];
  truncated: boolean;
} {
  const all = parseCsvLines(text);
  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  if (all.length === 0) return { rows, problems, truncated: false };

  const first = all[0]!.cells.map((c) => c.trim().toLowerCase());
  const hasHeader = first.some((c) => KEYWORD_HEADERS.includes(c));
  const at = (names: string[], fallback: number) => {
    if (!hasHeader) return fallback;
    const i = first.findIndex((c) => names.includes(c));
    return i;
  };
  const kCol = at(KEYWORD_HEADERS, 0);
  const tCol = at(TAG_HEADERS, 1);
  const uCol = at(URL_HEADERS, 2);

  const data = hasHeader ? all.slice(1) : all;
  const seen = new Set<string>();
  const slice = data.slice(0, MAX_PASTE_LINES);
  slice.forEach(({ cells, line }) => {
    const phrase = normalizePhrase(unprotect(cells[kCol] ?? ""));
    if (!phrase) {
      problems.push({ line, message: "No keyword on this line." });
      return;
    }
    if (phrase.length > MAX_KEYWORD_LENGTH) {
      problems.push({ line, message: `Keyword is longer than ${MAX_KEYWORD_LENGTH} characters.` });
      return;
    }
    if (seen.has(phrase)) {
      problems.push({ line, message: `"${phrase}" is listed twice. The first one is used.` });
      return;
    }
    const rawUrl = tCol === -1 && uCol === -1 ? "" : unprotect((cells[uCol] ?? "").trim());
    if (rawUrl && !/^https?:\/\/\S+$/i.test(rawUrl)) {
      problems.push({ line, message: `"${rawUrl.slice(0, 40)}" is not a full web address.` });
      return;
    }
    seen.add(phrase);
    const tagText = tCol === -1 ? "" : (cells[tCol] ?? "").replace(/[;|]/g, ",");
    rows.push({ phrase, tags: parseTags(tagText), targetUrl: rawUrl || null });
  });
  return { rows, problems, truncated: data.length > MAX_PASTE_LINES };
}
