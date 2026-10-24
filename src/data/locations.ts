/**
 * Countries offered for rank tracking. Codes follow the Google Ads geo target IDs that
 * DataForSEO uses (for example 2840 is the United States). Verify against
 * `GET /v3/serp/google/locations` before go-live (plan Step 8c).
 */
export type Location = { code: number; name: string; countryCode: string };

export const LOCATIONS: readonly Location[] = [
  { code: 2840, name: "United States", countryCode: "US" },
  { code: 2826, name: "United Kingdom", countryCode: "GB" },
  { code: 2124, name: "Canada", countryCode: "CA" },
  { code: 2036, name: "Australia", countryCode: "AU" },
  { code: 2356, name: "India", countryCode: "IN" },
  { code: 2276, name: "Germany", countryCode: "DE" },
  { code: 2250, name: "France", countryCode: "FR" },
  { code: 2724, name: "Spain", countryCode: "ES" },
  { code: 2380, name: "Italy", countryCode: "IT" },
  { code: 2528, name: "Netherlands", countryCode: "NL" },
  { code: 2076, name: "Brazil", countryCode: "BR" },
  { code: 2484, name: "Mexico", countryCode: "MX" },
  { code: 2392, name: "Japan", countryCode: "JP" },
  { code: 2410, name: "South Korea", countryCode: "KR" },
  { code: 2702, name: "Singapore", countryCode: "SG" },
  { code: 2784, name: "United Arab Emirates", countryCode: "AE" },
  { code: 2710, name: "South Africa", countryCode: "ZA" },
  { code: 2554, name: "New Zealand", countryCode: "NZ" },
  { code: 2372, name: "Ireland", countryCode: "IE" },
  { code: 2752, name: "Sweden", countryCode: "SE" },
  { code: 2578, name: "Norway", countryCode: "NO" },
  { code: 2208, name: "Denmark", countryCode: "DK" },
  { code: 2616, name: "Poland", countryCode: "PL" },
  { code: 2756, name: "Switzerland", countryCode: "CH" },
  { code: 2040, name: "Austria", countryCode: "AT" },
  { code: 2056, name: "Belgium", countryCode: "BE" },
  { code: 2620, name: "Portugal", countryCode: "PT" },
  { code: 2792, name: "Turkey", countryCode: "TR" },
  { code: 2682, name: "Saudi Arabia", countryCode: "SA" },
  { code: 2818, name: "Egypt", countryCode: "EG" },
  { code: 2566, name: "Nigeria", countryCode: "NG" },
  { code: 2404, name: "Kenya", countryCode: "KE" },
  { code: 2608, name: "Philippines", countryCode: "PH" },
  { code: 2360, name: "Indonesia", countryCode: "ID" },
  { code: 2458, name: "Malaysia", countryCode: "MY" },
  { code: 2764, name: "Thailand", countryCode: "TH" },
  { code: 2704, name: "Vietnam", countryCode: "VN" },
  { code: 2586, name: "Pakistan", countryCode: "PK" },
  { code: 2050, name: "Bangladesh", countryCode: "BD" },
  { code: 2032, name: "Argentina", countryCode: "AR" },
  { code: 2152, name: "Chile", countryCode: "CL" },
  { code: 2170, name: "Colombia", countryCode: "CO" },
];

export const LOCATION_CODES: ReadonlySet<number> = new Set(LOCATIONS.map((l) => l.code));

export function locationName(code: number): string {
  return LOCATIONS.find((l) => l.code === code)?.name ?? `Location ${code}`;
}
