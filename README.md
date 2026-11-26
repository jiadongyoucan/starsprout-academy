# 🌱 星芽学堂 · StarSprout Academy

> 面向 2–6 岁幼儿园家庭的「体系化课程 + 宠物伙伴 + 奖励仪式 + AI 计划 + 专家生态 + 家园社区 + 多端联动」平台。
> **每天 20 分钟，陪孩子长成自己的样子。**

星芽学堂不是又一个动画片仓库：它把 **托班 / 小班 / 中班 / 大班 × 智趣思维 / 英语 / 钢琴 / 汉字 / 蒙氏工作** 组织成可追踪的「学段 → 学科 → 单元 → 课时」体系；家长用手机 1 分钟生成计划，把计划推送到平板；孩子在平板上完成听、说、读、写、弹的互动课时，家长在手机看到进度、AI 周报，并可在孩子同意后收到学习瞬间照片。孩子还可以领养一只会开心、会饿、会想你的小伙伴，用学习赚来的金币给它换衣服、添房间小物。

- **零构建、零 npm 运行时依赖**：Node.js 24 原生 TypeScript + `node:sqlite`，没有数据库/Redis/打包器。
- **一条命令启动**：`./scripts/start.sh`，或者 `docker compose up -d`。
- **离线可用**：未配置大模型时自动降级为**本地规则规划引擎**，计划、课程、汇报全部可演示。
- **默认安全**：演示账号、沙箱都需显式开启；首次打开会引导创建管理员。
- **陪伴与奖励**：3 种伙伴、6 种情绪、5 种互动；服务端判分、首通奖励、单元/计划里程碑、金币小铺与衣橱。
- **有温度的 HMI**：家长首页「照顾自己」小纸条、儿童空间天空/草地/贴纸路径、设备端儿童悄悄话；原创文案每日稳定、可换句不换语气。
- **测试即验收**：`npm test`，83 个集成测试覆盖认证、隔离、计划、审核、设备、智能体、伙伴奖励与看板。

---

## 1. 一分钟启动

前提：**Node.js 24+**（`node:sqlite` 与原生 TypeScript 类型擦除）。本机不需要安装 npm 包。

```bash
./scripts/start.sh
# 🌱 家长端  http://localhost:8080
# 📱 学习端  http://localhost:8080/device
# 📚 文档    http://localhost:8080/docs/
```

首次启动会自动建库、迁移，并写入**体系化课程与公开课源**：

- 4 学段 × 5 学科 × 3 单元 × 3 课时 = **180 个核心互动课时**
- 4 个公开课源 / 4 个课程包（**+12 个课时**，带来源、许可证与版本）

打开首页后，如果系统还没有账号，会进入「首次初始化」，由你创建第一位管理员；**不会预置任何演示密码**。

想要一键体验完整演示家庭（含示例账号、计划、社区与照片）：

```bash
./scripts/start.sh --demo
# ⚠️ 仅限本机体验，不要对公网开放
```

### 演示账号（仅 `--demo` 或演示 Compose）

| 角色 | 邮箱 | 密码 | 能力 |
|---|---|---|---|
| 家长 | `parent@demo.com` | `Parent123!` | 课程、计划、智能体、设备、照片、社区 |
| 教师 | `teacher@demo.com` | `Teacher123!` | 家长能力 + 审核 / 公开专家发布 |
| 管理员 | `admin@demo.com` | `Admin123!` | 全部 + 模型配置、来源同步、用户与审计 |

> 演示模式由 `SEED_DEMO=true` + `DEMO_MODE=true` **显式开启**；启动脚本的 `--demo` 会设置它们。对外部署不要使用。

### Docker（单容器，数据持久化）

```bash
docker compose up -d
# 打开 http://localhost:8080 → 首次初始化管理员
```

本地演示（会写入演示账号，仅限本机）：

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d
```

Docker 镜像基于 `node:24-alpine`，运行时**不执行 npm install**，只挂载 `./data`：

```yaml
services:
  starsprout:
    build: .
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
```

局域网平板访问 / 摄像头 / PWA 安装需要 HTTPS（安全上下文）：

```bash
./scripts/gen-cert.sh 192.168.1.20   # 生成自签名证书
# .env 中设置 TLS_CERT / TLS_KEY，然后重启
# 平板访问 https://192.168.1.20:8080/device
```

---

## 2. 需求 → 实现映射

| # | 需求 | 实现 | 证据 |
|---|---|---|---|
| 1 | 四学段 × 五模块，分级课程，互动听说读写 | 192 个已发布课时；每个课时 6–8 个 block：故事 / 词卡 / 听 / 说 / 描红 / 钢琴 / 节奏 / 配对 / 测验；`src/infra/curriculum-data.ts`、`lesson-blocks.ts` | `test/curriculum.test.ts` |
| 2 | 对接优质公开课，持续更新，体系化不零散 | 4 个公开来源（OER Commons、StoryWeaver、国家智慧教育平台、MuseScore），带 license/attribution/版本；同步 → 隔离区 → 管理员审核 → 原子替换 | 课程页「公开课程来源」；Admin 同步；`test/curriculum.test.ts` |
| 3 | Plan 模块 + AI 辅助 + 纠正 / 提醒 | AI 读取真实进度排课；逾期检测、一键顺延 / 跳过、调整留痕、到期提醒；`src/modules/plans.ts` | `test/plans.test.ts` |
| 4 | 完整智能体（会话 / 记忆 / 沙箱 / 模型 / 工作区） | 会话、消息、长期记忆、工作区文件版本、模型配置（AES 加密）、权限隔离子进程沙箱、8 个工具、OpenAI-compatible 适配 + 本地引擎 | `test/agent.test.ts`、`test/platform.test.ts` |
| 5 | 综合分析 Dashboard + 日 / 周 / 月汇报 | 真实聚合：完成数、分钟、连续天数、学科均衡、计划坚持度、趋势；本地 / LLM 报告并落库 | `test/platform.test.ts`、看板截图 |
| 6 | 专家智能体、技能、连接器，发布与获取 | 公开需教师身份 + 审核；家庭私有即时可用；安装 / 卸载；内置与 HTTP 连接器；调用审计 | `test/platform.test.ts` |
| 7 | 社区广场，发布心得 / 课程，审核审批 | 全部内容先审后发；课程必须关联已发布课时；规范化 + 违禁词 + 导流 / PII 检测；不能自审；举报与隐藏 | `test/community.test.ts` |
| 8 | 登录注册、权限认证、权限隔离 | scrypt + JWT + 会话吊销；parent/teacher/admin/device 四类主体；household 全链路隔离 | `test/auth.test.ts`、`test/device.test.ts` |
| 9 | 手机 ↔ Mac / 平板联动 | 6 位一次性配对码（10 分钟）→ 设备令牌 → 推送 → SSE 实时 + 轮询兜底 → 学习 → 进度回传 | 浏览器 E2E + `test/device.test.ts` |
| 10 | 摄像头抓取学习照片供家长查看 | 家长请求 → 设备明确同意 → 拍照 / 相册 → 家长授权校验 → 家庭内鉴权读取 → 可删除 / 30 天清理 | `test/device.test.ts` |
| 11 | TDD / DDD / 最佳实践 / 简单部署 | 9 个测试套件 83 用例；按限界上下文拆分模块；零依赖部署；Docker + 一键脚本 + 健康检查 | 本文、`docs/architecture.html` |
| 12 | 可领养伙伴、多情绪、喂食/玩耍 | 3 种伙伴、6 种情绪、温和离线衰减、免费基础食物、5 种互动、学习联动 | `docs/companion-design.md`、`src/modules/pet.ts` |
| 13 | 答题/课时奖励、金币兑换、单元/计划仪式 | 服务端判分、首通幂等、单元 +30 / 计划 +100、小铺/衣橱、庆祝与证书 | `test/pet.test.ts`、`docs/product.html#pet` |
| 14 | 有温度的家长 / 儿童 HMI，儿童更卡通 | 独立儿童空间（天空/草地/路径/贴纸/伙伴）、家长「照顾自己」卡、设备儿童语气、家长密码解锁 | `test/warmth.test.ts`、浏览器 320/390 |
| 15 | 不定期鼓励 / 鸡汤 / 幽默话术 | 原创文案池，每日稳定、同语气手动换、2 次/日、低活跃屏蔽幽默、低分安慰 | `test/warmth.test.ts`、Reviewer #8/#9/#10 |

> 需求 5 的「日报 / 周报 / 月报」、需求 10 的摄像头、需求 9 的 Mac/平板浏览器学习端都已实际落地，不是静态原型。

---

## 3. 产品速览

### 课程体系

```
托班（2–3）  小班（3–4）  中班（4–5）  大班（5–6）
   ×            ×            ×            ×
智趣思维 · 英语启蒙 · 钢琴律动 · 汉字启蒙 · 蒙氏工作
   ×
3 个单元（每学科/学段） → 3 个课时/单元 → 互动 block
```

- 每个课时都有明确**目标、时长、前置顺序、来源**。
- 计划生成会跳过已完成课时、优先进度较少的学科、按每日时长约束排课。
- 公开课包映射到既有框架，带 `source_code / license / version / checksum`，新版本默认进入隔离区待审核。

### 学习体验（平板 / Mac）

| Block | 互动 |
|---|---|
| `story` / `read` | TTS 朗读（中文 / 英文、慢速）、故事文本 |
| `cards` / `listen` | 点读词卡、先听后说、翻译提示 |
| `speak` | 浏览器语音识别跟读，**音频不上传** |
| `trace` | Canvas 描红，支持手指 / 触控笔 |
| `piano` | WebAudio 琴键 + 示范旋律 + 高亮 |
| `rhythm` | 可视化节拍器，跟拍练习 |
| `match` / `quiz` | 配对、即时反馈与解释、得分 |
| `reflect` / `resource` | 亲子表达 + 带许可证的外部资源 |

### AI 计划与纠偏

1. 选择孩子、周期、每周天数、每日分钟、目标。
2. 系统读取真实进度与课程顺序 → 学科轮转 → 生成 2 周草稿。
3. 有模型时仅用 AI 补全**个性化理由**（不生成课程 ID，避免幻觉）；无模型时输出数据驱动的本地理由。
4. 家长确认激活 → 自动生成未来 7 天提醒。
5. 逾期 → 「一键纠偏」顺延到最近空白工作日，或跳过；写 `plan_adjustments` 审计；计划结束日期自动延长。

### 智能体工作室

- **会话 / 记忆 / 工作区 / 沙箱 / 模型** 完整闭环。
- 工具：`search_curriculum`、`create_plan`、`report_progress`、`create_lesson_draft`、`save_workspace_file`、`remember`、`submit_community_post`、`sandbox_run`。
- 工具参数服务端校验；AI 创作只进工作区 / 待审区，不直接进入公开课程库。
- 沙箱用独立子进程 + Node 权限模型 + `vm` + 时间 / 内存上限；**默认关闭**（`ENABLE_SANDBOX=false`），它不是虚拟机级硬安全边界。

### 社区与生态

```
草稿/编辑 → pending → 审核通过 approved → 广场可见
                    ↘ 拒绝 rejected（必须写理由，可修改后重提）
                    ↘ 举报 → 管理员隐藏 hidden
```

- 所有内容需人工审核；**不能审核自己的内容**。
- 导流 / 联系方式 / 手机号 / 身份证 / 违禁内容在提交阶段直接拒绝；站外链接与医疗建议进入人工复核。
- 专家 / 技能 / 连接器同样支持公开审核与家庭私有。

### 多端与照片

```
家长生成 6 位码（10 分钟，一次性）
        ↓
平板 /device 输入 → 设备令牌（绑定家庭）
        ↓
家长推送计划 → SSE 实时事件 + 30s 轮询兜底 → 平板打开学习
        ↓
设备完成课时 → /api/device/progress → 家长看板 / 报告同步
        ↓
家长请求拍照 → 平板显式“同意” → 上传 → 家庭内鉴权读取 → 删除 / 30 天清理
```

摄像头只在用户点击后短暂开启；关闭弹窗即停止；服务端再次校验监护人 `camera` 授权。

---

## 4. 技术栈与项目结构

| 层 | 选型 |
|---|---|
| 运行时 | Node.js 24（原生 TS 类型擦除） |
| HTTP | 自研 ~300 行路由 / 中间件（CSP、限流、JSON、静态资源） |
| 数据库 | `node:sqlite`（WAL、外键、版本化迁移、事务） |
| 前端 | 原生 ES Modules SPA + PWA；无打包器；CSS 设计系统 |
| AI | OpenAI-compatible 适配器（默认 DeepSeek）+ 本地规则引擎兜底 |
| 测试 | `node:test` + 真实 HTTP 集成测试；`tsc --noEmit` |
| 部署 | Docker / Compose / 一键脚本；SQLite 单文件备份 |

```
src/
  server.ts              入口：HTTP/HTTPS、保留期清理、优雅退出
  app.ts                 组装：DB、鉴权解析、路由注册
  config.ts              环境变量、密钥、数据目录
  core/                  http / security / errors / logger / validate
  infra/                 db / migrations / seed / curriculum-data / lesson-blocks / public-courses
  modules/               限界上下文（auth、curriculum、plans、agent、ai、sandbox、registry、community、device、analytics、privacy、models）
  routes/                HTTP 接口层
  web/                   index.html、device.html、styles.css、device.css、js/{api,ui,app,device}.js、js/views/*
test/                    83 个集成测试
docs/                    产品 / 架构 / QA HTML 文档、评审记录
scripts/                 start / smoke / backup / gen-cert
```

---

## 5. 测试与质量门禁

```bash
npm test          # NODE_ENV=test node --test test/*.test.ts
npx tsc --noEmit  # 严格类型检查
./scripts/smoke.sh
```

| 套件 | 重点 |
|---|---|
| `auth.test.ts` | 注册登录、密码策略、令牌吊销、改密、账号停用、家庭隔离、孩子授权 |
| `curriculum.test.ts` | 4×5 体系、学段差异、互动 block、公开课来源 / 许可证、进度联动、同步幂等 |
| `plans.test.ts` | 离线排课、周末留白、激活提醒、逾期顺延 / 跳过、手动计划、跨家庭隔离 |
| `community.test.ts` | 待审状态机、导流 / 谐音 / 手机号拦截、课程关联、自审禁止、编辑重审、举报隐藏 |
| `agent.test.ts` | 会话隔离、本地排课、记忆、工作区路径穿越、沙箱输出 / 超时、模型权限 |
| `device.test.ts` | 一次性配对、推送 / 收件箱、计划学习、拍照同意、跨家庭图片隔离、批量删除 |
| `platform.test.ts` | 专家审核 / 安装、连接器 SSRF 白名单、真实看板、周期报告、模型密钥不回传、管理员重置 |

> 测试使用临时 SQLite + 随机端口 + 真实 HTTP；`NODE_ENV=test` 关闭限流以便批量用例，业务限流在生产启用。83/83 通过，`tsc --noEmit` 通过。

---

## 6. 配置

复制 `.env.example` 为 `.env`。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | SQLite、照片、自动生成的 `secret.key` |
| `APP_SECRET` | 自动生成 | JWT / 密钥加密根；多实例必须显式设置 |
| `PUBLIC_URL` | `http://localhost:8080` | 配对页展示地址 |
| `SEED_DEMO` | `false` | 首次启动写入演示家庭；也可以用 `start.sh --demo` |
| `DEMO_MODE` | `false` | 登录页展示演示账号（对外必须 false） |
| `AI_API_KEY` | 空 | 配置后启用大模型；留空用本地规则引擎 |
| `AI_BASE_URL` / `AI_MODEL` | DeepSeek | 任意 OpenAI-compatible |
| `ENABLE_SANDBOX` | `false` | 沙箱开关；显式开启后使用权限隔离子进程，仍非虚拟机级 |
| `CONNECTOR_ALLOWED_HOSTS` | 空 | HTTP 连接器允许域名；空=禁用外部 HTTP 连接器（内置工具可用） |
| `SNAPSHOT_RETENTION_DAYS` | `30` | 照片保留天数，启动与每日清理 |
| `TLS_CERT` / `TLS_KEY` | 空 | 启用 HTTPS（摄像头 / PWA 必须） |

---

## 7. 生产部署清单

1. **确认演示关闭**：`DEMO_MODE=false`、`SEED_DEMO=false`（默认即如此）；首次打开完成管理员初始化。
2. **设置强 `APP_SECRET`**（≥32 字节随机值）；不要提交 `.env`。
3. **启用 HTTPS**：反向代理或 `TLS_CERT/TLS_KEY`；平板局域网需信任证书。
4. **限制连接器域名**：`CONNECTOR_ALLOWED_HOSTS=api.your-domain.com`；不要放开通配。
5. **AI 密钥**：优先用环境变量或管理后台（AES-256-GCM 加密）；为家庭设置每日额度（`AI_DAILY_LIMIT`，默认 120）。
6. **备份**：`./scripts/backup.sh /path/to/backup`（SQLite `VACUUM INTO` + 照片）。
7. **保留期**：按机构政策调整 `SNAPSHOT_RETENTION_DAYS`；删除照片不可恢复。
8. **审计**：定期查看 `audit_logs`、社区审核队列、专家审核队列。
9. **不要把照片目录暴露为静态资源**；只能经 `/api/snapshots/:id/image` 鉴权读取。
10. **升级**：替换代码后重启；迁移自动执行；先备份。

---

## 8. 安全与隐私设计（摘要）

- **认证**：scrypt 密码哈希；HS256 JWT（7 天）+ `sessions` 可吊销；设备独立令牌（365 天，哈希落库，可撤销）。
- **授权**：`public / user / staff / admin / device` 五种访问级别；服务层再次校验 `household_id` 与孩子归属；返回 403/404 不泄露跨家庭资源。
- **儿童数据**：监护人按 `camera / ai_processing / analytics` 三类授权；AI 发送前只提供去标识摘要；照片设备端二次确认；导出 JSON；可删除照片 / 记忆 / 账号。
- **XSS**：前端统一 `esc()`，用户内容只经 `textContent` / 转义模板渲染；CSP 禁用内联脚本。
- **CSRF**：Bearer Token + 不使用 Cookie 会话，避免传统 CSRF。
- **SSRF**：连接器域名允许列表 + DNS 解析私网拦截 + 禁止重定向 + 8s 超时 + 响应截断。
- **提示注入**：系统提示与用户内容分离；工具结果视为数据；工具参数白名单校验；AI 不能直接发布内容。
- **审核**：全部先审后发、不能自审、拒绝必须写理由、编辑重审、举报可隐藏、评论同样过滤。
- **限流**：登录 / 注册 / 改密 / 计划生成 / 聊天 / 沙箱 / 连接器 / 拍照 分别限流。

详见 [架构文档](docs/architecture.html) 的威胁模型章节。

---

## 9. 已知边界与后续路线

**已知边界**
- 摄像头需要 HTTPS / localhost；HTTP 局域网下会自动提示，并支持相册选择兜底。
- 单家庭 / 小型园所规模（单实例 SQLite）；多实例需外部数据库与共享存储，repo 层已隔离，可替换。
- 沙箱是权限隔离的纵深防御，不是虚拟机级硬隔离；默认关闭。
- 语音仅浏览器本地识别，不做云端发音评分（隐私优先）。
- 未接支付 / 原生 App / 实时视频；PWA 覆盖安装与推送。
- 教师角色是平台级审核者，不提供园所组织树（路线图）。

**路线图**
1. 园所组织与班级（teacher 多租户）。
2. 语音发音评分（本地模型 / 家长可选）。
3. 课程版本 diff 可视化与回滚。
4. Web Push（VAPID）替代纯轮询。
5. 学习报告 PDF 导出与家园共育周签。
6. 多实例：Postgres + S3 兼容对象存储。

---

## 10. 文档

- 产品文档：`docs/product.html`
- 架构与技术文档：`docs/architecture.html`
- 测试与验收：`docs/qa.html`
- 设计评审：`docs/reviews/01-design-review.md`
- 代码与安全评审：`docs/reviews/02-code-security-review.md`
- 验收评审：`docs/reviews/03-acceptance-review.md`
- 验收后复核（PASS）：`docs/reviews/03a-post-fix-verification.md`
- 伙伴 UX 评审：`docs/reviews/05-ux-pet-review.md`
- 伙伴代码/安全评审：`docs/reviews/06-pet-code-review.md`
- 温度 UX 评审：`docs/reviews/08-warmth-ux-review.md`
- 温度代码评审：`docs/reviews/09-warmth-code-review.md`
- 温度最终验收：`docs/reviews/10-warmth-final-acceptance.md`
- 最终验收（PASS）：`docs/reviews/07-final-acceptance.md`

启动后可直接访问 `http://localhost:8080/docs/`。

---

## 11. 公开课程与许可

平台内置的公开课程参考包仅引用公开来源的**活动思路 / 公版曲目 / 开放绘本**，并在课时中标注来源、许可证与「二次设计」说明：

- OER Commons（CC BY 4.0，逐条遵循原许可）
- StoryWeaver / Pratham Books（CC BY 4.0）
- 国家中小学智慧教育平台 · 学前教育（国家平台公开资源，署名、非商业使用）
- MuseScore 公共领域乐谱（Public Domain / CC0，逐曲目确认）

正式商用前请逐一复核原始资源许可；导入器已保留 `source / license / attribution` 字段，便于替换与下架。
