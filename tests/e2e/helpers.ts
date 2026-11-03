import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

export const EXAMPLE_INTRO =
  "You are a medical student in the emergency department. Mr Peter Walsh, 62, has presented with chest pain. Take a focused history.";
export const EXAMPLE_QUESTION =
  "What is your most likely diagnosis, and what are two differentials you would want to exclude?";

export type Bell = { at: number; strikes: number };

/** Records bell strikes (groups of 9 oscillators started in the same tick; ignores the 40 Hz keep-alive). */
export async function recordBells(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __osc: { t: number; f: number }[] };
    w.__osc = [];
    const orig = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (this: OscillatorNode, ...a: [number?]) {
      w.__osc.push({ t: performance.now(), f: this.frequency.value });
      return orig.apply(this, a);
    };
  });
}

export async function clearBells(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __osc: unknown[] }).__osc = [];
  });
}

/** Bell calls since the last clear, with time relative to `origin` (a performance.now() reading). */
export async function bells(page: Page, origin: number): Promise<Bell[]> {
  const osc = await page.evaluate(() => (window as unknown as { __osc: { t: number; f: number }[] }).__osc);
  const out: Bell[] = [];
  for (const o of osc.filter((x) => x.f > 100)) {
    const last = out.at(-1);
    if (last && Math.abs(last.at - (o.t - origin)) < 1) last.strikes += 1 / 9;
    else out.push({ at: o.t - origin, strikes: 1 / 9 });
  }
  return out.map((b) => ({ at: b.at, strikes: Math.round(b.strikes) }));
}

export const now = (page: Page) => page.evaluate(() => performance.now());

export async function newPage(
  browser: Browser,
  opts: { clock?: boolean; touch?: boolean } = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(
    opts.touch ? { hasTouch: true, isMobile: true, viewport: { width: 800, height: 600 } } : {},
  );
  const page = await ctx.newPage();
  await recordBells(page);
  if (opts.clock) await page.clock.install({ time: 0 });
  return { ctx, page };
}

export async function openHost(page: Page, opts: { pause?: boolean; example?: boolean } = {}) {
  await page.goto("/host");
  if (opts.pause) await page.clock.pauseAt(10_000);
  if (opts.example !== false) {
    await page.locator("#exampleBtn").click();
    await expect(page.locator("#planTitle")).toHaveText("Chest pain in a 62-year-old man");
  }
}

export async function startStation(page: Page, bare = false) {
  await page.locator(bare ? "#timerOnlyBtn" : "#startBtn").click();
  await page.locator("#readyGo").click();
  await expect(page.locator("#run")).toBeVisible();
}

/** A room is created automatically when the host page loads; read its code from the header. */
export async function createRoom(host: Page): Promise<string> {
  const code = host.locator("#chipCode");
  await expect(code).toHaveText(/^[A-HJ-NP-Z]{4}$/);
  return (await code.textContent()) as string;
}

/** Join a room from the home screen's "Join a room" box; this goes straight to the waiting room. */
export async function joinDisplay(page: Page, code: string) {
  await page.goto("/");
  await page.locator("#joinCode").fill(code);
  await page.locator("#joinGo").click();
}

/** Advance a page's fake clock in small steps, letting WebSocket traffic land between steps. */
export async function runBoth(pages: Page[], totalMs: number, stepMs = 1000) {
  for (let done = 0; done < totalMs; done += stepMs) {
    for (const p of pages) await p.clock.runFor(stepMs);
    await pages[0].waitForTimeout(12);
  }
}
