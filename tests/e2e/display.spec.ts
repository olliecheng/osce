import { expect, type Page, test } from "@playwright/test";
import {
  bells,
  clearBells,
  createRoom,
  EXAMPLE_INTRO,
  EXAMPLE_QUESTION,
  joinDisplay,
  newPage,
  now,
  openHost,
  runBoth,
  startStation,
} from "./helpers";

const secs = async (page: Page, id: string) => {
  const [m, s] = ((await page.locator(id).textContent()) as string).split(":").map(Number);
  return m * 60 + s;
};

test("host + display: lobby join, stem only, synced timer, pause, skip, finish, second station", async ({
  browser,
}) => {
  const h = await newPage(browser);
  const d = await newPage(browser);
  const host = h.page;
  const disp = d.page;

  await openHost(host);
  const code = await createRoom(host);

  await joinDisplay(disp, code);
  await expect(disp.locator("#lobbyMsg")).toHaveText(`Joined ${code}. Waiting for the station to start.`);

  // start: the host's black ready screen is plain black on the display
  await host.locator("#startBtn").click();
  await expect(disp.locator("#dBlack")).toBeVisible();
  await host.locator("#readyGo").click();
  await expect(disp.locator("#dBlack")).toBeHidden();

  // stem is shown, question and case content never reach the display
  await expect(disp.locator(".stem-box.reading-big")).toContainText(EXAMPLE_INTRO);
  await host.locator("#skipBtn").click();
  await expect(disp.locator("#dPhaseName")).toHaveText("History taking");
  await expect(disp.locator(".stem-box")).toHaveCount(0);
  await expect(disp.locator(".case")).toHaveCount(0);
  await host.locator("#skipBtn").click();
  await expect(disp.locator("#dPhaseName")).toHaveText("Examiner question");
  await expect(disp.locator(".stem-box")).toHaveCount(0); // blank during the question
  const html = await disp.content();
  for (const secret of [
    EXAMPLE_QUESTION,
    "acute coronary syndrome",
    "Peter Walsh, 62, retired",
    "Sitting forward slightly",
  ]) {
    expect(html).not.toContain(secret);
  }
  expect(await disp.title()).toBe("OSCE display"); // no countdown in the tab title
  expect(await host.title()).toMatch(/^\d+:\d\d Examiner question$/);

  // countdowns within 1 s
  expect(Math.abs((await secs(host, "#time")) - (await secs(disp, "#dTime")))).toBeLessThanOrEqual(1);

  // pause + resume propagate
  await host.locator("#pauseBtn").click();
  await expect(disp.locator("#dClock")).toHaveClass(/paused/);
  const frozen = await disp.locator("#dTime").textContent();
  await disp.waitForTimeout(1500);
  await expect(disp.locator("#dTime")).toHaveText(frozen as string);
  await host.locator("#pauseBtn").click();
  await expect(disp.locator("#dClock")).not.toHaveClass(/paused/);

  // joining mid-station works and shows the stem straight away
  const late = await newPage(browser);
  await joinDisplay(late.page, code);
  await expect(late.page.locator(".stem-box.reading-big")).toContainText(EXAMPLE_INTRO);
  await expect(late.page.locator("#dPhaseName")).toHaveText("Examiner question");
  await late.ctx.close();

  // finish -> lobby, display still joined
  await host.locator("#skipBtn").click();
  // the finished display mirrors the examiner: question, model answer, then the case sections
  await expect(disp.locator("#dPhaseName")).toHaveText("Station finished");
  await expect(disp.locator("#dClock")).toBeVisible();
  await expect(disp.locator(".question-big")).toBeVisible();
  await expect(disp.locator(".answer-title")).toHaveText("Model answer");
  await expect(disp.locator("details.answer")).toHaveCount(0);
  await expect(disp.locator(".case .sec").first()).toBeVisible();
  await expect(disp.locator(".case")).toContainText("Peter Walsh");
  await expect(disp.getByRole("button", { name: /again/i })).toHaveCount(0);

  // a late display joining after the finish sees the same
  const late2 = await newPage(browser);
  await joinDisplay(late2.page, code);
  await expect(late2.page.locator(".question-big")).toBeVisible();
  await expect(late2.page.locator(".case")).toContainText("Peter Walsh");
  await late2.ctx.close();

  // a second station works without rejoining
  await expect(host.getByRole("button", { name: /again/i })).toHaveCount(0);
  await host.locator("#resetBtn").click();
  await host.locator("#startBtn").click();
  await expect(disp.locator("#dBlack")).toBeVisible();
  await host.locator("#readyGo").click();
  await expect(disp.locator("#dPhaseName")).toHaveText("Reading time");
  await expect(disp.locator(".stem-box.reading-big")).toContainText(EXAMPLE_INTRO);

  // ending back to setup returns the display to the lobby, still joined
  await host.locator("#resetBtn").click();
  await host.locator("#resetBtn").click();
  await expect(disp.locator("#lobbyMsg")).toBeVisible();

  await h.ctx.close();
  await d.ctx.close();
});

test("display bells match the host on natural expiry and never ring on skip", async ({ browser }) => {
  const h = await newPage(browser, { clock: true });
  const d = await newPage(browser, { clock: true });
  await openHost(h.page, { pause: true });
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await d.page.clock.pauseAt(10_000);

  await startStation(h.page);
  const t0h = await now(h.page);
  await expect(d.page.locator("#dClock")).toBeAttached();
  await expect(d.page.locator("#dPhaseName")).toHaveText("Reading time");
  const t0d = await now(d.page);
  await clearBells(h.page);
  await clearBells(d.page);

  await runBoth([h.page, d.page], 62_000);
  await expect(d.page.locator("#dPhaseName")).toHaveText("History taking");
  // skip on the host: new phase on the display, but no extra bell there
  await h.page.locator("#skipBtn").click();
  await expect(d.page.locator("#dPhaseName")).toHaveText("Examiner question");
  const hostBells = await bells(h.page, t0h);
  const dispBells = await bells(d.page, t0d);
  expect(hostBells.map((b) => b.strikes)).toEqual([2]);
  expect(dispBells.map((b) => b.strikes)).toEqual([2]);
  expect(Math.abs(dispBells[0].at - hostBells[0].at)).toBeLessThan(2500);

  // natural expiry of the question phase on both
  await clearBells(h.page);
  await clearBells(d.page);
  await runBoth([h.page, d.page], 61_000);
  await expect(d.page.getByText("Station finished. Waiting for the next one.")).toBeVisible();
  expect((await bells(h.page, 0)).map((b) => b.strikes)).toEqual([2]);
  expect((await bells(d.page, 0)).map((b) => b.strikes)).toEqual([2]);

  await h.ctx.close();
  await d.ctx.close();
});

test("display rings the 1:00 warning once in history, and a double at the end", async ({ browser }) => {
  const h = await newPage(browser, { clock: true });
  const d = await newPage(browser, { clock: true });
  await openHost(h.page, { pause: true });
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await d.page.clock.pauseAt(10_000);
  await startStation(h.page);
  await expect(d.page.locator("#dPhaseName")).toHaveText("Reading time");
  await h.page.locator("#skipBtn").click();
  await expect(d.page.locator("#dPhaseName")).toHaveText("History taking");
  const t0h = await now(h.page);
  const t0d = await now(d.page);
  await clearBells(h.page);
  await clearBells(d.page);

  await runBoth([h.page, d.page], 362_000); // past the 1:00-remaining warning (360 s in)
  const hostBells = await bells(h.page, t0h);
  const dispBells = await bells(d.page, t0d);
  expect(hostBells.map((b) => b.strikes)).toEqual([1]);
  expect(dispBells.map((b) => b.strikes)).toEqual([1]);
  expect(Math.abs(dispBells[0].at - hostBells[0].at)).toBeLessThan(2500);
  await runBoth([h.page, d.page], 60_000); // natural end of history (420 s)
  expect((await bells(h.page, t0h)).map((b) => b.strikes)).toEqual([1, 2]);
  expect((await bells(d.page, t0d)).map((b) => b.strikes)).toEqual([1, 2]);
  await h.ctx.close();
  await d.ctx.close();
});

test("timer-only session shows a blank display with the hidden timer", async ({ browser }) => {
  const h = await newPage(browser);
  const d = await newPage(browser);
  await openHost(h.page, { example: false });
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await startStation(h.page, true);
  await expect(d.page.locator("#dPhaseName")).toHaveText("Reading time");
  await expect(d.page.locator(".stem-box")).toHaveCount(0);
  await expect(d.page.locator("#dStage")).toHaveText("");
  await h.ctx.close();
  await d.ctx.close();
});

test("display: phase band always shown; timer and bar only with Show timer; stem hidden during history", async ({
  browser,
}) => {
  const h = await newPage(browser);
  const d = await newPage(browser);
  await openHost(h.page);
  const code = await createRoom(h.page);
  await expect(d.page.locator("#showTimerWrap")).toBeHidden();
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await expect(d.page.locator("#showTimerWrap")).toBeVisible();
  await startStation(h.page);

  await expect(d.page.locator("#dPhaseName")).toBeVisible();
  await expect(d.page.locator("#dPhaseName")).toHaveText("Reading time");
  await expect(d.page.locator("#dTime")).toBeHidden();
  await expect(d.page.locator("#dBarFill")).toBeHidden();
  await expect(d.page.locator(".stem-box")).toContainText(EXAMPLE_INTRO);

  await d.page.getByLabel("Show timer").check();
  await expect(d.page.locator("#dTime")).toBeVisible();
  await expect(d.page.locator("#dBarFill")).toBeVisible();
  await d.page.getByLabel("Show timer").uncheck();
  await expect(d.page.locator("#dTime")).toBeHidden();

  // history: phase still shown, instructions are not
  await h.page.locator("#skipBtn").click();
  await expect(d.page.locator("#dPhaseName")).toHaveText("History taking");
  await expect(d.page.locator(".stem-box")).toHaveCount(0);
  expect(await d.page.content()).not.toContain("Candidate instructions</p>");

  // question: blank
  await h.page.locator("#skipBtn").click();
  await expect(d.page.locator("#dPhaseName")).toHaveText("Examiner question");
  await expect(d.page.locator(".stem-box")).toHaveCount(0);
  await h.ctx.close();
  await d.ctx.close();
});

test("join box: unknown code goes to the waiting room; Leave returns home; later joins work", async ({
  browser,
}) => {
  const d = await newPage(browser);
  await d.page.goto("/");
  await expect(d.page.locator("#joinTitle")).toHaveText("Join a room");
  // greyed out and inert until 4 letters are typed
  const go = d.page.locator("#joinGo");
  await expect(go).toHaveCSS("pointer-events", "none");
  await d.page.locator("#joinCode").fill("ab1");
  await expect(go).toHaveCSS("pointer-events", "none");
  await d.page.locator("#joinCode").press("Enter");
  await expect(d.page.locator("#lobbyMsg")).toHaveCount(0);
  await d.page.locator("#joinCode").fill("abcd");
  await expect(go).toHaveCSS("pointer-events", "auto");
  await d.page.locator("#joinCode").fill("");
  await d.page.locator("#joinCode").fill("zzzy");
  await d.page.locator("#joinGo").click();
  await expect(d.page.locator("#lobbyMsg")).toHaveText("No host found.");
  await expect(d.page.locator("#leaveBtn")).toBeVisible();
  await d.page.locator("#leaveBtn").click();
  await expect(d.page.locator("#joinCode")).toBeVisible();
  await expect(d.page.locator("#displayApp")).toBeHidden();

  // the code box and button are the same height
  const input = (await d.page.locator("#joinCode").boundingBox()) as { height: number };
  const button = (await d.page.locator("#joinGo").boundingBox()) as { height: number };
  expect(Math.abs(input.height - button.height)).toBeLessThan(0.5);

  const h = await newPage(browser);
  await openHost(h.page);
  const code = await createRoom(h.page);
  await d.page.locator("#joinCode").fill(code.toLowerCase());
  await d.page.locator("#joinGo").click();
  await expect(d.page.locator("#lobbyMsg")).toHaveText(`Joined ${code}. Waiting for the station to start.`);
  await expect(d.page.locator("header #chipCode")).toHaveText(code);

  await expect(d.page.locator("#takeoverBtn")).toBeVisible(); // the server's welcome has re-rendered the lobby

  // Leave sits outside the card, in red text with no background, right-aligned with the card
  const card = (await d.page.locator(".card").boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const leave = (await d.page.locator("#leaveBtn").boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  expect(leave.y).toBeGreaterThanOrEqual(card.y + card.height);
  expect(Math.abs(leave.x + leave.width - (card.x + card.width))).toBeLessThan(2);
  expect(await d.page.locator("#leaveBtn").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgba(0, 0, 0, 0)",
  );
  await h.ctx.close();
  await d.ctx.close();
});

test("a viewer can take over as host; the old host becomes a viewer of the same room", async ({
  browser,
}) => {
  const h = await newPage(browser);
  const d = await newPage(browser);
  await openHost(h.page);
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toHaveText(`Joined ${code}. Waiting for the station to start.`);

  // Take over sits immediately left of Leave
  const take = (await d.page.locator("#takeoverBtn").boundingBox()) as { x: number; width: number };
  const leave = (await d.page.locator("#leaveBtn").boundingBox()) as { x: number; width: number };
  expect(take.x + take.width).toBeLessThanOrEqual(leave.x);

  await d.page.locator("#takeoverBtn").click();
  await expect(d.page.locator("#displayApp")).toBeHidden();
  await expect(d.page.locator("header #chipCode")).toHaveText(code);
  await expect(d.page.locator("#joinCode")).toBeVisible();

  // The previous host is now a viewer of the same room, and can take it back
  await expect(h.page.locator("#lobbyMsg")).toHaveText(`Joined ${code}. Waiting for the station to start.`);
  await expect(h.page.locator("#takeoverBtn")).toBeVisible();
  await h.ctx.close();
  await d.ctx.close();
});

test("host and viewer can download the case as .md from the finished screen", async ({ browser }) => {
  const h = await newPage(browser);
  const d = await newPage(browser);
  await openHost(h.page);
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await startStation(h.page);
  await expect(d.page.locator("#downloadMdBtn")).toHaveCount(0); // nothing while running
  for (let i = 0; i < 3; i++) await h.page.locator("#skipBtn").click();
  await expect(d.page.locator("#dPhaseName")).toHaveText("Station finished");
  for (const page of [h.page, d.page]) {
    const dl = page.waitForEvent("download");
    await page.locator("#downloadMdBtn").click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe("chest-pain-in-a-62-year-old-man.md");
    const text = await (await import("node:fs/promises")).readFile((await file.path()) as string, "utf8");
    expect(text).toContain("title: |");
    expect(text).toContain("Peter Walsh");
  }
  await h.ctx.close();
  await d.ctx.close();
});

test("clicking the room code makes a new room; viewers of the old one are told", async ({ browser }) => {
  const h = await newPage(browser);
  const d = await newPage(browser);
  await openHost(h.page);
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toHaveText(`Joined ${code}. Waiting for the station to start.`);
  // viewers can't replace the room they joined
  await d.page.locator("#chipCode").click();
  await expect(d.page.locator("#chipCode")).toHaveText(code);

  await h.page.locator("#chipCode").click();
  await expect(h.page.locator("#chipCode")).not.toHaveText(code);
  await expect(h.page.locator("#chipCode")).toHaveText(/^[A-HJ-NP-Z]{4}$/);
  await expect(d.page.locator("#lobbyMsg")).toHaveText("No host found.");
  await h.ctx.close();
  await d.ctx.close();
});

test("host refresh reclaims the room and returns displays to the lobby", async ({ browser }) => {
  const h = await newPage(browser);
  const d = await newPage(browser);
  await openHost(h.page);
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await startStation(h.page);
  await expect(d.page.locator("#dPhaseName")).toHaveText("Reading time");
  await h.page.reload();
  await expect(h.page.locator("#chipCode")).toHaveText(code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await h.ctx.close();
  await d.ctx.close();
});
