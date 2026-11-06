# 架构与 XLSX 数据契约

## 数据与运行边界

`index.html` 是离线操作入口，使用 classic scripts，支持 Chrome / Edge 的 `file://`。`core.js` 提供纯计算和校验，`workbook.js` 负责 XLSX 读写，`app.js` 管理表单、版本预览、显式保存和结转。运行不需要 Node.js、账号、API 或网络。

最新保留的 XLSX 是实际工作事实的唯一保存来源。浏览器内存和未提交表单不是持久化记录；Estimated、App Displayed、银行实际到账、确认结转余额始终分开。

## 公共结构：2.0 与 3.0

- 导出 Sheet 顺序固定为 `Tool`、`Work Log`、`Config`。读取按名称及 workbook relationships 定位，允许 Excel 调整 Sheet 顺序或内部 XML 文件名。
- 仅支持精确的 schema `2.0` 和 `3.0`；其他版本拒绝读取。1904 日期系统暂不支持，明确报错。
- Work Log 第 5 行为表头，第 6–305 行最多 300 条 Job / Carryover。导入检查范围之外的原始值，禁止截断；空行可以不存在。
- 不允许增加、交换或删除列；表头必须与下表完全一致。输入列不能用公式代替原始值。公式列须符合对应版本；解析 shared formulas 后再比较。

| 列 | 精确表头 | 类型 / 含义 |
|---|---|---|
| A | Date | Excel 1900 系统日期整数，Job 必填 |
| B | Invoice ID | 文本 `INV-` 加至少四位数字；Job 可暂缺，同周期不能重复 |
| C | Shift | 公式展示，禁止手动修改 |
| D | Lunch (h) | 非负数字小时或空白；计算时空白为 0，保存仍为空白 |
| E | Rate (NZD/h) | Job 的正数费率 |
| F | Billable (AH) | 公式展示；3.0 固定两位小数，计算不依赖此文本 |
| G | Expected (NZD) | 工作估算加 Extra，或已确认 Carryover 余额 |
| H | App Shown (NZD) | 非负数或空白；空白与明确 0 不同 |
| I | Difference | Expected − App；App 空白则空白，不表示欠款 |
| J | Notes | 原始文本 |
| K | Start [h] | Excel 时间小数，00:00–23:59 整分钟 |
| L | End [h] | 同上，结束较早代表次日；相同时间拒绝，时长须小于 24h |
| M | Entry type | 严格为 `Job` 或 `Carryover` |
| N | Extra NZD | 有来源的额外费用，可空；保留原有负数调整能力 |
| O | Carryover NZD | Carryover 的正数确认余额，最多两位小数 |
| P | Raw hours | 原始时长公式 |
| Q | Billable num | 计费小时公式 |
| R | AH paid num | AH 计费小时公式 |
| S | AH raw num | AH 原始小时公式 |
| T | Base estimated | 不含 Extra 的估算公式 |

K:T 导出隐藏。Excel 编辑时间、Extra 或确认余额时需先取消相应列隐藏；不要修改 C/F/G/I/P:T 的公式。Carryover 不能填写新工作时间、费率、Lunch、Extra 或 App。

## Config 与计费

| 单元格 | 含义 |
|---|---|
| B5 | 最低计费小时，正数且不超过 24 |
| B6 | AH 起点，Excel 时间小数 |
| B7 | AH 倍数，至少 1 |
| B8 | 差额提醒阈值，非负数 |
| B9 | 只支持 `Standard first` |
| B10 | 精确 schema 版本 |
| B16 | **3.0 新增**：AH 结束时间，Excel 时间小数，与起点不同 |
| B17 | **3.0 新增**：上次 Tool 保存时的规则 JSON 快照；第 17 行隐藏，请勿修改 |

快照固定键为 `minHours, ahStart, ahEnd, mult, tolerance, allocation`，AH 时间在 JSON 中使用小时（如 18、6），其余字段对应上述配置。快照用于对比当前原始记录在两套规则下的估算，不是付款或不可篡改审计证据。

2026-11-07 用户确认的默认值：最低 2h、AH 每天 18:00–次日 06:00、1.5×；Lunch 先扣普通时段，再扣 AH。扣休息后不足最低时长，按剩余普通/AH 工时占比分配补足。按钟面分钟计算，未加入夏令时实际经过时长或节假日特殊规则。

金额在基础估算、加 Extra、差额三个步骤按两位小数舍入；内部工时不提前舍入。JS 与 Excel 使用同一版本口径，Excel 公式采用常规函数，不依赖 LET、动态数组或宏。

## 版本兼容与显式升级

- 原始 `RouterStack_Tracker_V2_Blank.xlsx` 保留不变。2.0 按旧算法只读打开：AH 仅从配置起点到午夜，最低工时不按 AH 占比补足。
- 用户点击升级后，使用同一组原始字段逐笔比较旧算法与 3.0。取消不改变当前内容；确认后仍须另存 3.0。新 AH 结束默认使用已确认的 06:00，其余配置沿用选定工作簿。
- 不批量迁移旧周期，不自动归并历史工作。没有历史快照的旧文件，不声称能恢复更早的规则或归档金额。
- 3.0 的 Config 与 B17 不一致时，先展示整周期规则差异；取消保留当前记录和草稿，确认后标为待另存。导出时更新 B17。
- 使用主版本 3.0 是因为旧工具接受所有 `2.x`；新文件必须让旧工具拒绝，避免按旧算法误读。
- 导出使用 3.0 标准模板，保持业务原始字段；不复制用户添加的样式或其他自定义工作簿结构。公式不符或附加数据会明确拒绝，不静默抛弃。

## 保存与结转

记录使用仅在浏览器内有效的稳定 ID 定位编辑，不新增 XLSX 列。记录修订、表单草稿、导出快照分别跟踪。导出期间新增的修改仍未保存。

默认另存带时间的新文件，拒绝写回已打开的文件。文件 API 写入必须成功 close 后才算该快照已保存；失败/取消保留内存。下载只能证明已发起，直到用户确认保留或打开文件前保留提醒；确认旧快照不会清除后续修改。

创建新周期前须先保存并确认旧周期。只导出用户选择并输入确切余额的 Invoice，空选择需确认；新文件不自动替换当前旧周期。Carryover 保留原 Invoice/date/note，不计新工作数、不累加余额或重复追加备注，不使用 App 差额或银行总额推测欠款。

## 模板维护

`scripts/generate-v3-template.mjs` 从空白 2.0 模板生成 3.0；`npm run template:sync` 将 3.0 嵌入 `src/template-data.js`。原模板不应含真实记录。变更后执行 `npm run check`、`npm run test:e2e`，计费/模板变更还需桌面 Excel 回归。
