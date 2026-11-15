# 文档入口

## 当前有效的工程文档

| 文件 | 唯一职责 |
|---|---|
| [PROJECT_GOAL.md](PROJECT_GOAL.md) | 目标、工作流程、产品要求、确认/假设、暂缓和排除范围 |
| [architecture.md](architecture.md) | 实际代码与 XLSX 数据契约，含现有复杂功能的兼容约束 |
| [roadmap.md](roadmap.md) | 实现状态、下一任务及验收条件 |
| [根目录 AGENTS.md](../AGENTS.md) | 开发操作约束与最低验证要求 |
| [根目录 README.md](../README.md) | 使用和本地开发说明 |

新会话先读 AGENTS → PROJECT_GOAL → roadmap；涉及数据读写再读 architecture。用户最新明确指令优先；产品范围与实际格式分开判断，冲突无法据确认要求解决时再询问。修改前核对实际工作区，不能把计划或本地未提交版本当已发布。

## 报告：按需查证，不作为当前要求

- [2026-11-15 范围审计与文档整理](reports/2026-11-15-scope-audit.md)：冲突裁决、实现差距、针对性验证及文档合并映射。
- [历史实施与验证](reports/validation-history.md)：v0.3/v0.4/A1–A3 的原始证据、版本和限制；未在本次分类时重新运行。

## 历史资料：追溯或兼容时查阅

- [旧 2.0/3.0 数据契约](archive/architecture-v3.md)：由当前架构引用，用于旧文件兼容。
- [决策演进](archive/decision-history.md)：保留旧决定的时间语境，冲突处以当前 Goal 为准。
- [2026-11-07 交接摘要](archive/handoff-2026-11-07.md)：合并原六份交接材料，已被替代的指令不再执行。

日常只维护当前文档；报告记录事实，归档保留历史。不要为同一目标另建需求/交接/实施计划副本。
