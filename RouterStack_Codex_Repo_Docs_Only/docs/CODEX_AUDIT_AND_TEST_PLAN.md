# Codex 审查与测试计划（当前源码基线）

> 只针对实际 `src/app.js` 和 `templates/*.xlsx` 所支持的功能评估。先审查、保护数据，再迭代。不要臆造平台业务事实。

## A. 需要先阅读的文件

1. `AGENTS.md`, `README.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/DECISION_HISTORY.md`
2. `docs/architecture.md`（**现有 workbook 数据契约权威参考**）
3. `src/app.js`, `index.html`, `src/styles.css`, `src/template-data.js`
4. `templates/RouterStack_Tracker_V2_Blank.xlsx`
5. `tests/core.test.mjs`, `.github/workflows/ci.yml`, `package.json`

## B. 已验证的基础（不是对所有业务边界的保证）

- 截至交接：`npm run check` 的 6 项测试通过，之前另做过浏览器手工的新增→导出→重开→结转流程。
- 原始工具可以录入/编辑/删除；生成 Excel 并重开；检查重复 ID；差额提示/复制；确认金额结转。
- 现有测试**不足以保证**跨日计费、Excel 不同版本兼容、损坏文件恢复、大量数据或配置历史版本行为。

## C. XLSX 关键契约（v2.x）

- Sheet 顺序：`Tool`、`Work Log`、`Config`；XML `sheet2` 是 Work Log、`sheet3` 是 Config。当前解析器依赖文件内部固定路径；调整顺序有破坏风险。
- Work Log 行 5 为表头，行 6..305 为记录区，最多 300 项。
- 可见列：A Date，B Invoice ID，C Time，D Lunch (h)，E Rate，F Billable (AH)，G Estimated，H App Displayed，I Difference，J Note。
- 隐藏列：K Start，L End，M Record kind (`Job` / `Carryover`)，N Extra，O Confirmed balance，P Raw hours，Q Billable hours，R AH hours，S Raw AH，T Base estimate。
- Config `B5` min hours，`B6` AH start (Excel 日小数)，`B7` multiplier，`B8` tolerance，`B9` allocation，`B10` `2.x` schema marker。
- 导出从模板复制数据与公式缓存；修改模板后必须 `npm run template:sync`、`npm run check`。

## D. 特别需要审查的技术风险

1. **固定 sheet path 依赖**：目前不仅依赖列名，还依赖 `sheet2.xml`/`sheet3.xml`；若用户在 Excel 里调整 sheet 顺序可能错位或拒绝读取。考虑根据 workbook relationships 解析而非硬编码，但必须测试迁移兼容性。
2. **部分列头检查不足**：当前关键验证主要只读 `B5`/`F5` 和 Config B10，建议审查整体 schema 与原始值类型一致性。
3. **显式保存语义**：浏览器下载文件并不保证用户已实际保留到正确目录；当前流程有把 dirty 状态清空的情况。应让用户知道是否仍有未落盘修改，同时防止误覆写。
4. **公式/缓存一致性**：工具有 JS 计算，Excel 中有公式/缓存，需在 round-trip 后分别校验，并验证空白 App、零金额、carryover 的汇总语义。
5. **Lunch 影响时段**：当前先扣普通时段是假设；早晚工、跨午夜、最低 2h AH 需要合约核对后才能改。
6. **Billable (AH) 显示**：字符串如 `8.75 (1.75)` 只能展示；要验证隐藏数值字段、Excel 公式与 Tool 结果一致。
7. **当期汇总与结转混合**：Carryover 被计入当前“预期总额”，但不是本周期新完成工作的收入；UI/报表应明确区分。
8. **结算证据有限**：银行到账总额不能分配 Invoice；需要保持未核实/已确认的差异边界，不能自动猜哪笔已付。
9. **容量与版本**：超过 300 项要明确阻止或安全升级；旧 schema 和新 schema 之间需要明确兼容/迁移，不可静默重写。
10. **真实数据隔离**：工作簿、截图、发票在 gitignore；测试只用合成数据，避免复制用户真实金额到仓库。

## E. 最低回归测试矩阵（全部使用合成记录）

| Case | Expected |
|---|---|
| 普通短工，<2h | 账单最低 2h，明确 AH 处理假设 |
| 普通长工，Lunch 空白 / 0 / 0.5 / 1h | 分别正确；只扣一次，不因 >8h 自动扣1h |
| 18:00 之前 / 跨越 18:00 / 18:00 之后 | AH 计算正确，边界严谨 |
| 跨午夜、00:00 结束、同起止时刻 | 符合已定义的时长约束，非法输入应报错而非产生无意义金额 |
| AH + Lunch + Extra Cost | 估算、AH、附加费用三者独立且可追踪 |
| App 未填 vs App=0 | 未填 Difference 为 null；明确0产生正常差额 |
| 同日两项工作，两个 ID | 同日允许多项；若重复 ID 拒绝 |
| 缺少 ID 时新增，后来编辑补齐 | 允许保存，后补验证；不能自动伪造 ID |
| 新增、编辑、删除、搜索、保存、再次打开 | 每个输入和计算字段完整，按记录逐条比较 |
| 结算后未选择任何 Invoice | 允许明确确认后生成空白新周期 |
| 确认某 ID 部分余额并结转 | 新周期只有这笔 Carryover 的确认余额，旧文件保持不变 |
| 连续两次结转同一旧 Invoice | 不重复计为新工作、金额不自增或丢失 |
| 历史文件 / 非法文件 / 换列 / 换 Sheet 顺序 | 拒绝破坏性读取或有明确版本迁移 |
| 金额精度、浮点尾差、负数、空值 | 货币2位小数；不把浮点噪声报为差额 |
| 结算总额与逐笔不对应 | 无凭据时“待核实”，不能自动确定具体漏付 |

## F. 建议后续工作顺序

P0：保存/重新打开的数据完整性与防丢失；schema 完整性、版本兼容、测试；计费假设显示清楚。

P1：提高快速录入效率（默认日期、近期费率、快捷输入但不可假定实际值）；差额/缺失提醒；简单月度统计（按日期跨周期时明确口径）；可复制给 Tim 的核对清单；更清晰的周期结转回顾与确认。

P2：结算记录证据的轻量化保存（银行收到总额、待查差额、Tim 反馈、确认金额）；可读的审计历史；更健壮的 XLSX schema 管理。

P3：有真实需求后再评估 Pages、框架或数据库。不要提前上线真实工作记录或云同步。

## G. 验收原则

- 未证实的实际 Invoice/日期/金额不得编造或自动填充。
- 每项用户输入在导出、重开、编辑、结转后保持一致；不无声丢失或篡改。
- 新增工作**不要求手动在 Excel 加一行**。
- 计费依据和 App 差额可解释，日常输入最少。
- 结算结转只带具体已确认金额，不能“银行实收差多少就随便分给某 Invoice”。
- 对已有数据契约的调整必须附兼容测试、迁移说明、变更记录。
