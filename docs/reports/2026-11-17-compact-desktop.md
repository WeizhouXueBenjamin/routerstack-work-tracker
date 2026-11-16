# 紧凑桌面 UI 实施与验收

日期：2026-11-17（Pacific/Auckland）。用户经过两轮偏好问答后确认本轮最终规格：Clean、Compact、Professional、Functional，仅桌面。此要求覆盖此前手机断点、上下布局、触控及 390px 测试要求。

## 恢复时的真实基线

HEAD 为 `0bf4e1641ded6698bedc9c09982b5591f0c3f157`。恢复时保留上一次宽松 UI 的未提交修改；紧凑方案停在 DOM／CSS／事件检查，尚未写入。实施前重新核对代码、数据契约和用户附件；`npm run check` 的 35 项 Node 测试及完整 64 项浏览器基线通过。

本次继续复用原 HTML／JS／JSZip、表单校验、模型命令及文件生命周期。没有框架、运行时联网依赖或新的业务功能。

## 实施 brief 与范围

任务是连续录入真实工作、即时核对八列记录、按需处理 Config／银行／未解决事项。视觉参考 VS Code、DBeaver、Excel 的信息密度和操作层级：13px 正文、34px 工作行、少量中性背景与分隔线；Historical 保持 `#f0f0f0`。移除品牌图标、宣传副标题、大标题、卡片、阴影、渐变、动画和全部手机专用样式。

- 顶部只留标题、周期／文件、保存状态和必要操作。Save／Save As 独立可见；文件失败另有持续提示，可手动关闭。成功写入并 close 或确认下载快照后才显示 Saved；并发新修改继续保持未保存。
- 左侧固定 320px，Start／End、Lunch／Rate 并排。新增时 Additional Details 收起 Invoice／App／Extra／Notes，连续录入保持展开偏好。Add Entry 紧接输入区；长表单只在左侧内部滚动。
- 点选行后由左侧统一查看、编辑、删除或返回新增。编辑强制展开全部工作字段，显示 type、Invoice、日期和时段；原始 ID 在 title 中保留。没有 Actions 列或逐行 Edit／Delete 按钮。选中行克制高亮，删除明确确认。
- Compact 默认 Notes 单行省略；Expanded 隐藏录入区与管理入口，Notes 完整换行且不限行。切换不重建表格，按可见行锚点维持滚动位置；搜索、筛选、选择和业务数据保持。存在未提交草稿时阻止进入 Expanded，并指明先提交或取消。
- Summary 位于右侧 Work Log 上方，四列及原计算语义保持；按真实月份生成，超过两个月可折叠较早月份。Historical 和 Total 始终保留；展开很多月份时汇总内部滚动，两端固定。
- Config／Bank Received／Unresolved 共用 520px 覆盖式右侧抽屉，同一时刻只显示一个，Work Log 宽度不被挤压。关闭保留表单和草稿；未提交时拒绝切换其他业务抽屉。Escape 关闭，焦点回到入口。打开干净抽屉后可以进入 Expanded，抽屉同时关闭。
- Config 先 Entry Defaults 再 Calculation Rules；保留规则变化预览／确认／取消／过期保护。取消规则草稿不会清除独立默认费率草稿。
- Bank 保留总额、日期／金额／备注列表及内联新增／编辑／确认删除。Unresolved 保留自动提醒、Manual Issues、Confirmed Balances 和专用历史；人工操作与结转入口固定在抽屉顶部，长自动提醒可折叠。

`WorkbookState`、schema 5.0、calculation 3.0、四 Sheet／八 Table、计费／提醒／余额／结转及保存保护算法均未更改。`src/core.js`、`src/model.js`、`src/reports.js`、`src/workbook.js`、`src/recent-file.js`、模板和嵌入资产与 HEAD 无 diff。`app.js` 文件操作段仅接入持久错误提示、显示状态及打开文件后的 UI 重置；三次 hash、权限、abort、write／close、版本接纳和旧快照确认规则保持。

## 两轮真实截图自查

按 distinctive-ai-design 的构图、层级、字体、间距、细节及主任务清晰度自查，没有使用独立评审代理。用户已有明确方向，因此直接实施该方向。

第一轮完成八列宽度、34px 行高和内部滚动；检查 Compact、Expanded、编辑、三个抽屉、草稿拦截及文件错误的实际截图。发现 Add Entry 离输入字段过远，以及长自动提醒把人工入口推到下方。第二轮将提交区接在输入后，压缩编辑身份信息，并把 Unresolved 常用操作固定在抽屉顶部，自动提醒增加原生折叠。第二轮以实际截图确认结果；未增加装饰元素或新导出功能。

截图仅含合成数据。通过开发验收脚本重新生成：

~~~powershell
node scripts/capture-desktop.mjs
~~~

默认目录为 `playwright-report/desktop-workbench/final/`（Git 忽略的本地验收产物）；第一轮保留于相邻 `review-1/`。该脚本只用于开发检查，不是产品内截图或报表功能。

| 视口（100%） | 左侧宽 | Summary 高度 | 行高 | 完整可见记录 | 表格横向滚动 | 页面整体滚动 |
|---|---:|---:|---:|---:|---|---|
| 1366×768 | 320px | 150px | 34px | 12 | 无 | 无 |
| 1920×1080 | 320px | 150px | 34px | 21 | 无 | 无 |

上表为 Historical＋单个 Current 月份＋Total 的 30 条合成记录场景。双月份场景 Summary 会再增加一行，1366×768 可见 11 条。文件错误条、多个未提交提示或较多展开月份会占用额外高度；不为固定行数缩小字体。Expanded 长备注超过两行仍完整展示，表格自身滚动；屏幕不能容纳任意长记录时不截断数据。

主要截图：[1366 Compact](../../playwright-report/desktop-workbench/final/compact-1366.png)、[1920 Compact](../../playwright-report/desktop-workbench/final/compact-1920.png)、[1366 Expanded](../../playwright-report/desktop-workbench/final/expanded-1366.png)、[记录编辑](../../playwright-report/desktop-workbench/final/editing-record.png)、[Config](../../playwright-report/desktop-workbench/final/drawer-config.png)、[Bank](../../playwright-report/desktop-workbench/final/drawer-bank.png)、[Unresolved](../../playwright-report/desktop-workbench/final/drawer-unresolved.png)、[草稿保护](../../playwright-report/desktop-workbench/final/protected-drawer-draft.png)、[文件错误](../../playwright-report/desktop-workbench/final/persistent-file-error.png)。机器测量见同目录 `measurements.json`。

## 最终检查

| 检查 | 本轮实际结果 |
|---|---|
| `npm run check` | 通过：JS 语法、模板同步、35 项 Node 测试 |
| `npm run test:e2e` | 通过：74 项，50.2 秒；12 项桌面 UI 场景加既有业务／文件回归 |
| `npm run test:native` | 通过：真实临时 XLSX；重启后 denied 权限安全降级、重选后重读实际磁盘的 2 项工作；存储仍仅 handle/name/writable |
| `node scripts/capture-desktop.mjs` | 通过：1366×768／1920×1080、两种模式、编辑及三个抽屉、草稿保护、持续文件错误；无浏览器 pageerror |
| `git diff --check` | 通过 |
| 桌面 Excel | 本轮未运行／未验证：未改 schema、模板、公式或解析导出，不以历史结果作为本轮证据 |

完整浏览器回归包括实际新增→保存→重开→连续两次结转；301／1,000／5,000 条动态容量；损坏及额外数据拒绝；Config 预览／取消／过期；独立事项／余额与银行 CRUD；三阶段外部冲突、abort、close 门禁、并发新修改、旧下载确认及归档保护。

本轮原生句柄合成证据目录：`C:\Users\benja\AppData\Local\Temp\routerstack-native-wCpLIL`。5,000 条合成记录本轮写入约 821ms、读取约 2931ms、界面渲染约 227ms、筛选约 29ms；只代表本机本次样本，不承诺 Excel 极限容量。

浏览器键盘检查覆盖 Tab、Enter 提交、Notes 换行、composition／IME 事件保护、重复 Enter、工作行方向键／Enter、抽屉 Escape 和焦点返回；不声称覆盖所有 Windows 实体输入法。应用按离线文件方式运行，测试中权限／写入失败与三阶段冲突使用可控夹具；原生句柄另由真实临时 XLSX 测试验证。

没有提交、推送或部署，也没有读写真实财务工作簿。
