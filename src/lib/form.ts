import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

/** Small Zod resolver for react-hook-form (we do not use the extra resolvers package). */
export function zodResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      if (key && !errors[key]) errors[key] = { type: issue.code, message: issue.message };
    }
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
