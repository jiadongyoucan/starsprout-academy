# Family UX Review — Audit 15, Reviewer #14

**Verdict:** PASS, not "minor findings only". Method, surfaces, and most evidence hold; **no Blocker in web child mode** (`#/child` password gate is real). But the audit never scored three `child-surface.md` rules, and one claim is wrong on the tablet device.

## Scores

| Axis | Audit | Mine | Reason |
|---|---|---|---|
| 1 Audience fit | 3/3 | **2/3** | Web gate good, but `/device` exit is `pointerdown` 1800 ms + browser `confirm` (`device.js:95`) — no adult check, and a hidden long-press, which `child-surface.md` bans. A 5-year-old can leave. |
| 2 Accessibility | 2/3 | **2/3** | Targets/body/contrast fine. Captions are worse than stated: `device-footer-note` 11.5px, device rows 12.5–13.5px — below the 14px rule, on the child device. |
| 3 Safety & trust | 3/3 | **3/3** | AI labels, no dosing, legal boundary marked. Agree. |
| 4 Comfort | 3/3 | **3/3** | Coins gone, stickers only, no streak/timer. Verified. Agree. |
| 5 Consistency | 2/3 | **2/3** | Device home is two-pane ≥861px, so "no rail" is milder than claimed; but "tablet accepted" is a product decision, not a rubric pass. |
| 6 Human feel | 2/3 | **2/3** | Family coherent, one style. `MY LITTLE COLLECTION` (`child.js:94`) is an English headline on the child surface — worse than "some screens". |

## Three smallest fixes

1. **Password-gate the device exit.** Replace hold-2s + `confirm` with the existing parent `verify-password`/PIN flow. Smallest change that makes "parent gate before settings" true and removes the banned hidden gesture.
2. **Visible mute + calm hand-back.** `speak()` and WebAudio exist with no mute control; sessions end with no parent hand-back card. Add one persistent mute toggle and one "交给爸爸妈妈" end card.
3. **Localize and upsize.** `MY LITTLE COLLECTION` → 我的小收藏; raise 11.5–13.5px device captions to 14px; add two e2e assertions.

## Is the skill used correctly?

Method yes — surfaces, age, locale, devices declared; six axes cited; child rules applied. Application incomplete: it grepped for numbers only, skipping three explicit child-surface lines (no hidden gestures, visible mute, calm hand-back) and the human-feel rule on English on Chinese screens. Add a per-line child-surface checklist to the audit template so a numeric pass cannot skip them.
