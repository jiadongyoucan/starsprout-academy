# 星芽学堂 · 产品与架构设计（v1.0）

> 面向 2–6 岁幼儿园家庭的「体系化课程 + AI 计划 + 专家生态 + 家园社区 + 多端联动」平台。
> 代码名：`starsprout-academy`；slogan：**每天 20 分钟，陪孩子长成自己的样子。**

## 1. 产品目标与非目标
**目标**
1. 覆盖托班/小班/中班/大班四级，五大模块（智趣思维、英语、钢琴、汉字、蒙氏工作）各有一套螺旋上升的课程体系。
2. 学习是互动式、多感官的：听（TTS/音频）、说（语音跟读）、读（识字/绘本）、写（触控描红），并可记录进度。
3. 家长用手机 3 分钟生成一周计划；AI 辅助排课、纠偏、提醒；平板/Mac 收到计划即可开始学习。
4. 家长可远程请求平板摄像头拍照留痕（有明确同意与可见提示），用于陪伴式监督而非监控。
5. 专家智能体 / 技能 / 连接器形成可发布、可审核、可安装的生态。
6. 社区只呈现「主题相关 + 健康合规」的内容，所有课程发布走审核。

**非目标（v1 明确不做）**：实时视频监控、儿童独立账号、支付/订阅、跨租户社交私信、离线视频转码、原生 App（用 PWA + 响应式替代）；宠物死亡 / 饥饿惩罚 / 排行榜；用金币购买基础照顾或学习内容（基础小饼干免费，金币只换虚拟装扮与小物）。

## 2. 用户与权限
| 角色 | 说明 | 关键权限 |
|---|---|---|
| parent 家长 | 家庭创建者/成员 | 自己家庭的孩子、计划、设备、照片、会话；发布社区内容 |
| teacher 教师 | 园所/内容专家 | parent 权限 + 公共专家/技能发布 + 社区审核队列 |
| admin 管理员 | 平台运营 | 全部 + 用户/模型配置/审核/审计 |
| device 学习设备 | 通过 6 位配对码绑定的平板/Mac | 仅本设备收件箱、计划、学习进度、拍照上传 |

隔离模型：**household（家庭）为租户边界**。所有业务表带 `household_id`；服务层 `assertHousehold / assertChild` 强制校验；设备令牌绑定单一 household；JWT 含 `hid` 但**不信任**客户端声明，服务端二次校验。管理端跨租户能力显式收口在 `/api/admin/*` 与审核接口。

## 3. 领域划分（DDD Bounded Contexts）
```
identity     用户/家庭/孩子/会话令牌
curriculum   学科/学段/课程框架/单元/课时/公开课源/进度
planning     计划/计划项/提醒/纠偏记录
agent        会话/消息/记忆/工作区/模型/沙箱/工具调用
ecosystem    专家/技能/连接器/安装/调用审计
community    帖子/评论/点赞/审核流转
companion    设备配对/推送/学习会话/摄像头快照
insight      看板聚合/周期报告
governance   审核策略/关键词/审计日志
```
分层：`routes (接口层) → service (应用层/用例) → repo (基础设施层，SQLite) → domain types`。领域规则（如计划纠偏、审核状态机）只放在 service/domain，不泄漏到路由。

## 4. 技术选型与理由（最低成本、最易部署）
| 项 | 选择 | 理由 |
|---|---|---|
| 运行时 | **Node.js 24** 原生 TS 类型擦除 | 零构建、零转译，`node src/server.ts` 即启动 |
| 存储 | **node:sqlite**（WAL） | 单文件、零外部依赖、备份=复制文件；家庭规模足够 |
| API | 自研 120 行路由/中间件 | 无 npm 依赖 → 供应链风险与安装成本最低 |
| 前端 | 原生 ES Modules SPA + PWA | 无打包器；手机可「添加到主屏幕」；一套代码适配手机/平板/Mac |
| AI | OpenAI-compatible 适配器（DeepSeek 默认）+ **本地规则引擎兜底** | 无 Key 也能演示计划/课程生成；有 Key 自动升级 |
| 测试 | `node:test` + 真实 HTTP 集成测试 | 零框架依赖，测试即验收 |
| 部署 | `scripts/start.sh` 或 Docker Compose（单服务 + volume） | 一条命令；无数据库/Redis 依赖 |

> 取舍：放弃独立 SPA 框架与 ORM，换取「无安装、无构建、可审计」。规模增长时可平滑替换：repo 层接口不变，SQLite→Postgres；AI 适配器已抽象。

## 5. 数据模型（核心表）
`users, households, household_members, children, sessions`
`subjects, class_levels, frameworks, units, lessons, public_sources, course_packs, progress`
`plans, plan_items, reminders, plan_adjustments`
`agent_sessions, agent_messages, agent_memory, agent_workspace_files, model_configs, agent_runs, sandbox_executions`
`experts, skills, expert_skills, connectors, installations, connector_invocations`
`community_posts, post_reviews, comments, post_likes`
`devices, device_pushes, learning_sessions, snapshots`
`reports, audit_logs, app_meta`
详见 `docs/architecture.html` 的 ER 图与完整字段。

## 6. API 约定
- 统一响应 `{ ok: true, data }` / `{ ok: false, error: { code, message, details? } }`。
- 鉴权：`Authorization: Bearer <JWT>`；设备端独立令牌。写操作限流；`scrypt` 口令哈希；JWT HS256 + 会话吊销。
- 重要端点：`/api/auth/*`、`/api/curriculum/*`、`/api/plans/*`、`/api/agent/*`、`/api/registry/*`、`/api/community/*`、`/api/devices/*`、`/api/device/*`、`/api/analytics/*`、`/api/admin/*`、`/api/health`。
- 所有列表都返回游标/上限（默认 50），避免全表扫描。

## 7. 关键流程
**体系化课程**：公开课源（带 license/attribution）→ 管理员同步 → 课程包版本(checksum) → 映射到 framework/unit/lesson（含前置课时），导入幂等；平台内置课程同样以「框架→单元→课时（blocks JSON）」组织，确保无零散内容。
**AI 计划**：目标/频次/时长 → 取孩子进度 + 课程顺序 + 前置约束 → 生成 1–4 周计划 → 冲突检测（同日超时、跨学科失衡）→ 家长确认激活 → 生成提醒。**纠偏**：每日扫描逾期项 → 计算偏差 → 一键顺延到最近空档 → 写 `plan_adjustments` + 通知。
**智能体**：会话（可绑定专家）→ 消息 → 模型调用（工具调用最多 3 轮）→ 工具：查课程、建计划、改计划、生成课程草案、提交社区、检索公开课、沙箱执行、写记忆。无 API Key 时使用本地规划器并明确标注「离线智能」。
**沙箱**：`node:vm` 隔离上下文 + 800ms 超时 + 无 require/process + 输出截断；明确声明「非安全边界」，限家庭成员、限流。
**社区审核**：`draft → pending → approved/rejected`；关键词/联系方式/外链/长度/主题相关性评分；管理员复核写 `post_reviews`；只有 approved 进入 feed；作者可修改后重新提交。专家/技能公共发布同样走审核。
**多端联动**：家长生成 6 位配对码（10 分钟）→ 平板输入 → 设备令牌 → 家长推送计划 → 平板收件箱（轮询 + 页面可见时刷新）→ 开始学习 → 进度实时回传 → 家长看板/报告更新。摄像头：平板端显式「允许拍照」授权开关 + 拍照时的快门提示，照片仅同 household 可读，家长可删除。

## 8. 安全与合规
- 口令 scrypt + 盐；登录/注册/沙箱/AI 限流；安全响应头（CSP、nosniff、frame-ancestors）。
- 越权：每个资源查询都带 household 条件；测试覆盖跨家庭读取返回 404/403。
- XSS：前端统一 `esc()` 转义 + 模板不使用 `innerHTML` 拼接用户数据（白名单字段除外）。
- SSRF：连接器仅允许 http(s) + 域名白名单 + DNS 解析后拒绝私网/回环地址 + 8s 超时 + 响应截断。
- 上传：照片大小/类型校验，随机文件名，鉴权后读取，禁止静态目录直达。
- 儿童隐私：最小化采集；照片需设备端同意；提供删除；审计日志记录审核与导出。
- Prompt 注入：系统提示与用户内容分离；工具调用参数白名单校验；AI 输出不直接执行代码。

## 9. 测试与验收
TDD：先写集成测试（`node:test`，临时 DB + 随机端口），覆盖 认证/RBAC、家庭隔离、课程体系完整性、计划生成与纠偏、审核状态机、设备配对与照片权限、连接器 SSRF、沙箱超时、看板聚合、报告。目标 ≥45 用例；`npm test` 全绿是交付门禁。
Reviewer 门禁：① 设计评审 ② 后端代码评审 ③ 安全/权限专项 ④ 最终需求验收。评审记录在 `docs/reviews/`。

## 10. 部署
- 本机：`./scripts/start.sh` → `http://localhost:8080`（Node ≥24，无 npm install）。
- Docker：`docker compose up -d`（单容器，`./data` 持久化，内置 healthcheck）。
- 首次启动自动迁移 + 写入体系化课程与演示数据；演示账号见登录页。

---

## 11. v1.1 安全与交付增补（实现后修订）

> 以下是实现与两轮评审后对原设计的修订，实现为准。

1. **演示数据默认关闭**：`SEED_DEMO` / `DEMO_MODE` 均为显式开关，默认 `false`；Docker 默认不写演示账号。首次初始化 `POST /api/setup` 创建首位管理员（零用户时可用）。`./scripts/start.sh --demo` 或演示 Compose 才写入演示家庭。
2. **强制临时密码**：`must_change_password` 由服务端拦截（除 me/改密/登出/meta/health 外全部 403），前端不可关闭弹窗，改密后吊销旧会话并续登。
3. **沙箱模型替换**：不再使用“Worker + 宿主对象注入的 vm”。改为独立 Node 子进程 + `--permission`（仅允许读取 runner）+ 清空环境变量 + 上下文内创建的 console + 800ms/32MB 限制；**所有环境默认关闭**，`ENABLE_SANDBOX=true` 才启用。PoC（Math/console/global constructor）均被阻断，测试覆盖。
4. **儿童授权**：新孩子服务端默认全部 `false`；看板/报告需 `analytics` 授权（403 CONSENT_REQUIRED），AI 计划在无 `ai_processing` 时自动降级本地规则，智能体未授权时跳过第三方模型并对工具调用二次拒绝。
5. **提醒**：`GET /api/reminders/due` 只读，新增 `POST /api/reminders/dispatch` 消费；启动与每 6 小时补齐活跃计划未来 7 天提醒；文案使用真实分钟；日期按 Asia/Shanghai。
6. **删除权**：DELETE 请求解析 JSON body；孩子删除需 `confirm:true`；新增家庭创建者“彻底删除家庭数据”（无其他成员时），同时清理数据库、照片文件与会话；照片保留期清理同时删除磁盘文件。
7. **角色管理**：管理员可将家长设为教师（反之亦然），不能修改自己的角色，不能移除最后一位管理员。
8. **测试规模**：7 个套件 **67 个集成测试** 全部通过；`tsc --noEmit` 通过。

以上修订同步反映在 `docs/product.html`、`docs/architecture.html`、`docs/qa.html`、`docs/reviews/04-fix-log.md` 与 README。
