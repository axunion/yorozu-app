import type { Page } from "@playwright/test";

/** Moves between admin screens through the tab bar every page carries. */
export async function openAdminTab(admin: Page, label: string) {
  await admin
    .getByRole("navigation", { name: "管理メニュー" })
    // Tabs can carry count badges after the label, e.g. 「注文3件の注文」.
    .getByRole("link", { name: new RegExp(`^${label}`) })
    .click();
}
