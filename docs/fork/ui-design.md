# DSH Tavern 私有 fork · UI 标准

<!-- private fork (owner 2026-10): the one authoritative UI standard. Keep ≤ 250 lines (tests/fork-ui-standard.test.mjs). -->

适用于 `tavern-plugin/src/client/**`、`lib/client-assets/fork-*.css` 与 `packages/dsh-tavern-ui`。**冲突时以本文为准**：[panel-ui-design.md](panel-ui-design.md) §一–§二 的旧视觉规格（如分节标题左侧强调色竖线、带框输入框）作废；功能决定与舞台主题详表见 [ui-notes.md](ui-notes.md)；表面/对比度实现见 [ui-surfaces.md](ui-surfaces.md)。组件效果图：`output/ui-standard/GALLERY.html`；现状偏差与迁移批次：`output/ui-standard/AUDIT.md`。

## 做 UI 任务前必读

1. 先在 §三 找到要用的组件，只用它的「唯一实现」；没有合适的组件先问主控，不要新写同类组件或复制一份。
2. 逐条自查 §一 主人裁决（R1–R20）。
3. 颜色只用 §二 的 token，字号只用 `--fork-fs-*`；不写颜色字面量、不写 px 字号。
4. 不用原生 `select` / `range` / `color` / `checkbox` / `radio`，不裸写 `input` / `textarea`，不用 `window.confirm` / `alert`。
5. 键盘走一遍：Tab 能到、Enter/Space 能用、Esc 先关最里层（菜单 → 编辑 → 多选 → 子页 → 弹窗）。
6. PC（≥1200px）与 375px 各看一遍：不横向滚动、点按区 ≥30px（手机 ≥36px）、文字不压叠。
7. 加载（`ForkSpinner`，150ms 后出现）、空（一个短语）、错误（⚠ + 一句 + 动作）三态都要有。
8. 跑 `node --test tests/fork-ui-standard.test.mjs tests/fork-surfaces.test.mjs`；修掉旧违例后 `node tests/helpers/fork-ui-standard-audit.mjs --write` 缩小 allowlist。
9. 截图给主人前对照 GALLERY；改了规则同步本文，不另写一份。

## 一、主人裁决（逐字执行）

- **R1** galgame 气质；PC 与手机都要好用。
- **R2** 不框中套框；不加强调色竖条（accent bar）；不用原生控件；不显示内部 id。
- **R3** ⚠ 只用于真正的警告；解释只放在 (?) 里，一句话。
- **R4** 添加 = 无文字的虚线 ＋；不写啰嗦的标签，除标题计数外不加计数。
- **R5** 标题顺序：标题 → 计数 → (?)；每一级标题都可折叠，折叠状态持久保存。
- **R6** 子页用统一的 ‹ 返回头，Esc 返回。
- **R7** 文本字段用 `ForkInlineField`。
- **R8** 素材包状态：全局 = 蓝，本卡 = 绿，关 = 灰色空心；条目灯 蓝/绿/关 用下拉。模组只用全局 `ForkSwitch`，没有本卡启用；模组设置有全局 / 本卡两层（§三.25–28，主人 2026-10 批准 config-proposal），改过的项打 `ForkOverrideDot`（本卡绿、全局蓝）。正文提示词页显示会话/压缩周期的实际快照，配置编辑器显示当前配置。
- **R9** 瓦片上不放 ⋯ 或常驻按钮。操作在网格下方的详情块里；差分 / 设定图这类素材格可以带本格菜单，按格子状态列出 生成… / 重画… / 上传 / 设置回退 › / 删除…（主人 2026-10-15 U1）；按输入方式（点按的 `pointerType`，否则 `pointer: coarse`，不看宽度）：触屏点一下打开；鼠标左键做主操作（选中 / 查看），右键或 Shift+F10 / 菜单键打开（主人 2026-10-17）。**唯一实现** `fork-asset-pack-card-ui.js` `cellMenuTrigger`。
- **R10** 缺素材：编辑器里是带 ✦ 的虚线瓦片；运行时用平和差分 + ⚠ 芯片（设了回退则静默用「回退为」的差分）；永不出现占位图。
- **R11** 面向用户的术语：差分 / 漫符 / 模组。
- **R12** 文字最少；简单、统一，不搞特例。
- **R13** 删除等破坏性操作不做成常驻的操作行或瓦片按钮：批量删除放在分节标题 ⋯ →「删除…」，进入多选模式（§三.15）；有本格菜单的格子（R9）可在菜单末尾放红色「删除…」，分隔线隔开，点后二次确认。同一编辑器里有不同范围的删除时，名称写明删什么（「删除这张头像…」在格子菜单，「删除差分…」「删除服装…」在分节 ⋯），每种范围只在一处；确认框说清删掉什么、保留什么（主人 2026-10）。
- **R14** 同一设置已在别处配置时，不再加「默认」之类的重复徽标（例：开场服装在「开场」里设置，服装瓦片上不标「默认」或「开场」）。
- **R15** 设置界面与浮层不透明；只有舞台全屏覆盖层可以玻璃化（§二.5）。
- **R16** 全页最多一个实心主按钮；其余是安静的文字或图标按钮。
- **R17** 即改即存；只有草稿型页面（引擎设置）才有「保存」，旁边写「有未保存的修改」。
- **R18** 空状态是一个短语（「还没有素材包」），不附解释。
- **R19** 悬停提示只写控件名称，不夹带诊断或内部键名。
- **R20** 动效不跟随系统「减少动画」：`prefers-reduced-motion` 规则一律写在 `and (update: none)` 后。
- **R21** 模组（及舞台功能）的设置按使用频率放且只放一处（主人 2026-10）：**舞台右上角快捷入口**只放最高频的开关（例：弹幕 开/关 + 飘屏 / 直播风格 / 关闭）；**舞台设置（Esc › 设置）**放本局临时、常调的（例：飘屏的显示区域 / 不透明度 / 字号、密度）；**右侧 模组设置页**放引擎级、设一次的（模型、调用节奏、素材/观众群管理），模组总开关仍是基础设置里那一行。不在第二处复制同一项。

## 二、颜色与主题

### 2.1 三层 token

| 层 | 定义处 | 谁读 |
|---|---|---|
| 宿主色 `--dsw-*` | 宿主，挂在 `<body>`（不是 `:root`） | 只给 `fork-surfaces.js` 取色与 `--fork-*` 别名 |
| 调色板 → 表面级 | `fork-surfaces.cjs`：7 个上下文（`chat-light`/`chat-dark`/`stage-classic`/`gothic`/`magical`/`crt`/`aero`）× 8 级（`base` `raised` `popover` `modal` `toast` `stage-hud` `stage-panel` `stage-textbox`），校验对比度后输出 `--fk-s-<级>-<色>` 与当前级 `--fk-current-<色>` | 组件 |
| 语义别名 | 聊天/面板：`--fork-*`（shell.css 与本文 token 区块）；舞台：`--gal-ui-*`（fork-theme.css「stage UI tokens」区块） | 组件只读这一层 |

语义 token（面板侧 → 舞台侧）：

| 语义 | 面板 | 舞台 | 说明 |
|---|---|---|---|
| 表面 1/2/浮起 | `--fork-surface` `--fork-surface-2` `--fork-raised` | `--gal-ui-surface` `--gal-ui-surface-2` | 不透明；行状态 `--fork-hover` / `--fork-accent-soft`（`--gal-ui-hover` / `--gal-ui-active`） |
| 文字 1/2/3 | `--fork-ink` `--fork-ink-2` `--fork-ink-3` | `--gal-ui-ink` `--gal-ui-ink-2` `--gal-ui-ink-disabled` | 正文 ≥4.5:1，次要/图标 ≥3:1；禁用用 `--fk-current-dim` 滤镜，不用透明度 |
| 边线 | `--fork-hairline` | `--gal-ui-line` | 只有一道发丝线 |
| 强调 | `--fork-accent`（跟随皮肤品牌色）、实心底 `--fk-current-fill` + 字 `--fk-current-onAccent` | `--gal-ui-accent` / `--gal-ui-accent-ink` | 选中、链接、焦点；**不**表示状态 |
| 状态 全局/本卡/关 | `--fork-state-global` / `--fork-state-card` / `--fork-state-off` | — | 蓝 / 绿 / 灰空心；不随皮肤变 |
| 灯 蓝/绿/关 | `--fork-lamp-blue` / `--fork-lamp-green` / `--fork-lamp-off` | — | 与状态同色同义：蓝 = 始终，绿 = 有条件，灰 = 关 |
| 警告 / 危险 | `--fork-warn` / `--fork-danger` | `--gal-ui-widget-warning` | ⚠ 只用警告色；删除等危险文字用危险色 |
| 焦点 | `--fork-focus`（`outline` 值） | `--gal-ui-focus` | 2px，键盘可见 |

新 token 定义在 `fork-theme.css` 的 `/* ==== fork UI standard tokens ==== */` 区块；颜色字面量只允许出现在该区块、舞台 token 区块和 `fork-surfaces.cjs`。

### 2.2 明暗

- 聊天/面板：宿主 `--dsw-*` 决定明暗，`fork-surfaces.js` 据底色选 `chat-light` / `chat-dark`；组件不写 `[data-theme]` 或明暗分支。卡片可用 `data-dsh-card-stage-scheme` 只给游玩区换明暗。
- 舞台：主题自带明暗（classic/gothic/crt 暗，magical/aero 亮），与宿主明暗无关；预览元素用 `.fork-gal-theme-scope[data-theme]`。
- 两边都只有一套组件规则，明暗差别全部在 token 里。

### 2.3 舞台皮肤能改什么

- **可设**：`stageSkinTokens()`（`fork-stage-skin.cjs`）产出的 `--gal-skin-*`（文本框、姓名牌、快捷菜单、圆角、边框、字体）与 `stageSkinPanelTokens()` 派生的 `--gal-base-*` / `--gal-ui-*`（CONFIG、履历、字幕、按钮、HUD），以及 `--fk-s-stage-textbox-*`。皮肤作者只写 `textbox.paint` / `nameplate.paint` / `ui` 的种子色，派生与对比度由代码保证。
- **不可设**：`--fork-*`、`--dsw-*`、状态/灯/警告/危险色、聊天上下文的任何 token、布局尺寸；也不能让设置面板透明。

### 2.4 形象色（`imageColor ?? autoColor`）

- 可以着色：姓名牌底色与描边（`--bubble-color`）、对白气泡与头像圈、履历行的强调（`--row-color`）、人物瓦片的地面光晕（`--figure-color`）、翻页提示宝石、漫符/特效。
- 不可以：正文文字（除非皮肤显式给了文字色，否则按实际底色修正对比度后才可用于姓名文字）、面板表面、状态/灯、按钮、焦点环、⚠。
- 一处取值：`figureColor()`；回退色由 token `--fork-figure-fallback` 给，不写 `#789080` 之类字面量。

### 2.5 透明度规则

设置界面、菜单、弹窗、(?) 提示永远不透明（`.fk-surface` 表面级）；舞台全屏覆盖层（履历、文本框）可以玻璃化，背后是画面而不是文字。拿不准就不透明。实现与 ratchet 见 [ui-surfaces.md](ui-surfaces.md)。

### 2.6 字号、间距、圆角

| token | 默认（标准档） | 用途 |
|---|---|---|
| `--fork-fs-title` | 18px / 600 | 页标题、子页标题 |
| `--fork-fs-heading` | 15px / 600（比正文高一档「界面大小」） | 分节标题（`StageSection` 一级，各面板同一处）；分节内的组标题（提示词的「正文模型 / 导演 / 判断模型」、二级 `StageSection`）用 `--fork-fs-body` / 500 `--fork-ink-2`：分节 > 组 > 行（主人 2026-10） |
| `--fork-fs-body` | 13px / 400 | 正文、字段、按钮 |
| `--fork-fs-meta` | 12px / 400 `--fork-ink-3` 等宽数字 | 计数、徽标、次要值 |

全部随「界面大小」（`--fork-ui-size`）缩放。面板只用这四档；舞台覆盖层用 `--gal-ui-*` 的响应式字号。间距 4 的倍数：行内 8px、行距 8px、分节 24px；圆角 `--fork-radius`（8px，控件）/ `--fork-radius-lg`（12px，瓦片、弹窗）。窄布局：视口 ≤720px 或面板容器 ≤560px（`@container`）。

## 三、组件

每项：何时用 · 结构 · 状态 · 键盘 · 375px · **唯一实现**（文件:函数）。未列出的组件先问主控。

1. **分节标题** — 页面里的每一个分组。结构 `[标题 计数 ⌄](按钮) (?) … 动作区`；计数 `--fork-fs-meta`，⌄ 12px `--fork-ink-3`，没有竖条和底框。状态：展开/折叠（`hidden` 保留子树）、被依赖阻塞（变灰 `inert` +「需要… · 去开启」）。键盘：标题按钮 Enter 折叠。375：动作区可换到第二行。折叠记忆 `useStageFold(foldKey)`（`dsh-tavern:stage-panel-folded`）。**唯一实现** `fork-asset-pack-card-ui.js` `StageSection`；二级标题同一组件（`level` 参数在迁移批次 1 加入，此前不新增 `.ap-sub` 标题）。
2. **子页 ‹ 返回头** — 任何从列表/设置进入的二级页。结构 `‹ 标题 (?) …工具`，‹ 是安静的图标按钮，名称与悬停提示「返回<上级>」；没有面包屑。Esc 返回（`subpageKeys`，内部先处理的 Esc 优先）。**唯一实现** `fork-asset-pack-ui.js` `SubpageHead`。
3. **(?) 说明** — 名称不够自明时。紧跟名称的小「?」字形：无圆圈、无底色，字号 `--fork-help-size`（所在行的 .72em），颜色是所在行文字色按 `--fork-help-dim`（45%）淡化，悬停/键盘聚焦/打开时恢复全色（主人 2026-10 选定方案 A）。悬停/聚焦/点按显示一句话的不透明浮层，Esc/点外面关闭，`aria-describedby` 关联；是可 Tab 到的按钮。375/触屏：点按区靠 padding 扩到 ≥ 32px，用等量负 margin 抵消，字形和行高不变。舞台、履历、CONFIG 里同一外观，不另做变体。不放在 `<label>` 里、排在控件前。说明里要放链接（许可页）时用 `interactive`：浮层可点、指针移过去不关，Tab 从「?」进入链接、走出最后一个即关，Esc 回到「?」。**唯一实现** `fork-settings-ui.js` `ForkHelpTip`（素材面板经 `createForkAssetPackUI({HelpTip})` 注入为 `Help`）。
4. **文本 / 数字字段** — 一切「标签 + 值」。值读作文字，悬停淡下划线，编辑时强调色下划线；Enter/失焦保存，Esc 撤销；校验失败留草稿并显示一行 `role=alert`。整格可点。375：单列、行高 44px。**唯一实现** `fork-inline-field.js` `ForkInlineField`（`text`/`number`/`link`），容器 `ForkInlineGrid`，包住其他控件用 `ForkInlineRow`。
5. **下拉选择** — 选项 >3 个或文字较长。读作「当前值 ⌄」，浮层挂 `<body>`，翻转/贴边，选中项带 ✓；↓ 打开、↑↓ Home End、Esc 关回值上、Tab 关闭。**唯一实现** `ForkInlineField kind:'menu'`（浮层 `useForkInlinePopup`）。
6. **分段选择** — 2–3 个短选项且都值得一直看见（视图切换、白天/黄昏/夜晚）。浅底槽，选中段为不透明表面 + 轻阴影；`role=radiogroup` + `role=radio`，←→ 移动。375：撑满宽度。**唯一实现** `fork-inline-field.js` `ForkSegmented`（原 `CatSegment`；roving Tab，←→ Home End 选择；素材面板里叫 `Segmented`，`base` 换皮：面板 `.ap-segmented`，舞台 CONFIG `.fork-gal-config-seg`）。灯不用分段（R8）。模组设置不用分段表示「写法」（§三.26）。
7. **开关** — 立即生效的开/关。结构「图标 名称 (?) ……开关」，36×20 胶囊，开为强调色；依赖未满足时变灰禁用，(?) 写「需要…」；状态词不另写。**唯一实现** 面板行 `fork-asset-pack-card-ui.js` `SwitchRow`；开关本身是 `fork-inline-field.js` `ForkSwitch`（全局，唯一允许原生 checkbox 的地方；SwitchRow 用 `bare`，聊天侧设置行「调试视图 / 卡片脚本」用轨道皮 `.dsh-tavern-settings-switch`）。舞台 CONFIG 内同形（`ForkGalConfigSwitch`，button `role=switch`，无状态词），用 `--gal-ui-*` 着色。有详情页（›）的行（`SwitchRow onOpen`）：除开关外整行点击进入详情，悬停整行变底、键盘 Enter 在 › 上（焦点环画在整行）；只有开关切换（Space）；没有详情页的行整行切换（主人 2026-10）。
8. **滑杆** — 连续数值（音量、倍速、强度）。轨道 + 填充 + 圆钮，右侧读数；拖动预览、松手保存；←→↑↓ 步进、Home/End。`role=slider` + `aria-valuetext`。松手时在轨道上发出冒泡的 `change`（舞台界面音效据此放音）。**唯一实现** `fork-inline-field.js` `ForkSlider`（`skin` 换皮：面板 `ap-slider`、舞台 `fork-gal-slider`、BGM `fork-bgm-slider`）；`VolumeSlider`（百分比）与声音调参 `TuneSlider` 只是包装。
9. **颜色** — 形象色、组件颜色。读作色块 + 名称，浮层是「自动」+ 自动色的深浅色块 + hex 字段。**唯一实现** `ForkInlineField kind:'color'`；没有预设调色板常量（批次 18：色块由 `figureColorShades(auto)` 生成，只有数据自带 palette 的模组字段例外）。
10. **状态芯片 全局 / 本卡 / 关闭** — 素材包、模组、模组库的素材包行，处处同一个尺寸（主人 2026-10 选定小号纯文字款）：24px 胶囊，只有词「全局」「本卡」「关闭」（`--fork-fs-meta`），无灯点、无 ⌄；全局 = 蓝填充 16%，本卡 = 绿填充 16%，关闭 = 灰色空心（1px `--fork-state-off` 描边，无填充）。点开同一个三项菜单，菜单项带灯点（蓝 / 绿 / 灰空心）与 ✓。忙时词前一个小转圈。**唯一实现** `fork-asset-pack-ui.js` `PackStateTag`（大号带灯的 `PackStatePill` 已删除）。
11. **条目灯 蓝 / 绿 / 关** — 条目、人物、服装、CG 的触发策略。一颗 7px 灯点 `.ap-lamp-dot`（关 = 灰空心圈），点开下拉：蓝灯 / 绿灯 / 关闭（演出风格等为 启用 / 关闭），选中带 ✓；点击不选中所在行。375：点按区 36px。**唯一实现** `fork-asset-pack-entry-ui.js` `LampMenu`（行内只有灯点；「标签 值」行里与人物名旁的人物灯 `named` 读作「● 绿灯 ⌄」；服装瓦片角上的灯同为 `LampMenu`；分段式 `LampSwitch` 已删除）。
12. **标签 / 触发词芯片** — 别名、触发词、分类。芯片 + 删除 ✕ + 末尾无文字的虚线 ＋（聚焦展开为输入）；Enter、逗号添加。**唯一实现** `ForkInlineField kind:'chips'`。
13. **瓦片网格 + 详情块** — 服装、差分、CG 变体、声音预设。瓦片只有图、名称、角上的灯；点选高亮，选中项的全部操作与字段在**网格下方**的详情块里（`ForkInlineGrid`）；右键不弹菜单。375：每行 3–4 个。**唯一实现** 服装网格 `fork-asset-pack-figure-ui.js` `FigureOutfitTile`（去掉 `TileMenu` 后，迁移批次 2）。
14. **⋯ 菜单** — 分节或页头的次要/破坏性操作，只出现在标题行末尾（不在瓦片、不在行上）。30px 图标按钮，菜单项是动词，危险项危险色并以「…」结尾表示还有一步。**唯一实现** `fork-asset-pack-card-ui.js` `Popover` + `MenuItem`，触发器 `IconButton icon:'more'`。
15. **多选模式（选择 → 删除 / 导出）** — 唯一的批量选择组件。入口：⋯ →「删除…」（或素材包「导出」、舞台素材批量导出）。进入后：瓦片左上角/行首出现自绘勾选框 `.ap-check-mark`（`role=checkbox`，点整块即切换），标题动作区换成「已选 N」（`role=status`）·「取消」·「删除」（危险色，N=0 时禁用）；瓦片上的灯和其他操作暂时隐藏。「删除」弹 `ConfirmDialog danger`，一句后果；完成或「取消」或 Esc 退出并把焦点还给 ⋯。**唯一实现**：现有形态是 `fork-asset-pack-ui.js` 舞台素材首页的批量导出（`ap-pack-check` + `ap-select-count` + `ap-manage`）；抽成共享的 `useSelection()` + `SelectBar({count, action, danger, onAction, onCancel})` 放在 `fork-asset-pack-ui.js`（`Button` 旁），人物编辑器的删除（进行中）是第一个使用者，素材包「管理/导出」随后迁移。
16. **对话框 / 确认** — 需要决定或多步表单时；不用 `window.confirm`。不透明 `.fk-surface` 弹窗，标题 + ✕，焦点进入并被困住，Esc/✕ 关闭（忙时禁用），关闭后焦点回到触发处；确认框只写一句后果，按钮「取消」+ 动词。375：全屏底部动作栏。**弹层栈**（主人 2026-10）：所有弹窗与菜单按打开顺序登记在 `fork-inline-field.js` `useForkOverlay`；点外面或 Esc 只关最上面一层（确认框 = 取消，忙时不关）；文本框里有未保存的输入时，点外面只结束编辑（失焦即存或留草稿），不关弹层。**唯一实现** `fork-asset-pack-ui.js` `Modal`、`fork-asset-pack-card-ui.js` `ConfirmDialog`，表单型用 `fork-asset-pack-catalogue-ui.js` `CatSheet`。
17. **空 / 缺失** — 添加：无文字的虚线 ＋ 瓦片或芯片（`aria-label` 写「添加…」），**唯一实现** `fork-asset-pack-catalogue-ui.js` `CatAddTile`。编辑器里的缺素材：虚线瓦片中央一个 ✦（点开本格菜单：生成… / 上传… / 设置回退 ›），**唯一实现** `fork-asset-pack-figure-ui.js` `SlotMissing`；设了回退的格子显示替身差分的淡化图 + ↩ 和它的名字。运行时：显示平和差分，提示栈一枚 ⚠ 芯片；回退指定的差分静默顶上。列表为空：一个短语 `.ap-empty`。
18. **⚠ 需要动作的状态** — 真警告：⚠ +（可选）短句 + 一个链接胶囊（「去添加」）；紧凑形式只有 ⚠ + 胶囊，句子在悬停/读屏名称里。**唯一实现** `fork-asset-pack-card-ui.js` `HintLine`（`.ap-hint-chip`）。
19. **列表行** — 素材包、条目。一行：首图/图标 · 名称（可截断，悬停全名）· 安静的图标计数 · 状态芯片或灯；整行可点进入。**唯一实现** `fork-asset-pack-ui.js` `PackRow`、`fork-asset-pack-entry-ui.js` `EntryItem`。
20. **按钮** — 文字按钮 `Button`（安静、无框）；图标按钮 `IconButton`（30px，`aria-label` = `title`）；分节动作区的文字按钮 `.ap-manage`（如「管理」「导入」，最多两个，其余进 ⋯）；全页唯一实心主按钮 `Button primary`。**唯一实现** `fork-asset-pack-ui.js` `Button` / `IconButton`。重置一律是旋转箭头图标按钮，名称/悬停写确切动作（「恢复为全局」），不用文字按钮：面板 `IconButton icon:'reset'`、模组设置 `fork-inline-field.js` `ForkResetButton`（同一 `FORK_INLINE_GLYPHS.reset`）。
21. **提示行（不做 toast）** — 操作结果写在发生处的一行 `.ap-notice`（`role=status`，可带一个胶囊），保存状态写在页头「正在保存… / 已保存」（`.ap-save-state`）。**唯一实现** `.ap-notice` / `.ap-save-state`（迁移批次 3 合并 `ap-voice-notice`、`fork-gal-config-saved`）。
22. **搜索 / 筛选** — 列表 >8 项时。唯一保留框的输入：圆角搜索框 + 放大镜，筛选与排序是同一行的图标菜单。**唯一实现** `fork-inline-field.js` `ForkSearchBox`（全局；素材面板里包成 `SearchBox`，BGM 播放器、气泡声音菜单、Fish 声音查找同用；`bare` 只出输入框给自带外框的行）+ `KindSortTools`。
23. **加载** — 任何等待。150ms 后出现的 iOS 式转圈；图片按预留尺寸淡入，不先出首字。**唯一实现** `fork-spinner.js` `ForkSpinner`。
24. **分类标签栏** — 舞台素材 / 模组库窗口里切换种类。下划线标签一行（`role=tablist`），放不下的进「更多 ⌄」；←→ Home End 切换。**只有一个标签时不画标签栏和它的分隔线**，内容直接接在窗口标题下（主人 2026-10）。**唯一实现** `fork-asset-pack-ui.js` `PackKindNav`。

25. **模组设置范围 + 覆盖点** — 模组设置页顶部一个紧凑的「全局 | 本卡 · <卡名>」决定改动写到哪一层（没有卡时只有全局），旁边的重置图标重置整层（确认后）；按它时已开的弹层不关，改看另一层。被当前层设置的项在名称后一颗 7px 点：本卡 = 绿，全局 = 蓝，引用/公式算不出来 = 警告色；不写「已改」。**唯一实现** `fork-mod-config-ui.js` `ForkScopeSwitch`（`ForkSegmented`）、`ForkOverrideDot`；数据走同文件 `useForkModConfig`（`docs/fork/mod-config.md` 的 RPC，CAS 写入）。
26. **模组设置行** — 模组的一项设置（主人 2026-10 简化）。一行「名称 (?) · 点 · 控件 · 重置」，控件就在行里：枚举 = 下拉，开关 = `ForkSwitch`，有范围的数字 = 滑杆、否则数字字段，短文字 = 文字字段，颜色 = 色块。**没有「自动 / 固定」写法层**：只有真有自动来源的字段（猜测的 MVU/台账变量、舞台值、记录列表）在同一个下拉里多一项「自动（跟随状态）」（颜色为色块浮层里的「自动（来源）」），再加「固定」「选择变量…」（数字另有「公式…」）；没有自动来源的数字（电量、信号）是同一个下拉但没有「自动」，选择器/公式框在行下方展开；固定值的控件紧跟在下拉后，自动/引用时跟着读到的值。其余字段只有固定值，未设置即默认值。旧的引用/公式值照常读出，显示为小芯片，改控件即写固定值。只有一个字段的分组不加分节标题；(?) 紧跟名称。重置图标只在当前层设过该项时出现（本卡「恢复为全局」，全局「恢复默认」/有自动来源的「恢复为自动」）；只有全局的键在本卡下禁用。即改即存。列表左对齐、单列（`ForkInlineGrid columns 1`），页面按内容定宽，和其他设置页一样紧凑。**唯一实现** `fork-mod-config-ui.js` `ForkCfgField`；页面列表 `fork-mod-config-pages.js` `ForkCfgList`。
27. **数据选择器 + 公式框** — 选只读数据源（变量 / 聊天变量 / 舞台 / 模组发布值）里的一个路径；在设置行下方展开（§三.26）。一个下划线输入框，聚焦即展开：空着时逐级浏览（按数据源分组、实时值、对象行 ›、面包屑回上级、数组显示下标、MVU 二元组显示值并以说明为提示），打字对完整路径模糊匹配（高亮 + 面包屑）；类型不符的叶子灰显不可选。键盘 ↑↓、→ 进入、← 上一级、Enter 选、Esc 只关列表；选中后收起，下拉显示「跟随 <来源> <路径>」。行按窗口渲染，几千个节点照样快。公式框是一行文字，引用显示为芯片，选择器在光标处插入（输入 { 跳到选择器），下面一行实时结果（超出范围写「按 …」）或 ⚠ 错误 + 「第 N 个字」并在框内标出位置。**唯一实现** `fork-data-picker.js` `ForkDataPicker`、`ForkFormulaInput`。
28. **可点选预览** — 模组画出自己的预览，声明热点区域（预览自身坐标）对应设置键；点热点在预览旁弹出该项的设置弹层（不透明 `.fk-surface`，375 为底部面板）：标题 + 点 + 重置 + ✕，内容就是 §三.26 的同一个控件（普通下拉/色块自动展开，可绑定字段的来源下拉不展开）；弹层按内容定宽，可以盖住页面。热点平时无任何装饰，只在悬停/聚焦时一圈淡虚线（和覆盖点）；可 Tab 到，Enter 打开。预览点不到的设置放在页面的设置列表里。**唯一实现** `fork-mod-config-ui.js` `ForkPreviewHotspots`、`ForkValueEditor`。
**点外面关闭只关最上层**：上面 25–28 的弹层、选择器列表、弹层里的菜单/颜色浮层都登记在弹层栈（§三.16）；点外面或 Esc 每次只关最上面一层（列表 → 菜单 → 设置弹层），有未保存输入时只结束编辑。

舞台覆盖层（CONFIG、履历、Esc 菜单、混音、选项）是同一套组件语法的舞台皮：结构与键盘同上，颜色字体只读 `--gal-ui-*`，不另立交互。

## 四、守卫

- `tests/fork-ui-standard.test.mjs`（规则在 `tests/helpers/fork-ui-standard-audit.mjs`）扫描 `src/client/**` 与 `lib/client-assets/fork-*.css`：原生 `select`；`input type=range|color|checkbox|radio`（`ForkSwitch` 除外）；裸 `input` / `textarea`（`ForkInlineField`、`SearchBox` 除外；隐藏的 file 选择器除外）；`window.confirm` / `alert` / `prompt`；固定字号；token 区块外的颜色字面量。
- 现有违例按「规则 × 文件」计数在 `docs/fork/ui-standard-allowlist.json`。**只减不增**：新违例直接失败；修掉旧违例后计数变少也会失败，提示运行 `--write` 缩小清单（`--write` 拒绝增长）。测试里另有每条规则的总数上限，同样只降。
- 合并上游带来的上游文件增长才允许 `--write --grow=<文件>`，并在合并总结里列出。
- 每次 UI 改动都跑本测试与 `tests/fork-surfaces.test.mjs`。
