# 星芽 v1.4 · Gap 修复计划（P0/P1 优先，P2 顺手）

来源：`docs/reviews/11-implementation-gap-review.html`（55 项：3 P0 / 19 P1 / 33 P2）。
原则：先修「承诺与行为相反」与治理/证据 P0；P1 按体验影响排序；P2 能改代码就改，纯文档夸大则改成诚实表述。每项配可执行断言。

## Phase 0 · P0 止血
1. 审核规范化：删除全部 Unicode 格式字符（含软连字符）、所有分隔符/标点压缩、简繁/形近归一、域名/联系方式/分隔手机号；补负向测试。
2. 教学模态：为智趣思维、蒙氏工作补听/说/读/描等真实 block；文档改为「所有课时含听说，读写弹按学科」，并加数据断言。
3. 浏览器 E2E：新增可运行 `scripts/e2e.mjs`（CDP），覆盖登录→首页→儿童空间→课程/课时→计划；`npm run e2e`，截图写入 `docs/e2e/`；QA 只引用可复现命令。

## Phase 1 · 核心体验 / 治理 P1
4. 课程元数据与前置：migration v6 增加 key_points/hard_points/home_extension/prereq_lesson_id；回填并 UI 展示；计划排课尊重前置。
5. 公开课：真实 sha256 checksum；非 demo 首次导入 quarantine（不 autoApprove）；保留旧版本快照，approve 原子生效。
6. 计划：source 按实际 engine；首项也受 minutesPerDay 约束；草稿纠偏不生成提醒；skip 版本 +1；顺延避让其他计划；报告 adherence 按范围。
7. 生态：技能 definition 进系统提示 + 专家表单技能选择；已安装连接器动态进入工具表；公开 registry 内容过 moderateContent；私有专家可选。
8. 社区：评论进审核队列 + 管理端通过/拒绝/隐藏；审核台隐藏入口；审核通过率/时长 KPI；URL/域名识别；跨租户 403/404 统一。
9. 伙伴：missing 台词；装饰按 inventory 渲染、玩具效果生效；sad 可达或删；儿童字号≥16、触控≥48；彩虹显示；计划庆祝用真实伙伴；披风不再公开售卖/证书视图；重复学习给伙伴反应；贴纸数标签修正。
10. PWA：完整 precache（views/assets/device）、device 注册 SW、PNG 图标/安装引导；对比度/焦点/触控目标；320 特化。
11. 度量：product_events + 5 个事件；后台 D7/计划完成率/审核 KPI。

## Phase 2 · 清理与文档一致性
12. DESIGN.md 归档为历史；六种情绪/测试数/路由数/E2E 表述统一。
13. A7/A8/A9、B4-B9、C4-C9、D5-D8、E5-E10、F4/F5/F8/F10 逐项修或删除夸大文案。
14. 每阶段 reviewer #11（方案/UX）、#12（代码/安全）、#13（最终验收）记录。

## 验收命令
- `npm test`（新增审核变体、模态覆盖、元数据、评论审核、计划约束、伙伴、KPI 断言）
- `npx tsc --noEmit`
- `npm run e2e`（需要本机 Chrome + 服务；脚本自动检测）
- 浏览器 390/320、儿童空间、家长解锁
