import {
  errorResponse,
  newId,
  type ShiftMemberResponse,
  UpdateMemberPositionsInput,
  UpdateMemberWorkProfileInput,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import {
  type AuthEnv,
  requireEntitlement,
  requireOwner,
  requireStore,
} from "../middleware";
import { bodyValidator } from "../validator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves :memberId against the caller's store; 404 on a miss. */
async function findMember(
  db: ReturnType<typeof createDb>,
  storeId: string,
  memberId: string,
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.id, memberId),
        eq(schema.members.store_id, storeId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Every requested position id must belong to this store. */
async function ownsAllPositions(
  db: ReturnType<typeof createDb>,
  storeId: string,
  positionIds: string[],
): Promise<boolean> {
  if (positionIds.length === 0) return true;
  const rows = await db
    .select({ id: schema.positions.id })
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.store_id, storeId),
        inArray(schema.positions.id, positionIds),
      ),
    );
  return rows.length === positionIds.length;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const shiftMembersRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireEntitlement("shift"))
  .use(requireOwner)

  /**
   * GET /api/shift/members
   * The roster the schedule builder works from: every member with the
   * positions they can work and their scheduling constraints. A member with
   * no profile row reports nulls — "not recorded", not zero.
   *
   * Owner-only: hourly_wage and is_minor must not reach a staff session.
   * Response: 200 { data: ShiftMemberResponse[] }
   */
  .get("/", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);

    const [members, assignments, profiles] = await Promise.all([
      db
        .select({
          id: schema.members.id,
          email: schema.members.email,
          role: schema.members.role,
        })
        .from(schema.members)
        .where(eq(schema.members.store_id, storeId))
        .orderBy(asc(schema.members.email)),
      db
        .select({
          member_id: schema.memberPositions.member_id,
          position_id: schema.memberPositions.position_id,
        })
        .from(schema.memberPositions)
        .where(eq(schema.memberPositions.store_id, storeId)),
      db
        .select({
          member_id: schema.memberWorkProfiles.member_id,
          hourly_wage: schema.memberWorkProfiles.hourly_wage,
          weekly_cap_minutes: schema.memberWorkProfiles.weekly_cap_minutes,
          is_minor: schema.memberWorkProfiles.is_minor,
        })
        .from(schema.memberWorkProfiles)
        .where(eq(schema.memberWorkProfiles.store_id, storeId)),
    ]);

    const profileByMember = new Map(profiles.map((p) => [p.member_id, p]));
    const data: ShiftMemberResponse[] = members.map((member) => {
      const profile = profileByMember.get(member.id);
      return {
        ...member,
        position_ids: assignments
          .filter((a) => a.member_id === member.id)
          .map((a) => a.position_id),
        hourly_wage: profile?.hourly_wage ?? null,
        weekly_cap_minutes: profile?.weekly_cap_minutes ?? null,
        is_minor: profile?.is_minor ?? false,
      };
    });

    return c.json({ data });
  })

  /**
   * PUT /api/shift/members/:memberId/positions
   * Replaces the member's position assignments; an empty list clears them.
   * 404 when the member or any position belongs to another store.
   * Response: 200 { data: { member_id, position_ids } }
   */
  .put(
    "/:memberId/positions",
    bodyValidator(UpdateMemberPositionsInput),
    async (c) => {
      const { id: storeId } = c.var.store;
      const memberId = c.req.param("memberId");
      const { position_ids } = c.req.valid("json");
      const db = createDb(c.env.DB);

      if (!(await findMember(db, storeId, memberId))) {
        return errorResponse("NOT_FOUND", "Member not found", 404);
      }
      if (!(await ownsAllPositions(db, storeId, position_ids))) {
        return errorResponse("NOT_FOUND", "Position not found", 404);
      }

      // Replace wholesale: the client sends the state it wants, not a diff.
      const clear = db
        .delete(schema.memberPositions)
        .where(
          and(
            eq(schema.memberPositions.store_id, storeId),
            eq(schema.memberPositions.member_id, memberId),
          ),
        );

      if (position_ids.length === 0) {
        await clear;
      } else {
        await db.batch([
          clear,
          db.insert(schema.memberPositions).values(
            position_ids.map((position_id) => ({
              id: newId(),
              store_id: storeId,
              member_id: memberId,
              position_id,
            })),
          ),
        ]);
      }

      return c.json({ data: { member_id: memberId, position_ids } });
    },
  )

  /**
   * PUT /api/shift/members/:memberId/work-profile
   * Upserts the member's wage, weekly cap and minor flag. Null means "not
   * recorded": the cost estimate excludes such a member rather than treating
   * them as free.
   * Response: 200 { data: { member_id, hourly_wage, weekly_cap_minutes, is_minor } }
   */
  .put(
    "/:memberId/work-profile",
    bodyValidator(UpdateMemberWorkProfileInput),
    async (c) => {
      const { id: storeId } = c.var.store;
      const memberId = c.req.param("memberId");
      const input = c.req.valid("json");
      const db = createDb(c.env.DB);

      if (!(await findMember(db, storeId, memberId))) {
        return errorResponse("NOT_FOUND", "Member not found", 404);
      }

      // One statement, not update-then-insert: two concurrent saves would
      // otherwise both find nothing to update and race into the (member_id)
      // unique index, turning the loser into a 500.
      await db
        .insert(schema.memberWorkProfiles)
        .values({
          id: newId(),
          ...input,
          store_id: storeId,
          member_id: memberId,
        })
        .onConflictDoUpdate({
          target: schema.memberWorkProfiles.member_id,
          set: input,
        });

      return c.json({ data: { member_id: memberId, ...input } });
    },
  );
