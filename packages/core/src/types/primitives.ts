/**
 * Zod primitives shared across product type files (index.ts, shift.ts).
 * Split out so two products can share a schema without one importing the
 * other's file (which two files both re-exported from the package root would
 * make circular).
 */

import { z } from "zod";
// Every schema built from these primitives validates with Japanese messages.
import "./zod-ja";

/** Trimmed, non-empty display name (1–100 chars). */
export const displayName = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(100));

/**
 * Sort order used across menu categories/items/option groups/options, and
 * shift positions/patterns. Upper bound is a sanity cap, not a meaningful
 * business constraint.
 */
export const sortOrderValue = z.number().int().min(0).max(100_000);
