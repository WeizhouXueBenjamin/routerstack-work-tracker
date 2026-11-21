# 数据契约与实现

当前格式：**schema 5.0 / calculation 3.0**。应用版本由 [package.json](../package.json) 管理，独立于数据格式和计费版本。仅此格式可读写，旧 2.0–4.1 拒绝；不迁移、不自动改用户旧文件。产品边界见 [Project Goal](PROJECT_GOAL.md)，操作与命令见 [README.md](../README.md)，验证要求见 [AGENTS.md](../AGENTS.md)。

## 离线运行架构

[index.html](../index.html) 通过 classic scripts 顺序加载本地 JSZip、core、model、reports、workbook、内嵌模板、recent-file、review-ui、app。可直接以 file:// 在桌面 Chrome／Edge 运行；开发服务器仅用于本地调试，不是运行时服务。数据流为表单 → 模型命令 → 已校验 WorkbookState → 汇总／界面或显式 XLSX 导出；重开文件先解析和完整校验，再接纳状态。

除最近文件便利引用外，不保存另一份持久工作状态。所有运行资产随仓库提供，不调用 API、追踪或远程存储；IndexedDB 故障或权限失效不应阻断手动选择文件。浏览器文件句柄和下载确认的行为见下文。

## 唯一模型与模块职责

WorkbookState 固定包含 metadata、config、periods、records、bankReceived、issues、balances、appChanges、issueHistory、balanceHistory。未知用 null，Excel 用空单元格；明确 0 保持数值。文本完整保留空白和换行，最大 32,767 个字符串 length 单元；输入公式样式的文本按文本存储。

| 模块 | 职责 |
|---|---|
| src/core.js | calculation 3.0、日期／时间、舍入、行公式及 shared formula 平移 |
| src/model.js / TrackerModel | 唯一模型、完整校验、原子 CRUD、Config 预览、集合式结转、专用历史 |
| src/workbook.js / TrackerWorkbook | 唯一 XLSX 读写、四 Sheet／八 Table、SHA-256、公式／容量校验 |
| src/reports.js | 纯汇总和筛选；提醒直接复用模型 |
| src/app.js | 录入、Config、Work Log、Save 生命周期、新周期 |
| src/review-ui.js | 独立事项／余额、关联编辑、银行 CRUD 和专用历史 |
| src/recent-file.js | IndexedDB 仅持久化 handle/name/writable 引用 |

命令先校验原状态，复制后修改，再完整校验并返回新状态；失败不改变原状态。Map／Set 检查唯一身份、外键和允许范围。没有通用审计事件、字段变化表或回放。

## 字段

所有实体 ID 为稳定字符串；新建使用 UUID。日期为有效 YYYY-MM-DD，时间为 HH:mm 整分钟；操作时间为有效含时区 ISO 时间。关系金额用安全整数 NZD cents，拒绝隐式舍入。工作 Rate/App/Extra 保留原有限数值，计算和汇总同时检查安全金额精度。

Excel 采用 1900 日期系统，业务日期范围为 1900-03-01 至 9999-12-31；1904 日期系统明确拒绝。inline/shared strings 只读取正文 t 或 r/t，不把 rPh 注音合入文本；导出以带 xml:space="preserve" 的 inline string 保留首尾空白及换行，不承诺保留富文本样式。

| 实体 | 固定字段 |
|---|---|
| metadata | schemaVersion、calculationVersion、currentPeriodId、fileId、fileVersionId、previousFileVersionId、sourceFileId、sourceFileVersionId、fileName、integrityAlgorithm、integrityDigest |
| config | minHours、ahStart、ahEnd、mult、tolerance、allocation（固定 Standard first）、defaultRate（可空正数） |
| periods | id、name、start/end（可空）、createdAt |
| records | id、type、periodId、date、invoice（可空）、start/end、lunch（可空）、rate、extra/app（可空）、note、createdAt/updatedAt、reminderKinds、ruleSnapshot |
| bankReceived | id、date、amountCents（正数）、note、createdAt/updatedAt |
| issues | id、recordId（可空）、periodId、category、description、amountCents（可空、有符号）、status（Open/Closed）、createdAt/updatedAt |
| balances | id、recordId（可空）、periodId、amountCents（明确非负）、description、confirmedAt、status、followUp、createdAt/updatedAt |
| appChanges | id、recordId、invoice（当时快照，可空）、oldApp/newApp（可空）、observedAt、recordedAt、note、estimatedCents、differenceCents（可空） |
| issueHistory | id、issueId、sequence、action、timestamp、recordId（当次，可空）、category、amountCents、description、status、reason |
| balanceHistory | id、balanceId、sequence、action、timestamp、recordId（当次，可空）、amountCents、description、confirmedAt、status、followUp、reason |

Current 仅属于 currentPeriodId，reminderKinds 为空数组，ruleSnapshot 为 null；统一使用 config，不存逐项规则副本。Historical 保持原 periodId，ruleSnapshot 存六项计费规则（不含 defaultRate）。reminderKinds 以 missing_invoice、missing_app、difference 固定顺序保存允许检测的集合，空数组表示背景。

Invoice 可后补，已知时全文件唯一，格式 INV- 后至少四位数字。同一 RecordID 只有一份工作原始数据。独立事项／余额可以没有工作；关联必须引用真实工作，编辑保持实体 ID、登记 periodId、createdAt、金额和状态，除非用户主动修改相关业务值。专用历史按实体内 sequence 连续保存，末项快照与实体一致。改余额金额会更新 confirmedAt；关联变更保留原确认时间。删除 Current 不得留下当前或历史外键，删除它的 AppChange 须在 UI 提示确认。

银行没有 status、void、关联付款或审计历史。更正／删除只影响现存银行记录，删除须在 UI 显示日期和金额确认。银行总额来自现存记录之和，不进入收入、余额计算或结转。

## 四张 Sheet 与八个 Table

| Sheet | Table |
|---|---|
| Work Log | RS_WorkLog（全部 Current 和 Historical，唯一原始工作存储） |
| Config | RS_Periods |
| Follow-up | RS_BankReceived、RS_Issues、RS_Balances |
| History | RS_AppChanges、RS_IssueHistory、RS_BalanceHistory |

Table 的精确字段及列顺序来自 TrackerModel.TABLE_FIELDS，工作表来自 TrackerWorkbook.WORK_HEADERS。除 Work Log 外，各实体直接使用模型字段列，无隐藏 JSON 或第二份快照账本。

Config 的 B5:B11 依次为 minHours、ahStart、ahEnd、mult、tolerance、allocation、defaultRate。AH 以小时数存储。B14:B24 依次保存 metadata 字段，包含 SHA-256；RS_Periods 从 A28 开始。Follow-up 三表从 A3、H3、S3 开始；History 三表从 A3、M3、Z3 开始。表头均存在精确校验，表范围不能重叠，空表保留一个空数据行。

Work Log 上方为 Revenue Summary（Historical、Current 实际月份、Total）；表头行 = 汇总组数 + 5。全部表、范围、公式按内容动态生成，不使用固定 305 末行。

| 列 | 内容 |
|---|---|
| A:H（可见） | Date、Start Time、End Time、Length、Hourly Rate、Estimated Revenue、Displayed Revenue、Notes |
| I:N（隐藏） | invoice、lunch、extra、difference、id、type |
| O:T（隐藏） | minHours、ahStart、ahEnd、mult、tolerance、allocation；Historical 为原始规则快照，Current 仅为指向 Config 的派生公式，缓存不构成第二份规则模型 |
| U:Y（隐藏） | rawHours、billableHours、ahHours、rawAHHours、baseEstimated 派生公式 |
| Z:AC（隐藏） | periodId、createdAt、updatedAt、reminderKinds（固定顺序逗号连接） |

冻结 Work Log 表头，Table 支持全列排序／筛选。Historical 条件格式作用 A:H，由当前行隐藏 N 列 type 驱动，背景 F0F0F0；不以固定物理行着色。金额右对齐，Notes 换行。公式及缓存均为派生数据。

## 计算与 Summary

保留 calculation 3.0 的钟面分钟模型、跨午夜、小于 24h 工作、Lunch 普通优先、最低计费按剩余普通／AH 比例补足、Extra 和逐步两位舍入。lengthHours = raw − Lunch，不是 billableHours。AH、倍率、最低工时和阈值来自有效 Config 或 Historical 快照；不是官方政策声明。

新空白工作簿的估算默认值为 minHours=2、ahStart=18、ahEnd=6、mult=1.5、tolerance=0.01、allocation=Standard first，defaultRate=null；它们是可编辑的工具配置，不是真实费率或官方政策。不包含夏令时实际经过时长、节假日或税务规则。

Summary 独立于筛选，Historical 不拆原月份，Current 仅从实际日期生成月份，Total 包含全部记录。Estimated、App、Difference 分别合计；Difference 逐笔舍入后再加，不能由两个总数相减代替。App 空白不当作 0；无可比项为空，有不可比项的可比差额标 *／Partial。银行、人工参考金额、确认余额均不进入 Summary。

工作整项按原 date 归属月份，跨午夜／跨月不拆分。Work Log 在 Tool 中按日期、开始时间升序显示，相同日期／时间保持原顺序；筛选不缩小导出。界面的 Summary 可折叠较早月份，这只是查看状态。

Config 预览携带 transient revision 和完整状态基线；确认时两者均须一致。只重算 Current，不改 Rate/App/Historical 或人工实体，不产生 AppChange。defaultRate 独立应用，仅用于后续预填。只有 App 实际变化才追加专用历史，保留旧／新值、观察时间、系统时间、Invoice、Estimated 和 Difference；同值保存、普通编辑、Config 重算不追加。无金额变化时填写观察资料会拒绝提交并保留输入。

## 保存、版本和结转

公共接口：read(input) → WorkbookState；write(state, {fileName}) → Blob；exportInfo(blob) → 实际导出的 metadata；hashBytes(bytes) → SHA-256。write 不修改调用方状态；仅成功写入并 close 或确认保留下载后，应用才接纳导出 metadata。每次实际导出新 fileVersionId；previousFileVersionId 是上次实际保存版本。结转新 fileId，sourceFileId/sourceFileVersionId 只指向直接来源。

分别跟踪表单草稿、Config／跟进草稿、内存 revision、导出快照和下载待确认状态。保存／换期前先提交或明确取消草稿。失败／取消不清输入；确认旧下载只更新它的 persistedRevision，不清除后来编辑。保存期间允许继续录入，新修改保持 dirty。

Save 仅写允许的当前句柄。权限检查后，在 createWritable 前、取得 writer 后、临时 write 后 close 前，三次对磁盘 SHA-256 与来源基线比较；冲突 abort，不自动合并。write 和 close 全部成功才标记保存。Save As 必须新文件名并避开已打开／导出句柄；归档句柄及已结转来源受保护。无句柄下载只表示发起，确认保留才标记对应快照。最近文件权限仅由用户主动重开请求。

重开最近文件在本次点击中直接请求读取权限，不先等待旧句柄的权限查询；授权、读取与校验合计等待超过 30 秒后结束本次重开，显示持续错误并恢复操作，提示通过 Open / Switch File 重新选择 XLSX。失败／超时不改变现有工作簿或草稿；超时后返回的旧读取结果不接纳。

结转从明确选择的提醒范围、IssueID、BalanceID 出发，分别处理无 RecordID 的独立实体。保留所选实体完整专用历史及登记周期；从当前及历史 recordId 求必要工作集合，以 RecordID 去重；保留这些工作的 AppChange。Current 转 Historical 时冻结六项原规则，旧 Historical 保持身份和快照；只保留当前和必要来源周期。未选事项／余额不复制、不解决旧项，也不因来源工作另被保留而复活。最小模型没有实体之间的余额外键，排除余额无需作为别的实体背景保留。银行不复制。新文件可只有独立实体而无工作。旧文件字节不写入，生成后仍需主动打开新文件。

## 完整性、容量和 Excel

规范化所有受控数据并按实体 ID 排序计算 SHA-256；排除自身摘要、物理行顺序、样式、筛选及公式缓存。摘要用于检测意外修改，不是数字签名。解析严格校验字段类型、金额、身份、引用、专用历史、Table 位置／表头及逐行计算公式（含 shared formulas），也校验 Summary 和 Current 指向 Config 的派生公式。Excel 正常重算／整表排序／筛选后保存应可重开；外部业务编辑和自定义计算公式明确拒绝。额外数据区域／未关联 Table 或 Sheet 拒绝，不静默丢弃。

必要容器部件、根关系、内容类型和 XML 根类型也受校验；额外命名数据／部件拒绝。先执行容量与部件检查，再验证 ZIP CRC，损坏包不作为合法 XLSX 接受。

统一上限：输入／输出 XLSX 32MiB；每个 XML 16×1024²、累计 XML 64×1024² 个 JavaScript 字符串 length 单元；各表末行不超过 Excel 1,048,576 行（包含前置内容与表头）。File 在完整读取前检查 size，字节接口同样检查；导出在写文件前执行相同检查。超限拒绝，不截断，不清草稿，不承诺任意接近 Excel 极限的工作量。

当前空白模板为 templates/RouterStack_Tracker_V5_Blank.xlsx，唯一生成入口 npm run template:generate，唯一嵌入资产 src/template-data.js。模板没有共享 FileID、PeriodID 或业务身份，每次打开创建独立身份。

验证命令与变更类型要求统一见 [AGENTS.md](../AGENTS.md#验证与交付)。浏览器可验证真实下载与文件重开，受控句柄用于错误／冲突分支；原生文件引用脚本单独验证浏览器重启后的权限与磁盘重读。桌面 Excel 的重算／排序／筛选／保存往返由 Windows 脚本验证，不能用公式缓存或 Linux CI 代替，也不扩展为所有 Excel 版本／平台的保证。合成测试可重建证据，不依赖历史报告中的本机临时路径。
