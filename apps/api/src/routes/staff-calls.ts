import { errorResponse, now } from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthEnv, requireStore } from "../middleware";

export const staffCallsRouter = new Hono<AuthEnv>()
  .use(requireStore)

  /**
   * GET /api/admin/calls
   * Lists staff calls for the authenticated store, oldest first, joined
   * with seat name.
   *
   * Optional query parameter:
   *   ?status=open (default) — only open calls
   *   ?status=all            — full history, including resolved calls
   *
   * Response: 200 { data: AdminCallResponse[] }
   */
  .get("/", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);
    const status = c.req.query("status");

    const rows = await db
      .select({
        id: schema.staffCalls.id,
        seat_id: schema.staffCalls.seat_id,
        status: schema.staffCalls.status,
        created_at: schema.staffCalls.created_at,
        resolved_at: schema.staffCalls.resolved_at,
      })
      .from(schema.staffCalls)
      .where(
        and(
          eq(schema.staffCalls.store_id, storeId),
          status === "all" ? undefined : eq(schema.staffCalls.status, "open"),
        ),
      )
      .orderBy(asc(schema.staffCalls.created_at));

    if (rows.length === 0) {
      return c.json({ data: [] });
    }

    const seatIds = [...new Set(rows.map((row) => row.seat_id))];
    const seatsRows = await db
      .select({ id: schema.seats.id, name: schema.seats.name })
      .from(schema.seats)
      .where(
        and(
          eq(schema.seats.store_id, storeId),
          inArray(schema.seats.id, seatIds),
        ),
      );
    const seatNameById = new Map(seatsRows.map((s) => [s.id, s.name]));

    return c.json({
      data: rows.map((row) => ({
        id: row.id,
        seat_name: seatNameById.get(row.seat_id) ?? "",
        status: row.status,
        created_at: row.created_at,
        resolved_at: row.resolved_at,
      })),
    });
  })

  /**
   * PATCH /api/admin/calls/:id/resolve
   * Resolves an open staff call.
   *
   * Idempotent: if the call is already 'resolved', returns 200 unchanged.
   * Multi-tenant safe: store_id filter; 404 (not 403) on miss.
   *
   * Response: 200 { data: { id, status, resolved_at } }
   */
  .patch("/:id/resolve", async (c) => {
    const { id: storeId } = c.var.store;
    const callId = c.req.param("id");
    const db = createDb(c.env.DB);

    const rows = await db
      .select()
      .from(schema.staffCalls)
      .where(
        and(
          eq(schema.staffCalls.id, callId),
          eq(schema.staffCalls.store_id, storeId),
        ),
      )
      .limit(1);
    const call = rows[0];
    if (!call) {
      return errorResponse("NOT_FOUND", "呼び出しが見つかりません。", 404);
    }

    if (call.status === "resolved") {
      return c.json({
        data: {
          id: call.id,
          status: call.status,
          resolved_at: call.resolved_at,
        },
      });
    }

    const resolved_at = now();
    await db
      .update(schema.staffCalls)
      .set({ status: "resolved", resolved_at })
      .where(
        and(
          eq(schema.staffCalls.id, callId),
          eq(schema.staffCalls.store_id, storeId),
        ),
      );

    return c.json({
      data: { id: call.id, status: "resolved" as const, resolved_at },
    });
  });
