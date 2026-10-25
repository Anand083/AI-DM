import "server-only";
import { getEnv } from "@/env";
import { GoogleHttpProvider } from "./http";
import { MockGoogleProvider } from "./mock";
import type { GoogleProvider } from "./types";

export type { GoogleProvider } from "./types";

let provider: GoogleProvider | undefined;

/** Picks the Google provider from `GOOGLE_PROVIDER`. The mock is the default. */
export function getGoogleProvider(): GoogleProvider {
  if (provider) return provider;
  const env = getEnv();
  provider =
    env.GOOGLE_PROVIDER === "google"
      ? new GoogleHttpProvider({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        })
      : new MockGoogleProvider();
  return provider;
}
