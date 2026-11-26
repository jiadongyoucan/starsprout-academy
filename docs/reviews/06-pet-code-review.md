# 伙伴 / 奖励代码与安全评审 — 06

**Reviewer #6 · code/security/QA** · 对当前实现（迁移 v4、`pet.ts`、`scoring.ts`、课程/设备/计划集成、`routes/pet.ts`、前端 pet/home/ui/app、theme.css）逐项复核 · 2026-11-26

## 结论：**PASS**（原 FAIL，P0/P1 已复核修复；见文末附录）

工程基础扎实：`npm test` 78/78 通过（8 suites）、`tsc` 0 错误；迁移 v5 幂等、外键级联、家庭/孩子隔离、离线衰减封顶与下限、导出/删除均可用；焦点陷阱、Esc、reduced-motion、XSS 转义与 CSP 到位。下列 P0/P1 为**修复前**的记录（保留作审计线索），附录给出修复后的复核证据。

## P0

**P0-1（已修复）计划奖励可由客户端任意触发（修复前实测：同一节课 ×3 得 100 金币 + 披风）。**
- `src/modules/pet.ts:405` 把 `skipped` 也算 `done`；`:408` 只按计划项日期去重。
- `src/modules/curriculum.ts:167-169`、`src/modules/device.ts:367-369` 只要 `planItemId` 属于该孩子就把该项标记完成，**不校验该项的 `lesson_id` 是否等于刚完成的课时**。
- 实测：3 项/3 天的计划，用同一节 `lsn_thinking_junior_u1_l1` 分别带 3 个 `planItemId` 完成 → 返回 plan 里程碑（100 金币、`star-cape`）；再建新计划重复 → 钱包 138 → 238。跳过 2 项、完成 1 项同样发 100。
- **修复：**①`planMilestone` 只计 `status='done'`，且日期统计基于 done 项；②课程/设备完成时要求 `item.lesson_id === lessonId` 才标 done；③计划金币只允许从 `awardLessonCompletion` 路径发放，`plans.ts:416` 的手工 PATCH 不再发币（或要求服务端完成证据）；④补测试：skipped、跨课时 `planItemId`、重复手动 done 均不得加币。

## P1

**P1-2（已修复）未作答题目被当作“选了第 0 项”。** `src/modules/scoring.ts:15` 用 `Number(answers[i])`，客户端稀疏数组序列化后的 `null` → `0`；若该题答案恰为 0 就白得分。实测答案键 `[0,3]`、提交 `[null,3]` → `score 100, correct 2/2`，发 3 星 + 20 金币，并污染看板均分（`analytics.ts:46`）。
**修复：**`answer == null` 一律判错；`answers.length !== questions.length` 时缺失项判错；仅“完全未作答”才给中性 80。补一条稀疏答案回归测试。

## P2

**P2-3（已修复）服装可按数量购买：**`src/modules/pet.ts:310` 允许 `qty≤10`，`total=price*qty`；实测小黄帽 `qty:10` 扣 600 金币、库存 qty 10 却只能穿一次。修复：服装强制 `qty=1` 或 `qty>1` 直接 422。
**P2-4（未变，非阻断）购买无幂等键：**`/api/pet/shop/buy` 无 Idempotency-Key，连点两次食物会买两份；≥60 金币确认只在 `views/pet.js` 前端。修复：服务端幂等键 + 扣款前二次确认令牌。
**P2-5（已修复）文档与实现不一致：**`companion-design.md:25` 写“金币 8 + 得分/10”，代码 `pet.ts:429` 为 `10 + floor(score/10)`（100 分实际 20 币，测试亦断言 20）；§3 `:17` 的“-2/h、最低 0”与 `pet.ts:65-86` 的封顶 18/14/12、下限 35/38/30 不符；§5 `:37` 称“金币/情绪常驻顶栏、移动端伙伴居中”，但 `theme.css:322` 在 ≤1020px 隐藏两个 chip，`app.js` 的 `BOTTOM` 也没有伙伴项（`.pet-tab-main` 为死代码）；README 称“5 种情绪”，实现有 6 种（含 `missing`）；`DESIGN.md` 非目标未补「金币不购买基础照顾」。请统一文档或代码。
**P2-6（已修复）免费喂食无冷却：**`pet.ts` 免费小饼干可无限点击（仅接口 60 次/10 分钟限流），经验/等级可刷；建议加 60s 冷却或每日上限（不影响“基础照顾免费”）。

## 已复核通过

XSS：所有名字/描述经 `esc`，`celebrate`/`openModal` 标题转义，`petSvg` 不插值用户文本；CSP 未放开 script。焦点：`ui.js` trapFocus 移入/陷阱/归还并支持 Esc；`styles.css:709` 全局 reduced-motion 生效。数据：缺席 48h 仍 `missing` 且饥饿 ≥35，无死亡/惩罚；孩子删除经外键级联清空 pets/wallets/rewards；导出含 companion；跨家庭 GET/POST 403。回归：课程、计划、设备、社区、认证用例全绿。

## 实际执行的命令

```
NODE_ENV=test npm test   # 首轮 76 pass；修复后 78 pass / 0 fail（8 suites）
npx tsc --noEmit         # exit 0（两轮）
node /tmp/probe.ts       # null 答案计分、服装 qty、导出、免费喂食（修复前后各一次）
node /tmp/probe2.ts      # 同一课时刷计划奖励 / 新计划重复发放（修复前后各一次）
```
（未修改任何产品代码；探针脚本位于 /tmp。）


## 附录：二次复核（修复后）

**复核时间：** 2026-11-26 晚 · 未修改产品代码。

**验证结果：**
- `NODE_ENV=test npm test` → **78 pass / 0 fail**（8 suites）；`npx tsc --noEmit` → exit 0。
- P0-1 修复：迁移 v5 新增 `plan_items.completed_via`；`curriculum.ts:170`、`device.ts:370` 仅当 `item.lesson_id === lessonId` 时写 `done/lesson`，`plans.ts:414` 手工 PATCH 写 `manual` 且不再返回 rewards；`pet.ts:408,413` 只统计 `done + lesson` 及这些项的日期，`skipped` 不再计入。复跑探针：同一课时 ×3 个 `planItemId` → 无计划里程碑（钱包 38 不变）；跳 2 完 1 → 不发；新计划手工 done → 不发。
- P1-2 修复：`scoring.ts:15-21` 仅接受整数且落在选项范围内的答案，`null/undefined/NaN/越界` 一律判错；课程/设备不再 `Number()` 转换。复跑 `[null,3]`（答案键 `[0,3]`）→ `score 50 / 1 star / 15 coins`（修复前为 100/3 星/20 币）。
- P2-3 修复：`pet.ts:314` 服装 `qty !== 1` 返回 422（复跑：小黄帽 qty10 → 422，余额不变）。
- P2-6 修复：`pet.ts:235` 免费小饼干 60s 冷却。P2-4 的幂等键仍未加（前端连点由扣款条件兜底，非阻断）。
- 文档同步：`companion-design.md:25`（10 + floor(得分/10)）、`:37`（移动入口与 5 项导航）、`DESIGN.md:15` 非目标（金币不购买基础照顾）、README 6 种情绪，均与实现一致。

**结论：** 无 P0/P1 残留；P2-4 作为后续优化。签发 **PASS**。
