# Post-fix Verification 03a — 星芽学堂 v1.0

**Reviewer:** Reviewer #4 · **Scope:** re-check of P1-1 and P2s from `03-acceptance-review.md` · 2026-11-25

## Verdict

**PASS.** The conditional item is closed and the final acceptance verdict is now PASS.

## Re-verification

| Item | Result | Evidence |
|---|---|---|
| P1-1 demo dual switch | **Fixed** | `src/infra/seed.ts:352-362` exports `shouldSeedDemo()` = `SEED_DEMO && DEMO_MODE`; `seedDatabase` uses it. `src/modules/auth.ts:193-196` `adjustDemoMode()` now also requires `DEMO_MODE`. New `test/seed.test.ts` boots production + `SEED_DEMO=true` + `DEMO_MODE=false` and asserts 0 users; dual-on asserts demo users. |
| Community projection | **Fixed** | `src/modules/community.ts:126-129` deletes `household_id`, `moderation_score`, and non-staff `moderation_reasons` from the detail response. |
| Docker review links | **Fixed** | `.dockerignore` no longer excludes `docs/reviews`; `COPY docs ./docs` now ships review files. |
| Docker data permissions | **Fixed** | `Dockerfile` installs `su-exec`; `docker-entrypoint.sh` creates `/data/snapshots`, `chown -R node:node /data`, then `exec su-exec node "$@"`. |
| Report test coverage | **Fixed** | `test/platform.test.ts:148` exercises `daily` and `monthly` in addition to weekly. |
| Pairing counter | **Addressed** | Dead per-code attempt increment removed; the route remains rate-limited (12 / 10 min). |
| Gates | **Green** | `NODE_ENV=test npm test` → **68/68**, 7 suites, exit 0; `npx tsc --noEmit` → exit 0. Docs now state 68 consistently (README, QA, index). |

## Accepted residual notes

- Docker build/run was **not executed** (Docker unavailable here); entrypoint/Dockerfile inspected only.
- Requirement 2 updates remain release-bound: `syncPublicCourses` re-imports built-in packs; there is no live OER/StoryWeaver fetch.
- Device tokens are 365 days; browser-only linkage (no OS push when the device page is closed) and HTTPS-only camera remain declared boundaries.
- Pairing still uses a plaintext short code in the DB until pairing; rate limiting is the control.

No new failures or documentation/code contradictions found. The product is accepted for single-household / small-kindergarten deployment.
