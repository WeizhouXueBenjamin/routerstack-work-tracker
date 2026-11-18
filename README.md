# RouterStack Work Tracker

个人使用、离线优先的工作记录与轻量核对工具：减少重复输入、独立估算并发现 App 金额差异、跨周期保留未解决事项。不是 RouterStack 官方软件。

当前本地版本 **v0.6.0 / schema 5.0 / calculation 3.0**。工程资料从 [文档入口](docs/README.md) 开始；本次授权与范围见 [Project Goal](docs/PROJECT_GOAL.md)。

界面仅面向桌面：左侧 320px 录入，右侧紧凑 Revenue Summary 与八列 Work Log。支持 Compact／Expanded 和 Config／Bank Received／Unresolved 右侧抽屉；验收视口为 1366×768、1920×1080，不再维护手机适配。截图和本轮检查见 [紧凑桌面验收](docs/reports/2026-11-17-compact-desktop.md)。

## 使用

直接用 Chrome/Edge 打开 [index.html](index.html)，日常无需 Node.js、账号、服务器、宏或互联网。

1. 打开最新实际保留的 schema 5.0 周期 XLSX，或从新的空白工作簿开始。最近文件只记住便利引用，每次重开重新读磁盘；权限失效或文件移动时重新授权／选择。
2. 填真实 Date、Start/End、Rate；Lunch 是数字小时，空白按 0。Invoice、App、Extra、Notes 可后补。添加只进入内存；成功后保留日期、恢复可空默认 Rate，清空专属字段并聚焦 Start。
3. Tool 的 Work Log 默认同时显示 Current 和浅灰 Historical，只有八列；按日期从早到晚、同日按开始时间排列，两者相同保持原顺序。新增或修改日期／开始时间后自动排序。Length 为实际工时减 Lunch。唯一 Revenue Summary 按 Historical、Current 实际月份和 Total 汇总；筛选不改变完整汇总或导出。
4. 点选 Work Log 行，在左侧查看完整 Notes、修改或确认删除；完成／取消恢复新增上下文。Expanded 收起录入区并完整换行显示 Notes。Config 抽屉中预览并确认规则变化，只重算 Current；Historical 保留原规则。默认 Rate 独立应用，只影响后续预填。
5. 人工事项和确认余额可选择“未关联工作”，以后可关联、更换或解除关联。参考金额可未知、0 或正负；余额须明确非负金额和依据，0 不自动关闭。银行实收可登记、更正、确认删除，独立于收入和余额。
6. Save 写回允许的当前句柄，Save As 生成副本／备份；无句柄时下载后点击“我已保留下载文件”。write/close 失败、取消、权限失效和外部文件冲突保留内存与草稿，错误持续显示。确认旧下载不会清除后来编辑。
7. 保存并确认保留当前文件、提交或取消草稿后，从 Unresolved 抽屉进入结转预览。提醒类别、人工事项和余额独立选择，排除余额单独确认。只携带必要真实工作及专用历史，银行款不携带。新文件无 Current 工作，可只有独立事项／余额；旧文件不变，生成后打开新文件继续。

App 空白是未知，明确 0 是已知。Difference 不是确认欠款，银行总额不证明某项 Invoice 已付。Summary 不包含人工参考金额、确认余额或银行实收。

只支持 schema 5.0，旧 2.0–4.1 明确拒绝，不提供迁移／升级／只读适配器；保管好原文件。Excel 可查看、重算、整表排序／筛选并保存；业务数据和 Config 通过 Tool 编辑，外部业务或公式修改会被拒绝。字段、结构、容量及完整性规则见 [数据契约](docs/architecture.md)。

## 本地开发和验证

需要 Node.js >=22。开发入口 http://127.0.0.1:4173：

~~~powershell
npm ci
npx playwright install chromium
npm run dev
npm run check
npm run test:e2e
npm run test:native
npm run test:excel
~~~

安装测试工具需要联网，应用运行无需联网。TEST_BROWSER=chrome 或 msedge 可选已安装浏览器。空白模板为 [RouterStack_Tracker_V5_Blank.xlsx](templates/RouterStack_Tracker_V5_Blank.xlsx)，生成入口 npm run template:generate；嵌入资产同步检查包含在 check 中。

v0.6 数据实现阶段的规模测试和 Excel 16.0 两次周期往返见 [历史验证报告](docs/reports/2026-11-17-v06-validation.md)。此次 UI 修改未改 schema、公式或模板，未重跑桌面 Excel；当前界面的实际结果以紧凑桌面验收记录为准。没有自动提交、推送或部署；本地通过不代表发布。

真实工作簿和财务资料请放仓库外并备份，测试仅用合成数据。JSZip 授权见 vendor/JSZip_LICENSE.markdown；源代码未指定开源许可证。
