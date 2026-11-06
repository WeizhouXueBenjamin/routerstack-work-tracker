# Codex: 开始之前

项目：RouterStack Work Tracker / v0.2.0 baseline。目标是在现有 GitHub repository 上继续开发 **Tool（真正可操作的小程序）— Work Log（唯一工作事实）— Config（估算规则）** 三层结构。

请先阅读：

1. `AGENTS.md`
2. `docs/PRODUCT_REQUIREMENTS.md`
3. `docs/DECISION_HISTORY.md`
4. `docs/architecture.md`
5. `docs/CODEX_AUDIT_AND_TEST_PLAN.md`
6. `README.md`、`docs/roadmap.md` 及实际 `src/app.js` 和测试。

首先执行 `npm run check`，核对文档与实际源码/模板是否相符。**第一轮先审查与提出优化实施方案，不要擅自修改金额算法、业务规则、sheet 列结构或真实工作数据。**

### 需要优先回答

- 当前功能哪些已经实现、哪些只是讨论建议、哪些实现与已确认需求有偏差？
- 新增/编辑/保存/重开/结转是否存在数据丢失、错位、重复计算的风险？
- 在尽量减少录入的同时，如何增强异常提醒、月度统计、给 Tim 的对账输出？
- 如何在不引入数据库/后端、不依赖云同步的前提下，让 Tool 和 XLSX 版本可控、长期兼容？
- 哪些计费规则仍待用户确认，不能擅自当成官方政策？

报告内容：问题清单（按 P0/P1/P2 严重度）、证据/源码定位、修复方案、测试计划、可能影响旧文件的兼容风险。确认方案后再开展代码改动。

不允许：虚构真实 Invoice ID/工时/收款；仅凭银行总额推断具体漏付项；将 App Displayed 当成已付款；把 Lunch 恢复为勾选框；重新加入已取消的历史迁移流程和逐笔付款状态；直接公开或提交真实财务数据。
