# Family UX Audit — 星芽学堂 v1.4（common-family-ux + kids-ux-design 本地适配）

**Skill used:** `common-family-ux` (HoangNguyen0403/agent-skills-standard) 的 `rubric.md`/`child-surface.md`/`human-feel.md`；`kids-ux-design` 为基于前者的本地适配规范（公开 registry 无同名可信包）。来源见 `skills/README.md`。
**Surfaces:** parent (`#/home`, `#/plans`, `#/account`), child (`#/child`, kid-mode `#/learn`), tablet (`/device`). Age band 2–6 (focus 3–6). Locale zh-CN. Devices: phone 390/320, tablet 1024, desktop.
**Verdict:** **PASS with minor findings** — no Blocker. Parent/child separation and parent gate are real; child targets/typography now meet 64px/16px; remaining label/consistency nits.

## Scores

| Axis | Score | Evidence |
|---|---|---|
| 1 Audience fit | **3/3** | Parent and child surfaces separated; `#/child` hides parent chrome; child cannot reach parent settings/delete/purchase; parent unlock requires account password (`verify-password`), wrong returns 403 without logout. Device settings now opens a **parent password modal** (`/api/device/verify-parent`), no hidden long-press. |
| 2 Accessibility | **2/3** | Body 16px; parent targets 48px+, child primary targets 64px (`#/child` E2E); AA contrast tokens updated; icon buttons have labels; reduced motion respected; child/device captions raised to 14px. Minor: some parent secondary captions 12–13px; no VoiceOver audit. |
| 3 Safety & trust | **3/3** | AI output labelled as local rules/AI-assisted; no clinical claims or dosing advice; destructive actions confirm and name data; child data export/delete behind parent session; no COPPA/GDPR claim—docs mark legal validation as boundary. |
| 4 Comfort | **3/3** | One warm accent family; no streaks/countdowns/points on child surface (child now shows sticker count only, coins removed); one primary action per child screen; no autoplay chains. |
| 5 Consistency | **2/3** | One design system, navigation order stable; parent sidebar / child full-bleed / tablet app intentionally different by audience. Minor: English eyebrows on some Chinese screens; tablet two-pane/rail not implemented (child device uses single-column, accepted). |
| 6 Human feel | **2/3** | Demo family coherent (米粒 / 米粒妈妈 / 团子); one SVG illustration style; no empty gradients or invented metrics; warm copy reviewed. Minor: some UI labels still English (Word Cards / Quick Quiz), and sample dates can drift. |

## Findings & fixes applied

1. **Child target sizes** were 44–56px → now `.kid-big-btn`/chips/parent gate 64px, `.kid-stop` 76px; E2E asserts ≥64.
2. **Child body text** was 12.5–15px → speech/body 16px, stop captions/stickers 14px, footer 14px; E2E asserts body 16 and speech 16.
3. **Coins on child surface** were a points mechanic → removed; child shows sticker count only. Coins stay in parent shop.
4. **Parent gate** already password-gated; verified wrong password 403 without logout, correct returns `#/home`.
5. **No urgency** — no streak count/completion ratio/red deltas on parent home; no timers on child.
6. **Secondary captions** on child/device raised to 14px; some parent captions remain 12–13px (minor, not blocker).
7. **Device parent gate** changed from 1.8s long-press + confirm to a visible「家长设置」button + parent password modal; wrong password 403, no logout. E2E/API test covers it.
8. **Visible mute + calm hand-back**: device header has 声音/静音 toggle (persisted); after completion a “今天到这里啦，把平板交给爸爸妈妈” hand-back card appears.
9. **Human feel**: `MY LITTLE COLLECTION` → 我的小收藏; device captions ≥14px.

## Re-run
```bash
npm run e2e   # 36 checks incl. child 64px/16px, 390/320, no exceptions
npm test      # 90/90
```
