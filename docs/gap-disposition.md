# Gap 处置台账（v1.4）

来源：`docs/reviews/11-implementation-gap-review.html`（55 项）。状态：**code** 已改代码并有断言；**doc** 已把夸大承诺改成真实边界；**delete-claim** 删除无法兑现的宣称；**partial** 已做最小闭环，剩余为已声明边界。

| ID | 处置 | 证据 / 说明 |
|---|---|---|
| A1 | code + doc | 思维/蒙氏/钢琴/汉字补听/说 block；文档改为「所有课时含听说，读写弹按学科」；`gaps.test.ts` |
| A2 | code | 迁移 v6 key_points/hard_points/home_extension；家长课时页展示；儿童端隐藏 |
| A3 | code | prereq_lesson_id 回填；课程页不再空谈「前置关系」；后续可接入排课约束 |
| A4 | code | `lesson_versions` + 真实 sha256；`course_packs.checksum` 64 hex |
| A5 | code | 非 demo/test 首次导入 quarantine；测试/demo 192，生产 180 + 待审 12 |
| A6 | code | 新版本暂存 lesson_versions，旧课时保持在线；approve 原子切换 |
| A7 | code | 设备课时返回来源/许可证并展示 |
| A8 | code | 词卡 TTS 按学科 language（英语 en-US，其余 zh-CN） |
| A9 | doc | intro 时长按真实 minutes；描红不宣称笔顺数据 |
| B1 | code | plans.engine 落库；无 Key 显示本地规则，不再冒充 AI |
| B2 | code | 单课超上限单独安排并写 note「超过每日」；不再承诺「不超过」 |
| B3 | code partial | product_events 5 类 + 后台 D7/计划完成/审核 KPI；更细漏斗为后续 |
| B4 | code | 只有 active 计划生成提醒 |
| B5 | code | 6 天/周理由改为「周日留白」 |
| B6 | code | skip 也 version+1 |
| B7 | code | 顺延叠加其他 active 计划占用 |
| B8 | code/doc | 提醒按计划/日期；跨计划聚合为已知边界 |
| B9 | code | adherence 按报告起止日期 |
| C1 | delete-claim | 连接器改为「家长手动调用，不进入儿童模型工具表」 |
| C2 | code | 技能 definition 进入系统提示；专家表单可选技能 |
| C3 | code | 公开专家/技能/连接器过 moderateContent |
| C4 | doc | 两种 agent_kind 提示词相同，文档不再暗示不同人格 |
| C5 | doc | 工作区版本仅为覆盖计数，不宣称历史/回滚 |
| C6 | code | remember/save file/sandbox 写审计 |
| C7 | doc | 调用日志按 owner 过滤；安装者 UI 入口为后续 |
| C8 | code | 会话专家下拉合并家庭私有专家 |
| C9 | code | search_curriculum 学段过滤生效 |
| D1 | code | 全 Unicode 格式字符/标点压缩/繁体/sha 变体；8 负向断言 |
| D2 | code | 评论 pending + 管理员评论队列 |
| D3 | code | 审核台隐藏按钮；通过率/平均时长 KPI |
| D4 | code | 域名识别（taobao.com 等）进入复核 |
| D5 | doc | 跨租户孩子存在性返回 403；统一 404 为后续边界 |
| D6 | code | 无 EventSource 时也启动 30s 轮询 |
| D7 | partial | 批量 API 已存在；Web 批量选择为后续；设备文案已去「实时监控」暗示 |
| D8 | code | 常见繁体/形近字归一 |
| E1 | code | moodLine missing = 「想你」 |
| E2 | code | 房间按 decor inventory 渲染；玩具参与玩耍效果 |
| E3 | code + doc | 删除不可达 sad；文档统一五种可观察情绪 |
| E4 | code | 儿童字号 ≥15–16px、触控 ≥48px |
| E5 | code | 彩虹解除 display:none |
| E6 | code | 计划庆祝使用孩子真实伙伴 |
| E7 | code | star-cape 仅计划奖励，商店不售 |
| E8 | delete-claim | 改为庆祝层纪念卡，删除独立证书宣称 |
| E9 | code | 重复学习给伙伴心情反应 |
| E10 | code | 儿童顶栏改「🏅 贴纸数」 |
| F1 | code + doc | 新增可选 `scripts/e2e.mjs`（10 项 CDP 断言）+ 人工清单；不再宣称 CI 必跑 |
| F2 | code | SW precache 视图/资产/device；网络优先 |
| F3 | code | device.js 注册 SW；独立设备壳可缓存 |
| F4 | delete-claim | 文档改为居中模态，不再宣称抽屉 |
| F5 | delete-claim | 删除骨架屏宣称（仅照片占位） |
| F6 | code | 焦点环 #4338ca（对比度达标） |
| F7 | code | muted 加深到 #5b5f6c |
| F8 | code | .btn min-height 44px；儿童 48–56px |
| F9 | partial | PNG 图标 + manifest；beforeinstallprompt 引导为后续 |
| F10 | partial | 320/390 实测；专项截图脚本为后续 |

## 剩余边界（诚实声明）
- 生产公开课需管理员审核；演示/测试自动发布。
- 连接器手动调用；不注入儿童模型工具。
- 跨租户孩子 ID 仍返回 403（不泄露内容，但泄露存在性）；统一 404 需改动现有 API 契约。
- 批量照片删除 API 有、Web 批量 UI 未做；Web Push/离线课时包在路线图。
- 浏览器证据为人工清单，不是自动化；CI 可后续加 Playwright。
