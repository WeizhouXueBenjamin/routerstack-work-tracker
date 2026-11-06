# RouterStack Work Tracker

> Offline-first personal work-hour and invoice reconciliation tool for data centre field work. 
> 本项目为个人记录及对账工具，并非 RouterStack 官方软件。

## 当前版本

- **v0.2.0 baseline** — 由已测试的 V2 离线 HTML 工具拆分为可维护的源码目录；保持现有业务行为。
- 中文操作界面，英文数据字段。无需服务端、数据库、云账号或 Excel 宏。
- 一笔工作对应一张 Invoice；同一天多笔工作分开记录。
- `Lunch (h)` 输入数字小时，空白按 0；`Billable (AH)` 使用类似 `8.75 (1.75)` 的展示方式。
- 自动 Estimated / App Displayed 差异提示；结算后仅结转经确认的 Invoice 余额。

## 开始使用（离线）

直接双击 `index.html`，用 Chrome 或 Edge 打开。可以在工具内新增工作、打开既有 V2 Excel、保存 Excel、创建新周期。**任何未显式保存的数据都不保证持久化**。

> 你正在编辑的是浏览器内存中的记录。保存按钮可能下载一个新的 Excel 文件；下次录入务必重新打开最新的文件。不要同时在 Excel 与 Tool 中修改相同的工作簿。

## 本地开发

需要 Node.js >=22，但**正常使用不需要 Node.js**：

```powershell
npm run dev
```

浏览器打开 `http://127.0.0.1:4173`。也可双击 `index.html` 进行离线回归检查。

```powershell
npm run check             # JS syntax + embedded template match + unit tests
npm run template:sync     # 修改 Excel 空白模板后再执行
```

没有 npm runtime 依赖，无需 `npm install`。

## 仓库结构

```text
routerstack-work-tracker/
├─ index.html                    # Tool UI
├─ src/
│  ├─ app.js                    # 表单、Excel 读写、结转逻辑
│  ├─ styles.css                # 界面样式
│  └─ template-data.js          # 由空白模板生成的 Base64（勿手改）
├─ templates/
│  └─ RouterStack_Tracker_V2_Blank.xlsx
├─ vendor/
│  ├─ jszip.min.js              # JSZip v3.10.1，离线 Excel ZIP 操作
│  └─ JSZip_LICENSE.markdown
├─ scripts/                     # 本地开发服务器、模板嵌入
├─ tests/                       # 无外部依赖的基础回归测试
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
- 目前计费规则为工具估算假设，不能替代 RouterStack 的实际计费条款。

## 后续开发优先级

1. 端到端浏览器自动化：录入 → 保存 → 重新打开 → 差额与结转的回归测试。
2. 严格版本化 Excel schema 与校验，让历史周期文件安全可读。
3. 改善文件保存体验（保存提醒、文件名、是否已修改）。
4. 仅在确有必要时考虑框架、数据库或托管部署。

当前**不**启用 GitHub Pages 或任何自动发布流程；代码在本地运行，工作数据留在本地。
