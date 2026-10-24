import "server-only";
import pino from "pino";
import { getEnv } from "@/env";

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  redact: ["password", "*.password", "authorization", "*.authorization", "secret", "*.secret"],
});
