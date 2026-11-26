# 评审修复记录（G3）

本轮针对 Reviewer #1（设计）与 Reviewer #2（代码/安全）的 P0/P1 逐项修复。所有改动均在当前范围内，无范围扩张。

## P0

### P0-1 演示后门（默认部署公开演示管理员）
**结论：已修复。**
- 演示数据改为**双重显式开关**：`SEED_DEMO=true` 且 `DEMO_MODE=true`；两者默认均为 `false`（`src/config.ts`、`.env.example`、`docker-compose.yml`）。
- Dockerfile 不再注入演示变量；`docker compose up -d` 默认安全启动。
- 新增首次初始化：零用户时 `/api/meta.setupRequired=true`，前端进入「首次初始化」，`POST /api/setup` 创建第一位管理员（已有用户则 409）。不再预置任何密码。
- `--demo` / `docker-compose.demo.yml` 为显式演示入口，文档标注仅限本机。
- 演示管理员不再加入其他家庭；单独 `hh_admin` 家庭，避免“管理员看到别人孩子”的误解。
- `must_change_password` 从建议变为**强制**：除 `/api/auth/me`、`change-password`、`logout`、`meta`、`health` 外，所有请求返回 403 `PASSWORD_CHANGE_REQUIRED`；前端弹出不可关闭的改密框，改密后自动续登。
- 测试：`test/auth.test.ts` 首次初始化与重复初始化；`test/platform.test.ts` 临时密码强制改密；CDP 实测初始化页面与强制改密流程。

**残余说明：** 显式 `--demo` 仍会创建演示账号并在登录页展示，这是演示模式的预期行为；生产清单要求不要开启。

### P0-2 沙箱逃逸 → RCE
**结论：已修复（模型替换 + 默认关闭）。**
- 不再使用 Worker 内 `vm` + 宿主对象。改为独立 Node **子进程**：
  - `--permission`，仅允许读取 runner 自身；
  - `env: {}`，无应用密钥；
  - 800ms 脚本超时 + 1.5s 硬终止 + 32MB 内存；
  - 上下文仅含**在上下文内创建**的 `console`，不注入宿主 `Math/JSON/console/process`。
- 复核 PoC：`Math.constructor.constructor('return process')()`、`console.log.constructor.constructor(...)`、`globalThis.constructor.constructor(...)` 均返回 `BLOCKED`；`typeof process/require` 为 `undefined`。
- 沙箱改为 `ENABLE_SANDBOX === 'true'` 才启用，**所有环境默认关闭**；UI 显示禁用状态。
- 新增回归测试：逃逸探测、默认关闭 403、超时终止。
- 文档与 UI 不再声称“无 require/process 即安全边界”，明确“非虚拟机级隔离”。

**残余说明：** 如需执行不可信代码，仍建议容器 / gVisor / isolated-vm；当前设计用于可信家庭的计算演示。

## P1

### 1. 孩子删除不可用（DELETE body 未解析）
- `core/http.ts` 现在为 `POST/PATCH/PUT/DELETE` 解析 JSON body。
- 新增测试：无 `confirm` 返回 422；带 `confirm:true` 删除成功，看板随后 404。

### 2. AI / 分析授权未生效
- 新孩子服务端默认 `ai_processing=false`、`analytics=false`、`camera=false`，必须显式 `true`；UI 中 AI 授权改为**默认不勾选**（可选能力）。
- 看板 / 报告 / 报告列表：无 `analytics` 授权返回 403 `CONSENT_REQUIRED`；首页给出“去开启授权”的引导。
- 计划生成：AI 已配置但无 `ai_processing` 时**自动降级本地规则**，不再 403。
- 智能体会话：无任何孩子授权时跳过第三方模型；系统提示只包含已授权孩子；`create_plan` / `report_progress` 工具对未授权孩子直接拒绝。
- 测试：撤回分析授权 → 403 → 恢复 → 200；AI 工具测试沿用已授权演示孩子。

### 3. 照片保留期清理遗漏文件 / 参数未校验
- 新增 admin 清理流程：校验 0–3650 天；删除 DB 记录后同步 `unlink` 照片文件；测试断言目录为空且非法天数 422。
- 单张 / 批量删除、设备撤销、跨家庭读取仍由既有测试覆盖。

### 4. 提醒：时长 / 滚动窗口 / GET 副作用 / 时区
- 提醒文案使用计划项真实分钟数，不再硬编码 15。
- 新增 `refillActivePlanReminders`：启动时与每 6 小时为活跃计划补齐未来 7 天提醒。
- `GET /api/reminders/due` 改为只读；新增 `POST /api/reminders/dispatch` 消费并标记，前端改为 POST。
- `today()` 固定按 `Asia/Shanghai` 计算，避免 UTC 跨日错位。
- “无需常驻页面”改为准确描述：页面打开时通知，下次打开补发。
- 测试：只读 GET 不改变状态、dispatch 仅消费一次、计划激活生成提醒。

### 5. 临时密码仅提示
- 服务端强制拦截 + 前端不可关闭改密弹窗 + 改密后旧会话吊销并自动续登；测试覆盖 403 与改密后恢复。

## 验证

```bash
npm test            # 68 / 68 passed（7 suites）
npx tsc --noEmit    # exit 0
./scripts/smoke.sh  # health → login → curriculum → plan → pair → inbox
```

浏览器（Chrome 157 / CDP，绕过 SW 缓存）实测：
- 首次初始化管理员 → 管理后台；
- 演示账号登录 → 首页 / 课程 / 课时 / 计划 / 智能体 / 社区 / 设备 / 管理后台；
- 家长生成码 → 平板配对 → 推送 → 平板打开计划 → 完成课时 → 家长看板进度更新；
- 家长请求拍照 → 平板同意 → 上传 → 家长图库鉴权读取；
- 移动端 390×844 无横向滚动；
- 临时密码登录 → 强制改密 → 正常进入。

## 保留的已知边界
- 沙箱非虚拟机级隔离；生产默认关闭。
- 摄像头依赖 HTTPS / localhost；提供证书脚本与相册兜底。
- 单实例 SQLite；多实例需 Postgres / 外置 SSE / 对象存储。
- 单张语音识别仅浏览器本地，无云端发音评分。

## 验收后补充（Reviewer #4 的 P1-1 / P2，已关闭）

Reviewer #4 给出 **CONDITIONAL PASS**，唯一 P1 是“`SEED_DEMO` 单开关仍可能在生产写入演示管理员”。已修复：

- **种子双重门禁**：`shouldSeedDemo()` 仅在 `SEED_DEMO=true` **且** `DEMO_MODE=true` 时返回 true；`seedDatabase` 使用该判断。显式内部参数 `{demo:true}` 仅用于受控测试/脚本。
- **演示展示只看显式开关**：`adjustDemoMode()` 不再在非生产环境自动展示演示凭据，必须 `DEMO_MODE=true`。
- **新增回归测试**：`test/seed.test.ts` 在 `NODE_ENV=production + SEED_DEMO=true + DEMO_MODE=false` 下断言 0 个用户；双开关才写入演示家庭。
- **P2 修复**：社区详情不再返回 `household_id / moderation_score`（非作者/非审核者也不返回审核原因）；`.dockerignore` 不再排除 `docs/reviews`；配对码尝试计数器死代码移除（由每 IP 限流控制）；新增日报/月报覆盖测试。
- **Docker 启动权限**：新增 `docker-entrypoint.sh`，root 修正 `/data` 挂载权限后 `su-exec node` 降权运行；避免 Linux bind mount 权限导致启动失败。

验证：`NODE_ENV=test npm test` → **68 / 68 passed（7 suites）**；`npx tsc --noEmit` → exit 0；`/api/setup` 初始化与生产式启动实测通过。

> `03-acceptance-review.md` 保留为验收当时的客观记录（CONDITIONAL PASS）；其 P1 条件已由本节关闭。重新验收时以本记录 + 68 测试为准。

## v1.2 伙伴 / 奖励 / UI 升级（Reviewer #5、#6、#7）

### 新增能力
- 迁移 v5：`pets / wallets / shop_items / pet_inventory / reward_events / pet_interactions`，以及 `plan_items.completed_via`。
- 三种伙伴、六种情绪、温和离线衰减、免费基础食物、五种互动；小铺 / 衣橱 / 背包；金币来自真实学习。
- 服务端按课时 `answers` 与答案键判分（`src/modules/scoring.ts`），客户端 `score` 不参与发币。
- 首通 / 单元 / 计划奖励使用 `(child_id, source_type, source_id)` 唯一约束；单元 +30，计划 +100 + 限定披风。
- 全站视觉升级：奶油纸张 + 极光背景 + 毛玻璃 + 衬线标题 + SVG 伙伴；首页、伙伴页、学习庆祝、移动端底栏。

### Reviewer #5（UX）阻断项关闭
- 移除愧疚经济：衰减封顶 18/14/12、下限 35/38/30，≥24h「想你」；基础小饼干免费；无排行榜 / 死亡 / 学习权限惩罚。
- 奖励伦理：儿童界面不显示数字分数，只显示星星 / 金币 / 答对题数；计划金币要求 ≥3 项且跨 ≥3 天。
- 不新增第 6 个底部入口；伙伴通过首页卡、桌面侧栏、顶栏 chip 与菜单进入；庆祝层焦点陷阱 + Esc + reduced-motion。

### Reviewer #6（代码 / 安全）阻断项关闭
- **P0 计划刷币**：`plan_items.completed_via='lesson'`，只有 `item.lesson_id === lessonId` 才标记；手工 PATCH 只记 `manual` 且不发奖励；`planMilestone` 只计 done + lesson，跳过项不计。回归：同一课时 ×3、跳过 2 项、手工全 done 均无计划金币。
- **P1 空答案计分**：不再 `Number(null)→0`；null/NaN/越界一律判错；稀疏答案回归。
- **P2**：服装 qty≠1 返回 422；免费喂食 60s 冷却；文档公式 / 衰减 / 六种情绪 / 导航描述对齐。
- 复核：`npm test` → **78 / 78 passed（8 suites）**；`npx tsc --noEmit` → exit 0；Reviewer #6 更新为 **PASS**。

### 仍为非阻断
- 小铺购买暂无服务端幂等键（前端按钮防抖 + 条件扣款保证不透支）；后续可加 `Idempotency-Key`。
- Docker 未在本机执行；静态检查和本机 Node 部署已通过。

## v1.3 温度 HMI / 儿童空间 / 文案系统（Reviewer #8/#9/#10）

### 新增
- `src/infra/warmth-data.ts` 原创文案池（家长共情/轻松/自我照顾；儿童陪伴/勇气/幽默；课时具体反馈），`src/modules/warmth.ts` 按日期 + 受众 + 场景 + 孩子选择；`fresh` 只换句不换语气，`exclude` 避免近期重复。
- 家长首页「星芽树洞」卡片，2 次/天换句上限；儿童空间 `#/child`：天空/草地/太阳/彩虹、伙伴、三个小站、贴纸墙、大按钮；`kid-mode` 儿童课时隐藏家长侧栏/顶栏并提供「回儿童空间」。
- 设备端儿童语气、温暖文案、长按「家长设置」；课时完成响应 `rewards.warmth` 并在庆祝层展示。
- 家长首页减负：3 个温和统计、移除连续天数、计划完成率与红色 delta、快捷喂食重复；低活跃时屏蔽幽默。
- 家长密码解锁儿童空间；密码错误返回 403 不触发登出；`/api/auth/verify-password` 限流。

### 评审关闭
- #8 UX：方向 CONDITIONAL；要求文案真正落地、减 KPI、儿童边界、轮换稳定、a11y。已逐项落实。
- #9 代码：首轮 CONDITIONAL（儿童链接被锁、换句漏 `ok`、历史全局）；修复后复核 **PASS**。剩余 P2：刷新 cap 仍客户端、池耗尽可能重复、`ok` 客户端断言。
- #10 最终验收：**PASS**；两项温度需求 ACCEPT，原 15 项无回归。

### 验证
`npm test` → **83 / 83 passed（9 suites）**；`npx tsc --noEmit` → exit 0；smoke 通过；浏览器 390/320 无横向滚动；儿童空间错误密码→正确密码解锁回到家长首页实测。
