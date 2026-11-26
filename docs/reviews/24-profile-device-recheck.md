# Review 24 — v1.6 Profile / Multi-Device Recheck

**Verdict: CONDITIONAL — sign-off withheld.** Most #23 blockers are closed, but the recheck found one restart-blocking regression and one incomplete control; hardware checks remain.

## Confirmed

- **Setup:** `/api/setup` requires `SETUP_TOKEN` for non-loopback callers, any proxy header, or `NODE_ENV=production`; constant-time compare with length guard (`src/routes/core.ts:67-77`); UI sends `x-setup-token`; `start.sh --real` generates/prints it; `.env.example`, compose and docs carry it.
- **Docker:** compose passes `SETUP_TOKEN`; docs mandate explicit `PUBLIC_URL` (no container IP) and `X-Forwarded-Proto`; no bridge auto-discovery.
- **Device child scope:** v7 `devices.child_id`; pairing stores the selected child; auth carries `childId`; `/api/device/me` ignores `?childId` and returns one child; inbox, push, plan, photo, start, snapshot and progress reject siblings; pair response is child-only; avatars omitted.
- **Avatars/names:** byte, magic and size checks; NFC/grapheme limits; moderation on user and child names; escaped child avatar; export/erase includes the child row; no camera-consent gate (intended).

## Still blocking

1. **Fresh install cannot restart.** `version: 7` sits before `version: 6` (`src/infra/migrations.ts:329-336`). A fresh DB runs 5→7→6 and ends at `user_version=6`; the next boot re-runs v7, fails with `duplicate column name: child_id`, and Docker crash-loops. The suite never reopens an existing DB, so 92/92 misses it. Reorder v7 after v6 and add a restart test.
2. **SSE ticket is client-only.** `src/app.ts:61-67` still accepts `typ==='device'` on `/api/device/events`, so the 180-day token stays valid in the query string (stale/PWA clients, or any caller). Require `device-stream` on events and reject that type on other device routes.

## Residual (hardware only)

Real Mac / 华为 / HTTPS camera / PWA / SSE-sleep matrix; the v1.5 WebGL boundary is unchanged.

Sign-off withheld pending the two fixes and the hardware matrix.

— Reviewer #22, 2026-11-27
