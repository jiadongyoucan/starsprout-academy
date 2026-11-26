# Review 25 — v1.6 Final Acceptance

**Verdict: PASS.** Both #24 blockers are closed in current source; the only residual is hardware verification.

## Blockers confirmed closed

1. **Migration order.** `src/infra/migrations.ts:353-357` now places v7 after v6; the runner skips `version <= current`, so a fresh DB ends at `user_version=7`. `test/migrations.test.ts:12-22` builds a fresh DB, asserts 7, closes it, reopens the same file and asserts 7 again with no duplicate `child_id` error — this test fails under the old 5→7→6 order, so the regression is genuinely pinned. Suite reported green at 93 tests / 11 describes.
2. **SSE ticket.** `src/routes/device.ts:37` mints a 120s `device-stream` ticket bound to `did`; `src/app.ts:67-68` rejects `device-stream` on every path except `/api/device/events` and rejects the long-lived `device` type on the events path. The client (`src/web/js/device.js:524-538`) fetches a ticket per connection and re-fetches it after the 5s reconnect. A query token is accepted only for the events path (`src/core/http.ts:226-227`).

Also verified from #23: setup token required for proxied, production and non-loopback callers, with a length-guarded `timingSafeEqual` (`src/routes/core.ts:67-77`); compose/env/docs carry `SETUP_TOKEN` and `PUBLIC_URL`; v7 child scoping enforced across me/inbox/plan/lessons/start/end/progress/snapshot with siblings returning 404; child avatars omitted from device payloads; avatar byte/magic/NFC/grapheme/moderation checks and escaped previews in place.

**Non-blocking note:** no automated test exercises the SSE type split or the setup-token 403/200 path. Code is correct; add regression tests in the v1.7 pass.

## Residual (hardware only)

Real Mac and 华为 device matrix — pairing QR, sleep/wake SSE reconnect, camera capture over HTTPS, PWA install/standalone behavior. The v1.5 WebGL pet boundary is unchanged.

**Sign-off: PASS for v1.6.** Remaining risk is hardware/network behavior that cannot be validated in software.

— Reviewer #25, 2026-11-27
