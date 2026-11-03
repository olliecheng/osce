# OSCE history station

- Layout: `worker/` (Worker + `Room` Durable Object + shared `protocol.ts`), `web/src/` (plain TS, no framework), `tests/worker` (vitest), `tests/e2e` (Playwright).
- Privacy rule: While a station is running, `DisplaySnapshot` must never contain the question, answer or sections. They travel only in `review`, which is non-null solely when `phase === "done"` and not timer-only (enforced by `sanitizeSnapshot`). Build it only via `web/src/snapshot.ts`; the server re-sanitizes with `sanitizeSnapshot`.
- `web/src/bell.ts` is ported verbatim from the original page (Safari audio workarounds). Don't "improve" it.
- Don't run `wrangler deploy` without the user's explicit permission.
- Run `npm run typecheck && npm run lint && npm test` before committing.
