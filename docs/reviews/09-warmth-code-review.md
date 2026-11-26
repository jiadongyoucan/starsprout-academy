# Warmth Code Review — 09

**Reviewer #9 · code / UX / security** · 2026-11-26 · re-review after fixes

## Verdict

**PASS**, with P2 follow-ups. Both P1s are closed: the child page no longer navigates into locked parent pages, and `ok` is sent on every parent-home warmth call with the tone hashed over the full pool and humor filtered afterwards (`warmth.ts:41-48`, `home.js:47-49,207`). Only the changed areas were re-checked.

## Fix verification

- **Unlock:** `verifyPasswordForUser` throws 403 `INVALID_PASSWORD` (`auth.ts:115`); `api.js:87` only clears the session on 401, so a wrong password no longer logs the parent out, and the modal stays open for retry (`child.js:154-164`). Guard, unlock and redirect are coherent.
- **Kid links:** hero, pet and choice actions are buttons; both map actions scroll to the stops (`child.js:66,103,112`); pet actions stay inline (`:73-75,113-114`).
- **Freshness:** `ok` on load and refresh (`home.js:47-49,207`); the kind is chosen from the full pool, then humor remaps to warm/selfcare when `ok=false` (`warmth.ts:45-48`), so tone no longer flips with the flag. History is per-child (`:193,206,271`), and the first line is seeded before refresh (`:193`).
- **Home calm:** three stats (`home.js:99-103`), no streak pill, no completion ratio; deltas are muted only (`:258-264`); quick feed removed (pet card only).

## Remaining P2s

1. **Two leftover edge links.** With no plan item, `startHref` still falls back to `#/curriculum?kid=1` (`child.js:41`), which the lock bounces (`app.js:340`); the no-pet branch still links `#/pet` (`child.js:102`). Fix: scroll/disable instead of routing, or allowlist a kid picker.
2. **Duplicate hug button.** `child.js:74` renders `#kidHug` and `#kidHug2`, two identical 「抱抱伙伴」 chips; drop one (`#kidMapJump3` at `:112` is also unused).
3. **Refresh has no server cap.** 2/day is localStorage-only (`home.js:201-213`); on pool exhaustion `warmth.ts:51` returns the full pool, so a refresh can repeat. Server ledger + `changed:false` remain a follow-up.
4. **`ok` is client-asserted** (`warmth.ts:67`), keyed to 2 completions/week rather than 3-day adherence — fine for static copy. Device exit still uses `confirm()` (`device.js:90`); device warmth stays child-context only.

## Gates

As reported: 83/83 tests, 9 suites; `tsc` clean; wrong→correct unlock reaches `#/home`; 320/390 no overflow. Verified here by static inspection only; no code changes made.
