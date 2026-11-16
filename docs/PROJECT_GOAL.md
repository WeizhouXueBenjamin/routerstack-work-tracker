# Project Goal 与产品要求

更新：2026-11-17。当前授权依据为用户《RouterStack v0.6 精简实施计划（最终评审修订版）》、“我授权开始实施”及最终紧凑桌面 UI 规格。该计划替代之前的兼容保留方向；本文是当前产品范围依据，实际字段见 [architecture.md](architecture.md)。

## 核心目标

**少填重复信息；独立估算并发现 App 金额差异；跨周期不丢未解决事项。** 质量顺序：数据完整性 > 可预测的 Excel 兼容性 > 录入便利 > 样式。工具不承担会计、工资核算或完整银行对账职责。

## 日常流程

1. 用 Chrome/Edge 打开离线 Tool，选择最新实际保留的 schema 5.0 XLSX；最近文件只保存 handle/name/writable 引用，每次重开重新读磁盘。
2. 新增 Current 工作，填写真实 Date、Start/End、Rate；Lunch 为数字小时，空白按 0。Invoice、App、Extra、Notes 可后补。同日可有多项，一项工作一张唯一 Invoice。连续添加保留日期、恢复 Config 默认 Rate、清空工作专属字段并聚焦 Start。
3. 查看唯一八列 Work Log 和 Revenue Summary；Current 与 Historical 默认同时显示。Historical 使用浅灰底及原计费快照。Length 是实际跨午夜时长减 Lunch，与最低计费工时分开。
4. 根据实际核实结果登记人工事项或明确确认余额。两者可不关联工作；以后可关联、更换或解除关联，保持自身身份、登记周期、金额及专用历史，不编造来源工作。
5. 银行实收只记日期、正数金额和可选备注，可更正及确认删除。总额只来自现存记录；不推断 Invoice 付款状态，不影响人工余额。
6. 显式 Save 或 Save As；无句柄时下载后须确认已保留。保存前内存不算持久化。失败、取消、权限失效、文件移动和外部冲突保留全部输入。
7. 保存并确认保留当前文件且无未提交草稿后，独立选择自动提醒类别、IssueID、BalanceID，生成新周期文件。旧文件保持不变；新文件无 Current 工作，显示必要 Historical，可完全没有工作而只有独立事项／余额。银行款不结转；生成后打开新文件继续。

## 金额与规则边界

- Estimated Revenue 包含 Extra；Displayed Revenue 是 App 原值。App 未知为 null／空白，明确 0 是已知值；Difference = 逐笔舍入的 Estimated − App。差额不是确认债务。
- Summary 仅有 Historical、Current 实际月份和 Total。Difference 只合计两项金额均已知的记录，有不可比记录标 Partial；完全无可比项显示未知。筛选不改变汇总或完整导出。银行实收、人工参考金额和确认余额不进入收入 Summary。
- 继续使用 calculation 3.0：Lunch 普通时段优先扣除；最低计费补足按扣 Lunch 后普通／AH 占比分配；基础、加 Extra、差额分步舍入。既有默认估算不是 RouterStack 官方政策；真实 Rate 不猜测，Default Rate 可空。
- Tool 中的 Config 变更先预览所有受影响 Current 的原值、新值及差额，确认后原子应用；过期预览拒绝。Historical 快照、Rate、App、参考金额和余额不变，不产生虚假 AppChange。Default Rate 只影响下一笔。
- 自动提醒只从实际数据派生。Historical 的有效提醒 = 适用类别 ∩ 持久允许范围；继承和明确排除保留，背景范围为空。App 实际变化才增加历史，不自动解决无关事项或余额。
- 人工事项参考金额可未知、0 或正负。余额须明确非负金额及依据，0 不自动关闭；改额、关闭和重开有专用历史。多个独立余额不自动合并。

## 格式与范围

当前目标 v0.6.0 / schema 5.0 / calculation 3.0。Tool 是唯一业务编辑入口；XLSX 是唯一持久工作来源。四张 Sheet、八个 Table、单一 WorkRecord：type 为 Current 或 Historical。只支持 schema 5.0；旧 2.0–4.1 明确拒绝，无迁移、升级或旧版只读入口，用户旧文件不修改。

Excel 用于查看、重算、整表排序、筛选和保存；业务字段、Config、身份、历史或计算公式的外部修改拒绝导入。无 300 条业务上限；采用动态表及统一文件／XML／Excel 行数保护。只报告实测规模，不承诺接近 Excel 极限的容量。

保留离线 HTML/JS/JSZip，不新增 API、追踪、云存储、自动上传或运行时联网依赖。不自动提交、推送或部署。真实财务资料不入仓库，测试只用合成数据。

本次明确移除旧 Settlement Batch、scope、付款分配、Payable、付款基点、金融证据、通用审计／回放、Pending／Opening／Site／预设兼容、重复工作数据、Tim 报告和 Excel 业务修改接受流程。后续不因历史计划恢复这些流程。

暂缓事项仍包括 Site 录入、费率预设、复杂 Pending、多行网格／批量输入、复制工作、额外图表／报告、附件库、银行／App 接口、OCR、云同步、多文件自动合并和框架重写。新提案须说明服务哪个核心目标、现有功能为何不足、增加多少输入或维护负担。

## 桌面 UI 范围（2026-11-17 最终确认）

仅面向桌面，正式视口为 1366×768 和 1920×1080。删除手机断点、上下布局及触控适配，不再以 390px 验收；保留桌面窗口中的基本滚动容错。本节覆盖旧计划及历史报告中的移动端要求。

- 简洁标题、文件／周期、Save／Save As、明确保存状态；错误持续显示。无品牌装饰、宣传副标题、统计卡片、阴影、渐变或动画。
- 左侧 300–340px 快速录入，右侧以八列 Work Log 为主；Revenue Summary 紧凑置于表上方，保留原有金额及 Partial 语义。Work Log 内部滚动，表头固定；常规字号 13–14px、行高 32–36px，目标在 1366×768 显示 10–12 条完整记录。
- Compact 默认：Notes 单行截断，点选记录在左侧统一编辑／确认删除，不增加 Actions 列。Expanded 临时收起左侧，八列保留，Notes 完整换行，尽量保持搜索、筛选、选择和滚动位置。不增加截图生成器、PDF 或其他导出。
- New Entry 常显 Date／Start／End／Lunch／Rate；Invoice／App／Extra／Notes 收进 Additional Details，连续新增保持展开偏好。编辑时全部工作字段展开；完成／取消后恢复新增日期及默认 Rate，上下文和键盘行为继续保护。
- Config、Bank Received、Unresolved 共用一个覆盖式右侧抽屉，内部滚动，不永久压缩工作表。关闭保留草稿；有草稿时先提交或明确取消再切换功能或 Expanded。Config 规则预览、银行独立登记、人工事项／余额及结转语义保持。

本轮只授权布局、样式及最小 UI 交互；不改 WorkbookState、schema 5.0、calculation 3.0、四 Sheet／八 Table、计算／提醒／余额／结转及文件安全机制。实际截图与验证见 [紧凑桌面验收](reports/2026-11-17-compact-desktop.md)。
