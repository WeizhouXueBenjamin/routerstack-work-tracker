# 可直接复制给 Codex 的起始 Prompt

我正在开发 `routerstack-work-tracker`，这是一个离线优先的 RouterStack 数据中心现场工作记录、理论收入估算、App 差额核对和集中结算结转工具。

请先完整阅读仓库的 `AGENTS.md`、`README.md`、`docs/PRODUCT_REQUIREMENTS.md`、`docs/DECISION_HISTORY.md`、`docs/architecture.md`、`docs/CODEX_AUDIT_AND_TEST_PLAN.md`、`docs/roadmap.md`，再审查 `index.html`、`src/app.js`、`templates/RouterStack_Tracker_V2_Blank.xlsx` 及现有测试。另有一份本地私有的 `FULL_CONVERSATION_HANDOFF_PRIVATE.md`，如在工作目录可读取，也请作为历史讨论的参考；其中的真实历史金额禁止提交 Git。

我最终确认的设计是三层：
- **Tool**：真正可录入的小程序，负责快速新增、编辑、异常提醒、按月统计、给 Tim 的对账清单、创建下一结算周期；
- **Work Log**：本地 XLSX 中唯一的原始记录来源，一项工作对应一个 Invoice ID，一天可有多项工作；
- **Config**：最低计费、AH 起点、倍数、Lunch、容差和规则/schema 版本。

核心优先级：1）最小化日常录入；2）独立估算收入以发现 App 漏算；3）结款时把**确认的**遗留未结金额带到下个周期。`Lunch (h)` 是数字输入、默认留空（新工作空白按0），不得恢复 Checkbox。`Billable (AH)` 合并显示，例如 `8.75 (1.75)`；内部仍需保存数值型工时。不要加入逐笔 Paid/Unpaid 维护、发票作废管理或把所有历史工作自动迁入新文件。

务必区分 Estimated、Extra Cost、App Displayed、银行到账总额、已核实的 Carryover Balance。由于结算经常只知道汇款总额，我需要向 Tim 查询才可能有某些 Invoice 明细；因此**不能通过差额推断某张 Invoice 已付或欠款**。现有 2h 最低计费、18:00 AH、1.5×和 Lunch 优先扣普通时段只是暂用的估算假设，未获实际计费规则确认。

第一轮只做审查与规划，**不要修改代码、模板或财务数据**：
1. 运行 `npm run check`，核实仓库、Workbook schema、当前功能是否符合最终需求，注明哪些功能已做、哪些仅是计划。
2. 逐项找出 P0/P1/P2 缺陷（尤其导出→重新打开的数据完整性、显式保存、固定 sheet XML 位置、跨日计费、周期结转、月度统计和 Tim 对账清单），给出源码定位和可复现的测试方案。
3. 提出最小修改、渐进迭代的路线图；对可能影响旧 XLSX 的变化给出版本兼容策略。不要引入没有必要的新框架、后端或云服务。
4. 列出必须向我确认的**计费政策**问题，不要把假设自动当作规则。

先提交审查报告与可执行方案，经我确认后再动手实现。所有示例与测试必须用虚构数据，真实工作表和付款记录不得进入 Git 仓库。
