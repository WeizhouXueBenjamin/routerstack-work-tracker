# 架构与 XLSX 数据契约

当前本地未提交实现 v0.5.0 / schema 4.1，计算版本 3.0；精确只读兼容 2.0/3.0/4.0。本文描述实际接口和历史兼容，产品目标见 [PROJECT_GOAL.md](PROJECT_GOAL.md)，实现状态见[路线图](roadmap.md)。

Tool / Work Log / Config 是职责分离，不限定 Sheet 数量。现有六张 Sheet、批次/Invoice 分配、余额派生与审计保持完整兼容；这些不再是扩建方向，4.1 选择性结转保留被选事项需要的完整关系；旧 4.0 关联图算法仍供兼容校验。旧格式契约见 [archive/architecture-v3.md](archive/architecture-v3.md)，验证证据见[报告](reports/validation-history.md)。

## 运行与数据权威

`index.html` 由 classic scripts 组成，支持 Chrome/Edge 的 `file://`，没有远程请求、后台、自动上传或 XLSX 自动保存。IndexedDB 的 routerstack-file-reference / recent / current 仅存 {handle,name,writable}，不存工作数据或 XLSX 字节。权限或存储失效时重新授权／选择，重开读取实际磁盘文件。最新保留的 XLSX 是实际事实的唯一持久来源。真实数据不进入仓库；测试只用合成数据。

- `core.js`：2.0/3.0 计费、校验及 Excel 公式。
- `reconciliation.js`：完整 Bundle、稳定 ID、原子业务命令、金额约束、App 历史、审计和跨期关联图。
- `workbook.js`：旧格式适配器及共享 XML/公式解析；`workbook-v4.js`：4.0/4.1 严格读写及公共 facade。
- `app.js`：工作输入、导入预览、显式保存及周期；`reconciliation-ui.js`：银行、批次、关联、问题和证据操作。
- `recent-file.js`：仅存最近文件便利引用；`review-ui.js`：轻量提醒、历史来源与人工事项。
- `reports.js`：当前文件新工作的月度视图与 Tim 清单。历史工作不参加新收入汇总。

Estimated、App Displayed、实际 Bank Payment、确认 CarryBalance 分开保存和展示，不合并成欠款。App 修正不确认付款，批次核对不产生 Invoice Paid。

## WorkbookBundle 与版本

Bundle 顶层固定为 `schemaVersion, calculationVersion, cycleId, fileId, fileVersionId, parentFileVersionId, sourceName, tables, audit, changes`。公共 `TrackerWorkbook.read(input)` 返回版本信息及完整 `bundle`（旧版为只读 records/config），外部 Excel 原始输入变化还返回待确认 `changes`。`write(bundle, options)` 接受完整 4.0/4.1 Bundle（4.0 写入仅供兼容验证，界面须升级另存），拒绝仅传 records 数组，以免漏导出结算资料。

业务实体使用 UUID v4；编辑、Invoice 改号、排序与结转不改变 RecordID。Invoice 在逻辑工作间唯一，可空；同一天允许多项。新周期/文件使用新 ID，历史实体沿用原 ID。内存新建没有实际导出版本；writer 为实际文件生成 FileVersionID，并记录上一实际版本。下载须人工确认保留，才能作为新周期来源。

旧 2.0/3.0 均只读，用户显式查看同组原始输入的旧/新计费结果后升级为 4.1，另存新文件。2.0 使用午夜截止旧算法展示，升级按确认的 06:00 AH 结束。没有的历史观察日期、原始工作或银行明细保持未知，不补造；迁移后的期初余额不是原 Invoice 全额或付款证明。不批量合并历史文件。

## 当前 schema 4.1：六个 Sheet 与命名 Tables

以下是当前 writer/模板的物理契约，不是三层架构的 Sheet 数量要求。按顺序保持前三张 `Tool / Work Log / Config`，追加 `Reconciliation / Entries / History`；共 20 个命名 Excel Tables。读取按 workbook relationships、Sheet 名称和 Table 名称定位，不固定 ZIP 路径，支持 Excel 保存、shared formulas、整表排序、稀疏空行。

| Sheet | Table / 数据 |
|---|---|
| Tool | RS_Workbook：版本、文件及当前周期身份；汇总区 |
| Work Log | RS_WorkLog：本期 Job，A5:V305，最多 300 项 |
| Config | RS_rules、RS_entrySettings、RS_ratePresets |
| Reconciliation | RS_payments、RS_batches、RS_scope、RS_allocations、RS_confirmations、RS_balanceReferences、RS_issues、RS_evidence |
| Entries | RS_cycles、RS_records：全部保留来源，含 Pending/Historical/Opening 与 Work Log 原始输入快照 |
| History | RS_observations、RS_origins、RS_Audit、RS_Changes、RS_Integrity |

精确的全部列名、类型和顺序定义在 `TrackerReconciliation.TABLES`、`auditFields/changeFields` 及 `workbook-v4.js` 的 metadata/integrity 字段中。它们直接生成可审查的 Excel 列；关键金额和关系不放进隐藏 JSON 或批注。受控表须由 Tool 修改，Excel 可查看、筛选和排序，不能直接改内容；直接改受控表会拒绝导入。

Work Log A:T 延续 [3.0 列契约](archive/architecture-v3.md)：A 日期、B Invoice、C Shift、D Lunch、E Rate、F Billable(AH)、G Expected、H App、I Difference、J Notes、K Start、L End、M Entry type、N Extra、O Carryover、P:T 计算辅助列。4.0 Work Log 仅存本期 Job，旧 Carryover 改存 Entries 的 Opening；追加 U RecordID、V Site，K:V 隐藏。整张 Excel Table 包含 U/V，排序必须覆盖整张 Table，不能只挪动 A:T 而拆开身份。

Config 原单元格 B5:B10、B16:B17 保留，B10 为 4.1；B17 是兼容的计费规则快照，透明 RS_rules 才是受控规则记录。Default Rate 由 Tool 通过完整 Bundle 原子命令设置；未配置留空，仅用于下一笔，单次覆盖及改默认均不改历史 Rate。Rate Presets 仍仅兼容、暂缓扩建。

## 字段、金额与规则

- 金额关系表用整数 **NZD cents**；付款/分配必须有限正数且最多两位小数；确认金额允许明确 0。未知为 `''`，不是 0。行中的比例、原始 Rate/App/Extra 为数值。日期为有效 YYYY-MM-DD，操作时间为含时区的 ISO 时间；证据确认日期支持日期或时间。
- records.state 为 Job/Pending/Historical/Opening。Job 属当前周期；Historical 保存原周期及当时规则；Opening 只保留旧文件确认期初余额，不虚构原工作。Pending 的未知工时/理论金额/差额为空；补齐转正保留 ID，跨期补齐成为 Historical，不算本期收入。
- 计算规则沿用 3.0（历史决策记录载明用户选择的估算模型，不是本轮重新确认的官方政策）：每日 AH 18:00–次日 06:00、1.5×、最低 2h；Lunch 普通优先，再扣 AH；最低补足按扣 Lunch 后普通/AH 占比分配。以钟面分钟计算跨午夜，内部小时不提前舍入，基础、加 Extra、差额分步两位小数。实际配置来自文件。
- App 只有实际变化才添加 observation：原/新金额、观察与系统时间、来源、备注、Invoice 快照及当时计算规则、理论/差额。金额不变的保存/查看不创建金额历史。可以修订观察资料并另留审计，不能重写旧金额快照或系统时间。历史缺日期仍为空。
- 4.1 自动提醒只由当前资料派生，没有独立 Open/Closed 状态或人工关闭操作。原 4.0 App 问题的 ID、状态与变更链继续兼容保留；新提醒不依赖它们。150→180 的原 30 差额保留在 observation，独立付款问题不关闭。

## 兼容实现：银行、付款关联和确认余额

到账只需日期、实际金额，备注可选，不要求 Batch/Invoice。同日期同金额提示重复；明确确认是另一笔才添加，不自动合并。单笔到账最多一个有效批次，一个批次可含多笔到账。没有自动匹配、按日期推断、银行拆分到多批或自动分摊。

关联付款前明确选择 payment、batch、record，Invoice 必须已知，并填写原因或证据摘要。可以在范围/口径未知时关联部分付款。银行有效分配总和始终不得超过实际到账。未知应结总额时，超过理论仅提示；人工确认 Payable 后是已知上限，已确认历史余额也约束新增付款关联。后来确认的上限低于既有付款时，保留付款事实、提示异常并要求相关批次复核，不截断旧分配。Opening 不是原 Invoice 全额，应结总额仍显示未知。撤销标记 Reversed，保留原行与审计。

CarryBalance 确认保存 `paidAtConfirmationCents` 及已反映的 allocation IDs/cents。之后剩余 = 确认余额 −（当前有效关联 − 已反映关联）；连续结转不重复扣历史付款，撤销也按有效净额回算。Opening 的基点为旧文件的确认期初余额。已验证的 Balance 来源在批次级核对/解释关闭后不再作为余额重复结转；这不创建逐笔 Paid，重开会恢复待核对来源。

## 兼容实现：批次核对与接续（不作为新开发方向）

scope 行保存 Theory 或人工确认 Balance，含计算金额、confirmationId 和 sourceScopeId；同一来源全额/余额不能同时纳入，同一来源不能在多个开放比较重复占用。未确认 scope/basis 时 Expected 和 Difference 为未知，不以零替代：

`Expected Settlement = 选定理论金额 + 选定确认历史剩余`

`Actual Settlement = 本批次有效银行到账总额`

`Pending Settlement Difference = Expected − Actual`（不是已确认欠款）。

用户确认范围、金额口径和完整到账，并明确填写核对日期/原因或摘要后，匹配批次可手动 Reconciled；无逐笔证明仍足够，银行不重复变成 Unallocated。非零差额可凭依据 ClosedExplained，仍展示原差额，不能称金额匹配。独立 Invoice/App 争议继续开放。关闭/重开都留审计。后补逐笔证据只增加关联，不新增银行收入。已关联原始字段/应结依据更正需预览影响，旧分配及旧 scope 保留，相关批次 ReviewRequired。

旧待核对差额默认仅作参考。继续原批次无需创建第二份余额；如需接续新批次，先确认真实剩余并凭处理依据解释关闭旧比较，再把同一 RecordID 的确认 Balance 纳入新批次。新 scope 自动引用该来源上个关闭比较的 sourceScopeId，旧差额只保留历史，不再次合计为追款。不能重复纳入旧工作理论全额，也不能把已核对余额再次纳入。

证据保留确认日期、原因、摘要、来源、引用和创建时间，不嵌附件，不自动访问路径/链接。修订证据另记字段前后值。

## 审计、完整性与 Excel 编辑

所有 Tool 命令先在完整 Bundle 副本中原子执行，检查约束后添加事件及逐字段 Changes，再严格校验回放。审计含来源文件、原始顺序、系统时间、原因与证据；Change 含实体、字段、原/新类型和值。可在界面查看完整审计及字段变化。

RS_Integrity 使用规范化受控表的 SHA-256，导入还校验类型、引用、ID、分配上限、精确表头/版本、计算公式（含 shared formulas）与完整审计回放。它用于检测意外修改/损坏，**不是防恶意篡改的数字签名**。缺关联、事件、公式或不支持的自定义公式均明确拒绝，不静默修补。原文本保留首尾空白/换行，排除 rPh 注音提示；字符串按文本存储，不执行输入里的公式。

Excel 仅修改 Work Log 原始字段与 Config。读出与受控快照的差异作为 proposal，先显示字段前后值和理论变化；取消不改变当前资料和草稿，接受后添加来源与变更审计。已关联记录/规则变更保留原付款与比较快照并要求复核。尚未确认 proposal 的旧 Bundle 不能导出，防止写回旧快照。管理表直接修改、未知数据区域/结构、超过第 300 条记录都拒绝。

## 当前保存和完整跨期行为

分别跟踪工作草稿、对账输入、周期资料、内存修订和导出版本。保存/切换/复制前必须提交或明确取消草稿；导入失败保持当前数据和输入，导入替换需确认，离开页面提醒。导出用完整快照且阻止重复导出；导出期间后续工作修改仍未保存。

Save 显式写回允许写入的当前句柄；写入前、createWritable 后及临时写入后 close 前，对实际文件 SHA-256 与打开／上次成功写入基线比较，冲突中止并保留输入，不自动合并。Save As 另存带时间的新版本，会话持续保护曾打开/导出的归档句柄。无句柄／旧格式升级使用另存；新周期来源在生成确认后受归档保护。直接写文件等待 write 与 close 成功，失败/取消保留内存和输入；下载只表示已发起，用户确认保留后才清除对应版本提醒。下载旧快照的确认不清除新修改。

4.1 只为选定的自动跟进、人工事项、确认余额及必要兼容资料保留来源；不会仅因未进入旧批次核对而把全部匹配工作带入。

新周期前先保存并确认当前周期；名称必填，日期范围可选。结转预览按允许类别选择自动跟进，人工事项与确认余额独立选择；确认余额默认勾选，排除时单独提示并确认。Pending、开放旧批次、未核对银行和金额异常继续兼容保留。排除不表示解决，旧周期完全不变。通过关联图保留必要的原工作/规则/App/付款/撤销/证据/审计，剔除无关已解决记录；审计只保留关联实体完整变更链，来源事件 ID 与原始序号不变，本文件顺序连续。结构/引用/账本矛盾阻止导出，真实业务不确定性正常携带。

新 Work Log 空白，旧 Job 变 Historical，来源 ID/周期/金额不变。生成文件后旧周期仍打开，需打开新文件继续。新文件不依赖旧路径、附件或外部公式。连续两次结转不增加收入/付款或重复扣减余额。

## 模板与验证

4.0 模板由 `scripts/generate-v4-template.mjs` 生成，`npm run template:sync` 内嵌；模板不带业务实体、周期或文件身份。旧 2.0/3.0 模板和 core 计算保留。任何 schema/解析/导出变更都运行 `npm run check`、浏览器新增→保存→重开→结转，以及 Windows 桌面 Excel 往返。实际证据、限制及未验证部分记录在[验证历史](reports/validation-history.md)，CI 只验本地可重复的语法/模板/单元/浏览器测试，不声称覆盖桌面 Excel。

沿用本工具单个 XML 文本的解析容量保护，阈值为 16×1024×1024 个 JavaScript 字符串 length 单元。4.x 导出也先检查同一上限，超限明确拒绝并保留内存，不能生成本工具无法重开的文件，也不会截断历史。此限制独立于本期 Work Log 的 300 条数量限制；积累大量历史或超长文本时仍受 XML 容量约束。

## 4.1 最小扩展与提醒范围

P1 前已核对两项必要性：现有 `confirmations.cents` 是明确确认金额，`allocations.cents` 是付款关联，`issues` 无可空参考金额；`records.state` 与旧 App Issue 状态也不能表达允许检测的类别、背景与明确排除。故只在原表末尾追加：

| 表 | 追加列 | 编码与语义 |
|---|---|---|
| RS_issues | amountCents | 可空整数 cents；`''` 为未知（语义 null），整数 `0` 为明确零，参考／争议金额可有正负，不产生确认余额 |
| RS_records | reminderKinds | 可见文本，按 `missing_invoice,missing_app,difference` 固定顺序、逗号连接允许集合；空文本为明确空集合 |

4.0 表头与摘要按旧定义严格读取，不补列后假装原生 4.1。升级预览必须明确确认每个旧 Historical 的范围；缺字段不是空集合。升级事件追加新字段变更链，原文件和全部旧表字段、关系、原审计链保留；另存前不称已保留升级结果。六张 Sheet、20 张 Tables、Work Log A:V 和 calculation 3.0 均不变，旧结构空白模板继续作为布局基底。

本期 Job 无条件检测全部适用类别。Historical 的有效提醒是实际成立的类别与允许集合的交集。首次主动跟进默认允许全部三类，再减明确排除；未出现的类别仍保留。既有 Historical 再次结转继承原范围；背景为空，重新允许需要明确操作。实际差额始终可在来源详情查看，范围不改变工作输入或原始估算。

手工参考金额仅用于人工事项。确认余额走独立 `confirmations` 与用户主动确认，不因填数、App 匹配或登记 Bank Received 自动变更。选择性结转按 RecordID／IssueID 去重。未选人工事项不复制为新周期开放事项；相关来源如因其他关系保留，历史提醒范围仍按明确选择保存。

确认余额排除只影响新周期：必要确认行保留金额及依据但设为 inactive，不表示已解决。若仅有 Opening 的原文件确认期初事实且仍须保留来源，则以 inactive 确认快照保留原已知金额及原付款基点，原 `openingCents` 不变；4.1 中该 inactive 快照阻止期初金额再次退回成活动跟进。再次结转不会复活或重复扣减，用户可明确重新确认余额。旧文件的确认金额和未解决状态完全不变。
