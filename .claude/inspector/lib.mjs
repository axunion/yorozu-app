import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

let shotDir;

// Polls until the dev server answers, so the caller doesn't need curl or `timeout`.
export async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url); // any HTTP response, even 404 or 401, means the server is up
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server did not answer at ${url} within ${timeoutMs}ms`);
}

export async function withBrowser(fn) {
  const browser = await chromium.launch();
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

// Runs check(width) at each width with the page resized, and collects the results.
export async function sweepViewports(page, widths, check) {
  const results = {};
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    results[width] = await check(width);
  }
  return results;
}

// Elements clipped by their own box, plus page-level horizontal overflow.
export async function overflowReport(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflowing = [...document.body.querySelectorAll("*")]
      .filter(
        (el) =>
          el.clientWidth > 0 &&
          el.scrollWidth > el.clientWidth &&
          !["auto", "scroll"].includes(getComputedStyle(el).overflowX),
      )
      .map((el) => {
        const id = el.id ? `#${el.id}` : "";
        const cls =
          typeof el.className === "string" && el.className
            ? `.${el.className.trim().split(/\s+/).join(".")}`
            : "";
        return `${el.tagName.toLowerCase()}${id}${cls}`;
      });
    return { pageOverflow: root.scrollWidth > root.clientWidth, overflowing };
  });
}

// Writes a screenshot under os.tmpdir() and returns its absolute path.
export async function shot(page, name) {
  shotDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "inspector-"));
  const file = path.join(shotDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
