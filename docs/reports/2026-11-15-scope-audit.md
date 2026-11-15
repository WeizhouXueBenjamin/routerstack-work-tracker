# 2026-11-15 范围审计与文档整理报告

时区 Pacific/Auckland。先依据用户《Documentation Alignment & Project Scope Reset》校准范围，再按用户“分类历史文档、报告与当前工程文档并精简”的要求合并整理。两步均只改文档，不实现功能、不改 schema/算法、不迁移用户数据。

## 依据与实现核对

审计基线：feat--v0.1，HEAD ce72aa53590f82e2783716ee90d9130c9a2249ac，工作区已有未提交 v0.5.0/schema 4.0 实现。阅读原 19 份项目 Markdown，核对 index.html、src/ 中交互/计算/报表/读写/对账、相关测试、package.json、Playwright 与 CI 配置；未用真实财务数据。

| 核对项 | 证据与结论 |
|---|---|
| 估算、App 空白/0、提醒、月度与清单 | core.js、reports.js、core/reports 单元测试；Estimated 与 App 独立，提醒从当前数据派生 |
| 连续录入 | app.js 的 fields、clearForm、submit：已清专属字段，但日期重置今天、Rate 清空；不是完整快录 |
| 默认费率与最近文件 | reconciliation.js 有 entrySettings.defaultRate 存储/校验，app.js 未接入；openBtn 只选文件，无跨会话重开机制 |
| 键盘体验 | 原生 Tab/提交已有；连续焦点、输入法、编辑后上下文缺专用验收 |
| 银行/App/问题 | reconciliation*.js、相关单元/浏览器测试：到账可独立登记，App 修正不生成银行款 |
| 保存与换期 | app.js、workbook*.js、buildCarryForwardPlan/carryForward 及测试：完整 Bundle、防覆盖/草稿/下载确认、两次结转；当前仍携带无批次覆盖工作 |
| 版本与环境 | 本地 0.5.0 / schema 4.0 / calculation 3.0；classic scripts，CI 配置存在，远端结果未验证 |

## 冲突裁决与现有影响

| 原冲突或冗余 | 当前裁决 |
|---|---|
| 先批次/分配再快录；校准稿仍把批次/人工分配当未来选项 | 用户最新要求为轻量核对、快录优先；批次与 Invoice 分配退出默认范围，不自动排队实施 |
| 自动余额/结算比较被当债务结论；银行到账要求复杂归属 | 日期/金额/可选备注单列；余额来自人工确认，App 差异不是欠款，不据总额推断付款 |
| 旧交接只结转确认余额，A3 又带所有无核对覆盖工作 | 目标为未解决问题/确认余额/提醒来源；当前广泛携带行为如实保留，不能靠改文档宣称已简化 |
| 三层被理解为三张 Sheet | 职责分离；当前六张 Sheet 和旧格式继续兼容，不重设计 |
| 默认费率与 Site/预设/Pending/更多模式捆绑；最近文件缺失 | 快录只纳入明确优先项，Site/预设/复杂待补/其他模式暂缓；字段存在不等于表单完成 |
| 旧“全部未确认”与新“用户选择模型”又混为官方条款 | 保留历史模型选择，不改算法；真实费率、税费等仍未知，代码测试不证明官方政策 |
| 计划勾选/历史全套结果当本轮完成；多份“最终需求”竞争 | 状态依据代码与适当测试；当前要求只在 Goal，报告/历史不授权，旧 Prompt 撤下 |
| README 建库教程和多份范围/实施细则重复 | 保留使用说明，合并目标+要求、路线图+验收；分类结果见下表 |

兼容约束：不删 batches/scope/allocations，不重算 CarryBalance 的 paidAtConfirmationCents/balanceReferences 基点；保留 App observations、issues、audit/changes、RS_Integrity；Pending/Historical/Opening 保留原周期，不计新收入。若未来调整批次覆盖条件，先明确问题延续/解决和全部引用保全。最近文件便利引用不取代显式保存，筛选不缩小导出。无未解决的业务冲突需要本次猜测；浏览器机制和真实默认费率继续未定。

## 范围审计阶段实际验证

这些测试在前一轮范围审计时已执行；本次目录分类与合并未重复运行应用测试。

| 检查 | 结果/边界 |
|---|---|
| npm run check | 53/53，语法、两份内嵌模板一致性及全部单元测试通过 |
| Chromium 针对性回归 | 3/3；真实下载/重开/连续两次结转、银行关系保留、App 修正；页面错误和 HTTP(S) 请求为 0 |
| 完整浏览器、Chrome/Edge、桌面 Excel、远端 CI | 此次范围审计未重跑；旧结果只见[历史报告](validation-history.md) |
| 前一轮文档核对 | 当时 19 份 Markdown、85 个本地链接有效，差异检查通过，41 个非文档文件哈希一致 |

实际浏览器命令：

~~~powershell
npx --no-install playwright test tests/browser/tracker.spec.mjs tests/browser/reconciliation.spec.mjs --grep 'offline add|bank-only evidence|App correction resolves' --workers=1
~~~

三个场景分别为新增→保存→重开→两次结转、bank-only evidence/unknown basis/partial payments 往返、App correction/observation revisions。第一项确认余额由合成内存命令夹具建立，不能声称该项覆盖人工确认 UI；复杂流程测试只作为兼容证据，不代表继续扩建。

## 文档分类与合并映射

| 原路径/材料 | 当前去向与处理 |
|---|---|
| CODEX_START_HERE.md | [docs/README.md](../README.md)，统一分类入口 |
| RouterStack_Project_Goal_Reset_for_Codex.md + PRODUCT_REQUIREMENTS.md | [PROJECT_GOAL.md](../PROJECT_GOAL.md)，合并目标/流程/行为/范围/假设 |
| DEVELOPMENT_PLAN.md + roadmap.md | [roadmap.md](../roadmap.md)，合并状态/下一任务/验收 |
| architecture.md | [architecture.md](../architecture.md)，保持全部实际格式、规则、关系和保存语义 |
| CODEX_AUDIT_AND_TEST_PLAN.md + VALIDATION_REPORT.md 的本轮部分 | 本报告，合并裁决/实现差距/验证与影响；日常验证要求归 AGENTS/roadmap |
| A1_A3_EXECUTION.md + VALIDATION_REPORT.md 的历史部分 | [validation-history.md](validation-history.md)，合并历史证据，保留原正文/版本/限制 |
| architecture-v3.md、DECISION_HISTORY.md | [archive/architecture-v3.md](../archive/architecture-v3.md)、[archive/decision-history.md](../archive/decision-history.md)，旧契约及决策追溯 |
| 原交接目录六份 Markdown | [archive/handoff-2026-11-07.md](../archive/handoff-2026-11-07.md)，保留独有历史要点，去除重复要求和可执行旧 Prompt |
| 根 README.md、AGENTS.md | 保留根入口，缩短说明并更新全部引用 |

原交接目录只合并指定 Markdown，不移动或删除任何其他文件/私人资料。整理后仅一份产品目标、一份实际契约、一份路线图，报告和历史按需查阅；不再保留旧路径跳转副本。

分类收尾检查：项目 Markdown 从 19 份收敛为 11 份，总字符数减少约 43%；55 个本地链接及全部 Markdown 差异检查通过（含新路径）；41 个非文档文件 SHA-256 前后一致。仅改文档，未重跑应用测试，未提交、推送或发布。
