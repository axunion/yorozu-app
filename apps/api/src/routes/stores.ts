import {
  buildSlug,
  CreateStoreInput,
  DeleteStoreInput,
  EMAIL_CHANGE_HOURLY_CAP,
  EMAIL_CHANGE_WINDOW_MS,
  EmailChangeInput,
  EmailChangeVerifyInput,
  errorResponse,
  newId,
  now,
  sendVerificationCodeEmail,
  UpdateStoreNameInput,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { issueVerificationCode, redeemCode } from "../auth";
import { requireOwner, requireStore } from "../middleware";
import { bodyValidator } from "../validator";

export const storesRouter = new Hono<{ Bindings: Env }>()
  /**
   * POST /api/stores
   * Registers a new store (status="pending") and its owner member
   * (role="owner", status="pending"), then emails a signup passcode.
   * No cookie is set here; the session is created on POST /api/auth/verify-code.
   * Response: 201 { data: { id, name, slug, code? } }
   * (code is only included when ENVIRONMENT === "development")
   */
  .post("/", bodyValidator(CreateStoreInput), async (c) => {
    const { name, email } = c.req.valid("json");
    const db = createDb(c.env.DB);

    // buildSlug appends a 5-char random suffix (~60M combinations); the INSERT
    // UNIQUE constraint below is the real collision guard.
    const slug = buildSlug(name);
    const id = newId();
    const memberId = newId();

    try {
      await db.batch([
        db.insert(schema.stores).values({ id, name, slug, email }),
        db.insert(schema.members).values({
          id: memberId,
          store_id: id,
          email,
          role: "owner",
        }),
        db.insert(schema.subscriptions).values({
          id: newId(),
          store_id: id,
          product: "order",
        }),
      ]);
    } catch {
      // Determine which UNIQUE constraint failed for an accurate error message.
      // Both stores.email and members.email get this same address, and either
      // one can independently already be taken — e.g. a member elsewhere
      // changed their login email (POST /me/email-change) to this address
      // without ever having been a store's original signup email, so only
      // members.email holds it. Check both.
      const [storeConflict, memberConflict] = await Promise.all([
        db
          .select({ id: schema.stores.id })
          .from(schema.stores)
          .where(eq(schema.stores.email, email))
          .limit(1),
        db
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(eq(schema.members.email, email))
          .limit(1),
      ]);
      if (storeConflict.length > 0 || memberConflict.length > 0) {
        return errorResponse(
          "VALIDATION_ERROR",
          "このメールアドレスはすでに登録されています",
          400,
        );
      }
      // Slug race-condition (TOCTOU between the pre-check and INSERT).
      return errorResponse(
        "INTERNAL_ERROR",
        "Store registration failed. Please try again.",
        500,
      );
    }

    // Issue a signup passcode (also invalidates any previous unused signup
    // code). A null return (MAGIC_LINK_HOURLY_CAP hit) is practically
    // unreachable for a brand-new member_id, but is handled the same as an
    // issuance failure for type-safety and future-proofing.
    let code: string | null = null;
    try {
      code = await issueVerificationCode(
        db,
        id,
        memberId,
        "signup",
        c.env.OTP_PEPPER,
      );
    } catch {
      code = null;
    }
    if (!code) {
      // Compensate by removing the store + member + subscription rows so the
      // user can retry registration without hitting "email already
      // registered". The subscription must go before the store it references,
      // or the FK aborts the whole batch and leaves the rows it was meant to
      // clear.
      await db.batch([
        db.delete(schema.members).where(eq(schema.members.id, memberId)),
        db
          .delete(schema.subscriptions)
          .where(eq(schema.subscriptions.store_id, id)),
        db.delete(schema.stores).where(eq(schema.stores.id, id)),
      ]);
      return errorResponse(
        "INTERNAL_ERROR",
        "Store registration failed. Please try again.",
        500,
      );
    }

    try {
      await sendVerificationCodeEmail(
        { to: email, code, purpose: "signup" },
        {
          resendApiKey: c.env.RESEND_API_KEY,
          mailFrom: c.env.MAIL_FROM,
          environment: c.env.ENVIRONMENT,
        },
      );
    } catch {
      // Email delivery failure: store stays pending; owner can retry via /login.
      return errorResponse(
        "INTERNAL_ERROR",
        "メール送信に失敗しました。しばらくしてから再度お試しください。",
        500,
      );
    }

    // Checked as an explicit opt-in (not "!== production") so an unset or
    // misconfigured ENVIRONMENT never accidentally leaks the passcode.
    const isDev = c.env.ENVIRONMENT === "development";
    return c.json(
      {
        data: {
          id,
          name,
          slug,
          ...(isDev && { code }),
        },
      },
      201,
    );
  })

  /**
   * PATCH /api/stores/me
   * Updates the authenticated store's display name. storesRouter is
   * otherwise public (POST / for signup), so requireStore is applied
   * inline on this route rather than router-wide — same pattern as
   * authRouter's GET /me. Owner-only: renaming the store is a settings
   * action, not a daily-operations one.
   *
   * The slug is intentionally NOT regenerated; it is a stable identifier
   * not currently used by any feature.
   *
   * Response: 200 { data: { id, name, slug } }
   */
  .patch(
    "/me",
    requireStore,
    requireOwner,
    bodyValidator(UpdateStoreNameInput),
    async (c) => {
      const { id: storeId } = c.var.store;
      const { name } = c.req.valid("json");
      const db = createDb(c.env.DB);

      const updated = await db
        .update(schema.stores)
        .set({ name })
        .where(eq(schema.stores.id, storeId))
        .returning();

      const result = updated[0];
      if (!result) {
        return errorResponse("NOT_FOUND", "Store not found", 404);
      }

      return c.json({
        data: { id: result.id, name: result.name, slug: result.slug },
      });
    },
  )

  /**
   * POST /api/stores/me/suspend
   * Owner self-service pause: sets stores.status = 'suspended' and deletes
   * every session for the store (all members, all devices) in the same
   * batch — not just the caller's own. Two reasons this must happen, not
   * just rely on requireStore's status check to block usage: (1) without
   * it, reactivating later would silently hand back every pre-suspension
   * session with no re-authentication, defeating suspension as an
   * incident-response control; (2) requireStore's sliding-expiry refresh
   * runs before this handler in the same request, so the *suspending*
   * session's own expires_at could otherwise be extended by this very
   * call. Deleting the rows makes both moot. Reactivation goes through
   * the normal POST /api/auth/login flow (an owner-role member logging in
   * to a suspended store gets a 'reactivate' passcode instead of the
   * usual silent no-op) — there is no separate unsuspend endpoint, since
   * no session survives suspension to call one.
   * Response: 200 { data: { id, status } }
   */
  .post("/me/suspend", requireStore, requireOwner, async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);

    const [updated] = await db.batch([
      db
        .update(schema.stores)
        .set({ status: "suspended" })
        .where(eq(schema.stores.id, storeId))
        .returning(),
      db.delete(schema.sessions).where(eq(schema.sessions.store_id, storeId)),
    ]);

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Store not found", 404);
    }

    return c.json({ data: { id: result.id, status: result.status } });
  })

  /**
   * POST /api/stores/me/email-change
   * Requests a change of the calling member's own login email: issues a
   * passcode (purpose 'email_change') sent to the NEW address, proving
   * control before the change takes effect at GET /api/auth/verify. Any
   * active member (owner or staff) can change their own email; not
   * owner-gated. stores.email is untouched — it stays fixed at whatever
   * address created the store (display-only from here on).
   *
   * Rejects 400 if new_email equals the current email or is already
   * registered to another member — the caller is authenticated here, so
   * (unlike /api/auth/login) anti-enumeration does not apply. Rejects 429
   * past EMAIL_CHANGE_HOURLY_CAP attempts per rolling hour (counted
   * regardless of outcome) to bound how fast that conflict response can be
   * used to probe arbitrary emails against the global members.email
   * namespace.
   *
   * Response: 200 { data: { sent: true, code? } }
   */
  .post(
    "/me/email-change",
    requireStore,
    bodyValidator(EmailChangeInput),
    async (c) => {
      const { id: storeId, member_id: memberId } = c.var.store;
      const { new_email } = c.req.valid("json");
      const db = createDb(c.env.DB);

      const memberRows = await db
        .select({
          email: schema.members.email,
          attempt_count: schema.members.email_change_attempt_count,
          window_started_at: schema.members.email_change_window_started_at,
        })
        .from(schema.members)
        .where(eq(schema.members.id, memberId))
        .limit(1);
      const member = memberRows[0];
      if (!member) {
        return errorResponse("NOT_FOUND", "Member not found", 404);
      }
      const currentEmail = member.email;

      // Rate limit attempts (conflict or not) — a rejected "already in use"
      // response would otherwise let an authenticated member probe
      // arbitrary emails against the global members.email namespace at
      // unlimited speed, since MAGIC_LINK_HOURLY_CAP below only counts
      // tokens actually issued.
      const ts = now();
      const withinWindow =
        member.window_started_at !== null &&
        ts - member.window_started_at < EMAIL_CHANGE_WINDOW_MS;
      const attemptsSoFar = withinWindow ? member.attempt_count : 0;
      if (attemptsSoFar >= EMAIL_CHANGE_HOURLY_CAP) {
        return errorResponse(
          "RATE_LIMITED",
          "しばらくしてから再度お試しください。",
          429,
        );
      }
      await db
        .update(schema.members)
        .set({
          email_change_attempt_count: attemptsSoFar + 1,
          email_change_window_started_at: withinWindow
            ? member.window_started_at
            : ts,
        })
        .where(eq(schema.members.id, memberId));

      if (new_email === currentEmail) {
        return errorResponse(
          "VALIDATION_ERROR",
          "現在のメールアドレスと同じです。",
          400,
        );
      }

      const conflict = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(eq(schema.members.email, new_email))
        .limit(1);
      if (conflict.length > 0) {
        return errorResponse(
          "VALIDATION_ERROR",
          "このメールアドレスはすでに使用されています。",
          400,
        );
      }

      let code: string | null;
      try {
        code = await issueVerificationCode(
          db,
          storeId,
          memberId,
          "email_change",
          c.env.OTP_PEPPER,
          new_email,
        );
      } catch {
        return errorResponse(
          "INTERNAL_ERROR",
          "変更の準備に失敗しました。再度お試しください。",
          500,
        );
      }

      // null means the store hit MAGIC_LINK_HOURLY_CAP — silently skip
      // sending but keep the response identical to the success case, same
      // anti-abuse posture as /api/auth/login.
      if (code) {
        try {
          await sendVerificationCodeEmail(
            { to: new_email, code, purpose: "email_change" },
            {
              resendApiKey: c.env.RESEND_API_KEY,
              mailFrom: c.env.MAIL_FROM,
              environment: c.env.ENVIRONMENT,
            },
          );
        } catch {
          return errorResponse(
            "INTERNAL_ERROR",
            "メール送信に失敗しました。しばらくしてから再度お試しください。",
            500,
          );
        }
      }

      const isDev = c.env.ENVIRONMENT === "development";
      return c.json({
        data: {
          sent: true,
          ...(isDev && code && { code }),
        },
      });
    },
  )

  /**
   * POST /api/stores/me/email-change/verify
   *
   * Applies a pending email change once the member proves control of the new
   * address by entering the passcode sent to it.
   *
   * Authenticated by session rather than keyed on a submitted email, because
   * the code went to an address that is not yet in members.email — there is
   * nothing to resolve the member by. Requiring both a live session and the
   * code is strictly stronger than the Magic Link this replaces, which proved
   * only the latter.
   *
   * No new session is issued: the caller already has one, so they stay on the
   * settings screen instead of being bounced through a redirect.
   *
   * Errors are specific here, unlike POST /api/auth/verify-code — the caller
   * is already authenticated, so there is no enumeration to defend against.
   *
   * Response: 200 { data: { email } } — the address now on the member.
   */
  .post(
    "/me/email-change/verify",
    requireStore,
    bodyValidator(EmailChangeVerifyInput),
    async (c) => {
      const { id: storeId, member_id: memberId } = c.var.store;
      const { code } = c.req.valid("json");
      const db = createDb(c.env.DB);
      const ts = now();

      const liveCodes = and(
        eq(schema.magicLinkTokens.member_id, memberId),
        eq(schema.magicLinkTokens.store_id, storeId),
        eq(schema.magicLinkTokens.purpose, "email_change"),
        isNull(schema.magicLinkTokens.used_at),
        gt(schema.magicLinkTokens.expires_at, ts),
      );

      const matched = await redeemCode(
        db,
        liveCodes,
        code,
        c.env.OTP_PEPPER,
        ts,
      );

      if (!matched?.new_email) {
        return errorResponse(
          "INVALID_CODE",
          "コードが正しくないか、有効期限が切れています。",
          400,
        );
      }

      const newEmail = matched.new_email;
      try {
        await db
          .update(schema.members)
          .set({ email: newEmail })
          .where(eq(schema.members.id, memberId));
      } catch {
        // Someone else claimed the address between issuance and verification.
        // The code is already spent, so the member has to start over.
        return errorResponse(
          "VALIDATION_ERROR",
          "このメールアドレスはすでに使用されています。",
          400,
        );
      }

      return c.json({ data: { email: newEmail } });
    },
  )

  /**
   * DELETE /api/stores/me
   * Permanently deletes the store and every row it owns. Body
   * { confirm_name } must exactly match the store's current name — a
   * server-side safeguard independent of whatever client-side
   * confirmation UI exists.
   *
   * Hard delete, not soft: no accounting/audit retention requirement
   * exists for this project (see docs/specs/features/authentication.md).
   * The response body IS the export — read from the same pre-delete
   * snapshot the delete batch below acts on, not a separate endpoint, so
   * the frontend can offer it as a download in the same action. The
   * snapshot reads and the delete batch are NOT one transaction: a row
   * written in the narrow window between them (e.g. a customer order via
   * a still-live qr_token) is still caught by the delete's live store_id
   * filters — no orphan — but won't appear in the returned export. Accepted
   * as a negligible gap given how narrow the window is; not worth the
   * complexity of folding ~25 statements into one db.batch to close it.
   * sessions/magic_link_tokens/seats.qr_token are excluded from the export
   * (auth/bearer secrets, not business data) but are deleted. subscriptions
   * are likewise deleted but not exported — entitlement records, not the
   * store's own data. The shift-management tables are deleted and also not
   * exported: a schedule is exportable in a more useful shape from the
   * builder's per-period CSV. See docs/specs/features/authentication.md
   * § Account lifecycle.
   *
   * Response: 200 { data: { export: { store, members, menu_categories,
   *   menu_items, option_groups, options, menu_item_option_groups, seats,
   *   orders, order_items, order_item_options, staff_calls, payments } } }
   */
  .delete(
    "/me",
    requireStore,
    requireOwner,
    bodyValidator(DeleteStoreInput),
    async (c) => {
      const { id: storeId, name } = c.var.store;
      const { confirm_name } = c.req.valid("json");
      const db = createDb(c.env.DB);

      if (confirm_name !== name) {
        return errorResponse("VALIDATION_ERROR", "店舗名が一致しません。", 400);
      }

      const [
        storeRows,
        memberRows,
        menuCategoryRows,
        menuItemRows,
        optionGroupRows,
        optionRows,
        seatRows,
        orderRows,
        orderItemRows,
        orderItemOptionRows,
        staffCallRows,
        paymentRows,
      ] = await Promise.all([
        db.select().from(schema.stores).where(eq(schema.stores.id, storeId)),
        db
          .select()
          .from(schema.members)
          .where(eq(schema.members.store_id, storeId)),
        db
          .select()
          .from(schema.menuCategories)
          .where(eq(schema.menuCategories.store_id, storeId)),
        db
          .select()
          .from(schema.menuItems)
          .where(eq(schema.menuItems.store_id, storeId)),
        db
          .select()
          .from(schema.optionGroups)
          .where(eq(schema.optionGroups.store_id, storeId)),
        db
          .select()
          .from(schema.options)
          .where(eq(schema.options.store_id, storeId)),
        // qr_token excluded — it's a bearer credential for the customer
        // order API (same sensitivity class as a session token), not
        // business data; sessions/magic_link_tokens are excluded for the
        // same reason (see doc comment above).
        db
          .select({
            id: schema.seats.id,
            store_id: schema.seats.store_id,
            name: schema.seats.name,
            is_active: schema.seats.is_active,
            created_at: schema.seats.created_at,
          })
          .from(schema.seats)
          .where(eq(schema.seats.store_id, storeId)),
        db
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.store_id, storeId)),
        db
          .select()
          .from(schema.orderItems)
          .where(eq(schema.orderItems.store_id, storeId)),
        db
          .select()
          .from(schema.orderItemOptions)
          .where(eq(schema.orderItemOptions.store_id, storeId)),
        db
          .select()
          .from(schema.staffCalls)
          .where(eq(schema.staffCalls.store_id, storeId)),
        db
          .select()
          .from(schema.payments)
          .where(eq(schema.payments.store_id, storeId)),
      ]);

      // menu_item_option_groups has no store_id column; every row it has
      // for this store is reachable via this store's own menu_items (an
      // item can only be attached to option groups already verified to
      // belong to the same store — see menu.ts's validateOptionGroupIds).
      const menuItemIds = menuItemRows.map((r) => r.id);
      const menuItemOptionGroupRows =
        menuItemIds.length > 0
          ? await db
              .select()
              .from(schema.menuItemOptionGroups)
              .where(
                inArray(schema.menuItemOptionGroups.menu_item_id, menuItemIds),
              )
          : [];

      // FK-dependency order: children before parents. The
      // menu_item_option_groups delete uses a live subquery (not the
      // menuItemIds snapshot above) so it still catches a row attached to
      // this store's menu items between the reads above and this batch
      // running — the export snapshot and the delete scope don't need to
      // agree, but a stale delete scope here could otherwise leave an
      // orphaned join row (or, if D1 enforces the FK, abort the whole
      // batch when the referenced menu_item is deleted next).
      await db.batch([
        // Shift-management rows first: availability_entries hangs off
        // availability_submissions, and shifts/staffing_requirements hang off
        // schedule_periods and positions, all of which reference members.
        db
          .delete(schema.availabilityEntries)
          .where(eq(schema.availabilityEntries.store_id, storeId)),
        db
          .delete(schema.availabilitySubmissions)
          .where(eq(schema.availabilitySubmissions.store_id, storeId)),
        db.delete(schema.shifts).where(eq(schema.shifts.store_id, storeId)),
        db
          .delete(schema.staffingRequirements)
          .where(eq(schema.staffingRequirements.store_id, storeId)),
        db
          .delete(schema.memberPositions)
          .where(eq(schema.memberPositions.store_id, storeId)),
        db
          .delete(schema.memberWorkProfiles)
          .where(eq(schema.memberWorkProfiles.store_id, storeId)),
        db
          .delete(schema.shiftPatterns)
          .where(eq(schema.shiftPatterns.store_id, storeId)),
        db
          .delete(schema.schedulePeriods)
          .where(eq(schema.schedulePeriods.store_id, storeId)),
        db
          .delete(schema.positions)
          .where(eq(schema.positions.store_id, storeId)),
        db
          .delete(schema.orderItemOptions)
          .where(eq(schema.orderItemOptions.store_id, storeId)),
        db
          .delete(schema.orderItems)
          .where(eq(schema.orderItems.store_id, storeId)),
        db.delete(schema.payments).where(eq(schema.payments.store_id, storeId)),
        db
          .delete(schema.staffCalls)
          .where(eq(schema.staffCalls.store_id, storeId)),
        db.delete(schema.orders).where(eq(schema.orders.store_id, storeId)),
        db.delete(schema.seats).where(eq(schema.seats.store_id, storeId)),
        db
          .delete(schema.menuItemOptionGroups)
          .where(
            inArray(
              schema.menuItemOptionGroups.menu_item_id,
              db
                .select({ id: schema.menuItems.id })
                .from(schema.menuItems)
                .where(eq(schema.menuItems.store_id, storeId)),
            ),
          ),
        db.delete(schema.options).where(eq(schema.options.store_id, storeId)),
        db
          .delete(schema.menuItems)
          .where(eq(schema.menuItems.store_id, storeId)),
        db
          .delete(schema.menuCategories)
          .where(eq(schema.menuCategories.store_id, storeId)),
        db
          .delete(schema.optionGroups)
          .where(eq(schema.optionGroups.store_id, storeId)),
        db
          .delete(schema.magicLinkTokens)
          .where(eq(schema.magicLinkTokens.store_id, storeId)),
        db.delete(schema.sessions).where(eq(schema.sessions.store_id, storeId)),
        db.delete(schema.members).where(eq(schema.members.store_id, storeId)),
        db
          .delete(schema.subscriptions)
          .where(eq(schema.subscriptions.store_id, storeId)),
        db.delete(schema.stores).where(eq(schema.stores.id, storeId)),
      ]);

      return c.json({
        data: {
          export: {
            store: storeRows,
            members: memberRows,
            menu_categories: menuCategoryRows,
            menu_items: menuItemRows,
            option_groups: optionGroupRows,
            options: optionRows,
            menu_item_option_groups: menuItemOptionGroupRows,
            seats: seatRows,
            orders: orderRows,
            order_items: orderItemRows,
            order_item_options: orderItemOptionRows,
            staff_calls: staffCallRows,
            payments: paymentRows,
          },
        },
      });
    },
  );
