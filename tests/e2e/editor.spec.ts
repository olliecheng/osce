import { expect, test } from "@playwright/test";
import { EXAMPLE_INTRO } from "./helpers";

const body = (page: import("@playwright/test").Page) => page.locator(".ed-doc");

test("editor: /editor loads with toolbar; header, bullets and marks", async ({ page }) => {
  await page.goto("/editor");
  await expect(page).toHaveURL(/\/editor\/?$/);
  for (const id of ["#tbSave", "#tbLoad", "#tbStyle", "#tbBold", "#tbItalic"]) {
    await expect(page.locator(id)).toBeVisible();
  }
  await body(page).locator("h1").click();
  // starts as: header, empty bullet. Make the first block a header via typing, Enter gives a bullet.
  await page.keyboard.type("History");
  await page.locator("#tbStyle").selectOption("header");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Plain ");
  await page.locator("#tbBold").click();
  await page.keyboard.type("bold");
  await page.locator("#tbBold").click();
  await page.keyboard.type(" and ");
  await page.keyboard.press("Control+i");
  await page.keyboard.type("it");
  await expect(body(page).locator("h1")).toHaveCount(1);
  await expect(body(page).locator("li strong")).toHaveText("bold");
  await expect(body(page).locator("li em")).toHaveText("it");
  expect(await body(page).locator("p:not(li p)").count()).toBe(0);
  // no paragraph outside a bullet, ever: Backspace at the start of the first bullet must not make one
  await expect(page.locator("#tbStyle")).toHaveValue("body");
});

test("editor: Header/Body style switch converts blocks, bullets stay bullets", async ({ page }) => {
  await page.goto("/editor");
  await body(page).locator("h1").click();
  await page.keyboard.type("Sec");
  await page.locator("#tbStyle").selectOption("header");
  await page.keyboard.press("Enter");
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  // turn "two" into a header, then back to a bullet
  await page.locator("#tbStyle").selectOption("header");
  await expect(body(page).locator("h1")).toHaveCount(2);
  await page.locator("#tbStyle").selectOption("body");
  await expect(body(page).locator("h1")).toHaveCount(1);
  await expect(body(page).locator("li")).toHaveText(["one", "two"]);
});

test("editor: Save downloads the case; Load reads a file", async ({ page }) => {
  await page.goto("/editor");
  await page.locator("#fTitle").fill("My case");
  await page.locator("#fIntro").fill("Take a history.");
  await body(page).locator("h1").click();
  await page.keyboard.type("Intro");
  await page.locator("#tbStyle").selectOption("header");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- 5 * 3");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#tbSave").click()]);
  expect(dl.suggestedFilename()).toBe("my-case.md");
  const text = await (await import("node:fs/promises")).readFile((await dl.path())!, "utf8");
  expect(text).toContain("title: |\n  My case");
  expect(text).toContain("# Intro");
  expect(text).toContain("- \\- 5 \\* 3");

  const md = '---\ntitle: Loaded\nintro: "Hi"\n---\n\n## A\nloose line\n### Sub\n- **b**\n';
  await page
    .locator("#tbFile")
    .setInputFiles({ name: "loaded.md", mimeType: "text/markdown", buffer: Buffer.from(md) });
  await expect(page.locator("#fTitle")).toHaveValue("Loaded");
  await expect(body(page).locator("h1")).toHaveText(["A", "Sub"]);
  await expect(body(page).locator("li").first()).toHaveText("loose line");
  await expect(page.locator("#edNotice")).toContainText("1 paragraph");
  await expect(page.locator("#edNotice")).toContainText("1 sub-heading");
});

test("editor: Load menu offers file and clipboard; clipboard opens a paste modal that loads Markdown", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.locator("#tbMenu")).toBeHidden();
  await page.locator("#tbLoad").click();
  await expect(page.getByRole("menuitem", { name: "Load from file" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Load from clipboard" }).click();
  await expect(page.locator("#tbMenu")).toBeHidden();
  await expect(page.locator("#pasteLoad")).toBeDisabled();
  const md = '---\ntitle: Pasted\nintro: "Hello"\n---\n\n## Sec\n- **bold** fact\n';
  await page.locator("#pasteText").fill(md);
  await page.locator("#pasteLoad").click();
  await expect(page.locator("#pasteText")).toBeHidden();
  await expect(page.locator("#fTitle")).toHaveValue("Pasted");
  await expect(page.locator("#fIntro")).toHaveValue("Hello");
  await expect(page.locator(".ed-doc h1")).toHaveText("Sec");
  await expect(page.locator(".ed-doc li strong")).toHaveText("bold");
  // Escape closes the menu; Cancel leaves the case alone
  await page.locator("#tbLoad").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#tbMenu")).toBeHidden();
  await page.locator("#tbLoad").click();
  await page.locator("#tbLoadClip").click();
  await page.locator("#pasteCancel").click();
  await expect(page.locator("#fTitle")).toHaveValue("Pasted");
});

test("editor <-> station share state both ways, and not during a station", async ({ context }) => {
  const host = await context.newPage();
  await host.goto("/");
  const ed = await context.newPage();
  await ed.goto("/editor");

  // editor -> station
  await ed.locator("#fTitle").fill("Shared case");
  await ed.locator("#fIntro").fill("Edited in the editor");
  await ed.locator(".ed-doc h1").click();
  await ed.keyboard.type("Introduction");
  await ed.locator("#tbStyle").selectOption("header");
  await expect(host.locator("#planTitle")).toHaveText("Shared case");
  await expect(host.locator("#planStem")).toHaveText("Edited in the editor");
  await expect(host.locator("#planChecks")).toContainText("1 section: Introduction");

  // station -> editor
  await host.locator("#exampleBtn").click();
  await expect(ed.locator("#fTitle")).toHaveValue("Chest pain in a 62-year-old man");
  await expect(ed.locator("#fIntro")).toHaveValue(EXAMPLE_INTRO);
  await expect(ed.locator(".ed-doc h1").first()).toHaveText("Introduction");
  await expect(ed.locator("#edNotice")).toBeHidden();

  // a station in progress is never replaced by editor changes
  await host.locator("#startBtn").click();
  await host.locator("#readyGo").click();
  await ed.locator("#fTitle").fill("Changed mid-station");
  await ed.waitForTimeout(600);
  await expect(host.locator("#planTitle")).toHaveText("Chest pain in a 62-year-old man");
});

test("editor: Use LLM panel copies the prompt and links to chat apps with it pre-filled", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/editor");
  await expect(page.locator("#edLlm")).toBeHidden();
  await page.locator("#tbLlm").click();
  await expect(page.locator("#edLlm")).toBeVisible();
  await expect(page.locator("#llmPrompt")).toContainText("Write a mock OSCE history-taking case");
  await page.locator("#llmCopy").click();
  await expect(page.locator("#llmCopy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Write a mock OSCE history-taking case",
  );
  const hrefs = await page
    .locator("[data-launch]")
    .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs).toHaveLength(3);
  for (const [i, host] of ["chatgpt.com", "claude.ai", "gemini.google.com"].entries()) {
    const u = new URL(hrefs[i]);
    expect(u.host).toBe(host);
    expect(u.searchParams.get("q")).toContain("Write a mock OSCE history-taking case");
  }
  await page.goto("/editor#llm");
  await expect(page.locator("#edLlm")).toBeVisible();
  await page.locator("#llmClose").click();
  await expect(page.locator("#edLlm")).toBeHidden();
});
