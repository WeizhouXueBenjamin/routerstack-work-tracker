# RouterStack Work Tracker

> Offline-first personal work-hour and invoice reconciliation tool for data centre field work. 
> 本项目为个人记录及对账工具，并非 RouterStack 官方软件。

## 当前版本

- **v0.3.0** — 增加记录防覆盖、草稿保护、另存版本、严格 XLSX 校验和显式升级预览；新工作簿 schema 为 **3.0**。
- 中文操作界面，英文数据字段。无需服务端、数据库、云账号或 Excel 宏。
- 一笔工作对应一张 Invoice；同一天多笔工作分开记录。
- `Lunch (h)` 输入数字小时，空白按 0；`Billable (AH)` 使用类似 `8.75 (1.75)` 的展示方式。
- 自动 Estimated / App Displayed 差异提示；结算后仅结转经确认的 Invoice 余额。
- 默认 AH 每日 **18:00–次日 06:00**、1.5 倍、最低 2h；扣 Lunch 后按普通／AH 占比分配最低工时。这些默认规则已由用户确认，实际配置仍以文件为准。

## 开始使用（离线）

直接双击 `index.html`，用 Chrome 或 Edge 打开。新增工作后先点击“添加这项工作”，再“另存新版本 Excel”。**任何未显式保存的数据都不保证持久化**。

> 有文件选择器时，选择新的版本文件名，写入完成后才显示已另存；下载模式只显示“已发起下载，待确认保留”。检查文件已保留后点击确认，或重新打开下载文件。确认较早的导出不会清除后来修改。下次务必打开最新保留的文件；Tool 和 Excel 可以先后编辑，避免同时修改同一份数据。

旧 `2.0` 工作簿只读打开；点击“预览升级为 3.0”，核对逐笔金额变化后再确认并另存，原文件保持归档。Excel 修改 Config 后重开也会要求确认整周期规则差异。当前只支持精确的 `2.0` 与 `3.0`，不自动迁移其他历史格式。

Excel 可修改原始字段和 Config；时间、Extra、Carryover 在隐藏的 K:O 中，需先取消隐藏。不要改计算公式、表头或列顺序。详细接口及限制见 [数据契约](docs/architecture.md)，开发入口见 [CODEX_START_HERE](docs/CODEX_START_HERE.md)。

本轮浏览器与桌面 Excel 验证结果见 [验证记录](docs/VALIDATION_REPORT.md)。

## 本地开发

需要 Node.js >=22，但**正常使用不需要 Node.js**：

```powershell
npm run dev
```

浏览器打开 `http://127.0.0.1:4173`。也可双击 `index.html` 进行离线回归检查。

```powershell
npm run check             # JS syntax + embedded template match + unit tests
npm run template:sync     # 修改 Excel 空白模板后再执行
npm ci                    # 以下浏览器回归所需的开发依赖
npx playwright install chromium
npm run test:e2e          # 离线浏览器流程、错误导入、保存及升级回归
npm run test:excel        # Windows + 已安装桌面 Excel
```

没有 npm runtime 依赖；日常使用和基础检查无需安装依赖。Playwright 仅供开发测试，安装时需要联网，应用运行不联网。可设置 `TEST_BROWSER=chrome` 或 `msedge` 验证已安装的浏览器。Excel 测试只在系统临时目录生成合成数据，不访问个人工作簿。

## 仓库结构

```text
routerstack-work-tracker/
├─ index.html                    # Tool UI
├─ src/
│  ├─ app.js                    # 表单、保存状态、升级预览、结转
│  ├─ core.js                   # 版本化计算、字段验证、公式定义
│  ├─ workbook.js               # XLSX 解析、公式校验、导出
│  ├─ styles.css                # 界面样式
│  └─ template-data.js          # 由空白模板生成的 Base64（勿手改）
├─ templates/
│  ├─ RouterStack_Tracker_V2_Blank.xlsx # 原版保留
│  └─ RouterStack_Tracker_V3_Blank.xlsx # 当前默认
├─ vendor/
│  ├─ jszip.min.js              # JSZip v3.10.1，离线 Excel ZIP 操作
│  └─ JSZip_LICENSE.markdown
├─ scripts/                     # 本地开发服务器、模板嵌入
├─ tests/                       # 基础单元测试 + Playwright 浏览器回归
├─ docs/architecture.md         # Excel schema / 数据契约
├─ AGENTS.md                     # Codex/AI 开发准则
└─ .github/workflows/ci.yml     # push / PR 自动检查
```

## GitHub 初始化（推荐 Private）

1. 在 GitHub 新建空仓库：`routerstack-work-tracker`，选择 **Private**，不要重复勾选自动创建 README / `.gitignore` / License。
2. 解压本仓库压缩包，在其根目录执行：

```powershell
git init -b main
git add .
git status
git commit -m "chore: establish V2 project baseline"
git remote add origin https://github.com/<YOUR_USERNAME>/routerstack-work-tracker.git
git push -u origin main
```

记得用自己的 GitHub 用户名替换 `<YOUR_USERNAME>`，不要原样执行。GitHub CLI 可改用 `gh repo create ... --source=. --private --push`，不要重复执行两种创建方式。

## 数据与安全

- **仓库只包含空白 Excel 模板**。`.gitignore` 屏蔽普通 `.xlsx`、CSV、PDF、备份及个人工作数据目录。
- GitHub Private 也不适合存储银行凭证或真实工资记录；请将个人记录存储在仓库之外并自行备份。
- JSZip 第三方授权见 `vendor/JSZip_LICENSE.markdown`；项目源代码暂未指定开源许可证。
- 默认计费规则由用户于 2026-11-07 确认，估算不代表实际付款或税后收入。银行到账与逐笔 Invoice 不会自动匹配。

## 后续开发优先级

1. 月度视图与异常／缺失筛选，分开本期工作收入和结转。
2. 增强 Tim 清单与轻量结算证据台账，具体范围另行确定。
3. 持续维护 XLSX 兼容回归；不自动迁移归并历史周期。

当前**不**启用 GitHub Pages 或任何自动发布流程；代码在本地运行，工作数据留在本地。
