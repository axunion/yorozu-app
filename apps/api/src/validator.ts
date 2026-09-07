import { zValidator } from "@hono/zod-validator";
import { validationError } from "@yorozu/core";
import type { ZodType } from "zod";

/** Wraps zValidator with the project's standard validation error format. */
export function bodyValidator<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result, _c) => {
    if (!result.success) return validationError(result.error.issues);
  });
}
