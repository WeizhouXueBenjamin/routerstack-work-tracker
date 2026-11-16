# v0.6 本地实施与验证

日期：2026-11-17（Pacific/Auckland）。授权：用户《RouterStack v0.6 精简实施计划（最终评审修订版）》及明确实施指令。开始时 HEAD 为 `67163c3104420756aa6d2d6fb712ee00c975785a`，工作区干净；本轮保留可审查 diff，未提交、推送或部署。所有测试资料均为合成数据。

**本轮实现、本地回归与桌面 Excel 验收均已通过。** 在受限环境外运行同一测试后，Excel COM 可用；已完成 Excel 16.0 的重算、整表排序、筛选后保存、Tool 重开再导出及连续两次新周期往返。

## 实际执行结果

| 命令／检查 | 本轮结果 |
|---|---|
| `npm run check` | 通过：源文件语法、单一嵌入模板同步、35 项 Node 测试 |
| `npm run test:e2e` | 通过：62 项 Chromium 浏览器测试，修复后全量 39.5 秒；补充默认费率往返与 Tab 断言的 2 项定向测试也通过 |
| `npm run test:native` | 通过：真实合成 XLSX、磁盘原生句柄、浏览器重启后的权限降级和重新选择，重新读取 2 项实际磁盘工作；存储键仅 handle/name/writable |
| `npm run test:excel` | 通过（受限环境外）：Excel 16.0、10 项合成工作及独立事项／余额／银行，计算和汇总、排序／筛选／保存、Historical 八个可见单元格灰底、Tool 重开再导出、两个新周期均通过 |
| `git diff --check` | 通过；未提交工作保留 |
| 桌面／390px 截图与布局 | 已检查，页面无整体横向溢出；Work Log 在窄屏容器内横向滚动，Summary 保持四列，Historical 灰底 |

原生句柄证据目录：`C:\Users\benja\AppData\Local\Temp\routerstack-native-L0SRkW`。通过的 Excel 夹具目录：`C:\Users\benja\AppData\Local\Temp\routerstack-excel-v5-81835d4a9b904984bca6d4ac1d9ac062`，含原文件、Excel 保存文件、Tool 再导出及两次周期的 Excel／Tool 往返文件。这些是本机临时合成资料，目录可能被系统清理；仓库中的测试可重新生成。

Playwright 在容量测试运行时附加 JSON 耗时证据；本轮桌面／390px 截图保存在 `test-results/v06-validation/`。CI 已改用当前格式检查、完整浏览器和原生句柄入口，未运行远程 CI，也未把本地结果称为已发布。

## 需求逐项核对

| 计划要求 | 当前实现与证据 |
|---|---|
| 单一 WorkbookState，type 为 Current/Historical | `src/model.js` 严格字段校验；`tests/model.test.mjs`；无 Pending/Opening/伪工作 |
| 独立事项／余额，无需原日期或 Invoice | 可空 recordId、独立实体 ID／登记周期；无工作 XLSX 和两次结转均通过 |
| 后补关联、更换、解除关联 | UI 和模型回归保持 ID、金额、状态、创建来源；历史保留当次关联，非法引用拒绝 |
| 多个相同来源独立余额 | 按 BalanceID 保留，不以 RecordID 或空值合并；模型测试通过 |
| 原子更新与引用保护 | 复制后完整校验；输入非法、重复身份、超精度、历史缺失、悬空引用不改原状态；有必要关系的工作不能删除 |
| 八列／Length／Historical | 唯一 A:H 可见布局；实际 Length 与最低计费分开；Tool 灰底与 type 驱动的条件格式；真实 Excel 排序后八个可见单元格均为灰底，Current 保持普通背景 |
| 唯一 Revenue Summary | Historical、实际 Current 月份、Total；Difference 逐笔舍入，null／0／Partial 回归；筛选不改变 Summary 或导出 |
| Config 预览 | 受影响 Current 原／新金额；取消不改、过期拒绝；Historical／App／人工金额不变；Default Rate 不追溯 |
| App 专用历史 | 只有实际金额变化追加；保留 old/new、Invoice、观察／记录时间和当时估算／差额；同值观察输入拒绝并保留草稿 |
| 人工事项／余额历史 | Create/Edit/Close/Reopen、连续实体内序号、当次字段和依据；0 不自动解决；银行或 App 更正不关闭它们 |
| 银行 CRUD | 新增、更正、取消／确认删除、现存总额；无 status/void/付款关联/审计历史；不改变余额，不结转 |
| 集合式结转 | 提醒范围、IssueID、BalanceID 独立根选择；当前／历史引用求真实工作并去重；仅保留必要周期和专用历史；连续两次往返通过 |
| 排除与归档 | 排除余额单独确认，只影响新文件；不复活未选项，不解决旧项；原字节不变；保护具体版本和原句柄，归档来源 Save As 的新副本仍可 Save |
| 四 Sheet／八 Table、唯一工作数据 | XLSX 结构回归通过；Work Log 单份 records，公式和缓存只是派生；模板无共享 FileID/PeriodID，每次打开新身份 |
| 严格完整性与公式 | SHA-256 排除行序／样式／筛选／缓存；排序、shared formula、缓存变化可读；业务、Config、ID、历史、错误／缺失公式、额外区域／命名区域／部件拒绝；必要容器、类型、关系和 ZIP CRC 校验，损坏包拒绝 |
| 动态容量 | 301／1,000／5,000 完整往返、结转和界面操作；实际表单第 301 项通过；包含表头与 Summary 的 Excel 行数边界通过 |
| 文件／XML 上限 | 输入 File 在读取前检查 32MiB；字节接口同限；真实压缩输出超过 32MiB 拒绝且未发起下载；单 XML 16×1024²、累计 64×1024² 字符串 length 上限均回归；不截断、保留并发草稿 |
| 文件生命周期 | 三阶段源 hash、abort、权限、文件移动、write/close 失败／取消、并发已提交修改与未提交草稿、旧下载确认、最近文件磁盘重读均通过 |
| 旧实现与资产清理 | 旧金融／付款分配／Payable／迁移／通用审计／Tim 模块和专用测试已移除；仅当前模板、嵌入资产及生成入口；当前文档／package／CI 已更新 |
| 桌面 Excel 两次结转 gate | `scripts/test-excel.ps1` 与 `scripts/excel-fixtures.mjs` 实际通过生成→重算／全表排序／筛选／保存→Tool 重开→再导出及两个周期；Excel 16.0 |

## 合成性能测量

以下来自最终完整浏览器运行，计时使用页面 performance.now，使用两个测试 worker；不是不同电脑的性能保证。记录包含最少完整工作事实，未知 App，没有超长 Notes 或大量专用历史。

| 工作数量 | XLSX 字节 | 首次写入 ms | 读取 ms | 模型结转 ms | 新周期写入＋重开 ms | 完整渲染 ms | 搜索 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| 301 | 100,105 | 85.8 | 202.1 | 8.4 | 238.0 | 16.7 | 2.3 |
| 1,000 | 303,964 | 196.2 | 623.0 | 28.5 | 818.8 | 57.2 | 10.3 |
| 5,000 | 1,489,061 | 764.2 | 3,171.1 | 131.3 | 3,856.6 | 257.4 | 27.4 |

各规模均确认 RecordID 唯一、条数完整、结转后全部 Historical；5,000 条还执行筛选后真实表单编辑。额外容量测试使用 440 个长文本工作和 480 个带历史的独立事项，生成真实高熵压缩数据，确认超过 32MiB 输出时没有下载、没有截断、草稿和 dirty 状态保持。另一组合验证单 XML 和累计 XML 上限。

## 桌面验收修复与验证范围

此前受限进程创建 Excel COM 返回 `0x80070520`；本轮在受限环境外运行同一测试后 COM 可用，未修改 Windows／Office 配置。真实验收先发现脚本需要使用 Table.AutoFilter.ShowAllData，而不能使用 Worksheet.ShowAllData 清除 Table 筛选；已修正，并在保存前重新应用筛选以验证筛选后的往返。

真实 Excel 还发现 Historical 条件格式的差分填色缺少明确背景色：原 indexed 系统色不能产生预期灰底。已将差分填色的前景／背景均设为 F0F0F0，重新生成唯一空白模板和嵌入资产，并补充模板回归断言。实际 Excel 已确认排序后的 Historical A:H 全部灰底、Current 普通背景；随后各次 Excel 保存→Tool 重开及两个新周期全部通过。修复后重跑 check、完整浏览器、原生句柄检查均通过。此处是本机 Excel 16.0 实测，不扩展为所有版本／平台的保证。

真实句柄脚本验证磁盘读取和恢复；写入成功／失败、三阶段冲突和并发场景由浏览器句柄 mock 验证，不把 mock 结果描述为所有 Chrome/Edge 会话的原生写入保证。跨浏览器进程重启后本机实际 permission 为 denied；回退重新选择已验证，不承诺永久权限。

不承诺接近 Excel 行数极限的容量，也不将高熵／长文本测试等同于同条数日常记录性能。旧 2.0–4.1 按授权明确拒绝；原用户 XLSX 与忽略的周期文件未改。本轮授权实现和验收完成，没有另行启动功能扩展或发布工作。
