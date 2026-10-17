---
name: stage-setup
description: "设置 galgame 舞台模式：给卡开舞台、设置向导、舞台设置页各项在哪里，开场画面（背景、时段、BGM、CG、登场人物与站位）、卡的默认皮肤、全局舞台/音乐/音效/环境音/配音/气泡开关与正文语言，并指引字体和阅读控制。卡自带的 HTML 特效与 HUD 用 card-stage；开场白文字用 edit-card。"
---

# 舞台设置

用户说"舞台""舞台模式""galgame""开场画面""皮肤"时，指的是这里的 galgame 舞台。卡片自带的 HTML 特效和 HUD（`extensions.dsh_stage`）才属于 card-stage。

工具：`tavern_stage_read`、`tavern_stage_patch`，需要查找素材时用 `tavern_assets_read`。设置分两类，处理前先判断属于哪一类：

| 类别 | 内容 | 影响范围 |
| --- | --- | --- |
| 卡设置 | 开场画面、默认皮肤 | 只影响这张卡，不需要全局确认 |
| 全局引擎设置 | 六个舞台开关、对话气泡格式与正文语言、对话框主题 | 所有卡 |

开场白的文字（`first_mes`、`alternate_greetings`）用 `tavern_update_card` 修改，属于 edit-card；本 Skill 只配画面。

## 界面位置

用户问"在哪里设置"或想自己点时，给这些位置：

- 「舞台设置」：游玩这张卡时右侧栏顶部「＋」→「舞台设置」；显示「这张卡还没有舞台设置」时点「启用舞台（对话气泡）」。进出舞台用聊天顶部「舞台」按钮或 F12。
- 「基础设置」（全部对所有卡生效）：对话气泡、配音 ›、舞台模式 ›、自动生成选项、BGM、音效、环境音、每个模组一行。「舞台模式 ›」是导演模型、判断模型、可用演出、每轮上限（stage-directing）。标题行右侧是「设置向导」和「基础 | 高级」。
- 「素材包」：「管理」改包的全局/本卡/关闭（asset-library），「导出」「⋯ › 导入」是卡 ZIP（card-sharing）。人物、服装、差分在点包名打开的素材库窗口里编辑（figure-assets）。
- 「人物」（素材包下面）：这张卡能用到的人物，点头像直接打开该人物的编辑 / 生图页（figure-assets）。
- 「高级」才显示「开场设置」（主角、默认皮肤、各开场白画面）和「提示词」。

## 设置向导

三步：「挑选素材」勾选已装包里的条目，「创建本卡素材包」把它们复制进绑定本卡的「卡名 · 本卡素材包」；「自定义角色」点卡里识别出的角色名，选一个已有人物（复制进本卡包并改成这个名字）或「新建角色」；「开场画面」逐条设置，「完成」后回到「基础设置」。没有绑定素材包的卡第一次进入舞台时自动打开。本卡包里是副本，改它不影响原包；相同媒体只存一份。

向导只能由用户在界面里操作。要你代劳时，用工具做同样的事：复制条目并绑定（asset-library）、人物改名与触发词（figure-assets）、开场画面（下文）。

## 调用格式

每个工具只有一个 `request` 参数。读取把 `action` 和字段直接写在 `request` 里；写入把 `expectedRevision` 和 `patch` 放在外层，`action` 放进 `operation`：

- 读卡设置：`tavern_stage_read({request:{action:'card'}})`，不带 `path` 即当前卡；结果的 `openings` 是当前开场画面，`bindings.revision` 是写入要用的卡 revision。
- 存卡设置：`tavern_stage_patch({request:{expectedRevision:'卡的 revision', patch:{openings:{…}}, operation:{action:'card'}}})`。
- 读写引擎：`tavern_stage_read({request:{action:'engine'}})`；`tavern_stage_patch({request:{expectedRevision:'引擎 revision', patch:{…}, operation:{action:'engine'}}})`。
- 可写字段：`tavern_stage_read({request:{action:'schema', section:'openings'}})`（或 `'engine'`）。

## 完整例子：关掉所有卡的舞台音乐

1. `tavern_stage_read({request:{action:'engine'}})`：记下引擎 `revision`，确认 `stageToggles.music` 当前为开。
2. 告诉用户"这是全局设置，会影响所有卡片：关闭舞台音乐，其他声音不变"，然后调用 `tavern_stage_patch({request:{expectedRevision:'第 1 步的引擎 revision', patch:{stageToggles:{music:false}}, operation:{action:'engine'}}})`。补丁只带要改的开关。宿主在这次调用中请用户确认。
3. 回执成功后再读 `engine`，`music` 为 `false` 才报告"已关闭"；审批未通过时报告"没有改动"。

## 开场画面

开场白直接显示自己的画面，不经过导演，也不花费模型调用。用 `card` 读取每条开场白的当前画面、指纹和卡的 revision，按 [开场画面](references/openings.md) 组织数据后写回。

- 背景、音乐、CG 和人物引用必须来自当前卡能用的包（本卡绑定或全局启用）。用 `tavern_assets_read` 的 `bindings` 找到这些包（`boundPackIds` 和 `globalEnabledPackIds`），再用 `item` 按名字取条目或人物的 `id`；需要的素材在未绑定的包里时，先按 asset-library 绑定。
- 登场人物列表为空就是空舞台，系统不会自动补上主角。用户要"开场有大肥鱼"就明确写进该开场白的人物列表。
- 站位由 `cast` 的顺序决定：多人时从左到右，单人固定居中。用户要"一个人站左边"时，说明单人只能居中；能用的人物素材不存在时，告诉用户缺哪个人物（figure-assets），不用其他功能替代。

## 默认皮肤

默认皮肤是这张卡的初始皮肤，写在同一个 `card` 补丁的 `defaultSkin` 里，可选：

- 内置皮肤：`classic`（经典，沉静深色）、`gothic`（哥特，暗紫与浅金）、`magical`（魔法少女，明亮奶油粉）、`crt`（显像管，深夜绿色荧光）、`aero`（千禧晴空，天空蓝玻璃）。
- 包里的皮肤：`{packId, kind:'skins', assetId}`，所在包必须绑定到这张卡；用 `item {kind:'skins'}` 查看候选。

用户问"有哪些皮肤"时，列出内置皮肤和当前卡可用包里的皮肤条目。

## 全局引擎设置

先读 `engine` 取当前值和 revision，用 `schema {section:'engine'}` 确认可写字段。

- `stageToggles` 有六项：`dialogue`（对话气泡）、`voice`（配音）、`stage`（舞台模式）、`music`、`sfx`、`ambience`。只有全局开关，没有逐卡开关；用户想让某张卡没有 BGM，应该让这张卡用不到音乐素材（asset-library），而不是关全局开关。
- `dialogue` 里有气泡差分列表、格式注入和正文语言（`zh`/`ja`/`en`）。保存后宿主会刷新每张卡由插件管理的气泡格式世界书条目，那条受管理的条目不用 edit-card 手改。
- 写入前按上面的例子说明影响和具体变化。只改用户要改的字段，补丁里不要带上其他字段的旧值。

导演模型、可用演出和动作上限也在引擎设置里（界面在「舞台模式」页），但属于 stage-directing；配音服务、人物声音和各类声音默认用哪个服务（引擎 `voiceServices`，由声音工具写入）属于 figure-voice。

## 只能在界面里做的事

字体选择和阅读控制（自动、跳过、履历、隐藏文本框、快捷键、音量）是浏览器本机偏好，没有工具可以代为设置。用户问到时读 [本机显示与阅读](references/local-ui.md)，给出准确的界面位置，并说明需要用户自己操作。

## 进行中的游戏

开场画面只在开场白显示时使用，不会改变已经开始的游戏的当前背景、人物或音乐。全局开关和气泡格式改动在之后的轮次生效；进行中的会话的正文格式在下一次快照更新（新会话或上下文压缩后）才换成新格式。

## 用工具完成，按事实报告

- 舞台设置只通过本 Skill 的工具读写。报错里的 `example` 是最小合法骨架：占位符换成读到的值，空数组只表示类型、不代表清空。工具做不到的事，说明缺什么或界面位置。
- 报告只描述工具结果里出现的事，分清：计划（还没调用写工具）、已问你（等你回复）、等待宿主批准、未获批准没有改动（照审批错误的 `message` 转述，会话策略自动拒绝不说成用户拒绝）、已保存（回执成功且回读到目标值）。

## 完成标准

写入回执成功，回读显示目标值。开场画面再读 `card`，确认对应开场白已设置、引用齐全。交付时请用户在游玩页选择这条开场白看一次画面；全局开关请用户在任意卡的下一轮确认。没有看过页面时，只说"已保存"。
