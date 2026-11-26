# Acceptance Review 03 — 星芽学堂 v1.0

**Reviewer:** Reviewer #4 (final acceptance) · **Scope:** 11 client requirements, prior P0/P1 fixes, docs, deploy · 2026-11-25

## Verdict

**CONDITIONAL PASS (superseded by `03a-post-fix-verification.md` — P1-1 closed; final verdict PASS).** The product meets all 11 requirements at a credible v1 scope, and the prior P0s are materially fixed: demo seeding and the sandbox are off by default, first-run setup exists, temporary passwords are server-enforced, child deletion and consent gates work, photo files are purged, reminders have a rolling refill and a non-mutating read, and 67/67 tests plus strict `tsc` pass. One security hardening item is still open: demo seeding is gated only by `SEED_DEMO`, not by the claimed dual switch. Default production deployment is safe, but the fix-log claim is false and an operator who sets only `SEED_DEMO=true` in production gets a published-credential admin. Fix that gate (or refuse seeding under `NODE_ENV=production`) before public deployment.

## Gates run

| Gate | Result |
|---|---|
| `NODE_ENV=test npm test` | **67/67 pass**, 7 suites, exit 0 |
| `npx tsc --noEmit` | **exit 0** |
| `./scripts/smoke.sh` (server already running) | **pass** — health → demo login → curriculum → plan → pairing → inbox |
| Docs self-containment | product/architecture/qa/index: **0 external URLs, 0 `{{...}}` placeholders**; images embedded; internal links 200 over HTTP |
| Deploy inspection | `start.sh`, Dockerfile, compose reviewed; Docker not executed (not installed) |

The running server was in explicit `--demo` mode (demo accounts and sandbox enabled); this was not a default configuration.

## Requirement-by-requirement

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | 4 levels × 5 subjects, level-adapted, interactive 听说读写 | **Met** | 180 core + 12 pack = 192 published lessons; distinct syllabi per level (`src/infra/curriculum-data.ts`, `lesson-blocks.ts`); listen/speak/trace/piano/rhythm/match/quiz blocks; `test/curriculum.test.ts` |
| 2 | Quality public courses, continuous updates, systematic | **Met, update path limited** | 4 sources / 4 packs with license, attribution, version, checksum; import → quarantine → admin approve; `syncPublicCourses` re-imports built-in packs (no live source fetch) — content updates ship with a release |
| 3 | Plan module, AI assist, correction, reminders | **Met** | Draft → activate; local planner without model; AI rationale only when consent+key; 逾期 shift/skip with `plan_adjustments`; real-minute reminders, timezone fixed, POST dispatch + 6h refill (`src/modules/plans.ts`) |
| 4 | Full agent: sessions/memory/sandbox/models/workspace/chat | **Met** | Sessions, messages, memory, workspace versions, AES-GCM model secrets, 8 tools; sandbox subprocess + permissions, **default off** (`src/modules/sandbox.ts`, `sandbox-runner.ts`); `test/agent.test.ts` |
| 5 | Dashboard + daily/weekly/monthly AI reports | **Met** | Real aggregates, consent-gated dashboard and reports, local/LLM engine, persisted by period; UI exposes 日报/周报/月报 (`src/modules/analytics.ts`, `account.js`); only weekly is automated |
| 6 | Experts, skills, connectors; publish/consume | **Met** | Public publish requires teacher + review; install/uninstall by other households; built-in and HTTP connectors; SSRF allowlist; call audit (`src/modules/registry.ts`) |
| 7 | Community with review/approval, healthy/on-topic | **Met** | Approved-only feed; no self-review; reject reason required; edit resets to pending; comments moderated; reports/hide (`src/modules/community.ts`, `moderation.ts`); `test/community.test.ts` |
| 8 | Login/registration, authn/authz, isolation | **Met** | scrypt + JWT + revocable sessions; first-run `/api/setup`; forced password change at `http.ts:186-188`; four principals; household scoping throughout; `test/auth.test.ts` |
| 9 | Phone ↔ Mac/iPad plan push and learning | **Met, browser-bound** | 6-digit one-time code, device token, push/inbox, SSE + polling, device lesson playback, progress return (`src/modules/device.ts`, `src/web/js/device.js`); no OS-level push when closed |
| 10 | Camera snapshots for parent supervision | **Met, HTTPS-bound** | Parent request requires `camera` consent; device explicit consent at upload; authenticated household-only image read; single/batch/retention purge with file unlink; `test/device.test.ts` |
| 11 | TDD/DDD/clean code, easy deploy, HTML docs | **Met** | 67 tests / 7 suites, strict typecheck, bounded contexts and routes separated, zero runtime deps, `start.sh` + Docker + backup, self-contained docs |

## Remaining issues

**P1-1 · Demo seeding is not double-gated as documented.** `src/infra/seed.ts:352-356` seeds whenever `SEED_DEMO=true`; `DEMO_MODE` is not required. Probe with `NODE_ENV=production SEED_DEMO=true DEMO_MODE=false`: `/api/meta` hides accounts, but `admin@demo.com / Admin123!` logs in; after `change-password` the session reaches `/api/admin/users` (4 users). `docs/reviews/04-fix-log.md:9-10` claims seeding requires both switches — false. Default compose/.env are safe. **Condition:** require `DEMO_MODE` too, or refuse seeding in production.

**P2 (not blocking)**
- `src/modules/community.ts:107` (`getPost ... SELECT p.*`) returns `household_id` and `moderation_score` to any reader of an approved post; restrict the projection.
- `.dockerignore` excludes `docs/reviews`, while `docs/index.html` and `docs/qa.html` link to those files; review links 404 inside the shipped image.
- `src/modules/auth.ts:194-199`: in non-production, demo credentials are displayed whenever demo data exists, even with `DEMO_MODE=false`; document or gate on `demoMode` only.
- Pairing attempt counter is ineffective (exact-code lookup before increment, `src/modules/device.ts:76-85`); route rate limit (12/10 min) is the practical control.
- Test gaps: no production/demo boot assertion, only weekly report period covered; Docker deploy path not executed here.
- Requirement 2's sync is release-bound (above); no live OER/StoryWeaver fetch.

## Accepted with notes

- Sandbox is defense-in-depth, not a VM boundary; default off and explicitly labeled.
- Camera/PWA need HTTPS or localhost; album fallback works; voice stays in-browser with no pronunciation scoring.
- Single-instance SQLite, in-memory rate limits; no native app, OS push, payment, or 园所组织树 — declared roadmap.
- Demo mode intentionally prints credentials; local/demo only, production checklist says keep it off.
- 192 lessons comprise 180 syllabus-generated core lessons and 12 curated pack lessons.

**Sign-off:** accepted for single-household / small-kindergarten deployment once P1-1 is gated; no default-path blocker found.
