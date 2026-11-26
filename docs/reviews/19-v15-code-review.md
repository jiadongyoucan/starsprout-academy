# v1.5 Code Review — Reviewer #17 (code/UX/game design)

**Verdict: CONDITIONAL.** Rename and nav simplification hold up in source; the 3D pet is real Three.js, but its lifetime and touch interaction have real bugs the green gates cannot see (WebGL disabled in headless Chrome).

## Blockers
1. **3D view never disposed.** [pet.js](../../src/web/js/views/pet.js) re-renders the whole page on buy/equip (`renderPet` again), and [app.js](../../src/web/js/app.js) route changes never call `view3d.dispose()`. Each pass creates a renderer/canvas, leaves the old rAF loop and WebGL context alive. After ~8–16 contexts the probe returns null and the page silently degrades to 2.5D mid-session. `visible` from the IntersectionObserver is dead code — rAF renders forever off-screen.
2. **Touch cannot orbit; touch drags pat.** In [pet3d.js](../../src/web/js/pet3d.js), `pointermove` returns early for `pointerType === 'touch'`, so `moved` stays 0 and `pointerup` always fires `playAction('pet')` + POST `/api/pet/interact`. A tablet scroll becomes an accidental interaction, and the tooltip "拖拽旋转视角" is false on touch.
3. **Cape floats.** `star-cape` is created under `petGroup` then reparented into `accessoryGroup` (child of `head`, y=1.75), so it sits ~1.75 units high; the head sphere is also parented to `petGroup`, not `head`, so the face tilts off the head during pat.

## Top 5 fixes
1. Return a dispose handle from the pet page's `renderRoute` contract; call it on route change and before re-render; dispose sprite textures, `forceContextLoss()`.
2. Support touch orbit (allow horizontal drag; suppress pat when `moved > 6`), and gate pat on `pointerup` with movement/time check.
3. Fix cape parent/position and put the head sphere inside `head`.
4. `clean` spawns 'Z' sleep sprites and has no face; `brow` is computed but never applied; sleepy eyes revert at 2.4s while the pose holds to 3.4s. Give each action a real face/effect (bubbles, not Zzz).
5. Rebind the fallback `#pet2dPet` tap after `pet3d-lost` (listener is bound once, so post-loss taps are dead).

## Creation & nav
Nav is 8 items and 创作中心 sits in 工作台; 专家与技能 is reachable only from the chat header — thin but workable. The context drawer has three duplicate entries (工具 button, four mobile icons, three tabs); `contextToggle` only opens, never closes. Copy still leaks the old concept: "创作助手/对话式创作/新建创作助手会话", awkward `KIND_LABEL`（陪学创作/专家创作）, and two competing one-liners (PAGES subtitle vs empty-state list). "智能体" itself is absent from src/web — good.

## Acceptance gaps
- 3D path unverified: no WebGL screenshot, perf/GPU budget, or post-loss recovery evidence.
- No test for repeated buy/equip leaks, touch orbit, or dispose.
- Canvas is `role="img"` yet focusable/hotkeyed; drawer lacks focus management/`aria-hidden`.
- Home left dead helpers (`statCard`, `deltaText`) and an empty `<p>`.

Acceptance requires: real WebGL visual proof, a dispose/soak test, and touch orbit fixed.
