# RouterStack Work Tracker — Codex 交接包

**整理于 2026-11-07。** 供用户把当前聊天的业务背景、已确认决策、历史方案、代码结构、下一步开发目标完整交给 Codex。

## 包含内容

- `CODEX_PASTE_PROMPT.md` — 可直接复制到 Codex 的第一轮审查指令。
- `local-reference/FULL_CONVERSATION_HANDOFF_PRIVATE.md` — 包含原 Excel 实际历史日期与金额的详细聊天总结。**本地参考，禁止提交 Git。**
- `repository/` — 在现有 `routerstack-work-tracker` v0.2.0 源码基础上加入以下文档的仓库副本：
  - `docs/PRODUCT_REQUIREMENTS.md` — 最新有效需求及三层架构、字段、计算、结算语义。
  - `docs/DECISION_HISTORY.md` — 已确认 / 废弃 / 替代的全部关键方案。
  - `docs/CODEX_AUDIT_AND_TEST_PLAN.md` — 现有技术契约、风险与回归测试矩阵。
  - `docs/CODEX_START_HERE.md` — 仓库内 Codex 导航和审查要求。

`repository/` 可用来新建 GitHub 仓库，或将这四份新增 docs 合入已有仓库。若已经有 Github 上的更新，请**不要整包覆盖已有代码**；仅挑选文档合并，并让 Codex 比较实际 Git HEAD。

## 推荐使用方法

1. 把 `repository/docs/*.md` 中新增的四份文档放进你的仓库的 `docs/`。
2. 复制 `CODEX_PASTE_PROMPT.md` 到 Codex 发起第一轮审查。
3. 如需要了解原始文件曾出现的具体金额差异，可把 `local-reference/FULL_CONVERSATION_HANDOFF_PRIVATE.md` **仅在本地**提供给 Codex，不要 git add 或推送。
4. Codex 先运行测试与对照需求，再给审查报告；确认后才实施业务逻辑修改。

## 重点边界

- 实际 Tool 是浏览器 HTML 小程序；XLSX 的 Tool Sheet 仅为只读指南/汇总。
- 工作数据只以保存的 XLSX 为准；修改 JS/模板不代表真实数据已更新。
- 真实 App 差异与已核实未结清金额不是一回事。
- 新建结算文件只能带入人工明确确认的 Invoice 余额。
- 早期对原 XLSX “部分行是硬编码值”的说法存在误判：原表的 D/F 公式包含 **shared formulas**，需用实际 XLSX 复核。
