/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:workers";
import { OTP_MAX_ATTEMPTS } from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { issueVerificationCode } from "../auth";
import { jsonInit, seedMember, seedStore } from "../test-helpers";

type Purpose = "signup" | "login" | "email_change" | "invite" | "reactivate";

/** Issues a real code through the production path, so the digest under test
 * is the one issueVerificationCode actually writes. */
async function issueCode(
  storeId: string,
  memberId: string,
  purpose: Purpose,
  newEmail?: string,
): Promise<string> {
  const code = await issueVerificationCode(
    createDb(env.DB),
    storeId,
    memberId,
    purpose,
    env.OTP_PEPPER,
    newEmail,
  );
  if (!code) throw new Error("issueVerificationCode hit the hourly cap");
  return code;
}

async function memberEmail(memberId: string): Promise<string> {
  const rows = await createDb(env.DB)
    .select({ email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  const email = rows[0]?.email;
  if (!email) throw new Error(`no member ${memberId}`);
  return email;
}

/** Any six digits that are not `code`. */
function wrongCode(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

async function verify(body: Record<string, unknown>): Promise<Response> {
  return app.request("/api/auth/verify-code", jsonInit("POST", body), env);
}

async function tokenRow(id: string) {
  const rows = await createDb(env.DB)
    .select({
      used_at: schema.magicLinkTokens.used_at,
      attempt_count: schema.magicLinkTokens.attempt_count,
    })
    .from(schema.magicLinkTokens)
    .where(eq(schema.magicLinkTokens.id, id))
    .limit(1);
  return rows[0];
}

async function liveTokenIdFor(memberId: string): Promise<string> {
  const rows = await createDb(env.DB)
    .select({ id: schema.magicLinkTokens.id })
    .from(schema.magicLinkTokens)
    .where(eq(schema.magicLinkTokens.member_id, memberId))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) throw new Error(`no token row for member ${memberId}`);
  return id;
}

describe("POST /api/auth/verify-code — success", () => {
  it("creates a session and names the admin origin for a login code", async () => {
    const store = await seedStore(`ログイン店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");

    const res = await verify({ email, code });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { redirect_to: string } };
    expect(body.data.redirect_to).toBe("http://admin.localhost");

    const sessions = await createDb(env.DB)
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.member_id, store.member_id));
    // seedStore already planted one session; verifying adds a second.
    expect(sessions).toHaveLength(2);
  });

  it("sets an HttpOnly SameSite=None session cookie", async () => {
    const store = await seedStore(`クッキー店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");

    const res = await verify({ email, code });
    const cookie = res.headers.get("Set-Cookie") ?? "";

    expect(cookie).toContain("session_token=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=none");
  });

  it("consumes the code by setting used_at rather than deleting the row", async () => {
    const store = await seedStore(`消費店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");
    const tokenId = await liveTokenIdFor(store.member_id);

    await verify({ email, code });

    const row = await tokenRow(tokenId);
    expect(row?.used_at).not.toBeNull();
  });

  it("activates both the store and the member for a signup code", async () => {
    const store = await seedStore(`新規店 ${crypto.randomUUID()}`);
    const db = createDb(env.DB);
    await db
      .update(schema.stores)
      .set({ status: "pending", activated_at: null })
      .where(eq(schema.stores.id, store.id));
    await db
      .update(schema.members)
      .set({ status: "pending", activated_at: null })
      .where(eq(schema.members.id, store.member_id));

    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "signup");

    expect((await verify({ email, code })).status).toBe(200);

    const [storeRow] = await db
      .select({ status: schema.stores.status })
      .from(schema.stores)
      .where(eq(schema.stores.id, store.id));
    const [memberRow] = await db
      .select({ status: schema.members.status })
      .from(schema.members)
      .where(eq(schema.members.id, store.member_id));
    expect(storeRow?.status).toBe("active");
    expect(memberRow?.status).toBe("active");
  });

  it("activates only the member for an invite code, leaving the store alone", async () => {
    const store = await seedStore(`招待元店 ${crypto.randomUUID()}`);
    const invitee = await seedMember(store.id, "staff");
    const db = createDb(env.DB);
    await db
      .update(schema.members)
      .set({ status: "pending", activated_at: null })
      .where(eq(schema.members.id, invitee.member_id));

    const email = await memberEmail(invitee.member_id);
    const code = await issueCode(store.id, invitee.member_id, "invite");

    expect((await verify({ email, code })).status).toBe(200);

    const [memberRow] = await db
      .select({ status: schema.members.status })
      .from(schema.members)
      .where(eq(schema.members.id, invitee.member_id));
    expect(memberRow?.status).toBe("active");
  });

  it("returns a suspended store to active for a reactivate code", async () => {
    const store = await seedStore(`再開店 ${crypto.randomUUID()}`);
    const db = createDb(env.DB);
    await db
      .update(schema.stores)
      .set({ status: "suspended" })
      .where(eq(schema.stores.id, store.id));

    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "reactivate");

    expect((await verify({ email, code })).status).toBe(200);

    const [storeRow] = await db
      .select({ status: schema.stores.status })
      .from(schema.stores)
      .where(eq(schema.stores.id, store.id));
    expect(storeRow?.status).toBe("active");
  });
});

describe("POST /api/auth/verify-code — landing origin", () => {
  it("names the shift origin when the caller says app=shift", async () => {
    const store = await seedStore(`シフト店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");

    const res = await verify({ email, code, app: "shift" });

    const body = (await res.json()) as { data: { redirect_to: string } };
    expect(body.data.redirect_to).toBe("http://shift.localhost");
  });

  it("defaults to the admin origin when app is omitted", async () => {
    const store = await seedStore(`既定店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");

    const res = await verify({ email, code });

    const body = (await res.json()) as { data: { redirect_to: string } };
    expect(body.data.redirect_to).toBe("http://admin.localhost");
  });

  it("rejects an app outside the enum, so it can never name an origin", async () => {
    const store = await seedStore(`不正app店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");

    const res = await verify({
      email,
      code,
      app: "https://evil.example.com",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/verify-code — rejection", () => {
  it("rejects a wrong code and counts the attempt", async () => {
    const store = await seedStore(`誤入力店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");
    const tokenId = await liveTokenIdFor(store.member_id);

    const res = await verify({ email, code: wrongCode(code) });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_CODE");

    const row = await tokenRow(tokenId);
    expect(row?.attempt_count).toBe(1);
    expect(row?.used_at).toBeNull();
  });

  it("consumes the code after OTP_MAX_ATTEMPTS failures, so the right code stops working", async () => {
    const store = await seedStore(`総当り店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");
    const tokenId = await liveTokenIdFor(store.member_id);

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      expect((await verify({ email, code: wrongCode(code) })).status).toBe(400);
    }

    const row = await tokenRow(tokenId);
    expect(row?.used_at).not.toBeNull();

    // The genuine code is now worthless — the member has to request a new one.
    expect((await verify({ email, code })).status).toBe(400);
  });

  it("never lets a concurrent burst exceed the attempt budget", async () => {
    const store = await seedStore(`同時攻撃店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");
    const tokenId = await liveTokenIdFor(store.member_id);

    // Twenty guesses at once. The budget has to be claimed inside the UPDATE:
    // comparing first and incrementing after would let every one of these read
    // the same live row and spend a guess, leaving attempt_count at 20 and the
    // limit doing nothing.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        verify({ email, code: wrongCode(code) }),
      ),
    );

    const row = await tokenRow(tokenId);
    expect(row?.attempt_count).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    expect(row?.used_at).not.toBeNull();
    // And the real code is spent along with the budget.
    expect((await verify({ email, code })).status).toBe(400);
  });

  it("answers an unregistered email with the same INVALID_CODE", async () => {
    const res = await verify({
      email: `${crypto.randomUUID()}@test.internal`,
      code: "123456",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_CODE");
  });

  it("rejects an expired code", async () => {
    const store = await seedStore(`期限切れ店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");
    const tokenId = await liveTokenIdFor(store.member_id);
    await createDb(env.DB)
      .update(schema.magicLinkTokens)
      .set({ expires_at: Date.now() - 1000 })
      .where(eq(schema.magicLinkTokens.id, tokenId));

    expect((await verify({ email, code })).status).toBe(400);
  });

  it("rejects a code that has already been used once", async () => {
    const store = await seedStore(`再利用店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(store.id, store.member_id, "login");

    expect((await verify({ email, code })).status).toBe(200);
    expect((await verify({ email, code })).status).toBe(400);
  });

  it("does not accept one member's code submitted under another's email", async () => {
    const storeA = await seedStore(`A店 ${crypto.randomUUID()}`);
    const storeB = await seedStore(`B店 ${crypto.randomUUID()}`);
    const codeForA = await issueCode(storeA.id, storeA.member_id, "login");
    const emailB = await memberEmail(storeB.member_id);

    expect((await verify({ email: emailB, code: codeForA })).status).toBe(400);
  });

  it("rejects a body missing the code or the email outright", async () => {
    // The deleted GET /verify had an explicit "token param absent" case; this
    // is its analogue under the email+code model.
    const store = await seedStore(`欠落店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);

    expect((await verify({ email })).status).toBe(400);
    expect((await verify({ code: "123456" })).status).toBe(400);
    expect((await verify({})).status).toBe(400);
  });

  it("rejects a malformed code before touching the database", async () => {
    const store = await seedStore(`不正形式店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);

    expect((await verify({ email, code: "12345" })).status).toBe(400);
    expect((await verify({ email, code: "abcdef" })).status).toBe(400);
  });
});

describe("POST /api/auth/verify-code — email_change is out of scope", () => {
  it("will not verify an email_change code, which belongs to the session-authenticated route", async () => {
    const store = await seedStore(`変更店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    const code = await issueCode(
      store.id,
      store.member_id,
      "email_change",
      `${crypto.randomUUID()}@test.internal`,
    );

    expect((await verify({ email, code })).status).toBe(400);
  });

  it("leaves a pending email_change code untouched when a login guess fails", async () => {
    const store = await seedStore(`巻添え店 ${crypto.randomUUID()}`);
    const email = await memberEmail(store.member_id);
    await issueCode(
      store.id,
      store.member_id,
      "email_change",
      `${crypto.randomUUID()}@test.internal`,
    );

    // Burn the login budget entirely; the email change must survive it.
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await verify({ email, code: "000000" });
    }

    const [changeRow] = await createDb(env.DB)
      .select({
        used_at: schema.magicLinkTokens.used_at,
        attempt_count: schema.magicLinkTokens.attempt_count,
      })
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.member_id, store.member_id))
      .limit(1);
    expect(changeRow?.used_at).toBeNull();
    expect(changeRow?.attempt_count).toBe(0);
  });
});
