# v1.5 Final Recheck — Reviewer #19

**Verdict: CONDITIONAL.** Code, async lifecycle and soak are confirmed; release sign-off is gated on one hardware-only visual check.

## Confirmed (async/lifecycle)

- `renderPet` invalidates prior work synchronously: generation token (pet.js:10), prior cleanup, and hook registration **before** the dynamic import (101 vs 108). A late import aborts when generation has moved or `stage.isConnected` is false (109).
- Route change disposes (app.js:334); buy/equip rerenders dispose then re-enter (pet.js:192,196); dispose cancels rAF, disconnects observers, forceContextLoss, disposes renderer/geometry/textures (pet3d.js:291+).
- Soak: E2E asserts hook null and `__petLive===0`, then 4× pet↔home mount/unmount with no orphans; all 30 checks pass. Here that is 2.5D-path evidence.

Residual, nonblocking: navigation during the initial `/api/pet` fetch (pet.js:15) is not generation-checked; a late resolution could repaint `#view` and register one mount after a route change. No WebGL context exists at that point, and the post-import guard still bounds it. Recommend rechecking generation after fetch, or an AbortSignal.

## Remaining boundary (exact)

WebGL is code-reviewed only. Headless Chrome runs with GPU disabled, so no pixels were produced for orbit, pat, feed, play, sleep, clean, or the `WEBGL_lose_context` fallback. Before release, real Chrome, Safari and iPad Safari with GPU on must run that matrix plus context loss; record device/browser versions in QA. A 2.5D-only pass does not close this.

Confirmed from #17/#18: head/cape parenting, touch/pointer affordances, clean sparkles, sleep pose, fallback rebind, canvas ARIA, Esc→工具 focus, leftover copy.

Sign-off: **conditional**. Ship-readiness follows the hardware matrix; no further code changes are required by this review.

— Reviewer #19, 2026-11-27


## Addendum

The fetch-window race noted above is now closed: `renderRoute` increments `__petGeneration` on every navigation, and `renderPet` rechecks it immediately after `/api/pet` resolves; a late response cannot repaint or register a mount. This is a non-WebGL lifecycle fix and does not change the hardware-only 3D boundary.
