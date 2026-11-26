# Redesign v1.5 — Plan Review, Reviewer #16 (Product / UX / Game Design)

**Verdict: REVISE — not approvable for build.** Direction is right, but this is a wish-list: it over-scopes 3D, miscounts its own IA, orphans 专家与技能, and sets outcomes no check can fail.

Evidence: 10 nav items (`app.js:25`); 10 links to the pet page (five chrome, five home); 5 action buttons but 4 animation classes; `clean` has none (`pet.js:57`, `theme.css:199`); 6 backend moods vs 5 planned, `sad` dropped; every interaction re-renders the page and rebuilds the figure (`pet.js:149`), so any 3D clip dies at network latency; `three.module.js` = 1.27MB unminified, served with no gzip/ETag at `max-age=300` (`http.ts:260`).

## Six prioritized changes

1. **IA arithmetic and orphans.** 3+3+2 = 8, not 7. Give 专家与技能 a home (tab inside 创作中心, not nav). Name the exact 5 bottom items — 伙伴 must survive mobile (首页/学习/伙伴/创作/我的). Add `#/agent → #/creation` redirect and a copy inventory: `index.html:7` meta, `PAGES.agent`, manifest, e2e, `package.json`.
2. **First-screen budget in numbers.** 1440×900: 1 primary + 1 ghost CTA, ≤1 hint above fold, stat strip below fold, ≤4 side cards (fold 小约定 into 今日安排). 390×844: hero ≤60vh, pet spotlight is the visual anchor, not a third CTA. Delete 和智能体聊聊.
3. **Cut 3D scope ~60%.** One species, one rig; other two stay 2D. No 3D room/decor, no particle systems (one sprite burst), no drag-orbit (rotate = 2 buttons; orbit fights scroll). Probe WebGL, then `import()` on `#/pet` only; add gzip + immutable `/js/vendor` cache; ≤350KB gzip, dpr≤2, pause on `hidden`/offscreen, handle `webglcontextlost`. Otherwise pet-page LCP regresses for a module some users never get.
4. **One stage contract for both renderers.** Canvas persists outside the DOM re-render; animate optimistically, then sync. Single state machine `idle→action→idle(≤200ms)`, crossfade ≤250ms, 6 moods, 5 actions, click-during-play ignored, `stageId` stable. Fix `moodLine` randomness (`assets.js:92`): the bubble changes every re-render.
5. **Delete copy, don't hide it.** Tooltips are unusable at 3–6 and on touch. `?` = button + popover (focus, Esc, `aria-expanded`), max 1 per page. Keep visible: 金币只换虚拟装扮、无真实物流、伙伴不会离开、照片需授权. Ban the "9 个工具" tooltip: jargon belongs in admin.
6. **Boundary and a11y in the same pass.** 创作中心 is parent-only (kid-mode route guard, absent from kid bottom nav). 儿童空间 entry from home/pet only, with ≥64px 家长返回 + lock. Canvas `role="img"` + name, `aria-live` reaction, focus retained after action, reduced-motion static pose. New 14px ink fails contrast: `.hint` #a08e73 ≈3.0:1 on paper.

## Acceptance additions

- `grep 智能体 src/web` = 0 on parent surfaces; `#/agent` redirects; `<title>`/meta updated.
- Nav = 8 fixed labels; home pet links ≤2; every route ≤2 clicks from home.
- Hero: exactly 1 primary button at 1440/390; no overflow at 320.
- `three.module.js` requested **only** after `#/pet`; no WebGL ⇒ `[data-pet-stage="2d"]` with the same 5 actions and text.
- Clip matrix: 6 moods × 5 actions ⇒ expected clip; return-to-idle ≤1.2s; one canvas, `stageId` stable across feeds.
- Captions ≥4.5:1; reduced-motion ⇒ no rAF motion; context-loss recovers.
- Kid-locked session cannot open `#/creation`; 家长返回 ≥64px and clears the lock.
