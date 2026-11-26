# Design Review 01 — 星芽学堂 v1.0

**Reviewer:** independent product/architecture · **Inputs:** `docs/DESIGN.md`, early `src/` (config/errors/logger only — no routes, schema or tests yet) · 2026-11-25

## Verdict

**Conditional pass — not acceptance-ready.** Contexts, tenancy and layering are sound; the zero-dependency constraint is honestly held. 7 of 11 are adequately designed (4, 5, 6, 7, 8, 9, 11); 1, 2, 3 are partial; **10 is under-specified**. Blockers are not features: children's-data consent/retention is absent, and demo seeding is a default backdoor. Every fix below stays inside Node 24 + SQLite + vanilla PWA.

## Findings

**P0-1 · No consent, retention or deletion model for children's data.** Photos, voice, agent memory and reports are sensitive minor data (PIPL <14). "Minimization" is asserted without a consent record, purge schedule, export/delete path, or disclosure that child data reaches a third-party LLM.
*Check:* writes blocked without per-child consent; snapshots auto-purge; delete cascades; prompts carry no names; data-flow table in docs.

**P0-2 · Demo seed and known passwords default on.** `SEED_DEMO=true`, demo creds in `config.ts`, credentials printed on the login page — a production admin backdoor and cross-tenant hole.
*Check:* production boot refuses seeding by default and forces a password change; test asserts no demo user exists; login page hides creds outside demo mode.

**P0-3 · Multi-device linkage (req 9/10) is not demoable as designed.** The tablet reaches the Mac at `http://<lan-ip>:8080` — no secure context, so `getUserMedia` and service-worker install fail. There is also no push channel in a zero-dep PWA, no offline lesson cache, and no timezone rule for reminders.
*Check:* HTTPS path (reverse proxy or mkcert) documented, verified on a real iPad; `start.sh` prints the LAN URL and warns; reminder latency bound stated; TZ test crosses midnight.

**P0-4 · User-facing `node:vm` sandbox is RCE-adjacent.** It runs in the same process as SQLite and `APP_SECRET`, gated only by rate limits.
*Check:* off by default, or a child process with permission flags, memory cap, no net/fs; test that `this.constructor.constructor('return process')()` and `require` fail.

**P1-1 · Req 1 "说" and piano are asserted, not designed.** No capture/replay or scoring path, no audio retention rule, no piano input/latency story; level adaptation is unproven.
*Check:* claim scoped to record-and-replay with parent self-assessment; subject × level matrix with real lesson counts and prerequisite chains; 托班 content not reading-screen heavy.

**P1-2 · Moderation covers only post text.** Comments, post edits, display name/bio and images bypass it; keyword checks lose to NFKC, zero-width, homoglyph and pinyin; no report, appeal or repeat-offender handling.
*Check:* edits reset approved → pending; comments run the same pipeline; four bypass classes normalized in tests; report endpoint exists; images blocked or human-queued.

**P1-3 · AI fallback realism and grounding.** A template report can pass as "AI"; metrics may be invented; 3 tool rounds × 45s is slow; no per-household quota; synced courses and posts can prompt-inject write tools.
*Check:* no-key report numbers equal SQL aggregates; agent tools re-assert household; injection fixture cannot write another `hid`'s plan; quota returns 429.

**P1-4 · Tenant and device auth stated, not mechanized.** Aggregates, reports, agent tools and connectors need the same guard as CRUD; admin cross-tenant reads need audit rows; 6-digit codes need lockout and single use.
*Check:* table-driven 403/404 suite over every route; admin read leaves an audit row; code dies after 5 failures and on first success; device expiry/unpair tested.

**P1-5 · "Continuous updates" has no update mechanism.** No scheduler, version diff/rollback, license gate or quarantine; remote lesson blocks are implicitly trusted, so blocks JSON is an XSS vector.
*Check:* sync endpoint + `last_synced_at` + version history + rollback; whitelist block renderer; publish refuses sources lacking license/attribution; fetch goes through the SSRF allowlist.

**P2 · Ops and account lifecycle.** No CI, versioned migrations, backup/restore, graceful shutdown or log rotation; "no npm install" is contradicted by `typescript` in devDeps; rate limits reset on restart; `teacher` has no 园所 boundary; no password reset, email verification or admin 2FA.
*Check:* CI runs `npm test` on Node 24; backup/restore drill documented; typecheck labelled dev-only; teacher scoped to the review queue; audited admin reset.

## Accepted trade-offs

No ASR, no realtime video, no native app, household-only tenancy and experimental `node:sqlite` are fair v1 cuts — state them on a limitations page.
