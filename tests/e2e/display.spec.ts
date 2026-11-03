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
  await expect(host.locator("#roomMeta")).toHaveText("0 displays connected");

  await joinDisplay(disp, code);
  await expect(disp.locator("#lobbyMsg")).toHaveText(`Joined ${code}. Waiting for the station to start.`);
  await expect(host.locator("#roomMeta")).toHaveText("1 display connected");

  // start: the host's black ready screen is plain black on the display
  await host.locator("#startBtn").click();
  await expect(disp.locator("#dBlack")).toBeVisible();
  await host.locator("#readyGo").click();
  await expect(disp.locator("#dBlack")).toBeHidden();

  // stem is shown, question and case content never reach the display
  await expect(disp.locator(".stem-box.reading-big")).toContainText(EXAMPLE_INTRO);
  await host.locator("#skipBtn").click();
  await expect(disp.locator("#dPhaseName")).toHaveText("History taking");
  await expect(disp.locator(".stem-box.reading-big")).toContainText(EXAMPLE_INTRO);
  await expect(disp.locator(".case")).toHaveCount(0);
  await host.locator("#skipBtn").click();
  await expect(disp.locator("#dPhaseName")).toHaveText("Examiner question");
  await expect(disp.locator(".stem-box.reading-big")).toContainText(EXAMPLE_INTRO);
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

  // joining mid-station is rejected with the right message
  const late = await newPage(browser);
  await joinDisplay(late.page, code);
  await expect(late.page.locator("#joinErr")).toHaveText(
    "That station is in progress; join between stations.",
  );
  await late.ctx.close();
  await expect(host.locator("#roomMeta")).toHaveText("1 display connected");
  await expect(host.locator("#roomChip")).toContainText("Displays can join between stations");

  // finish -> lobby, display still joined
  await host.locator("#skipBtn").click();
  await expect(disp.getByText("Station finished. Waiting for the next one.")).toBeVisible();
  await expect(host.locator("#roomMeta")).toHaveText("1 display connected");

  // a late display can now join between stations
  const late2 = await newPage(browser);
  await joinDisplay(late2.page, code);
  await expect(late2.page.getByText("Station finished. Waiting for the next one.")).toBeVisible();
  await late2.ctx.close();

  // a second station works without rejoining
  await host.getByRole("button", { name: "Run this case again" }).click();
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

test("display timer band is hidden until hover or focus", async ({ browser }) => {
  const h = await newPage(browser);
  const d = await newPage(browser);
  await openHost(h.page);
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await startStation(h.page);
  const band = d.page.locator("#dClock");
  await expect(band).toBeVisible();
  const opacity = () => band.evaluate((el) => getComputedStyle(el).opacity);
  expect(await opacity()).toBe("0");
  const box = (await band.boundingBox()) as { x: number; y: number; width: number; height: number };
  expect(box.height).toBeGreaterThan(40); // the hidden band still occupies layout space
  await d.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(opacity).toBe("1");
  await d.page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
  await expect.poll(opacity).toBe("0");
  await band.focus();
  await expect.poll(opacity).toBe("1");
  await h.ctx.close();
  await d.ctx.close();
});

test("touch: tapping the strip reveals the band for 3 s", async ({ browser }) => {
  const h = await newPage(browser);
  const d = await newPage(browser, { touch: true });
  await openHost(h.page);
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await startStation(h.page);
  const band = d.page.locator("#dClock");
  await expect(band).toBeVisible();
  const opacity = () => band.evaluate((el) => getComputedStyle(el).opacity);
  expect(await opacity()).toBe("0");
  await band.tap();
  await expect.poll(opacity).toBe("1");
  await d.page.waitForTimeout(2000);
  expect(await opacity()).toBe("1");
  await expect.poll(opacity, { timeout: 3000 }).toBe("0");
  await h.ctx.close();
  await d.ctx.close();
});

test("display errors: unknown code, bad code, room closed by host", async ({ browser }) => {
  const d = await newPage(browser);
  await d.page.goto("/join");
  await d.page.locator("#codeIn").fill("ab1");
  await d.page.locator("#joinBtn").click();
  await expect(d.page.locator("#joinErr")).toContainText("4-letter code");
  await d.page.locator("#codeIn").fill("zzzy");
  await d.page.locator("#joinBtn").click();
  await expect(d.page.locator("#joinErr")).toHaveText("No station with that code.");

  const h = await newPage(browser);
  await openHost(h.page);
  const code = await createRoom(h.page);
  await joinDisplay(d.page, code.toLowerCase());
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await h.page.locator("#closeRoomBtn").click();
  await expect(d.page.locator("#joinErr")).toHaveText("This station was closed by the host.");
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
  await expect(h.page.locator("#roomCode")).toHaveText(code);
  await expect(d.page.locator("#lobbyMsg")).toBeVisible();
  await expect(h.page.locator("#roomMeta")).toHaveText("1 display connected");
  await h.ctx.close();
  await d.ctx.close();
});
