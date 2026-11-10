# OSCE history station

A timed mock-OSCE history station (reading 1:00, history 6:00, examiner question 1:00) with an optional second screen for the candidate. Runs as one Cloudflare Worker serving static assets plus a `Room` Durable Object that relays host snapshots to displays over WebSocket.

- One page at `/`. It is the role-player view (the station); a room is created automatically and its code is shown top right. The "Join a room" box swaps it for the candidate display, and Leave swaps it back.
- The host is authoritative. Displays are read-only and never receive the question, answer or case sections.

## Develop

```sh
npm install
npm run dev          # vite dev, Worker runs in workerd locally
npm test             # vitest (Worker, Durable Object, parsing, timer)
npm run test:e2e     # Playwright (starts `npm run dev` itself)
npm run typecheck
npm run lint
```

## Deploy

```sh
npm run deploy       # vite build && wrangler deploy
```

`name` in `wrangler.jsonc` (`osce`) must match the Worker name of the Cloudflare project. The Durable Object uses a SQLite-backed migration (`v1`), which works on the free plan. `JOIN_LIMITER` is a Workers Rate Limiting binding (20 requests/minute/IP) that limits display joins and room creation.

## Case file format

One Markdown file: front matter, then `##` sections.

- Front matter between two `---` lines: `intro` (read by the candidate), `question` (examiner's question), optional `title` and `answer` (use `|` for multi-line values).
- Each `##` heading becomes a section on the role-player's screen; `###` stays inside its section.
- Write in the patient's voice. Use `- If asked about X: "..."` for things only said when asked, and bold for things never volunteered.

The in-app "How to write a case" dialog has a copyable template and an AI-agent prompt (see `web/src/host/content.ts`).

## Room protocol (summary)

`POST /api/rooms` returns `{ code, hostToken }`. WebSockets: `/api/rooms/:code/ws?role=host&token=…` and `?role=display`. Displays can join at any time and receive the latest snapshot. Close codes: 4002 host replaced, 4003 no room, 4004 room closed. Types are in `worker/protocol.ts`. A host disconnect starts a 2-minute alarm, after which displays are closed.
