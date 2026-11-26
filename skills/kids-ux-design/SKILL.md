---
name: kids-ux-design
description: Produce and review child-surface design tokens/components for ages 3-6. Local adaptation derived from common-family-ux child-surface + rubric; no public skill with this exact name was found.
metadata:
  adapted_from: HoangNguyen0403/agent-skills-standard/common-family-ux
  age_band: 3-6
---

# Kids UX Design (local adaptation)

> 公开 registry 未找到可核验的 `kids-ux-design` 同名 skill；本文件不是第三方包，而是基于 `common-family-ux` 的 `references/child-surface.md` 与 `references/rubric.md` 为星芽落地的儿童端 token/组件规范。来源与许可证见 `skills/README.md`。

## Tokens
- Body 16px / 1.7；label、caption ≥14px；中文圆体/系统字体优先。
- Child target **64×64px**，间隔 ≥16px；parent target 48px。
- Primary: 珊瑚 `#ff8a5b`；Sky `#a9ddff`；Grass `#b8e6a8`；Ink `#26384b`；one accent per screen.
- Radius 18–30px；2.5–3px hand-drawn border；offset shadow (0 4px 0) instead of blur-only.
- Motion: one entrance + one celebration; respect reduced-motion; no perpetual decorative motion.
- Sound optional, visible mute; never sound-only signal.

## Components
- Big action button (≥64px, icon + verb), stop card (number/emoji/title/subject/minutes), sticker medal (unit/plan only), partner speech bubble (one line), parent gate (password; never a simple tap).
- No coins/points/streaks/leaderboards/timers on child surface. Sticker count is a collection, not a score.
- One task per screen; one obvious next step; back/parent exit always visible; calm hand-back.

## Review checklist
1. Parent/child separation and parent gate for settings/purchases/deletion/external links.
2. 64px child targets, 16px body, 14px labels, AA contrast, status icon+word.
3. No urgency/guilt/dark patterns; no autoplay chain; no external links/chat.
4. Tablet landscape/two-pane considered; sound optional.
5. Sample family/age/date consistent; one illustration style.
