# 验证方法与验收

所有测试仅用合成记录，真实数据存放在仓库之外。

本轮实际结果见 [VALIDATION_REPORT.md](VALIDATION_REPORT.md)。

## 自动检查

```powershell
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
# 也可直接验证已安装的浏览器
$env:TEST_BROWSER='chrome' # 或 msedge
npm run test:e2e
npm run test:excel        # Windows + 已安装桌面 Excel
```

Playwright 仅是开发依赖，应用离线运行不需要安装依赖。CI 执行源文件/模板检查与 Chromium file:// 浏览器回归；远端 CI 结果需单独确认。

## 必须覆盖

- 无 ID 编辑、删除前序行、搜索后提交，其他工作不被覆盖。
- 草稿、下载待确认、导出快照和后续修改；取消、写入失败、close 失败和原文件覆盖拦截。
- 完整表头、输入类型、日期/时间、重复 ID、配置、容量、未知版本、缺失/自定义/shared formulas。
- 非法导入保持当前记录和草稿；调整 Sheet 顺序、内部 relationship 路径、稀疏空行的往返。
- 新增→保存→重开→部分余额结转→连续结转；空白周期；App 空白与 0；网络请求为 0。
- 旧版只读、升级取消/接受、Config 变更差异与另存后快照更新。
- 60 NZD/h、无 Lunch/Extra：19–20=180；22–02=360；17:30–18:30=150；06–08=120。
- 桌面 Excel：重算数值与 JS 一致，原始字段修改、Config 修改、shared formulas、Tool 再导出后可重算，无修复提示。
- 重开导出文件或通过无句柄的文件输入再次打开后，会话内旧文件仍不可覆盖。
- 结转草稿关闭/ESC/离开提醒，生成期间输入与关闭锁定，取消/写入/close 失败保留草稿；确认替换文件时不遗留旧结转候选。
- inline/shared 富文本带 rPh 时，只读正文；首尾空白、中文和换行经 Excel 与 Tool 往返后不变。
- 当前文件按 Job 日期分月（含跨月夜班），Carryover 独立；App 空白/0、容差与月度可比总额口径正确。
- 文件总览只汇总新工作预计，确认结转余额单列；无可比 App 时总览与月度差额均显示未提供，而非零。
- 月份、搜索、提醒筛选不修改数据；导出仍完整，编辑移走最后一项工作后月份不会自动扩大。
- Tim 默认待核对、当前可见、全部工作三种范围明确，结转单列；未保存状态与来源正确，剪贴板失败仍可本地手动复制，不自动发送。

浏览器检查不替代桌面 Excel 兼容证据。未运行的 Excel 版本应标记“未验证”。
