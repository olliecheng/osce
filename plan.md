# Plan: OSCE history station → standalone Cloudflare app with host/display sync

## 0. Context for the agent

`osce-history.html` (provided alongside this plan) is a working single-file mock-OSCE timer. Read it fully before starting. It is the reference for all existing behaviour and visual design. It was built as a Claude Artifact; this project moves it to its own repository on Cloudflare and adds a second-screen mode.

Roles used throughout:

- **Host**: the device running the station (the existing page). Used by the role-player. Holds the case, controls the timer, and is the single source of truth.
- **Display**: a secondary screen for the candidate. Joins the host with a 4-letter code. Read-only.

## 1. Goals

1. Port the existing page to a repository deployable with `wrangler deploy`, with no dependency on the Claude Artifacts runtime.
2. Add host/display mode via a 4-letter room code, relayed by a Cloudflare Worker + Durable Object (WebSocket).
3. Make three UI changes:
   - **Display** shows the stem but never the question or answer, and shows the timer and bar only on hover.
   - **Host** gets a "Show case" button during question time, behaving like the existing one on the finished screen.
4. Keep every existing behaviour (section 9) working, including when no room is used.

Non-goals: accounts, persistence of cases server-side, more than one host per room, peer-to-peer transport.

## 2. Stack (decided; do not substitute)

- **Runtime**: one Cloudflare Worker serving static assets and the WebSocket API, plus one Durable Object class (`Room`).
- **Build**: Vite with `@cloudflare/vite-plugin`, TypeScript everywhere. `vite dev` runs the Worker in workerd locally; `vite build && wrangler deploy` ships.
- **Durable Object**: SQLite-backed (`new_sqlite_classes` migration, required on the free plan). Use the WebSocket Hibernation API (`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`, `serializeAttachment`). Use `ctx.storage` for room state, and a DO alarm for host-disconnect expiry.
- **Frontend**: no framework. Plain TypeScript modules, ported from the existing inline script. Dependencies from npm:
  - `marked`, replacing the cdnjs script tag
  - `@fontsource-variable/inter`, self-hosted instead of Google Fonts
- **Tests**:
  - `vitest` with `@cloudflare/vitest-pool-workers` for the Worker and DO
  - Playwright for end-to-end, using `page.clock` for timer tests
- **Lint/format**: Biome.

Use current stable versions. Pin exact versions in `package.json`. Check the Cloudflare docs for current `wrangler.jsonc` syntax and `compatibility_date` rather than relying on memory.

## 3. Repository layout

```
/
├─ package.json
├─ vite.config.ts          # cloudflare() plugin
├─ wrangler.jsonc          # assets (SPA fallback), DO binding + migration
├─ tsconfig.json
├─ biome.json
├─ README.md               # dev, test, deploy, case format
├─ worker/
│  ├─ index.ts             # fetch: /api/* routes, else assets
│  ├─ room.ts              # Durable Object Room
│  └─ protocol.ts          # shared message types (imported by web/ too)
├─ web/
│  ├─ index.html           # landing: Run station / Join as display
│  ├─ src/
│  │  ├─ main.ts           # routing between host and display views
│  │  ├─ host/             # existing station UI (ported)
│  │  ├─ display/          # new display UI
│  │  ├─ case.ts           # front matter + section parsing (ported verbatim)
│  │  ├─ timer.ts          # phase engine, shared by host and display
│  │  ├─ bell.ts           # audio engine (ported verbatim, incl. Safari fixes)
│  │  ├─ sync.ts           # WebSocket client with reconnect
│  │  └─ styles.css        # ported CSS + display styles
│  └─ public/              # favicon (🩺 as SVG)
└─ tests/
   ├─ worker/room.test.ts
   └─ e2e/*.spec.ts
```

`wrangler.jsonc` essentials:
- `assets.not_found_handling: "single-page-application"`
- `durable_objects.bindings: [{ name: "ROOM", class_name: "Room" }]`
- `migrations: [{ tag: "v1", new_sqlite_classes: ["Room"] }]`

## 4. Port first (milestone 1, no new features)

1. Split the HTML file into `index.html`, `styles.css` and TS modules as above. Keep the DOM structure, class names, CSS tokens (light and dark), Inter typography and corner radii identical.
2. Remove Artifact-only concerns:
   - the CDN `<script>` and Google Fonts links (use the npm packages instead)
   - the safe-area padding (keep it; it is harmless and correct)
   - localStorage try/catch (keep it)
3. Keep `parseFrontMatter`, `splitSections`, the bell synthesis (`strike`, bus, keep-alive, fresh context per gesture, `<audio>` fallback, `navigator.audioSession`) **behaviourally identical**. Convert them to TS without "improving" them.
4. Extract the phase engine from the DOM into `timer.ts`:
   - Pure state: `phaseIdx`, `endAt`, `pausedLeft`, `warned`, `timerOnly`.
   - Methods: `start`, `pause`, `resume`, `skip`, `reset`, `tick(now)`.
   - It emits events (`phase`, `warn`, `end`, `finish`) that the UI and the bell subscribe to.
   - Use `performance.now()` internally.
5. Acceptance: the Playwright suite (section 8) passes against the ported host with no room.

## 5. Room service (milestone 2)

### 5.1 HTTP / WebSocket API

| Route | Purpose |
|---|---|
| `POST /api/rooms` | Create a room. Response: `{ code, hostToken }`. |
| `GET /api/rooms/:code/ws?role=host&token=…` | Host WebSocket. |
| `GET /api/rooms/:code/ws?role=display` | Display WebSocket. |

**Room creation** (`POST /api/rooms`):
- The Worker generates a code from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I or O), 4 characters, via `crypto.getRandomValues`.
- It gets the DO stub with `idFromName(code)` and calls the RPC method `claim(hostToken)`.
- If the room is occupied (a live host, or a host disconnect less than 2 minutes ago), it retries with a new code, up to 10 times.
- `hostToken` is 128 random bits, hex-encoded. The host keeps it in `sessionStorage` so a page refresh can reclaim the room.

**Code input**: case-insensitive, trimmed. Reject anything that isn't 4 letters from the alphabet client-side before connecting.

**Rate limiting**: limit display join attempts per IP using the Workers Rate Limiting binding (for example, 20 per minute) to blunt code enumeration.

### 5.2 Room state (in DO storage)

```ts
type RoomState = {
  hostToken: string;
  status: "lobby" | "running";
  hostConnected: boolean;
  hostGoneAt: number | null;      // Date.now()
  snapshot: DisplaySnapshot | null;
};
```

### 5.3 Rules

- **Displays may only join while `status === "lobby"`.** Otherwise the server accepts the socket, sends `{ type: "error", code: "in_progress" }`, and closes it with code `4001`.
- **Displays stay connected across sessions.** When a station finishes or the host returns to setup, the host sends `status: "lobby"`; connected displays remain.
- **The host is authoritative.** The server stores the latest snapshot and fans it out to all displays. It never runs a timer.
- **A second host socket with a valid token** replaces the first, which is closed with code `4002`.
- **Host disconnect**:
  - Set `hostGoneAt`, broadcast `{ type: "host", connected: false }`, and set a 2-minute alarm.
  - If the host reconnects within 2 minutes, cancel the alarm and broadcast `connected: true`.
  - If the alarm fires, close all displays with code `4004` ("room closed") and clear storage.
- **Displays never send commands.** Ignore any message from a display except `ping`.

### 5.4 Messages (`worker/protocol.ts`, shared)

```ts
// host → server
type HostMsg =
  | { type: "snapshot"; snapshot: DisplaySnapshot }
  | { type: "ping" };

// server → display
type ServerMsg =
  | { type: "welcome"; code: string; status: "lobby" | "running"; hostConnected: boolean }
  | { type: "snapshot"; snapshot: DisplaySnapshot }
  | { type: "host"; connected: boolean }
  | { type: "error"; code: "in_progress" | "no_room" | "bad_code" }
  | { type: "pong" };

// server → host
type ServerToHost =
  | { type: "welcome"; code: string; displays: number }
  | { type: "displays"; count: number }
  | { type: "pong" };

type DisplaySnapshot = {
  seq: number;                    // monotonically increasing per host session
  sessionId: string;              // new per station start
  status: "lobby" | "running";
  phase: "ready" | "reading" | "history" | "question" | "done" | null;
  remainingMs: number | null;     // at send time
  paused: boolean;
  timerOnly: boolean;
  title: string | null;
  stem: string | null;            // the case's intro; null in timer-only mode
};
```

**Privacy rule**: `DisplaySnapshot` must never contain the question, answer or sections. Build it with an explicit allow-list function on the host. A unit test must assert that no other keys are present.

### 5.5 Host sync behaviour

- **When the host sends a snapshot**:
  - on every state change: room created, "Start station" pressed (`phase: "ready"`, `status: "running"`), Start on the black screen, each phase change, pause or resume, skip, finish, and End station / Back to setup (`status: "lobby"`)
  - every 10 s while running, to correct drift
- **Timer value**: `remainingMs` is computed at send time. Displays compute `endAt = performance.now() + remainingMs` on receipt. Do not send wall-clock times; this avoids clock skew between devices.
- **Reconnect**: exponential backoff (0.5 s to 10 s, with jitter), and re-send the current snapshot on reconnect.
- **WebSocket keepalive**: ping every 25 s, using `setWebSocketAutoResponse` in the DO so hibernation is not broken.

## 6. UI changes (milestone 3)

### 6.1 Landing (`/`)

Two actions:
- **Run station** opens the existing host setup.
- **Join as display** opens a 4-letter code input and a **Join** button.

`/join?code=ABCD` pre-fills the code but still requires a click, because the click unlocks audio. Use the existing visual language.

### 6.2 Host additions

- **"Second screen" area in the setup panel:**
  - **Create room** shows the code large and the number of connected displays, which updates live.
  - **Close room** disconnects the host and closes the room.
- **While a station is running**, show the code and display count unobtrusively in the header.
- **Joining is blocked mid-station.** The host UI shows "Displays can join between stations" next to the code while running.
- **"Show case" during question time.** During the question phase, add a **Show case** button below the question (and the model answer). Clicking it renders `stemBlock(false) + caseBlock()` beneath and removes the button. This is the same behaviour as the existing **Show case sections** button on the finished screen; extract one shared function and use it in both places. The button resets on each new station.
- **Room-free use**: everything else is unchanged, and the app must work fully without creating a room.

### 6.3 Display view

**States:**

| State | Shows |
|---|---|
| Not joined | Code input and Join button. Errors: "No station with that code", "That station is in progress; join between stations". |
| Joined, lobby | "Joined ABCD. Waiting for the station to start." Plus the host connection state. |
| Host on the black ready screen (`phase: "ready"`) | Plain black screen. |
| Reading, history, question | The stem (`snapshot.stem`), large, as in the host's reading-time layout (`.stem-box.reading-big`). The stem stays the same through all three phases. No question, no answer, no case content, ever. |
| Timer-only session | Blank page (no stem). |
| Done | "Station finished. Waiting for the next one." |
| Host disconnected | Subtle banner: "Host disconnected. Reconnecting…". Keep the countdown running locally. |
| Room closed (`4004`) | Return to the join screen with a message. |

**Hover-revealed timer.** The display renders the same clock band (time, phase name, progress bar, phase colour), but hidden until the user interacts with that area:
- The band always occupies its layout space at the top of the page. It is visually hidden with `opacity: 0`, not removed, so hovering over the empty strip reveals it (see the reference screenshot).
- Reveal it on `:hover` and `:focus-within` with a short opacity transition. Respect `prefers-reduced-motion`.
- On touch devices (`@media (hover: none)`), tapping the strip reveals it for 3 seconds, then it hides again.
- The display band has no Pause, Skip or End controls.
- The browser tab title must **not** show the countdown on the display (unlike the host), so the time doesn't leak.

**Bells on the display:**
- The display runs its own `timer.ts` instance, seeded from snapshots, and rings using the same bell rules: a single bell at 1:00 remaining in history, and a double bell at the natural end of each phase.
- It rings only on local natural expiry while not paused.
- A skip on the host produces a new-phase snapshot; the display adopts it without ringing, matching the host.
- Deduplicate with the key `${sessionId}:${phase}:${warn|end}`.
- Audio is unlocked by the Join click (`primeAudio(true)`). The keep-alive runs for as long as the display is joined, because displays sit idle between stations.
- If `AudioContext.state !== "running"`, show a small "Tap to enable sound" control that calls `primeAudio(true)`.
- **Test bell** is also available on the display.
- Request a screen wake lock while joined.

## 7. Error handling and edge cases

- A display joining a code with no host returns `no_room`; close with `4003`.
- **Host refresh mid-station**: the timer state is lost (the host is the source of truth). On reload, the host reclaims the room with `sessionStorage` and sends `status: "lobby"`. Displays show the lobby. Do not attempt timer recovery.
- **Multiple displays** are supported. Each receives the same snapshots.
- **Message limits**: snapshots are small. Reject host messages over 64 KB.
- **Validation**: validate all incoming messages with a hand-written type guard and drop invalid ones. No `eval`, and no HTML from the network. Display text is set with `textContent` only.

## 8. Tests

**Unit and Worker (vitest, pool-workers):**
- Code generator alphabet and length; retry on collision.
- `claim` rejects an occupied room and accepts reclaim with the same token.
- A display join while running gets `in_progress` and is closed with `4001`.
- Displays stay connected through the running → lobby transition.
- Host disconnect leads to the alarm, then all displays closed with `4004`; a reconnect within the grace period cancels the alarm.
- The snapshot allow-list strips question, answer and sections.
- `parseFrontMatter` and `splitSections`: port the example case from the HTML as a fixture.

**E2E (Playwright, `page.clock`):**
- **Host alone**: full station with a fake clock. Bell oscillator starts at 60 s (double), 420 s (single warning) and 480 s (double). Record them by wrapping `AudioContext` with `addInitScript`, as in the reference test approach.
- **Host + display in two pages**:
  - join in lobby
  - start
  - the display shows the stem, and the question text never appears in the display's DOM
  - the display countdown is within 1 s of the host's
  - pause and resume propagate
  - skip propagates without a display bell
  - finish returns to the lobby with the display still joined
  - a second station works without rejoining
- **Display join mid-station** is rejected with the correct message.
- **Hover reveal**: the band has opacity 0 by default and 1 on hover; the touch emulation tap shows it for 3 s.
- **"Show case" during question time** renders the case sections on the host.
- **No-room regression**: paste, choose file, example, the black ready screen, Run timer only, two-click End station, help dialog copy buttons.

## 9. Existing behaviour to preserve (regression checklist)

**Phases and bells**
- Phases: reading 1:00, then history 7:00, then question 1:00.
- Single bell at 1:00 remaining in history.
- Double bell at the natural end of every phase.
- No bell on skip.

**Starting**
- **Start station** and **Run timer only** both open the black screen with a white **Start** button and **Cancel**. Esc cancels.
- **Run this case again** and **Run timer again** also open the black screen.
- Timer-only mode shows no case content, and works with no case loaded.

**Controls**
- Pause/Resume, also on Space.
- Skip to next.
- End station needs two clicks: the first shows "Click again to end" for 3 s. No `confirm()`.

**Loading cases**
- **Paste .md** (primary button) opens a textarea; Load, Cmd/Ctrl+Enter or Esc to close.
- **Choose .md file** (secondary) and drag-and-drop.
- **Load example case**.
- The last case is persisted in localStorage.

**Help dialog**
- "How to write a case" opens from the top left.
- A prominent **Copy agent prompt** button in the dialog header.
- Copy template and copy prompt buttons on the code boxes.

**Audio robustness (Safari)**
- A fresh AudioContext on each click that needs sound.
- One shared output bus; oscillators disconnect when they end.
- Inaudible keep-alive during a station.
- `<audio>` fallback with a pre-rendered WAV.
- `navigator.audioSession.type = "playback"`.

**Layout and theme**
- Light and dark themes via CSS tokens.
- Inter font.
- Small corner radii.
- Phase colours: amber (reading), teal (history), red (question).
- Sticky clock band on the host.
- Section index navigation during history.
- Screen wake lock during a station.

## 10. Milestones and definition of done

1. **Port**: the repository builds, `vite dev` works, the host is identical to the HTML, and the regression E2E tests are green.
2. **Room service**: the DO and API are implemented, and the Worker tests are green.
3. **Host and display UI**: section 6 is implemented, and all E2E tests are green.
4. **Deploy**:
   - `README.md` documents `npm run dev`, `npm test`, `npm run deploy` and the case-file format (copy it from the help dialog).
   - `wrangler deploy` succeeds on a free-plan account.
   - Manually verify on Safari (macOS and iOS) that bells ring on the display after more than 5 minutes idle in the lobby.

Commit after each milestone. Do not change the case-file format.