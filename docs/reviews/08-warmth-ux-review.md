# Warmth / Kid-HMI UX Review — 08

**Reviewer #8 · independent UX, warmth, child-development lens** · `warmth-design.md` v1.3 vs. `home.js`, `device.js`, `theme.css` · 2026-11-26

## Verdict

**CONDITIONAL PASS on the design, NOT SHIPPABLE as warmth.** The doc's instincts are good: no leaderboard, no red KPI, no auto-carousel, one deterministic line per day, humor that never targets the child. But warmth stops at the API — `/api/warmth`, `/api/device/warmth`, `lessonWarmth` exist in `src/modules/warmth.ts` with **zero callers under `src/web`** — so §6.1/6.4 cannot be evaluated, and both surfaces the client will judge are still dashboards. Fix F1–F3 before build, F4–F6 before release.

## Findings

**F1 · P0 · Warmth is backend-only.** Nothing renders it; `celebrate` (`ui.js:297`) ignores the `warmth` the reward API already returns, and `#/child` has no view file. **Change:** three placements only — one card on `#/home` under the hero, one speech bubble in the device hero, one line inside the existing celebration. No new pages. e2e: one line per surface, silent fallback on 500.

**F2 · P0 · The parent home is a KPI console that contradicts §3.** Four stat cards, streak pill (`home.js:73`), 计划完成率 (`:100`), rose-red `↓` delta (`:247`, `#b83a63`), plus 「距离下一件小衣服还差一点点」 (`:173`). Loss-aversion streak + dangling reward + red deltas is precisely the anxiety the doc bans. **Change:** collapse stats into 「这周的数据」; streak becomes a 7-dot week strip with no number; delete percentage deltas and red down-arrows; one primary CTA; drop the 喂食/陪玩 duplication that also lives on `#/pet`.

**F3 · P1 · The child device speaks parent, and gives no agency.** "家长给你准备了新的学习任务" (`device.js:164`), "请家长在…推送一份计划" (`:194`), "家长的手机会看到记录" (`:275`, `:319`); 学习准备 is three text imperatives (`:201–204`) where the doc promises 「开始前，先深呼吸」; 设备信息/拍照与隐私 sit in the child's home. Separate HMIs are the right call, but the boundary is drawn by route, not by person. **Change:** child voice ("今天有一件小事在等你"), two real choices ("先做这个，还是先休息三分钟"), adult gate (long-press, not `confirm()`, `:87`) on 设备信息/退出设备, and a `kidMode` flag on the device shell instead of deferring to a full `#/child` (keep that for 1.4).

**F4 · P1 · Refresh can cause tonal whiplash.** `pickWarmth` seeds the *kind* and line together with `fresh` (`warmth.ts:47`), so 换一句 can jump 被理解→幽默; same-line repeats ~1/6; no impression cap. **Change:** freeze kind per day, 7-day no-repeat, ≤2 refreshes, ≤3 impressions/session, never auto-rotate, and a quiet flag.

**F5 · P1 · Humor needs state gating, not just tone rules.** 「孩子静悄悄…也可能在拆家」 is warm on a good day, cruel on a bad one; 「可怕的是……好吧」 is unparseable at four. **Change:** humor only at home/idle, suppressed when 3-day adherence < 50% or a retry state shows; ban 「一定/就会/马上」; drop `child_humor` from the device pool.

**F6 · P2 · Accessibility.** Default `.btn` ≈37px and `.btn.small` ≈29px (`styles.css:60–78`) — under 48; kid-screen copy at 11.5–13.5px muted; no `aria-live` on any warmth element; reduced-motion covers CSS only; an all-caps English eyebrow over Chinese copy. **Change:** 60px floor on kid actions, ≥16px/1.7 left-aligned kid copy, `aria-live="polite"` on the line only, JS confetti gated, 320px + 200%-zoom pass.

## Acceptance checklist

- [ ] One warmth line per parent/kid surface; ≤3 per session; 换一句 changes the line, never the tone kind; 7-day no-repeat.
- [ ] No red/rose numeric delta and no streak count on the parent home.
- [ ] Child screen: no 设备信息/隐私/退出设备 without an adult gate; every kid action ≥60px.
- [ ] Retry/low-score path: non-evaluative, non-humorous, no score shown to the child.
- [ ] `prefers-reduced-motion` removes confetti *and* breathing pet; warmth announced once, not per card.
- [ ] Copy read aloud to a 4-year-old; every parent line passes "would I say this to a tired parent's face?"
