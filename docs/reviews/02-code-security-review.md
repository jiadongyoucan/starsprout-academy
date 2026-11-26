# Code & Security Review 02 — 星芽学堂 v1.0

**Reviewer:** independent senior engineer / security · **Scope:** `src/`, tests, deploy · 2026-11-25

## Verdict

**Fail — not acceptance-ready.** Tenancy and XSS are better than the docs claim, but two P0s and five P1s block sign-off: the shipped deployment is a demo-credential admin backdoor, and the user-facing `vm` sandbox escapes to server-process RCE. Tests are green but exercise neither path.

**Verified:** `NODE_ENV=test npm test` → 59/59, 7 suites; `npx tsc --noEmit` → exit 0. Probes reproduced P0-1, P0-2, P1-1 and the `DEMO_MODE=false` failure.

## P0

**P0-1 · Demo seeding + published credentials in the default production image = unauthenticated admin takeover.**
`Dockerfile:4-9` and `docker-compose.yml:9-16` hard-code `NODE_ENV=production`, `SEED_DEMO=true`, `DEMO_MODE=true`; `src/infra/seed.ts:98-115` writes `admin@demo.com/Admin123!`, teacher and parent into the live DB; unauthenticated `/api/meta` publishes all three (`src/routes/core.ts:30-40`); credentials live in code (`src/modules/auth.ts:63-67`). Probe: `demoMode:true`, admin login ok, `/api/admin/users` returns all 4 accounts, `/api/children` returns another household's child. `mustChangePassword` is never enforced, so the flag is cosmetic.
The documented mitigation is false: `adjustDemoMode` (`auth.ts:150-155`) only hides the list; with `DEMO_MODE=false` the probe still logged in as `teacher@demo.com`, and seeded accounts persist. `README.md:254`/`docker-compose.yml:14` imply otherwise.

**P0-2 · `node:vm` "sandbox" escapes to full RCE as the app process — reachable by any registered parent and by the LLM.**
`src/modules/sandbox-worker.ts:21-28` injects host-realm intrinsics into the context, so `Math.constructor.constructor('return process')()` returns the real process. Probe: read `data/secret.key` (HMAC key → forged admin JWTs; DB/snapshots and network equally reachable). Exposure: enabled whenever `NODE_ENV !== 'production'` (`src/modules/sandbox.ts:11-15`), and `scripts/start.sh:19-24` copies `.env.example` (no `NODE_ENV`) — the documented one-command LAN start is an RCE endpoint for anyone who self-registers (`/api/auth/register` is public). The LLM tool `sandbox_run` (`src/modules/agent.ts:152-158, 247-253`) runs model-chosen code, so prompt injection in lesson text or a public expert prompt (`agent.ts:66-70`) escalates identically. Tests give false assurance: `test/agent.test.ts:90-104` only checks `typeof process` inside the context, never the constructor escape; `docs/DESIGN.md:75` repeats the wrong claim.

## P1

**P1-1 · Child deletion is impossible — the data-deletion right is broken.**
`src/core/http.ts:184-188` parses bodies only for POST/PATCH/PUT, yet `DELETE /api/children/:id` (`src/routes/core.ts:69`) requires `body.confirm === true` (`src/modules/privacy.ts:75`) and the UI sends it (`src/web/js/views/account.js:126`). Probe: 422 `删除孩子档案需要 confirm: true`; child remains. Untested.

**P1-2 · AI/analytics consent inconsistent and partly decorative.**
Agent chat calls the provider with no consent gate (`src/modules/agent.ts:471-480`) while `buildSystemPrompt` (`agent.ts:50-80`) sends child names and classes — contradicting "AI 发送前只提供去标识摘要" (`README.md:254`). `plans.ts:199` throws 403 when `ai_processing` is withdrawn instead of degrading to the local engine; `analytics.ts:232` gates reports correctly; `analytics` consent is never read anywhere. New children default to AI+analytics consent server-side (`privacy.ts:52-54`), so pre-checked boxes yield opt-out consent for minors.

**P1-3 · Photo retention/erasure gaps.**
`routes/core.ts:76` calls `purgeExpiredSnapshots` (`analytics.ts:316-321`), which deletes rows but never unlinks files; the daily job (`server.ts:11-21`) then finds nothing, so JPEGs stay on disk forever. `days` is an unvalidated `Number` — `-9999` wipes every row. Account disable (`privacy.ts:141-150`) keeps children/plans/snapshots and no admin household-erasure endpoint exists, so a sole guardian's deletion request cannot be honoured.

**P1-4 · Plan reminder/scheduling correctness.**
Reminder text hard-codes `${15} 分钟` (`plans.ts:321`); reminders cover only 7 days from activation/correction (`plans.ts:301-307`), so later days never remind. `dueReminders` marks `sent` on read (`plans.ts:418-428`), so a lost response or second device loses the notice. `today()` is UTC (`core/security.ts:13-15`) while `reminderAt` is `+08:00` (`plans.ts:297-299`): before 08:00 CST "today" is yesterday and reminders fire immediately. `correctPlan` claims the nearest "blank day" but only caps 2/day (`occupied` is dead code), extends `end_date` up to 21 days, and mutates `archived` plans. "提醒无需常驻页面" (`account.js:51`) is false — a 60 s in-tab poll (`app.js:303-307`).

**P1-5 · Password reset rotation is advisory only.** `must_change_password` is returned to the client (`auth.ts:16, 24`) but never checked in `app.ts:42-59` or any route; a temporary password works indefinitely. UI only hints "建议修改" (`account.js:39`).

## P2

- Pairing lockout is dead (`device.ts:76-85`: exact-code lookup, wrong guesses never increment); plaintext codes; 365-day device tokens; SSE query tokens (`http.ts:219`).
- In-memory rate limits (`security.ts:144-162`) keyed on socket IP with no `X-Forwarded-For` (`http.ts:141`); disabled entirely in tests (`http.ts:179`).
- Teacher self-review guarded only by `author_id` (`community.ts:214`) — a second parent account bypasses it. `getPost` exposes `household_id`/`moderation_score` to all readers (`community.ts:108-133`); `listConnectors` masks only the last 4 chars of other households' public secrets (`registry.ts:159`).
- Broken doc links: `/docs/` maps to missing `docs/index.html` (`http.ts:246-247`); `README.md:281-289` and `/api/meta` link `product.html`, `architecture.html`, `qa.html` that do not exist.
- Test gaps: nothing boots production/demo mode; no consent, retention-purge or child-delete test; sandbox test asserts the wrong invariant.

## Must fix before acceptance

1. Remove demo seeding/credentials from the production image; refuse seeding under `NODE_ENV=production`; make `DEMO_MODE=false` disable logins; expose no `/api/meta` accounts in production.
2. Replace the sandbox with a permission-restricted child process (no net/fs) or remove endpoint + tool; add an escape regression test.
3. Parse DELETE bodies (or accept bodyless confirm) and test child deletion end-to-end.
4. Enforce `ai_processing` on agent chat, degrade plans instead of 403, require explicit consent on child creation, honour `analytics`.
5. Unlink files on admin purge, validate `days`, add household erasure.
6. Fix reminder duration/horizon and timezone handling; enforce `must_change_password` server-side.

## What holds up

Household scoping is real: `assertHousehold/ChildAccess/PlanAccess` gate every child, plan, snapshot, report, session and memory path. Snapshot bytes are auth-read only (`device.ts:302-311`). Connector SSRF is solid (allowlist + DNS private-IP check + `redirect:'manual'` + timeout). Secrets are AES-GCM sealed and never echoed. CSP blocks inline script; the frontend uses `esc()`/`mdLite` consistently — no user-data XSS sink found. Edit→`pending` re-review, author≠reviewer and rejection-reason rules are correct.
