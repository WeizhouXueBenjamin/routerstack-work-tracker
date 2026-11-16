# RouterStack Work Tracker

个人使用、离线优先的记工与收入核对工具：减少重复输入、独立估算并发现 RouterStack App 差异、换期不丢未解决事项。并非 RouterStack 官方软件。

工程资料从 [docs/README.md](docs/README.md) 进入，已分为**当前文档、报告、历史资料**。

## 使用

直接用 Chrome/Edge 打开 index.html，日常无需 Node.js、账号、服务器、宏或互联网。

1. “打开现有 Excel”，选择最新实际保留的周期文件；支持句柄的浏览器可以“重开最近”读取实际文件。权限失效或文件移动时重新授权／选择；浏览器只保存便利引用。
2. 输入实际日期、Start/End、Rate；Lunch 为数字小时，空白按 0。Invoice、App、Extra、Notes 可后补。同日多项工作分别记录。
3. “添加这项工作”只提交到内存。成功后保留 Work Date、恢复 Config 默认 Rate，清空专属字段并聚焦 Start。默认费率在表单下方配置、随 XLSX 保存；未配置留空。
4. Save 显式写回允许写入的当前文件，并检查外部修改；Save As 用于副本、备份、新周期和升级。无句柄时降级另存下载；直接写文件需 write/close 成功；下载模式需确认已保留文件。确认旧快照不会清除后来的修改。
5. 下次继续打开最新保存文件；Tool 与 Excel 先后编辑，避免并行修改。

旧 2.0/3.0/4.0 只读，升级须预览、确认并另存 4.1；旧 4.0 Historical 还须明确确认初始提醒范围。Excel 可编辑 Work Log 原始字段和 Config；时间/Extra 列需先取消隐藏，不改公式、表头、ID 或受控表。详见[数据契约](docs/architecture.md)。

## 核对与换期

- Estimated、App、银行实收、人工确认结转分别保留。App 空白不是 0，差额不是确认欠款，银行总额不证明具体 Invoice 已付。
- 银行到账可只记日期、金额和可选备注。月度只统计当前文件新工作，结转单列；筛选不影响完整导出。Tim 清单只复制本机，不自动发送。
- 先保存并确认保留旧周期，再手动创建新周期。新 Work Log 空白，旧文件归档；生成后仍打开旧周期，需打开新文件继续。
- 结转按类别选择允许继续检测的提醒，首次自动跟进默认三类全部允许；人工事项和确认余额独立选择。历史范围继承，空范围仅作背景。排除余额单独提醒，不表示解决、不修改旧文件。必要的旧批次与付款关系仍兼容保留，见[路线图](docs/roadmap.md)。

当前本地实现 v0.5.0 / schema 4.1，计算版本 3.0，含未提交改动；不代表已发布。现有批次/付款分配只保留兼容。范围和规则确认边界见 [Project Goal](docs/PROJECT_GOAL.md)。

## 本地开发

开发需 Node.js >=22；开发入口 http://127.0.0.1:4173：

~~~powershell
npm run dev
npm run check
npm run test:e2e
npm run test:excel
npm run test:excel:v4
node scripts/test-recent-file.mjs
~~~

首次运行浏览器测试可先 npm ci、npx playwright install chromium；安装工具需要联网，应用运行不联网。TEST_BROWSER=chrome 或 msedge 可选已安装浏览器。模板仅在授权改动后执行 npm run template:sync。验证结果及环境限制见[报告](docs/reports/2026-11-15-scope-audit.md)。

真实工作簿、工资和银行凭证放在仓库外并自行备份；测试只用合成数据。JSZip 授权见 vendor/JSZip_LICENSE.markdown；源代码未指定开源许可证。当前不自动发布或启用 GitHub Pages。
