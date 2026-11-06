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

浏览器检查不替代桌面 Excel 兼容证据。未运行的 Excel 版本应标记“未验证”。
