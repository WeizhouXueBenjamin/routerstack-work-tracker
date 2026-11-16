# 路线图与实施状态

范围见 [Project Goal](PROJECT_GOAL.md)，实际格式见 [数据契约](architecture.md)。2026-11-16 用户授权 v0.6 精简实施计划最终修订版，开始时 HEAD 为 67163c3104420756aa6d2d6fb712ee00c975785a，工作区干净。本轮修改保留在本地，未提交、推送或部署。

## 已接入 v0.6

| 批次 | 结果 | 验证入口 |
|---|---|---|
| 契约与计算 | schema 5.0、calculation 3.0 数值基线、Length、动态列映射；移除 300 条业务限制 | tests/core.test.mjs、docs/architecture.md |
| 最小模型 | 单一 Current/Historical records；原子 CRUD；可空工作引用；银行 CRUD；App／事项／余额专用历史 | tests/model.test.mjs、tests/carry-forward.test.mjs |
| 唯一 XLSX | 四 Sheet／八 Table；规范化 SHA-256；严格公式／类型／引用／额外数据／容量校验；无旧格式入口 | tests/browser/workbook.spec.mjs |
| Tool | 八列、Historical 灰底、唯一 Summary、Config 预览／取消／过期保护、轻量表单与后补关联 | tests/browser/tracker.spec.mjs |
| 文件生命周期 | Save／Save As、三阶段冲突、abort、write/close、并发输入、旧下载确认、归档、最近引用 | tests/browser/workflow.spec.mjs、scripts/test-recent-file.mjs |
| 清理 | 删除旧金融、迁移、通用审计、Tim 及旧模板／测试；单一模板和桌面 Excel 入口；更新 package／CI | 当前源码、package.json、.github/workflows/ci.yml |

## 验收状态

本轮 Node、浏览器、原生句柄、301／1,000／5,000 条容量测试及实际性能见 [验证报告](reports/2026-11-17-v06-validation.md)。没有将旧报告结果算成本轮通过。

桌面 Excel gate **通过**：受限进程曾返回 0x80070520，改为受限环境外执行同一 npm run test:excel 后，在 Excel 16.0 完成重算／全表排序／筛选／保存→Tool 重开→再导出和连续两次新周期。真实验收发现的 Table 筛选脚本调用与 Historical 差分背景色问题已修复，模板／嵌入资产同步，回归通过。完整过程和合成文件证据见上述报告。

本轮已授权实现和验收完成；没有自动提交、推送或部署。不恢复旧金融流程，也不启动暂缓功能。
