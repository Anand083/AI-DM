import { percentChange } from "./google-metrics";

export const DIMENSION_TABS = [
  { key: "QUERY", param: "query", label: "Queries", column: "Search query" },
  { key: "PAGE", param: "page", label: "Pages", column: "Page" },
  { key: "COUNTRY", param: "country", label: "Countries", column: "Country" },
  { key: "DEVICE", param: "device", label: "Devices", column: "Device" },
] as const;
export type DimensionKey = (typeof DIMENSION_TABS)[number]["key"];

export const dimensionFromParam = (value: string | undefined): DimensionKey =>
  DIMENSION_TABS.find((t) => t.param === value)?.key ?? "QUERY";

const DEVICE_NAMES: Record<string, string> = {
  MOBILE: "Phone",
  DESKTOP: "Computer",
  TABLET: "Tablet",
};

let regionNames: Intl.DisplayNames | null = null;

/** Readable name for a Search Console key. Countries come as 3-letter codes, devices in capitals. */
export function labelBreakdownKey(dimension: DimensionKey, key: string): string {
  if (dimension === "DEVICE") return DEVICE_NAMES[key] ?? key;
  if (dimension === "COUNTRY") {
    const alpha2: Record<string, string> = {
      usa: "US",
      gbr: "GB",
      ind: "IN",
      can: "CA",
      aus: "AU",
      deu: "DE",
      fra: "FR",
      esp: "ES",
      ita: "IT",
      nld: "NL",
      bra: "BR",
      mex: "MX",
      jpn: "JP",
      sgp: "SG",
      are: "AE",
      zaf: "ZA",
      irl: "IE",
      nzl: "NZ",
      pak: "PK",
      phl: "PH",
    };
    const code = alpha2[key.toLowerCase()];
    if (!code) return key.toUpperCase();
    try {
      regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
      return regionNames.of(code) ?? key.toUpperCase();
    } catch {
      return key.toUpperCase();
    }
  }
  return key;
}

/** Percent change of clicks against the 28 days before. Null when the key had no clicks then. */
export const clickChange = (now: number, before: number | undefined) =>
  before === undefined ? null : percentChange(now, before);

/** Share of sessions that were engaged, in whole percent. */
export const engagedPercent = (engaged: number, sessions: number) =>
  sessions === 0 ? 0 : Math.round((engaged / sessions) * 100);

/** Conversions per 100 sessions with one decimal, as text such as "2.4%". */
export const conversionRate = (conversions: number, sessions: number) =>
  sessions === 0 ? "0%" : `${(Math.round((conversions / sessions) * 1000) / 10).toString()}%`;
