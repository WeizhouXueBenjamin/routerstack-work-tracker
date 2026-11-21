# 编码助手开发约束

项目：RouterStack Work Tracker。工程文档默认用中文，根 README 用英文；代码保留 English technical identifiers。

## 阅读顺序与权威

先读 [README.md](README.md)、[Project Goal](docs/PROJECT_GOAL.md)；涉及模型、计算或文件读写，再读 [architecture.md](docs/architecture.md)。[roadmap.md](docs/roadmap.md) 只描述后续方向。

产品范围以 Goal 为准，实际格式以 architecture 为准，本文件定义开发操作与验证要求。报告、旧计划、路线图和测试通过不构成额外开发授权；当前用户明确指令优先。

## 修改边界

- 修改前核对 git status、HEAD、实际代码和相关测试；保留无关未提交内容。
- 优先级：数据完整性 > 可预测的 Excel 兼容性 > 录入便利 > 样式。文档整理不授权业务重构、功能恢复或数据迁移。
- 遵守 Goal 的核心目标、金额边界及暂缓范围；新增功能先回答服务哪个目标、现有功能为何不足、增加多少输入或维护负担。
- 用户保存／上传的 XLSX 是唯一持久事实来源，Tool 是唯一业务编辑入口。不读取或提交与任务无关的真实财务资料，不编造工作、费率或付款；测试仅用合成数据。
- 保持 WorkbookState、schema 5.0、calculation 3.0、四 Sheet／八 Table 及现有数据保护。旧 2.0–4.1 明确拒绝，不加迁移或旧版入口，不修改用户旧工作簿。结构变更须先说明格式影响并补兼容验证，不静默降级或截断。
- 保持离线 HTML／JS／JSZip；未经批准不引入 API、追踪、远程存储、自动上传或运行时联网依赖。最近文件引用不能成为第二份工作账本。
- UI 仅验收 1366×768 和 1920×1080；不恢复手机布局、移动断点或触控优化。视图与抽屉操作保护草稿和键盘操作；工程整理不改变 UI／UX。
- 显式保存前不算持久化，下载不等于保留成功；失败／取消不清草稿，确认旧快照不清新修改。保存冲突、归档和结转保护以数据契约为准。
- 应用版本与 schema／calculation 独立。调整前检查 tags／Releases；未发布版本可以按用户指令整理，不覆盖已发布版本，不制造历史 Release／Changelog。
- 不自动提交、推送、创建 PR、发布 Release 或部署。

## 验证与交付

- 工程脚本／配置调整运行 `npm run check` 及受影响的检查；文档核对本地链接、文件引用和命令。交付前运行 `git diff --check`。
- 解析／导出／保存／结转变更必须运行 `npm run check` 和浏览器新增 → 保存 → 重开 → 连续两次结转；涉及原生文件句柄再运行 `npm run test:native`。
- 模板／公式／schema 变更另运行 `npm run test:excel`，验证桌面 Excel 重算、整表排序／筛选／保存 → Tool 重开 → 再导出及两次结转。
- UI 变更只检查两个桌面视口及相关键盘／草稿行为。需要截图时用 `npm run capture:desktop`，产物留在忽略目录。
- 完成状态依据本轮实际代码和适当测试；未运行标“未验证”，历史结果不算本轮通过。原生句柄、mock、桌面 Excel、远端 CI 和发布证据分别表述。
- 交付列出文件变更及删除理由、实际验证、版本结果、未解决问题和建议 Commit／PR 文案；保留可审阅 diff。
