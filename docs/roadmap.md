# 维护与后续方向

产品范围以 [Project Goal](PROJECT_GOAL.md) 为准，格式与实现以 [architecture.md](architecture.md) 为准。本文件只描述后续工作方向，不作为功能授权或测试通过证明。

## v0.1.0 PR 准备

目标是形成简洁、准确、可维护的首次正式 PR 基线：

- 统一未发布的应用版本及开发命令，保持 schema 5.0／calculation 3.0。
- 以 README、Project Goal、architecture、roadmap、AGENTS 五份文件明确文档职责。
- 移除已被当前契约取代的开发历史和重复入口，保留有效约束及可复现的合成测试。
- 核对离线运行资产、测试引用、隐私忽略规则和本轮实际验证结果。

本地整理不等于发布。提交前应复核 diff；本轮不自动提交、推送、创建 PR、打标签、发布 Release 或部署。

## 后续维护

以下是维护方向，具体修改仍须按任务明确范围：

- 根据真实使用中可复现的问题修复缺陷，优先保护草稿、保存、重开及跨周期完整性。
- 保持开发脚本、CI 和文档命令一致；依赖升级与兼容验证单独评估。
- 按实际需要复核桌面 Chrome／Edge 和目标 Excel 环境，不将历史通过记录当成当前保证。
- 源码重构仅在能说明具体维护收益、控制行为影响并获得授权后单独进行。

新增业务功能、移动端或远程服务不包含在维护默认范围。暂缓项和提案门槛见 Project Goal。

## 发布前检查

应用版本、XLSX schema 和 calculation version 独立管理。版本调整前检查 Git tags／Releases，不覆盖已发布版本，不伪造历史 Release 或 Changelog。

验证要求见 [AGENTS.md](../AGENTS.md)，命令说明见 [README.md](../README.md#development--testing)。交付说明应记录本次实际命令、结果和未验证项；CI、桌面 Excel 与发布状态分别报告。
