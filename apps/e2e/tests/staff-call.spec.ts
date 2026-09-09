import { expect, test } from "@playwright/test";
import { ADMIN_ORIGIN, ORDER_ORIGIN, SIGNUP_ORIGIN } from "../origins";

/**
 * The staff-call round trip: customer presses 「スタッフを呼ぶ」, the call
 * shows up on the order board, staff clear it, and the customer's own screen
 * stops showing 「呼んでいます」.
 *
 * Separate from business-cycle.spec.ts because it is the second, independent
 * cross-app polling channel — OrderBoard.loadCalls and OrderScreen.pollCall,
 * both on 5s intervals, neither touched by the order/payment cycle. Same
 * failure mode, and nothing else in the suite would notice it breaking.
 *
 * Deliberately no menu and no order: a call is raised against the seat, not
 * against an order, so the setup stays down to a store and a seat. As in the
 * golden path, each screen is opened before the other side acts, so the
 * assertions can only be satisfied by a poll.
 */

test("a customer can call staff and staff can clear the call", async ({
  context,
}) => {
  const storeName = `E2E呼出 ${Date.now()}`;
  const email = `e2e-call-${crypto.randomUUID()}@test.internal`;

  const admin = await context.newPage();
  let orderUrl = "";

  await test.step("1. register a store and issue a seat", async () => {
    await admin.goto(SIGNUP_ORIGIN);
    await admin.getByLabel("店舗名").fill(storeName);
    await admin.getByLabel("メールアドレス").fill(email);
    await admin.getByRole("button", { name: "申し込む" }).click();
    // The [DEV] code stands in for the emailed one (ENVIRONMENT=development).
    const note = await admin.getByText(/\[DEV\] 確認コード:/).textContent();
    await admin.getByLabel("確認コード").fill(note?.match(/\d{6}/)?.[0] ?? "");
    await admin.getByRole("button", { name: "登録を完了する" }).click();
    await admin.waitForURL(`${ADMIN_ORIGIN}/`);

    await admin.getByRole("link", { name: "座席管理・QR 発行" }).click();
    await admin.getByLabel("座席名").fill("テーブル5");
    await admin.getByRole("button", { name: "座席を追加" }).click();

    const seatRow = admin.locator("li").filter({ hasText: "テーブル5" });
    const href = await seatRow.getByRole("link").getAttribute("href");
    expect(href).toContain(ORDER_ORIGIN);
    orderUrl = href ?? "";
  });

  await test.step("2. staff open the order board, with no call waiting", async () => {
    await admin.getByRole("link", { name: "← 管理トップ" }).click();
    await admin.getByRole("link", { name: "注文確認・提供管理" }).click();
    await expect(admin.getByText("アクティブな注文はありません")).toBeVisible();
    // The banner only renders when a call is open, so its absence here is
    // what makes step 4 a statement about loadCalls' 5s poll.
    await expect(
      admin.locator("li").filter({ hasText: "テーブル5" }),
    ).toHaveCount(0);
  });

  const customer = await context.newPage();

  await test.step("3. the customer calls staff", async () => {
    await customer.goto(orderUrl);
    await expect(
      customer.getByRole("heading", { name: "テーブル5" }),
    ).toBeVisible();

    await customer.getByRole("button", { name: "スタッフを呼ぶ" }).click();
    // Set straight from the POST response, so this one is immediate.
    await expect(customer.getByText("呼んでいます")).toBeVisible();
  });

  await test.step("4. the call reaches the board on its poll", async () => {
    // The board has been open since step 2 — never navigated, never reloaded.
    const callBanner = admin.locator("li").filter({ hasText: "テーブル5" });
    await expect(callBanner).toBeVisible();
    await expect(
      callBanner.getByRole("button", { name: "対応済み" }),
    ).toBeVisible();
  });

  await test.step("5. staff mark the call handled", async () => {
    const callBanner = admin.locator("li").filter({ hasText: "テーブル5" });
    await callBanner.getByRole("button", { name: "対応済み" }).click();
    await expect(
      admin.locator("li").filter({ hasText: "テーブル5" }),
    ).toHaveCount(0);
  });

  await test.step("6. the customer screen stops showing the call", async () => {
    // Never reloaded since step 3 — this is pollCall's 5s interval clearing it.
    await expect(customer.getByText("呼んでいます")).toHaveCount(0);
  });
});
