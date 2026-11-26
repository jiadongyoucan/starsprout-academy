# Accessibility / VoiceOver audit record

## Automated (Chrome Accessibility Tree, proxy for screen-reader naming)
`npm run a11y` checks every interactive node (button/link/textbox/combobox/checkbox/switch/tab/menuitem) and image on:

- parent home desktop: 23 interactive nodes
- child space: 10 interactive nodes
- parent home tablet rail 1024px: 22 interactive nodes
- parent home 390px: 18 interactive nodes

Result: **0 unnamed interactive nodes, 0 images without alt/name**. Buttons/links have accessible names; icon-only controls use `aria-label`; status is icon + word; focus ring is visible; reduced-motion removes confetti/looping pet motion. This is an accessibility-tree audit, not an audio VoiceOver session.

## Manual VoiceOver checklist (run on the target Mac/iPad before a public release)
1. Enable VoiceOver (Cmd+F5). Navigate by rotor: headings, links, buttons, form controls.
2. Parent home: hear “首页”, child selector, warmth card (one polite announcement), stats, today plan, pet card.
3. Open child space: hear “回家长空间”, sticker count, adventure stops, partner bubble; no parent settings/account controls.
4. Parent gate: activate “家长空间”; hear “家长密码” field; wrong password error is announced; correct returns to parent home.
5. Lesson: all TTS buttons have names; mute control announces pressed state; no audio-only status.
6. Keyboard-only: Tab order follows visual order; focus visible; Esc closes modal and returns focus.
7. 390/320: controls remain ≥44px parent / ≥64px child; no clipped labels at 200% text size.
8. Device: parent settings requires password; mute announces state; completion hand-back is announced.
9. Test with VoiceOver audio on; record device/OS/date in QA.
10. If any step fails, log severity + screen + smallest fix in `docs/qa.html`; do not mark this checklist complete without audio.

**Status:** automated AX tree PASS (2026-11-26). Audio VoiceOver pass is device-specific and remains a manual release step; the script and checklist are committed so it is reproducible.
