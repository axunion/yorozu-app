import { expect, type Page } from "@playwright/test";

/**
 * Reads the passcode the API echoes back when `ENVIRONMENT=development`,
 * which every spec uses to stand in for the emailed one.
 *
 * Asserts rather than coercing a miss to "": filling the input with an empty
 * string surfaces the failure several steps later as a confusing timeout on a
 * `waitForURL`, instead of here, where "no code was shown" is the actual fact.
 */
export async function readDevCode(page: Page): Promise<string> {
  const note = await page.getByText(/\[DEV\] 確認コード:/).textContent();
  const code = note?.match(/\d{6}/)?.[0];
  expect(code, "no [DEV] passcode rendered").toMatch(/^\d{6}$/);
  return code as string;
}
