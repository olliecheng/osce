import { expect, test } from "@playwright/test";
import {
  bells,
  clearBells,
  EXAMPLE_INTRO,
  EXAMPLE_QUESTION,
  newPage,
  now,
  openHost,
  startStation,
} from "./helpers";

test("host page: header, room code, join box, editor card, reset case", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header .brand")).toHaveText("OSCE Simulation Platform");
  await expect(page.locator("header nav")).toHaveCount(0);
  await expect(page.locator("header #chipCode")).toHaveText(/^[A-HJ-NP-Z]{4}$/);
  await expect(page.locator("header #bellTest")).toBeVisible();
  await expect(page.locator("#helpBtn")).toHaveCount(0);
  await expect(page.locator("#drop #editorLink")).toHaveAttribute("href", "/editor");

  // titles share one size
  const size = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).fontSize);
  expect(await size("#loadTitle")).toBe(await size("#planTitle"));
  expect(await size("#joinTitle")).toBe(await size("#planTitle"));

  // reset case
  await expect(page.locator("#resetCaseBtn")).toBeDisabled();
  await page.locator("#exampleBtn").click();
  await expect(page.locator("#startBtn")).toBeEnabled();
  await page.locator("#resetCaseBtn").click();
  await expect(page.locator("#planTitle")).toHaveText("No case loaded");
  await expect(page.locator("#startBtn")).toBeDisabled();
  await page.reload();
  await expect(page.locator("#planTitle")).toHaveText("No case loaded");

  // join box
  await expect(page.locator("#joinGo")).toHaveCSS("pointer-events", "none");
  await page.locator("#joinCode").fill("abcd");
  await page.locator("#joinGo").click();
  await expect(page).toHaveURL(/\/$/); // no separate /join path
  await expect(page.locator("#lobbyMsg")).toHaveText("No host found.");
  await page.locator("#leaveBtn").click();
  await expect(page.locator("#joinCode")).toBeVisible(); // back on the home screen
  await expect(page.locator("header #chipCode")).toHaveText(/^[A-HJ-NP-Z]{4}$/);
});

test("host alone: full station on a fake clock rings at 60 s (x2), 360 s (x1), 420 s (x2), 480 s (x2)", async ({
  browser,
}) => {
  const { ctx, page } = await newPage(browser, { clock: true });
  await openHost(page, { pause: true });
  await page.locator("#startBtn").click();
  await page.locator("#readyGo").click();
  const t0 = await now(page);
  await clearBells(page);

  await expect(page.locator("#phaseName")).toHaveText("Reading time");
  await expect(page.locator("#time")).toHaveText("1:00");
  await expect(page.locator(".stem-box.reading-big")).toContainText(EXAMPLE_INTRO);

  await page.clock.runFor(59_000);
  await expect(page.locator("#time")).toHaveText("0:01");
  await page.clock.runFor(1_300);
  await expect(page.locator("#phaseName")).toHaveText("History taking");
  await expect(page.locator("#time")).toHaveText("6:00");
  await expect(page.locator(".case")).toBeVisible();
  await expect(page.locator("#stage")).not.toContainText(EXAMPLE_QUESTION);

  await page.clock.runFor(301_000); // 362 s in: past the 360 s warning
  await page.clock.runFor(60_000); // 422 s: past the 420 s end of history
  await expect(page.locator("#phaseName")).toHaveText("Examiner question");
  await expect(page.locator("#stage")).toContainText(EXAMPLE_QUESTION);
  await page.clock.runFor(60_000); // 482 s
  await expect(page.locator("#phaseName")).toHaveText("Station finished");

  const got = await bells(page, t0);
  const expected: [number, number][] = [
    [60_000, 2],
    [360_000, 1],
    [420_000, 2],
    [480_000, 2],
  ];
  expect(got).toHaveLength(expected.length);
  expected.forEach(([at, strikes], i) => {
    expect(got[i].strikes).toBe(strikes);
    expect(got[i].at).toBeGreaterThanOrEqual(at);
    expect(got[i].at).toBeLessThan(at + 400);
  });
  await ctx.close();
});

test("skip rings nothing; pause freezes and Space toggles", async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { clock: true });
  await openHost(page, { pause: true });
  await startStation(page);
  await clearBells(page);

  await page.clock.runFor(5_000);
  await page.keyboard.press("Space");
  await expect(page.locator("#pauseBtn")).toHaveText("Resume");
  const frozen = await page.locator("#time").textContent();
  await page.clock.runFor(30_000);
  await expect(page.locator("#time")).toHaveText(frozen as string);
  await page.keyboard.press("Space");
  await expect(page.locator("#pauseBtn")).toHaveText("Pause");

  await page.locator("#skipBtn").click();
  await expect(page.locator("#phaseName")).toHaveText("History taking");
  await page.locator("#skipBtn").click();
  await page.locator("#skipBtn").click();
  await expect(page.locator("#phaseName")).toHaveText("Station finished");
  expect(await bells(page, 0)).toEqual([]);
  await ctx.close();
});

test("show case button during question time (and on finish) renders the sections once", async ({ page }) => {
  await openHost(page);
  await startStation(page);
  await page.locator("#skipBtn").click();
  await page.locator("#skipBtn").click();
  await expect(page.locator("#phaseName")).toHaveText("Examiner question");
  await expect(page.locator(".case")).toHaveCount(0);
  await page.getByRole("button", { name: "Show case", exact: true }).click();
  await expect(page.locator("#caseArea .case")).toBeVisible();
  await expect(page.locator("#caseArea .stem-box")).toContainText(EXAMPLE_INTRO);
  await expect(page.locator("#caseArea")).toContainText("Peter Walsh");
  await expect(page.getByRole("button", { name: "Show case", exact: true })).toHaveCount(0);

  await page.locator("#skipBtn").click();
  // finished: question, model answer and case sections all shown, no buttons
  await expect(page.locator(".done-box .question-big")).toBeVisible();
  await expect(page.locator(".done-box .answer")).toBeVisible();
  await expect(page.locator(".done-box .case")).toBeVisible();
  await expect(page.getByRole("button", { name: /again|Show case sections/ })).toHaveCount(0);

  // a new station resets the button
  await page.locator("#resetBtn").click();
  await page.locator("#startBtn").click();
  await page.locator("#readyGo").click();
  await page.locator("#skipBtn").click();
  await page.locator("#skipBtn").click();
  await expect(page.getByRole("button", { name: "Show case", exact: true })).toBeVisible();
});

test("no-room regression: paste, file, example, ready screen, timer only, two-click end", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/host");
  await expect(page.locator("#startBtn")).toBeDisabled();

  // paste
  await page.getByRole("button", { name: "Paste .md" }).click();
  await page
    .locator("#pasteIn")
    .fill('---\nintro: "Pasted intro"\nquestion: "Pasted Q?"\n---\n\n## One\nHello\n');
  await page.locator("#pasteIn").press("Control+Enter");
  await expect(page.locator("#planStem")).toHaveText("Pasted intro");
  await expect(page.locator("#pastePanel")).toBeHidden();
  await expect(page.locator("#startBtn")).toBeEnabled();

  // file
  await page.locator("#fileIn").setInputFiles({
    name: "from-file.md",
    mimeType: "text/markdown",
    buffer: Buffer.from('---\ntitle: File case\nintro: "File intro"\nquestion: "Q"\n---\n## A\nx\n'),
  });
  await expect(page.locator("#planTitle")).toHaveText("File case");

  // persisted in localStorage
  await page.reload();
  await expect(page.locator("#planTitle")).toHaveText("File case");

  // example + ready screen cancel with Esc
  await page.getByRole("button", { name: "Load example case" }).click();
  await page.locator("#startBtn").click();
  await expect(page.locator("#ready")).toBeVisible();
  await expect(page.locator("#readyGo")).toHaveText("Start");
  await page.keyboard.press("Escape");
  await expect(page.locator("#ready")).toBeHidden();

  // timer only: no case content
  await page.locator("#timerOnlyBtn").click();
  await page.locator("#readyGo").click();
  await expect(page.locator("#phaseName")).toHaveText("Reading time");
  await expect(page.locator("#stage")).toBeEmpty();
  await page.locator("#skipBtn").click();
  await expect(page.locator("#stage")).toBeEmpty();

  // two-click end station, no confirm()
  page.on("dialog", () => {
    throw new Error("unexpected confirm()");
  });
  await page.locator("#resetBtn").click();
  await expect(page.locator("#resetBtn")).toHaveText("Click again to end");
  await page.locator("#resetBtn").click();
  await expect(page.locator("#setup")).toBeVisible();

  // timer-only again from the finished screen
  await page.locator("#timerOnlyBtn").click();
  await page.locator("#readyGo").click();
  for (let i = 0; i < 3; i++) await page.locator("#skipBtn").click();
  await expect(page.getByRole("button", { name: "Run timer again" })).toHaveCount(0);
  await page.locator("#resetBtn").click();
});

test("#load=<base64> preloads the case and strips the fragment", async ({ page }) => {
  const md = '---\nintro: "Linked intro é"\nquestion: "Q?"\n---\n\n## One\nHello\n';
  await page.goto(`/#load=${Buffer.from(md, "utf8").toString("base64")}`);
  await expect(page.locator("#planStem")).toHaveText("Linked intro é");
  expect(new URL(page.url()).hash).toBe("");
  await page.reload();
  await expect(page.locator("#planStem")).toHaveText("Linked intro é");
});

test("bad #load= fragment is stripped and reports an error", async ({ page }) => {
  await page.goto("/#load=!!!notbase64");
  await expect(page.locator("#status")).toHaveText("Couldn’t read the case in the link.");
  expect(new URL(page.url()).hash).toBe("");
});
