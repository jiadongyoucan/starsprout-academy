# UX / Pet & Reward Review — 05

**Reviewer #5 · product/UX, child-development lens** · `companion-design.md` v1.2 vs. current UI · 2026-11-26

## Verdict

**CONDITIONAL PASS for design, NOT build-ready.** Direction is right: first-completion-only rewards, idempotency, no leaderboard, no pet death. But the care economy ships guilt and pay-to-care (F1), reward math trusts the client (F2), and nothing is built — migrations stop at v3, no `pets`/`wallets` or `/api/pet`. Fix F1–F2 before build, F3–F7 before release.

## Findings

**P0-1 · The care economy is a guilt engine.** Hunger −2/h hits 0 in ~12h, so a weekend away greets a starving pet — "no death" doesn't remove guilt, the sad face *is* the punishment. Worse, §4 sells the food §3 consumes: studying funds survival — coercion for 2–6. **Change:** pause decay while closed, floor it at "a little hungry", resolve absence as `missed you`, ban 「你都不来看我」-class lines. Basic food free and unlimited; coins buy cosmetics only (hats, toys, decor); 「金币永不可购买」 goes into `DESIGN.md` non-goals.

**P0-2 · Reward integrity trusts the client.** `learn.js:106` derives `score` from in-page counters, defaulting to 95 with no quiz; coins = 8 + score/10, so dev-tools inflates payout. Plan completion (+100) is farmable with a one-item plan. **Change:** server derives score from submitted answers plus a completion token; flat coins per completion, stars differentiate; plans need ≥3 items over ≥3 days, once per period, paid in ceremony not coins; `shop/buy` needs an idempotency key and non-negative balance guard.

**P1-3 · Celebration is evaluative, not informational.** Leading a 4-year-old with 「本次得分 95 分」 teaches that the number is the point; predictable rewards erode intrinsic motivation. **Change:** the child layer leads with behavior ("你自己把三块拼图都转对了"); stars are the only child-facing metric, score goes to the parent view; move the parent prompt (`learn.js:136`) off the child's screen.

**P1-4 · Do not add a sixth bottom-nav slot.** `BOTTOM` (`app.js:39`) is full at five; the topbar already carries child switcher + bell + avatar at ≤620px. **Change:** put the pet in the hero — `.hero-emoji` (`styles.css:288`, hidden ≤860px) is dead space; replace it with the live pet, plus *one* combined mood/coin chip in the topbar. Opens from that chip and from 学习 in the sidebar; no 6-column grid, no 更多 overflow.

**P1-5 · Ceremony frequency and motion are unbounded.** Three activities/day = three takeovers, each blocking the next lesson. **Change:** tier it — lesson: inline strip (pet reaction + coins, ~3s, no backdrop); unit: one modal; plan: page with printable certificate. One full-screen ceremony per session, any tap skips, ≤2.5s, confetti off by default, JS animation gated on `matchMedia('(prefers-reduced-motion)')` — `styles.css:709` covers only CSS.

**P1-6 · Accessibility debt the pet layer multiplies.** `openModal` (`ui.js:45`) sets `aria-modal` but never moves, traps or restores focus — every new celebration inherits a broken dialog. Mood must not be color-only; gold `--sun` on cream is ~2.8:1; 2–6 needs ≥60px targets. **Change:** focus-in/trap/restore in `openModal`; per-mood `aria-label` and a text state block; 60px floor on pet controls, coin text at `--ink-2`.

**P1-7 · Parent trust needs a visible face.** Pet name is unmoderated free text, pet data is absent from the delete/export path (§6 covers isolation only), and spending happens in the parent's session. **Change:** pet name through the moderation pipeline; child delete ⇒ pet/wallet/inventory; a 伙伴设置 panel (quiet hours, sound, disable, ledger); hold-to-confirm on spend; no loot boxes or 限时 pressure.

## Acceptance additions

- 48h absence ⇒ warm reunion, zero decay while closed, never `sad`/0.
- Replay ×5, spoofed answers, one-item plan ⇒ wallet unchanged; double-buy ⇒ single debit.
- Child layer shows no score; back/refresh does not re-award; 320px and 1024×600 landscape: no scroll, CTA above the fold.
- Keyboard-only: every tier traps and restores focus; reduced-motion + muted ⇒ no confetti, bounce or auto-sound.
- Mood/coin changes announced once; delete child ⇒ pet rows gone, export includes them.
- Companion off ⇒ kid flow identical, no nags, no locked UI.
