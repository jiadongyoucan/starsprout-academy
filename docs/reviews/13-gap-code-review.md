# Reviewer #12 — Gap Code Review (code/security/UX)

**Snapshot:** 90/90 tests · 10 suites · `tsc` clean. Scope: P0 moderation, A1 content/versioning, plan engine, ecosystem, PWA.
**Verdict: CONDITIONAL PASS.** No P0/P1 code defect found in the gaps closed; approval conditional on the gates below (none require reopening P0/A1).

## Findings (no code change requested)

1. **Moderation depth is good, surface is thin.** `src/modules/moderation.ts:43` strips `\p{Cf}`, plus punctuation/symbol mapping; 8 negative probes cover it (`test/gaps.test.ts`). Residual: only the comment/post bodies are normalized at write time — titles pass the same path, but no test asserts *rendered-output* encoding after approval (stored payload vs. client re-render). Keep as watch item, not a gate.
2. **Comments roll up correctly.** Comment create returns `pending` + reason (`src/modules/community.ts:166-167`); admin counts and queue/hide exist (`community.ts:270`, `analytics.ts:312-316`). Cross-tenant existence returns 403, not 404 — accepted residual, but it is an oracle; document it as a known information leak of low severity rather than "by design."
3. **A1 holds.** Public pack checksum is a real sha256 over blocks+meta (`src/infra/public-courses.ts:62,93`); `lesson_versions` staged (migration `src/infra/migrations.ts:340`, insert `public-courses.ts:86`); non-approved packs land `quarantined` (`public-courses.ts:32`). Metadata v6 parent-only is enforced at the response layer, not per-field — add an assertion that child tokens can never see v6 metadata.
4. **Plan engine.** Adherence is a computed range (`plans.ts:262`, `analytics.ts:50`), single-lesson cap exception carries a note, reminders active-only. `skipped` is a status (`plans.ts:439`) but downstream adherence excludes skipped without a test — verify skipped does not inflate `missed`.
5. **PWA kid UX is the real gap.** `src/web/sw.js` precaches the complete view, icons are PNG; but kid font, contrast, touch targets, rainbow/mood-missing/decor/toy/cape states are absent. This is child-facing accessibility, not polish.
6. **Evidence honesty is intact.** CDP claims retracted; manual checklist at `docs/e2e/manual-checklist.md`.

## Gates before PASS

- **G1** Automated browser E2E for one child journey (currently manual-only) — the single largest residual.
- **G2** Kid contrast/touch-target audit ≥ WCAG AA + ≥44px, evidenced in checklist.
- **G3** Seed/demo photos for batch-photo UI (accepted residual must not ship silently empty).
- **G4** Connector model injection: pin an allowlist at the call boundary, or record explicit acceptance in `docs/gap-disposition.md`.

## Residual ledger

| Item | Sev | Owner | Disposition |
|---|---|---|---|
| Cross-tenant 403 (not 404) | Low | Backend | Accept + document oracle |
| Batch photo UI | Low | UX | G3 |
| Connector model injection | Med | Backend | G4 |
| No automated browser E2E | Med | QA | G1 |
| Kid font/contrast/touch/states | Med | UX | G2 |
