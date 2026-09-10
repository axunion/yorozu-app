import { expect, test } from "@playwright/test";
import { readDevCode } from "../dev-code";
import { ADMIN_ORIGIN, SHIFT_ORIGIN, SIGNUP_ORIGIN } from "../origins";

/**
 * Passcode login on the shift origin.
 *
 * The other two specs only ever reach the code screen through signup, so the
 * admin and signup passcode paths are covered and `apps/shift`'s own login is
 * not. Its unit tests mock `fetch`, which is exactly the blind spot that let
 * the SPAs keep reading a `verify_url` the API had already stopped sending —
 * a browser is the only place the shift login is actually exercised.
 *
 * The cookie jar is cleared before the login. Cookies ignore ports, so the
 * session the registration step sets on `localhost` would otherwise be sent to
 * :5176 as well, and the run would pass without the passcode doing anything.
 *
 * Landing on 「シフト管理は未契約です」 is the success condition, not a failure:
 * registration subscribes a new store to `order` only, so `ShiftGuard` gets a
 * 403 from `/api/shift/periods` and renders that screen. It renders it *inside*
 * `<Show when={store()}>`, which is reached only after `/api/auth/me` returned
 * a store — an unauthenticated load redirects to `/login` instead. So this
 * screen appears if and only if the passcode established a session here.
 */
test("an owner can sign in to the shift app with an emailed passcode", async ({
  context,
}) => {
  const storeName = `E2Eシフト ${Date.now()}`;
  const email = `e2e-shift-${crypto.randomUUID()}@test.internal`;

  const admin = await context.newPage();
  const shift = await context.newPage();
  let code = "";

  await test.step("1. register a store", async () => {
    await admin.goto(SIGNUP_ORIGIN);
    await admin.getByLabel("店舗名").fill(storeName);
    await admin.getByLabel("メールアドレス").fill(email);
    await admin.getByRole("button", { name: "申し込む" }).click();
    await admin.getByLabel("確認コード").fill(await readDevCode(admin));
    await admin.getByRole("button", { name: "登録を完了する" }).click();
    await admin.waitForURL(`${ADMIN_ORIGIN}/`);
  });

  await test.step("2. request a passcode from the shift login", async () => {
    // Drops the session registration just established, so step 3 can only
    // succeed on the one the passcode creates.
    await context.clearCookies();

    await shift.goto(`${SHIFT_ORIGIN}/login`);
    await shift.getByLabel("メールアドレス").fill(email);
    await shift.getByRole("button", { name: "確認コードを送信" }).click();

    code = await readDevCode(shift);
  });

  await test.step("3. enter it and land back on the shift origin", async () => {
    await shift.getByLabel("確認コード").fill(code);
    await shift.getByRole("button", { name: "ログイン" }).click();

    // `app: "shift"` is what aims the session back here; without it the API
    // resolves the admin origin and this wait times out.
    await shift.waitForURL(`${SHIFT_ORIGIN}/`);
    await expect(
      shift.getByRole("heading", { name: "シフト管理は未契約です" }),
    ).toBeVisible();
  });
});
