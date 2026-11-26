# 本地 UI/UX 审查技能

## common-family-ux
- 来源：https://github.com/HoangNguyen0403/agent-skills-standard/tree/main/skills/common/common-family-ux
- 安装位置：项目 `skills/common-family-ux/`
- 用途：每次评审区分家长端/儿童端，检查 parent gate、触控目标、对比度、去焦虑化反模式、AI tells。
- 本项目的应用记录：`docs/reviews/15-family-ux-audit.md`。

## kids-ux-design
- 公开 registry（skills.rest / SkillsMP / Tessl / GitHub 搜索）未找到同名、可核验来源的 `kids-ux-design` skill；没有使用伪造第三方包。
- `skills/kids-ux-design/SKILL.md` 是明确标注来源的**本地适配规范**，基于 common-family-ux 的 `references/child-surface.md` + `references/rubric.md`，用于儿童端 token/组件审查；后续找到可信来源再替换。

## 安装说明
- 项目内副本已随仓库提交，可在后续会话直接读取。
- 尝试复制到 `~/.dsh/skills/` 时被本机文件沙箱拒绝（Operation not permitted）；未绕过沙箱。DSH 当前技能目录也未挂载这两个名称，因此本次以仓库内 skill 文件作为审查依据。
