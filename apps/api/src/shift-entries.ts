/**
 * Reading availability entries, shared by the availability and schedule
 * routes — the same shape the order-item helpers play for order routes.
 */
import type { AvailabilityEntryResponse } from "@yorozu/core";
import { type createDb, schema } from "@yorozu/db";
import { and, asc, eq, inArray } from "drizzle-orm";

/**
 * D1 caps a query at 100 bound parameters, and this query binds one per
 * submission id plus the store. A store with more members than this in one
 * period is unusual but not impossible, and the failure would be a 500 on the
 * manager's own schedule screen.
 */
const IDS_PER_QUERY = 90;

/**
 * Entries for the given submissions, grouped by submission id and ordered
 * within each. Filtered by store_id as well as submission_id: the column is
 * denormalized onto entries precisely so it can be.
 */
export async function entriesBySubmission(
  db: ReturnType<typeof createDb>,
  storeId: string,
  submissionIds: string[],
): Promise<Map<string, AvailabilityEntryResponse[]>> {
  const chunks: string[][] = [];
  for (let i = 0; i < submissionIds.length; i += IDS_PER_QUERY) {
    chunks.push(submissionIds.slice(i, i + IDS_PER_QUERY));
  }

  const chunkRows = await Promise.all(
    chunks.map((chunk) =>
      db
        .select({
          id: schema.availabilityEntries.id,
          submission_id: schema.availabilityEntries.submission_id,
          work_date: schema.availabilityEntries.work_date,
          kind: schema.availabilityEntries.kind,
          start_minutes: schema.availabilityEntries.start_minutes,
          end_minutes: schema.availabilityEntries.end_minutes,
        })
        .from(schema.availabilityEntries)
        .where(
          and(
            eq(schema.availabilityEntries.store_id, storeId),
            inArray(schema.availabilityEntries.submission_id, chunk),
          ),
        )
        .orderBy(
          asc(schema.availabilityEntries.work_date),
          asc(schema.availabilityEntries.start_minutes),
        ),
    ),
  );

  const grouped = new Map<string, AvailabilityEntryResponse[]>();
  for (const { submission_id, ...entry } of chunkRows.flat()) {
    const list = grouped.get(submission_id);
    if (list) list.push(entry);
    else grouped.set(submission_id, [entry]);
  }

  return grouped;
}
