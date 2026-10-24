import type { z } from "zod";
import { ValidationError } from "./errors";

/** Parses input with a Zod schema. On failure throws a ValidationError with one message per field. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".");
    if (key) fieldErrors[key] ??= issue.message;
  }
  throw new ValidationError("Please check the form.", fieldErrors);
}
