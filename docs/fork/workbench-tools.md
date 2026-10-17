# 卡片工作台功能管理工具合同（Stage B）

状态：Stage A 已批准，Stage B 工具与 owner 适配已实现，发布门禁通过。本文保留 Stage A 设计依据；实际接口与预算以本节 Stage B 更新及注册代码为准。适用模式是 `card`，工具、测试与本合同按 `public/include.json` 显式公开交付。

源码复核发现 inventory/部分旧合同已落后：当前 `putBlob` 拒绝独立图片，图片与绑定必须原子 `patchPack`；Script Navigation 写操作已有 revision/cardPath/scriptVersion 三重检查；当前应用生图没有 CLI 那套母版强制前置链。本文以现有源码为准，具体差异在各工具节列明。

复测（警告不计通过）：GPT 6 Astra Low 三组为 11/13、12/12、15/16（合计 38/41，92.7%），Gemini 3.8 Flash Low 为 9/13、6/12、10/16（25/41，61.0%）；工作台推荐 Astra 级、工具调用可靠的模型。

## Stage B 接口更新（同步给 Skill 作者）

工具名不变；声音读/写新增 `engine-services` action（见 4.9/4.10）。为满足单 Skill 10 KiB / 全部 25 KiB，公共必填 owner/CAS 字段提到同一 request 层，动作放在其 `operation` 子对象（可递归嵌套），不重复列出公共字段。实际唯一语法源为 `lib/domain/workbench-feature-schema.js` 和 `lib/tools/workbench-features.js:featureRequestSchema`；不得沿用附录 A 的扁平 request 示例。执行时仍以 defineTool 编译的闭合 schema 校验逐动作必填项，模型 wire 省略 additionalProperties 默认声明；异构 author payload 保留 object 类型，语义交既有 owner。解释/示例留 Skill references，工具 description 仅一行。

Skill 作者同步：引擎 `voiceServices` 归声音域。`voice_read.engine-services` 无其他参数；`voice_patch.engine-services {expectedRevision,voiceServices}` 替换该 section，走同一 `getAssetEngineSettings/saveAssetEngineSettings` owner 和引擎 CAS，必须全局审批。返回 `{voiceServices,revision,writable,live}`；figure-voice 不需要 stage 工具。`stage_patch.engine.patch` 不再允许 `voiceServices`。`mods_patch.scope/pack-scope` 只允许 `global|off`；pack-scope 不注入 cardId，不改每卡绑定。

实际 wire 示例：读 `tavern_voice_read({request:{action:'engine-services'}})`；写 `tavern_voice_patch({request:{expectedRevision:'读回的引擎版本',operation:{action:'engine-services',voiceServices:{qwen:'已配置的服务 ID'}}}})`。空 `voiceServices:{}` 显式清空该 section；未列出的映射不会保留，其他引擎字段不变。

当前真实注册编译测量（`tests/workbench-feature-budget.test.mjs`，包含实际注册的 read_script 633 字节，不再硬编码）：{"tavern-features":0,"asset-library":10002,"figure-assets":7076,"stage-setup":3177,"stage-directing":7279,"stage-mods":4086,"figure-voice":8099,"script-play":2170,"card-sharing":4383,"asset-generation":2800}；全部（含 read_script）22929 字节。每项采用 `{name,description,parameters}` 的 UTF-8 JSON 字节，加非空工具列表的追加逗号。默认新增 0；每 Skill 均不超过 10240，全解锁不超过 25600。本文其余 Stage A 数字仅保留作旧设计基线，不能当成交付预算。

本次两项审阅决策的回归：真实 handler 对 engine-services 未确认拒绝、确认后由原引擎 owner 保存、回读一致、旧 revision 拒绝，其他 engine 字段不变；stage_patch 拒绝 voiceServices 且不调用写 RPC；mod scope/pack-scope 的 card 值在注册 schema 和适配器边界均拒绝，global/off 不传 cardId。功能/审批/媒体/预算/Skill gate 共 12 项针对性测试通过。完整 affected-tests 首轮暴露旧 UI 夹具漏载共享图片模块，已修复；最终复跑 123 文件、791 项通过、1 项跳过、0 失败。client/TTS/asset-library build --check 及 UI 标准门禁通过。隐藏静音 slot 0 使用临时数据副本和新建 smoke pack，实际注册 handler 到应用 owner 的素材读取/人物 alias CAS 写回、引擎读取及未确认全局写拒绝通过。首次 smoke 的复制渠道返回 UNSUPPORTED_CHANNEL；rebase 合入应用 owner 的 Images 渠道支持后，重新启动隐藏槽位，实际注册 generation prepare handler 成功返回单张冻结方案，未改渠道/凭据、未发起付费生成或采用，候选列表仍为空。证据在 `output/workbench-tools/SMOKE.md`。

### 实测修复接口（2026-10-15）

- 语法失败现在返回 `{ok:false,error:{code:'INVALID_ARGS',message,path,retryable:false,mayHaveCharged:false,next,example}}`，不再抛出裸 `oneOf matched 0`。`example` 是完整 `{request:...}` 最小语法骨架；按所传 action 选择最近分支，展示真实的 `operation` 和 `expectedRevision` 层级。占位符须替换为读回值，异构 author 对象还须遵循 owner 的 schema。语义错误保留 owner code/message，并尽可能映射回真实 request 字段路径。
- `assets_read.list` 只给 `{packId,name,revision,counts,scope:{global:boolean,card:boolean|null}}`，外层 `path:null` 表示工作台尚未挂卡，不能当作本卡关闭。包详情用 `assets_read({request:{action:'pack',packId}})`；`item` 无 id 时只列身份摘要，有 id 时返回完整 author/media 字段。`bindings` 直接给 `boundPackIds` 和 `globalEnabledPackIds`。
- `resolve` 仍只接受 canonical ref，**不支持 name**。先用 item 列候选，再传人物 `{packId,figureId:id}` 或素材 `{packId,kind,assetId:id}`；name 错误会明确提示该恢复路径，没有新增 resolver/别名表。
- directions 的 schema 给出 `text` 正文字段和完整有效示例：`{kind:'directions',id:'quiet',name:'Quiet direction',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',text:'Keep movements small.'}`。不是 `content`。
- `assets_transfer.inspect` 未挂卡时必须显式给 `path`；缺目标返回 `SOURCE_UNAVAILABLE`，不会再因错误对象里的 undefined 被宿主判成非 lossless JSON。ZIP 错误指出成员名，例如 `path:'dsh-tavern-card-bundle.json:$.schemaVersion'`、`message:'Missing field schemaVersion in dsh-tavern-card-bundle.json'`。嵌套 inspection 不再泄露 incoming/current 整份包。
- 审批摘要明确“等待用户批准”。`error.reason` 区分 `policy-rejected`、`user-rejected`、`approval-unavailable`、`cancelled`；策略拒绝明确说明没有弹出用户审批，实际拒绝为“用户拒绝，未更改”。**完全权限**预设是 `danger-full-access + approval:never`，需要确认的工具仍会被拒绝；测试由用户切到审批 `ask` 的预设后再调用，在会话审批组件处理允许一次/拒绝。隐藏实例不应通过伪造同意或直接调用写 owner 来绕过。

## 1. 设计边界

增加 12 个工具，按素材库、舞台设置、模组、声音、剧本划分 owner；媒体和归档是跨对象的专用传输入口，不增加任意 RPC 执行器。另修复现有 `tavern_read_script` 的 card 可见性。每次调用只执行一个声明的动作；不提供跨 owner 的批量事务、任意 JS、任意宿主路径或 `method:string` 转发。

- 模型工具是已有 owner 的适配器，不自行写 pack JSON、设置文件、声音配置、卡片 ZIP 或剧情历史。优先调用进程内服务；HTTP 仍保持现有鉴权/同源要求。素材是 `assetLibrary` v2，不能误走 `/api/dsh-tavern/patchPack`。
- `index.js` 只装配依赖。CAS、资源身份、引用闭包、权限、序列化、导入事务、下载状态继续归原 owner。schema 做语法检查，既有 owner 在输入边界做一次语义/资源完整性检查；读取不重新扫描媒体。
- 功能开关只有全局：`stageToggles:{dialogue,voice,stage,music,sfx,ambience}`；模组 scope 只有 `global|off`。每卡差异来自绑定包和本轮可用条目，不添加每卡功能开关。mod-config 的 `layer:card` 只保存现有 schema 允许的数据/展示配置，不成为功能启用覆盖。
- 包的全局启用/本卡绑定，和条目的 `enabled`、`recall`（蓝灯常驻/绿灯召回）是不同层次。figure、outfit、背景、BGM、SE、独立 ambience、skin、look、CG、direction、performance 等使用各自已有 author schema。
- 默认服装/开场只初始化无状态人物。保存素材、刷新、换轮、重挂载不 reset 运行中的服装/名单/背景/BGM/ambience。省略保持，停止/清空必须显式；本工具层不提供运行时 reset、不改历史、不补播一次性演出。导演预览只读，不顺带 `generateStageDirection/retryStageDirection`。
- 所有执行体验证来自真实 `exec.agent.session` 的 `card` 会话；不接受模型传入 authority、origin、任意 sessionId。跨卡路径只能指向工作台可管理的卡资源；调试游玩只接受已关联的 `play-chat:` 引用。Skill 解锁是成本优化，不是安全权限。

依据：`AGENTS.md` 规则 8/10/11/12/15；`docs/architecture.md`；`docs/refactoring-boundaries.md`；`docs/fork/stage-incremental-architecture.md`、`docs/fork/stage-runtime-architecture.md`。旧 `stage-persistent-state.js` 仅供理解不变量，生产接线仍为 asset-pack director/runtime，不复活旧协议。

## 2. 动作处的确认、凭据与时间界限

### 2.1 现有宿主确认可直接复用

本机固定 DSH 已有 `@deepseek-ai/dsh-user-approval` 的 `approval.request({agent,toolName,callId,reason,signal})`；结果只有 `allowed-once|rejected|cancelled|unavailable`。`dsh-tools` 的 ask seam 已调用它；Web 组合 `config/plugin-web.patch.yml` 有 `dsh-client-ui-approval`。审批落在 Session 的 `approval/asked` / `approval/decided` 中，要求处于 open turn，缺少 answerer 或 policy=never 会拒绝，不是自动批准。本次只核实源码/组合声明，未操作 live 弹窗。

采用该原生机制，不新增 `confirmGlobal:true`，也不把模型填写的确认文字、生成服务的 `consentToken` 当作用户同意。工具在调用写 owner **之前**构造确定的摘要并直接请求一次性批准，只有 `allowed-once` 才继续。摘要由规范化后的目标、旧值/变更字段及新值生成，而非让模型自由填写掩盖影响范围。冻结的参数与摘要对应，审批后仍执行原 CAS；失败不自动换 revision 或再写。

全局摘要开头固定说明：**“这是全局设置，影响所有卡片，不只当前卡。”** 后列 owner、对象、字段差异；例如“关闭全局舞台音乐 stageToggles.music；已有播放器按原 owner 规则响应”。每次全局写都重新批准，包括把值改回去、取消绑定全局包、设置 catalogue 来源、全局 mod-config、TTS 服务/预设/读音词典及 judge 渠道。空变更可以不写并返回 `unchanged`；不能先写再提示。

共享包编辑不等同全局开关，但可能影响多卡。素材读投影返回依赖数量；已被其他卡使用的包/figure/voice 改动也请求原生确认，明确“影响所有引用此共享素材的卡”，原有 `confirmShared` 只由获批的适配器填入。依赖无法确定时显示影响未知，不声称仅本卡。独立新包和仅当前卡的绑定/开场无需全局确认。多包导入以一份冻结决策摘要确认全部影响；不在 apply 中悄悄扩大范围。

### 2.2 付费调用与候选

`tavern_asset_generation.prepare` 复用 `prepareAssetGeneration`，返回实际 `imageCount`（1..4，默认 1）、目标、模型/输出、冻结参考和原 consent 信息。`generate` 在每一次请求处调用原生 approval，摘要必须列出数量，并沿用应用费用提示的事实：**N 张 = N 个单图请求；外层模型可能另收文字费用，金额由供应商决定；失败、超时、取消、无图不保证免费**。已有 `confirmNewRequestIds` 必须逐项显示“上次结果未确认，可能已经收费，本次可能再次收费”，由该次批准交给原 billing gate。变更目标/提示词/参考/渠道/数量必须重新 prepare 和批准。保留原 planId 去重，绝不循环重试请求。

工具只提供 prepare/generate/status/list/read/cancel/reject/retry-save，**不暴露 accept 动作**。read 返回供人审阅的应用候选入口和媒体附件，不在文字结果放 base64。采用、sprite/avatar 的 ImageFramer 对齐/裁切、sheet 逐槽导入和最终 accept 继续在原应用 UI 由用户选择；不能经普通 upload/patch 将未采用候选绕道写入包。原 `acceptAssetCandidate`、`importFigureImage` 的 CAS、TARGET_CHANGED、IMPORT_REQUIRED 仍是 UI owner 的职责。此取舍避免新建一条裁切/采用写路径，Skill 完成状态须区分“已生成待选择”和“用户已采用”。

judge `test`、TTS `test` 也可能实际发模型/合成请求，不能伪装为免费 read：走同一付费批准，显示一次测试、当前渠道可能收费；目录查询/配置读取/导演提示词预览不触发合成。工具不自动试听。

### 2.3 凭据与授权 seam

输出仅包含 credential reference / `{configured,writable}`；不得输出密钥、Authorization、带密钥 query 的 URL、供应商原始错误或带凭据的配置。工具输入没有 `secrets/apiKey/token/password` 写字段；已有服务沿用已保存凭据，新服务缺凭据时返回 `credentials-required` 并引导用户到原设置页填写，之后再继续。judge 同样只选择 provider/ref，不接受密钥。

Stage B 将 TTS 已有 control switch 提为同一进程内 `ttsControl.call`（包括 disabled 时可读/改服务），HTTP 路由和工具都调用它，不能只依赖会随 enabled 消失的 `ctx.get('tts')`。mod/mod-config 当前只承认浏览器 origin，需在原 authorize seam 增加宿主创建的窄 workbench capability；不能伪造 `origin:'localhost'` 或绕开 `modService.call`。此 capability 不出现在模型参数/输出/日志中，也不增加公开未鉴权 endpoint。figure preview 播放 lease 只使用宿主注入并验证的实际浏览器 origin；没有客户端上下文则 `UNAVAILABLE` 并给应用入口，不合成虚假 URL，不向模型输出 grant token。

### 2.4 超时

每个新增工具 `timeoutMs:540000`，包含确认等待，确保单次调用小于 10 分钟。approve 等待建议最多 120 秒，超时返回未授权/取消；从未批准的写不启动。普通本地读写目标 30 秒以内；下载和生成只返回原 owner jobId，然后通过 status 查询，不等待整组完成。底层已有每张生成 5 分钟限制不变。传递 `exec.signal`；不取消其他会话的任务，不因超时自动重发。无法中断的原子发布由 owner 完成/回滚，响应不确定时先回读状态，不能宣称失败即未写。

## 3. 通用 schema 与结果约定

附录 A 是可执行、可测量的完整**模型可见输入 schema 草案**；非实现。每个工具仅一个 `request`，内部 `oneOf` 按 `action` 精确区分必要字段，拒绝未知 envelope 字段。多个同形只读动作可以共享 action enum。字段说明以本节及各工具表为准；schema 描述保持短小，不复制教程。

- `path`：卡资源路径；省略使用当前工作台卡。`file`/`directory`：工作台根内相对路径，不是 dataRoot 路径。`ref`：规范 AssetRef/FigureRef；名称/别名必须先经现有 resolver 得到 canonical ID，不另造别名表。
- `expectedRevision`：原 owner 返回的不透明版本，通常 string；创建 pack 为 null，reading 行编辑为 integer。不得把 pack revision、card revision、config revision 或模板 revision 混用。
- `patch`、`figure`、`entry`、`config` 是结构化 JSON，不是 JSON 字符串或原始文件。schema 声明允许的顶层字段；异构素材正文、provider 特有字段和安装模组私有结构继续由现有 owner 校验。read 的 `schema` 投影按选中类型返回合法字段/枚举/示例，避免常驻展开整个 pack schema。工具 schema 不以 `args:{}` 包装任意 RPC。
- DSH 当前支持 object/properties/required/additionalProperties、array/items、enum/const、oneOf；不使用它不执行的 minItems/maxLength/if/then 等关键词。分页/文件大小/数值范围等限制写入短字段说明并由原 owner 或输入适配边界执行一次，错误带字段路径。
- 列表默认 20、最多 50，文字片段默认 4000、最多 8000 字符；返回 `nextOffset`/`truncated`，不静默丢字段。详情只含选中对象的 author 字段、refs、revision 和 diagnostics；不返整包 manifest/files、原始 data JSON、媒体字节、租约 token 或凭据。

成功统一外壳：`{ok:true,data:Projection|Receipt}`。写回执为 `{status:'saved'|'unchanged'|'deleted'|'pending',owner,target,revision?,changed:[field],view?,jobId?,warnings?:[]}`，`revision` 保留原类型；view 是变更对象的紧凑回读，不克隆全快照。原 owner 的多步非原子写失败须返回已完成步骤/已返回 revision（如孤立 blob、已导入的集合子包），不能承诺全成或全败。

失败统一为 `{ok:false,error:{code,message,path?,retryable,mayHaveCharged?,revision?,next}}`。保留原错误码，不穷举包装：`INVALID_ARGS/INVALID_INPUT/UNKNOWN_FIELD` 指向字段；`REVISION_CONFLICT` 附当前 revision、建议重读目标并重做最小 patch；`NOT_FOUND/ASSET_UNAVAILABLE/SOURCE_UNAVAILABLE` 指向缺资源/未加载服务；`LIMIT_EXCEEDED` 显示实际限制。工具层仅新增真实边界错误 `CARD_MODE_REQUIRED`、`WORKSPACE_PATH_DENIED`、`APPROVAL_REQUIRED/REJECTED/CANCELLED`。已知 CAS 冲突不可自动 force；`retryable` 仅表示同一动作本地可重试，不是付费重发许可。

## 4. 工具合同

### 4.1 `tavern_assets_read`

用途：查包、条目、figure、绑定、可用媒体和依赖，给出可编辑的小投影。

| action / 输入 | data 输出 | 现有 owner/RPC |
| --- | --- | --- |
| `list {query?,offset?,limit?}` | `{packs:[{packId,name,revision,counts,scope}],nextOffset}` | `listPackSummaries`；服务快照投影，不读媒体树 |
| `item {packId,kind,id?,offset?,limit?}` | `{packId,revision,kind,items:[{id,...authorFields}],nextOffset}` | `getPackSnapshot`；kind 含当前各素材类型、figures/sprites/voices/bundles |
| `resolve {refs}` | `{items:[{ref,revision,available,diagnostics}]}` | `resolveAssets/resolveFigures`，按 ref 形状分派 |
| `bindings {path?}` | `{path,revision,boundPackIds,globalEnabledPackIds,effective,diagnostics}` | `getCardAssetBindings` + asset pack settings |
| `dependencies {packId}` | `{available,count,cards:[{path,name}]}` | `getAssetPackDependencies` |
| `settings` / `catalogue` | `{revision,globalEnabledPackIds}` / `{revision,sources,preferredDownloadId,mirrorPrefix}` | pack `settings`、`catalogueSettings`；目录条目通过 transfer.refresh 获取，不虚构缓存读取 RPC |
| `schema {kind}` | `{fields,examples,limits}` | 原 pack/figure author contracts 的选择性投影 |

CAS：只返回 owner revision，不写；无全局/付费门。特有错误：引用歧义由原 resolver 返回可选 canonical refs，依赖索引不可用不能显示 count=0。技能：asset-library、figure-assets，以及需要素材选择的 stage-setup/stage-directing/figure-voice/asset-generation/card-sharing。

### 4.2 `tavern_assets_patch`

用途：一包/一 figure/一张卡绑定的一次 CAS 管理；不替代素材格式 owner。

| action / 必要输入（其余见附录） | 调用与输出 |
| --- | --- |
| `create-pack {name,description?,expectedRevision:null}` | `createPack` → 新 packId/revision/摘要 |
| `patch-pack {packId,expectedRevision,patch}` | `patchPack` → 包名称/描述等选中元数据；不接受 identity/hash/files |
| `item {packId,expectedRevision,item}` / `remove-item {...,kind,id}` | 宿主在同一 snapshot 上按 canonical kind/id 替换/新增/移除单条，再调用 `patchPack({patch:{assets}})`；其余条目保持，不要求模型读回整包 assets 数组 |
| `remove-pack {packId,expectedRevision}` | `removePack` → 删除回执及引用警告，不修改卡绑定/历史 |
| `create-figure {packId,expectedRevision,figure}`、`patch-figure {...,figureId,patch}`、`remove-figure {...,figureId}` | `createFigure/patchFigure/removeFigure` → figureId/revision/选中 figure 摘要；create 适配为 `schemaVersion:1`，默认 outfits=[]，id 仍由 owner 分配 |
| `copy {sourcePackId,itemRefs,target}` | `copyItems`（figure 包含同一原复制 owner）；target 为新包或带 expectedRevision 的现包 → ID 映射及新 revision |
| `bind {path?,expectedRevision,boundPackIds}` | `saveCardAssetBindings({patch:{assetBindings:{boundPackIds}}})` → 卡 revision/绑定 |
| `global-packs {expectedRevision,globalEnabledPackIds}` | pack `saveSettings` → 全局 settings revision |
| `catalogue-settings {expectedRevision,sources,preferredDownloadId?,mirrorPrefix?}` | `saveCatalogueSettings` → 来源摘要/revision |
| `avatar-crop {...,figureId,outfitKey,scope,stateId?,crop}`、`emotion-fallback {...,figureId,outfitKey,emotionId,enabled}`、`remove-emotion {...,figureId,emotionId}` | `setFigureAvatarCrop/setFigureEmotionFallback/removeFigureEmotion` → figure 小投影 |
| `layered-sprite {...,figureId,outfitKey,spriteKey,manifest,assets,files?}`、`layered-part {...,figureId,outfitKey,rigId,partId,part,media:{hash}或{file}}`、`remove-layered-part {...,figureId,outfitKey,rigId,partId}` | 对应 `registerLayeredSprite/registerLayeredPart/removeLayeredPart`；已有媒体用本包 hash，新分层文件经同一 workspace intake 作为原 owner files/bytes 传入并原子绑定，不先暂存无主图片 |

上述 `...` 为 `packId,expectedRevision`。outfits/emotions/avatar 映射和 Live2D 映射由 `patchFigure` 保存；模型本体由媒体工具 `putBundle` 入库。简单 sprite 经媒体工具 image 分支与 owning outfit 一次发布；不暴露旧 `createSimpleSprite` 独立暂存动作（当前闭包拒绝未绑定 sprite），不能按旧 RPC 名单机械包装。patch 的数组/字典替换语义完全沿用 owner；先读目标字段、保留非目标成员，不发明 JSON Merge Patch 的 null 语义。

CAS：包、卡、全局设置各自的原 CAS；copy 的 source/target 约束与原 service 一致，不承诺两步复制+绑定原子。全局两项总是审批；共享资产修改按 §2.1。特有错误：`UNBOUND_PACK`、闭包引用/retired key/资源不可用错误原样给出修法；不提供 force。技能：asset-library、figure-assets、stage-directing（directions/directorNote/服装指引）。

### 4.3 `tavern_media_upload`

用途：把用户已有工作台文件交给对应媒体 owner；不让模型搬 base64，也不自动采纳生成候选。

输入目标：`blob {packId,expectedRevision,file,purpose}` 只用于 music/sound/ambience/voice-reference 音频，宿主识别 ext/MIME/size，交原 `putBlob`；`image {packId,expectedRevision,file,target}` 必须同时指定图像用途和绑定槽；`bundle {packId,expectedRevision,directory,bundleKey,kind,entry}` 以相对目录树交 `putBundle`；`mod-file {modId,layer:'global'|'card',expectedRevision,file}` → `uploadModConfigFile`；`mod-media {modId,packId,file}` → `putModMedia`。不解压到数据目录，不执行上传脚本。

**当前图片路径与旧 inventory 不同**：`pack-v2/service.js:putBlob` 已明确拒绝 image MIME，不能先 putBlob 再 patchFigure。image 的 target 分为 `{kind:'avatar'|'sprite',figureId,outfitKey,emotionId}`、`{kind:'settei',figureId,outfitKey}`、`{kind:'identity-settei',figureId}`、`{kind:'asset',asset,slot:'media'|'variant',variant?}`。asset 是 background/CG 等所选条目的 author 字段（可创建新条目），variant 只在 owner 支持的变体槽有效。Stage B 从现 `fork-asset-pack-ui.js` 的 imageClosure/importFigureImage/putThen 提取可共享的**原子入库构造函数**，UI 和宿主共同调用，一次 `patchPack({patch:{blobs,assets?/sprites?},fileUpdates})` 同时发布图片和 owning figure/asset；不用第二套 JSON 构造器。工作台文件必须已准备好尺寸/透明度；需要交互裁切/对齐则交 UI，不在工具里新造 ImageFramer。图片 hash 只为原 owner 内容寻址计算一次。

输出：audio blob 为 `{packId,revision,hash,mime,size,purpose,attached:false}`；image 为 `{packId,revision,hash,target,attached:true,warnings}`（已绑定不等于视觉验收）；bundle 为 `{packId,revision,bundleKey,entry,filesCount,attached:false}`；mod 为 `{revision?,file:{path,mime,size},attached:false}`。非图片上传和绑定分两步；后续 patch 用返回的新 revision。模组 `putModMedia` 现有接口没有 expectedRevision，回执明确 `cas:'none'`，不伪造 CAS。

工作台路径必须经原 workspace/文件服务定位、realpath 与 root containment 验证；拒绝绝对路径、`..`、reparse/symlink 逃逸、设备/ADS、凭据及 dataRoot 文件。只读用户提供的 workspace 文件/目录；不允许 HTTP URL。文件名/相对目录不当权限证据。上传不创建新 hash 算法：内容寻址、ZIP 外部信任校验都留给原 service。

现代码限制优先于 PACK-SERVICE 的旧预算段：image/sprite 通常 6 MiB、avatar 3 MiB、background 依用途校验 4 MiB、普通 audio 60 MiB；图片每边 <=8192、像素 <=32 Mi；reference text <=16 MiB。settei 免普通图片 6 MiB 限制但仍受 entry/整包预算。bundle/ZIP 单 entry <=512 MiB、总计 <=2 GiB、<=20000 项、压缩比 <=200、总 spool <=6 GiB；模组媒体 <=512 KiB。

**当前 portable voice 已不是旧 voice-ref-set 的统一 1..10 段/总计 8 MiB**：使用 `sources` 下 reference-list/emotion-references，由 shared voice-schema 验证并保留顺序；单音频遵守 60 MiB pack 限制，实际合成再按 provider.capabilities.referenceLimits 校验 count/bytes/totalBytes/时长/格式（例如当前本地 GPT-SoVITS 声明 count=1、bytes=8 MiB、180 秒、wav/mp3）。不支持多参考则报错，不能静默仅取首段。读 schema 投影从 owner 实际配置导出 limits（当前 capabilities 并不返回所有限制，不假称已有该 DTO），部署如覆写则服从 owner 限制。

CAS：pack/config 用原 revision；审批：global mod 文件及共享包按 §2；不收费。错误：路径拒绝、MIME/签名不符、闭包缺文件、大小超限、CAS；指出压缩/改正文件/重新读取后再试，不偷偷转码。技能：asset-library、figure-assets、figure-voice、stage-mods。

### 4.4 `tavern_assets_transfer`

用途：同一个 asset-library 传输 owner 下的素材包/集合、人物卡 bundle、catalogue/URL 下载。

| action / 输入 | 输出与 owner |
| --- | --- |
| `inspect {kind:'pack'|'card',file,path?}` / `inspect-url {kind:'card',url,path?}` | `inspectImport/inspectCardBundle/inspectCardBundleUrl` → `{inspectionId,expiresAt,kind,changes,choices,conflicts,risks,expectedRevision,externalDependencies}`；只给摘要，不倾倒 raw 文档 |
| `preview-card {inspectionId,decisions}` | `previewCardBundleDecisions` → 冻结决策/冲突/影响/风险摘要 |
| `apply-pack {inspectionId,expectedRevision,decision,acceptScriptRisk?,acceptVoiceFallback?}` | `applyImport`，decision 为 install/update/keep-both/noop/cancel；集合按原每个子 inspectionId 显式应用 |
| `apply-card {inspectionId,expectedRevision,decisions,cancel?,acceptScriptRisk?,acceptVoiceFallback?}` | `applyCardBundle` 原多包+Card Preparation journal → 卡路径/身份映射/新版本 |
| `export-pack {packs:[{packId,expectedRevision}],output}` | 单包 `exportPack`，多包 `exportPacks` → workspace ZIP 文件、size、包含项 |
| `export-card {path?,expectedRevision,packIds,output}` | `exportCardBundle` → ZIP 文件/包含包与外部依赖；保留原封面，不修改源卡 |
| `refresh {sourceId}` / `updates {packIds}` | `refreshCatalogue/checkPackUpdates` → 来源/更新候选摘要，不自动安装 |
| `download {selection?,url?,useMirrorPrefix?}` / `status {jobId}` / `control {jobId,actionId}` | `startPackDownload/getPackDownload/controlPackDownload` → 原 job 投影/待 inspect 结果，不自动 apply |

`selection` 与 `url` 恰选一个；selection 原形状为 `{sourceId,packId,version,downloadId,catalogueRevision}`，control.actionId 映射为原 `action:'pause'|'resume'|'cancel'`。`output` 同样受 workspace 路径边界约束，文件已存在即拒绝覆盖。脚本风险/voice fallback 确认必须在原生审批显示后由适配器转交，不能只看模型布尔值。替换共享或全局依赖时同时显示 §2 的影响。导出/检查/下载不付费且不自动授权脚本执行；外部 URL 安全策略、ZIP 预算和过期由原 transport/catalogue owner 执行，不新建下载器。

CAS：保留 inspection 冻结 revision、导出 expectedRevision、card transaction 各资源 CAS；检查过期必须重 inspect。特有错误：`EXPIRED`、`REVISION_CONFLICT`、`SCRIPT_CONFIRMATION_REQUIRED`、`DOWNLOAD_FAILED/INTEGRITY_MISMATCH`、冲突/缺依赖；没有 force 覆盖。技能：asset-library、card-sharing。卡分享不是 PNG 复制，也不把 Helper 本机静音设置带进 ZIP。

### 4.5 `tavern_stage_read`

用途：读卡开场/defaultSkin、全局 engine、judge 与真正只读的提示词诊断。

输入：`card {path?}`、`engine`、`judge`、`bubbles`、`director-preview {playRef,turn,section?,offset?,limit?}`、`bubble-preview {config}`、`schema {section}`。输出依次为开场投影+卡 revision；选中 engine values+revision；judge 非秘密配置+credentialStatus+revision；气泡派生投影；`{sections:[{name,bytes}],toolSchemaBytes,text,nextOffset,source}`；气泡预览；可写字段/枚举。

调用：`getCardAssetBindings/getCardOpeningScenes/getAssetEngineSettings/getJudgeConfig/getJudgeCredentialStatus/getDialogueBubbles/previewStageDirectorPrompt/previewDialogueBubbleInstruction`。director-preview 使用工作台已关联的游玩引用映射 sessionId，不对空工作台编造剧情；无游玩记录时返回缺少预览来源。不返回整份 director tool schema，先给字节与 section 目录，按需取选中段。

CAS：只读，返回相关 owner 版本；无确认/费用。错误：无卡/无关联游玩/不可用源，以及原 preview 错误；不因缺数据生成新演出。技能：stage-setup、stage-directing（figure-voice 需要的 voice 总开关通过 stage-setup）。

### 4.6 `tavern_stage_patch`

输入：`card {path?,expectedRevision,patch:{openings?,defaultSkin?}}`、`engine {expectedRevision,patch}`、`judge {expectedRevision,patch}`、`judge-test`。card 的 defaultSkin 是工具简写：适配器保留现有 stage 对象并只替换 defaultSkin，再映射为原 `patch.stage.defaultSkin`；不能把它当 RPC 顶层字段，也不借机清除旧 dimensions/widgets。judge.patch 映射为原 `saveJudgeConfig.config`，credentialStatus 的 keyName 从该配置读取。输出：写回执+选中设置回读；test 为 `{connected,credentialStatus,diagnostics,mayHaveCharged}`。

调用：card → `saveCardAssetBindings`，openings 使用 `lead/scenes/cast` 既有结构；engine → **完整 `saveAssetEngineSettings` 管理入口**（不能直接跳过全卡 dialogue worldbook 同步副作用）；judge → `saveJudgeConfig`；test → `testJudgeConnection`。engine 的 patch 只允许全局 stageToggles/dialogue/dialogueTheme/dialogueThemes/directorModel/dimensions/actionCaps（voiceServices 只由声音工具的 engine-services 写入）；judge 走独立 owner，不复制第二套 judge 保存逻辑。正文 first_mes/alternate_greetings 仍用 `tavern_update_card`，此工具只配画面。

CAS：三个保存分支均原 CAS；全局 engine/judge 每次审批，judge-test 付费审批，card 分支不触发全局门。特有错误：无效场景/figure/outfit、无效 model/channel、CAS、未配置凭据；空 cast 就是空舞台，不补 lead。不支持 force 或运行中 reset。技能：stage-setup、stage-directing。

字体/阅读控制决定：**guidance-only，无新工具**。字体 override 是浏览器 localStorage / `window.forkFonts`，不是卡 JSON；字体导入/安装没有等价服务端 RPC。Skill 引导实际 UI，不能声称替用户浏览器设置成功。自动/跳过/历史/隐藏/快捷键/本机音量亦然。

### 4.7 `tavern_mods_read`

输入：`list`、`mod|packs|config {modId}`、`resolve {modId,key}`、`sources`、`formula {formula}`。输出分别为已安装 mod 的身份/授权/scope/revision、包条目目录、schema/各层值及 resolved 值/来源、单键解析、可用状态源及 unavailable 原因、公式结果/错误路径。绑定当前卡 context，formula 不写变量。

调用：`listMods/getMod/listModPacks/getModConfig/resolveModConfig/listModConfigSources/evaluateModConfigFormula`；经原 modService/modConfigHost。CAS 只读；无审批/费用。错误：`MOD_PERMISSION_DENIED`、`CONFIG_TYPE`、引用缺失/公式循环/状态源 unavailable；无 MVU/台账时不制造数值。技能：stage-mods。

### 4.8 `tavern_mods_patch`

输入：`authorize {modId,allowed,expectedRevision}`、`scope {modId,scope,expectedRevision}`、`pack-scope {modId,packId,scope,expectedRevision}`、`settings {modId,values,expectedRevision}`、`pack {modId,pack,expectedRevision}`、`entry {ref,entry,expectedRevision}`、`remove-pack {modId,packId,expectedRevision}`、`config {modId,key,layer,value,expectedRevision}`、`clear-config {...}`。

分别调用 `authorizeMod/setModScope/setModPackScope/saveModSettings/saveModPack/saveModEntry/deleteModPack/setModConfig/clearModConfig`。remove-pack 的原 `confirmed` 由原生删除批准提供。`value` 是现有 `{auto:true}|{fixed:JSON}|{ref:{source,path,...}}|{formula:...}`；使用 read 返回的安装模组 schema，不硬编码 phone/items/textcard 的所有设置。输入 schema 按安装配置稳定，不随本轮 recall 裁剪。输出：owner revision、scope/permission 或已改条目/解析后设置，小范围回读。

CAS：保留 mod library/config/card-owned pack 的原 CAS；authorize/scope/settings/global config 必须全局审批，pack/entry 若共享需影响确认。pack-scope schema 和适配器都只接受 global/off，拒绝 card；不向 setModPackScope 注入 cardId，因此只改变全局包启用，不改已有每卡绑定。声音/图片走媒体工具；不提供模组安装任意代码、迁移、游玩运行命令、phone 正文注入或历史状态改写。特有错误：`MOD_PERMISSION_DENIED`、`CONFIG_TYPE/CONFIG_CYCLE` 等原配置错误、CAS；无 force。技能：stage-mods。

### 4.9 `tavern_voice_read`

输入：`engine-services`、`services|provider-kinds|voices|models {serviceId?}`、`presets`、`readings {id?,offset?,limit?}`、`figure {packId,figureId}`、`choices`、`templates`。输出为服务和 credentialStatus（不含 secrets 原值）、provider 非秘密配置字段/能力、分页 voices/models、voice presets/revisions、读音预设 active/行/revision、人物 binding/有序参考音频摘要/候选服务、共享 template refs。

`engine-services` 调用 `getAssetEngineSettings`，只返回 `{voiceServices,revision,writable,live}`，revision 为同一全局引擎版本。其他调用：TTS control `services/providerKinds/listVoices/listModels/voicePresets/readingPresets/readingPreset`；`getFigureVoiceEditor/listFigureVoiceChoices`；asset library `listVoiceTemplates`。明确 Azure/Qwen/Volcengine/GPT-SoVITS/OpenAI-compatible/Fish/reference-api/已装本地服务的实际能力；无 Edge，不虚构 Qwen 克隆。列表可有 provider 网络发现，不合成、不播放。CAS 只读，无批准。错误：service offline、credentials-required、provider 不支持等原状态，不能换渠道重试。技能：figure-voice。

### 4.10 `tavern_voice_patch`

输入动作见附录：`engine-services {expectedRevision,voiceServices}`；service 保存/删除/test；voice preset 保存/删除；reading 预设新建/复制/改名/删除/激活和单行 edit；人物 voice binding/pack voice/voice template 保存和分配。服务 `config` 只含 provider 公开参数，沿用已有 credential ref；不存在“从配置读 key 给另一服务”。

| 动作族 | 现有 owner | CAS / 门 |
| --- | --- | --- |
| `engine-services {expectedRevision,voiceServices}` | 同一 `saveAssetEngineSettings({expectedRevision,patch:{voiceServices}})` 管理入口 | 引擎 revision；替换该 section、其他引擎字段不变；全局审批，批准后仍检查 CAS，不新增存储 |
| `save-service/remove-service/test-service` | TTS `saveService/deleteService/testService` | 编辑/删除用 service revision；新建沿用原创建语义；保存/删除全局审批，测试付费审批 |
| `save-preset/remove-preset` | `saveVoicePreset/deleteVoicePreset` | preset revision（新建 null）；全局审批 |
| `reading-create/reading-rename/reading-remove/reading-active/reading-edit` | `createReadingPreset/renameReadingPreset/deleteReadingPreset/setActiveReadingPreset/editReading` | edit 为 integer revision；其他原 owner 只有串行写、无 CAS，明确回执 `cas:'none'`；全部全局审批 |
| `assign-figure/binding/pack-voice` | `assignFigureVoice/saveFigureVoiceBinding/savePackVoice` | 原 pack revision；共享 voice 的原 confirmShared 必须来自批准 |
| `save-template/assign-template/remove-template` | `saveVoiceTemplate/assignVoiceTemplate/deleteVoiceTemplate` | 保存含 template expectedRevision、源 packRevision；分配含 templateRevision 和目标包 expectedRevision；全局模板保存/删除总是全局审批，分配按目标共享影响审批 |

输出为服务/读音/绑定等目标的回执和紧凑回读，不返回音频字节。保存不等于可合成/已试听；参考音频留人物包，服务地址/凭据不入包；多参考保持原顺序；当前 owner 已支持显式 emotion-references/referenceEmotion 映射，只执行用户配置的声明，不由 Agent 临时猜情绪换槽。

唯一 force 例外：`remove-service {force:true,reason}` 可在用户看过 `SERVICE_IN_USE` 和实际引用后删除仍在使用的服务；原生全局确认展示受影响绑定和 reason，传原 `deleteService.force`。schema 要求非空 reason，不能 force CAS、绕过凭据/审批。其余动作没有 force。特有错误：`SERVICE_IN_USE`、`CREDENTIALS_REQUIRED`、`REVISION_CONFLICT`、`LAST_PRESET`、声音能力/引用不符；给可修复建议。技能：figure-voice。

### 4.11 `tavern_script_manage` 与现有 `tavern_read_script`

新增输入：`info {path?}`、`import {file,title?}`、`bind {path}`、`unbind`、`helpers`、`mute {id,muted}`、`browse {playRef,position}`、`chunk-size {playRef,chunkSize}`、`point {playRef,...原定位字段}`。输出：`{path,title,totalChunks,chunkSize,cursor?,bound}` 或 helpers 的 id/name/muted；不返整本剧本/JS。import 文件经 workspace 读取并传现有 import payload；只修改工作副本，不覆盖素材原版。

调用：`getScriptInfo/importScript/bindScript/deleteScript/getCardScripts/setCardScriptMuted/browseScript/setScriptChunkSize/pointScript`；unbind 只对当前卡走已有解除绑定语义，不能把删除原素材当解绑。browse/read 不推进游标；point/chunk-size 仅对显式关联的游玩目标调用 Script Navigation → Script Continuity，不能直接写 scriptState；两者输入都必须加上最近 browse 返回的 `revision,cardPath,scriptVersion`。importScript 现有按 title 复用 source 的行为保留：同名素材存在时回执说明复用了既有文本，不能谎称导入了不同内容；想保存新文本要指定新 title。Helper mute 是本机该卡状态、不进入导出；从卡内编辑脚本仍用既有卡工具。全局门：无（不修改全局）；关联游玩定位/切块和解除绑定在动作处展示影响并请求原生批准，避免把制作素材误当游玩推进。

CAS：import/bind/unbind/helper mute 没有统一 expectedRevision，不捏造版本保证；沿用原工作副本/卡队列，回执标注 `cas:'none'`。**point/chunk-size 已有实际 CAS**：browse 返回 `revision`（chat storage revision）、`cardPath`、`scriptVersion`；两种写动作必须原样携带这三项并通过原 Script Navigation 在 exclusive/更新队列内重新检查，不由适配器替模型补最新值。特有错误：未绑定、无关联 playRef、定位/切块范围错误、忙碌会话/脚本 ID 不存在，遵循原 owner。

已有 `tavern_read_script({path?,query?,offset?,limit?})` schema 和执行体保持；只把它加入 card `visibleTools` 并由 script-play 解锁。card 最多 6 块，script 游玩仍保留原 21 块窗口。**不能把全局 GATED 过滤直接作用于 script 模式**，否则修复 card 的同时会意外隐藏游玩原工具：Skill gate 改为仅 card 的能力筛选。技能：script-play。

### 4.12 `tavern_asset_generation`

输入：`prepare {target,expectedRevision,userPrompt?,references?,quality?,count?,redrawOf?,note?,useCandidateReference?}`（avatar-sheet 可选 target.emotionIds）；`generate {planId,consentToken,confirmNewRequestIds?}`；`status|cancel|read|reject|retry-save {jobId,emotionId?}`；`list {packId}`。target 精确区分 identity-settei（无 outfit/emotion）、settei/avatar-sheet（有 outfit，无 emotion）、sprite/avatar（都有）、background（可选 assetId）。references 仅本包 `{hash,role}` 或 workspace `{file,role}`，适配器读后交原受限 upload 形式，不给生成 owner 新增宿主路径读取能力。

输出：prepare 为上述冻结方案和费用提示（prompt 只在按需准备中返回）；其他为原 Job 的 `jobId/requestId/groupId/target/status/outcome/candidate检查摘要/error`；read 为用户审阅附件/应用 review target，而非候选文件路径，不能被 media_upload 当普通输入。原 Job status 枚举 running/candidate/save_failed/failed/cancelled/accepted/rejected；没有 accepted 的任务不能宣称已入库。

调用：`prepareAssetGeneration/generateAssetCandidate/getAssetGenerationJob/cancelAssetGenerationJob/listAssetCandidates/readAssetCandidate/rejectAssetCandidate/retryAssetCandidateSave`。CAS/依赖：prepare 用原 pack revision/目标槽/参考冻结；**应用不是开发 CLI**：现 `asset-generation.js` 将 identity/outfit/default 图作为存在时使用的参考，非一律前置；单 avatar 仍要求同差分 sprite，sheet 要求默认 sprite 或 settei；沿用 owner 的实际检查，不在工具增加旧合同的强制母版链。生成没有写包；采用由 UI 执行原 accept CAS。审批：generate 每次付费批准，reject/cancel 不重新收费，retry-save 仅保存已收到的字节不重新生成。特有错误沿用 `CONSENT_REQUIRED/BILLING_CONFIRMATION_REQUIRED/UNSUPPORTED_CHANNEL/NOT_CONFIGURED/BUSY/EXPIRED/TARGET_CHANGED/ALIGNMENT_REQUIRED/IMPORT_REQUIRED/SAVE_FAILED/GENERATION_FAILED/IMAGE_NO_RESULT`，尤其 mayHaveCharged 不丢失。不暴露开发者 CLI、凭据提取或自动挑选候选。技能：asset-generation。

## 5. Skill → 工具与解锁

| Skill | 新增解锁工具（均带 `tavern_` 前缀） | 已有工具/边界 |
| --- | --- | --- |
| tavern-features | 无 | `skill` 分流；不自动加载九个子 Skill |
| asset-library | assets_read、assets_patch、media_upload、assets_transfer | 卡正文用现有卡工具 |
| figure-assets | assets_read、assets_patch、media_upload | 生图另载 asset-generation，声音另载 figure-voice |
| stage-setup | assets_read、stage_read、stage_patch | `tavern_update_card` 改文字开场；字体/阅读偏好指导 UI |
| stage-directing | assets_read、assets_patch、stage_read、stage_patch | 仅设置/只读 preview，不重导历史 |
| stage-mods | mods_read、mods_patch、media_upload | 模组制作转已有 tavern-plugin |
| figure-voice | assets_read、voice_read、voice_patch、media_upload | 配音总开关另载 stage-setup |
| script-play | script_manage | 额外解锁已有 `tavern_read_script`；不影响 script 游玩可见性 |
| card-sharing | assets_read、assets_transfer | 不要求用户读 ZIP/pack raw |
| asset-generation | assets_read、asset_generation | 用户在应用选择采用；不自动解锁写包工具 |

扩展 `domain/skill-gated-tools.js` 的 `SKILL_TOOLS`，沿用原 `<skill_content name="...">` 事件识别；原生 skill 工具结果和 slash 展开的 user/message 都可解锁，`tavern_read_skill_reference` 本身不解锁。已加载工具在会话内累积、去重，不随每轮素材/模组启用状态变化；加载新 Skill 有一次 schema 前缀变化。切换会话不得继承解锁。新增工具名同时进入 `controlledToolNames` 和 card 分支 `visibleTools`，执行体再校验模式；entry 只路由，因此默认卡会话新增 schema 为 **0 字节**。

Skill 作者可直接使用本合同，不需读取 raw pack 或 data 文件。提示应善意引导：“请用管理工具的小投影确认目标和 revision；若工具说明需要用户审阅，交回应用完成该步”，不以禁用所有 Shell/文件工具代替正确 owner 接线。

## 6. 字节预算与复测

计量定义：`toolSchemaBytes = Buffer.byteLength(JSON.stringify(tools.map(({name,description,parameters}) => ({name,description,parameters}))), 'utf8')`。不包括 output renderer、Skill 目录/正文、运行时系统提示或供应商 function 包装；这与仓库 director 对工具列表计 UTF-8 的口径一致。不是 token 数，也不冒称 live 请求测量。

基线使用当前仓库真实 register*Tools/defineTool，和固定本机 DSH `runtime-a272f20b3f1f5b15-setup2` 的真实 pwsh/fs/str-replace-editor/skill/web 注册函数；空 session，通过生产 `visibleTools` + `createSkillGatedTools`。Windows pwsh，无 sandbox schema 扩展、background 字段默认启用、read_image 已挂载，无用户自装工具。没有执行工具/加载 live 数据/请求模型。

当前基线：**26 个工具，23042 字节**；其中 Tavern 工具列表自身 **14931 字节**（单独列表计数，不能简单与外层列表相减推数量）。现有 `tavern_read_script` 单对象 **632 字节**，追加到已有列表需 **633 字节**（含逗号）。非 Windows Shell、沙箱参数、用户工具及宿主版本会改变基线，Stage B 必须在实际公开组合再测。

下面预算由附录 A 草案实际序列化得到，不按“每个工具约几百字节”估算。附录的短 description、oneOf、类型与枚举均纳入计量；schema 未注册，属于 **projected** 而非实施后的数字。

| 新增工具 | 追加字节（含分隔逗号） |
| --- | ---: |
| `tavern_assets_read` | 2235 |
| `tavern_assets_patch` | 8512 |
| `tavern_media_upload` | 2929 |
| `tavern_assets_transfer` | 3947 |
| `tavern_stage_read` | 1241 |
| `tavern_stage_patch` | 2428 |
| `tavern_mods_read` | 908 |
| `tavern_mods_patch` | 3410 |
| `tavern_voice_read` | 1146 |
| `tavern_voice_patch` | 5588 |
| `tavern_script_manage` | 2077 |
| `tavern_asset_generation` | 3161 |

| 从默认卡加载单个 Skill | 增量 | 加载后总计 |
| --- | ---: | ---: |
| tavern-features | 0 | 23042 |
| asset-library | 17623 | 40665 |
| figure-assets | 13676 | 36718 |
| stage-setup | 5904 | 28946 |
| stage-directing | 14416 | 37458 |
| stage-mods | 7247 | 30289 |
| figure-voice | 11898 | 34940 |
| script-play | 2710 | 25752 |
| card-sharing | 6182 | 29224 |
| asset-generation | 5396 | 28438 |

12 个新工具的最坏增量为 **37582 字节**；再恢复已存 read_script 为 **38215 字节**，基于本次空 Skill 卡基线合计 **61257 字节**（不含另行加载既有 debug/plugin 等 Skill）。单次只载最大的 asset-library 为 +17623 字节。草案预算门：默认增量=0、单个功能 Skill 增量 <=18 KiB、功能工具全部解锁增量 <=40 KiB；这不是把 37 KiB 常驻每轮的许可。

校验结果：12 份草案均通过本机 `assertSupportedJsonSchema`；当前单工具最大为 assets_patch（8512 字节），因为保留逐动作必填项与 CAS 类型，而不是把编辑输入退化为任意 JSON。Stage B 若换成 defineTool 作者 DSL，必须将 required 数组递归转换为字段的 required:true，再测**编译后的** parameters，不能直接把本附录 JSON Schema 塞给作者 DSL。

预算策略：未加载相关 Skill = +0；入口 Skill = +0；每个子 Skill 只加载上表的工具并共享去重。所有新增工具一次全开只是最坏上限，不在默认卡回合发送。Stage B 预算回归须校验实际 schema 与本草案的差额，不为通过测量删必要语法/确认边界；增长须在本节解释。

## 7. Stage B 实施清单（原 Stage A 审阅依据）

1. 小型适配与投影：新增 `tavern-plugin/lib/tools/workbench-features.js`（定义/注册/模式检查）、`tavern-plugin/lib/domain/workbench-feature-projections.js`（纯投影/字段选择）、`tavern-plugin/lib/workbench-feature-host.js`（owner 装配、原生审批、workspace 文件转换）。优先复用既有 workspace resolver、别名 resolver、defineTool 和错误结果，不新建设置仓库或任务队列。
2. 最窄宿主接线：修改 `tavern-plugin/lib/index.js`，注册/controlledToolNames；`tavern-plugin/lib/domain/turn-orchestration.js` 加 card 名单；`tavern-plugin/lib/domain/skill-gated-tools.js` 加映射并明确只在 card 使用 gate。只提取需要的 RPC 管理方法，不对外暴露任意 dispatcher。
3. owner 的内部可调用 seam：`tavern-plugin/packages/dsh-tts/src/index.js` 从现 control handler 提出并提供 `ttsControl`，HTTP 继续复用同一个函数；`tavern-plugin/lib/fork-mod-service.js` / `tavern-plugin/lib/fork-mod-config-host.js` 的 authorize 接受宿主能力（原浏览器策略不变）。如 catalogue/transfer 当前只在 transport 暴露，修改 `tavern-plugin/packages/dsh-asset-library/src/pack-v2/transport.js` 及包 `src/index.js` 只发布现有受控管理端口，不复制 service/下载实现。精确导出形状在实施时按实际 service composition 选择，但不得改变本合同外部 schema。
4. 图片必须与现 UI 共享入库构造：修改 `tavern-plugin/src/client/fork-asset-pack-ui.js`，提取现 imageClosure/importFigureImage/putThen 的纯构造部分至 `tavern-plugin/shared/asset-image-publication.cjs`，由 UI 与宿主共用，再调用同一 patchPack。保留既有原子闭包，不恢复 image putBlob。按原应用 review target 返回候选入口；不新增 accept 工具、不改 ImageFramer。若当前客户端不能从候选 ID 导航，最小修改 `tavern-plugin/src/client/fork-asset-pack-gen-ui.js` 和所属路由组件；这项需要运行 UI 标准/构建门，生成 `tavern-plugin/lib/client.js`，不直接编辑产物。优先用现有入口避免 UI 扩展。
5. 公开交付：修改 `public/include.json` 显式列入新增运行模块与测试/合同按发布策略所需条目，核查 `public/exclude.json` 不误排运行模块；不把内部 docs 当 Skill 运行依赖。Skill 和 references 由另一代理负责，不由本阶段写。

测试计划（均隔离临时数据，模型/网络用本地替身，不在 live 做破坏性导入）：

- 新增 `tests/workbench-feature-tools.test.mjs`：真实注册与执行；各 owner 代表性 read→patch→回读；未加载/加载 skill、slash、会话隔离；story/script/card 可见性，script 游玩 read_script 不回归。附录 schema 的非法动作/必填字段/未知字段、错误 path/next；不穷举不可能状态。
- 新增 `tests/workbench-feature-approval.test.mjs`：原生 ApprovalService 的 allowed-once/rejected/unavailable/取消；全局写 owner 零调用直到批准、摘要对应真实参数、审批期间 CAS 变化拒绝；付费每次 generate 批准/plan 重放不重发、未确认账单逐项展示；testService/judge-test 也受门控；日志和结果无秘密。
- 新增 `tests/workbench-feature-media.test.mjs`：真实 pack owner + 合成 PNG/WAV/模型目录，workspace 路径逃逸及用途大小限制；图片单次原子 patchPack、音频 putBlob 新 revision→patch、mod 文件 512 KiB、voice provider 数量/总量限制；候选路径不可旁路上传；导入/导出闭包和 cover/外部依赖，原 CAS 冲突保持数据。
- 新增 `tests/workbench-feature-budget.test.mjs`：真实宿主 tool schema 序列化，默认增量 0、每 Skill 增量/去重及最坏值；已安装模组 schema 不随逐轮 recall 变化。不得只统计 parameters 或遗漏原生通用工具而称总 toolSchemaBytes。
- 扩展 `tests/skill-gated-tools.test.mjs`，运行相关既有 packs-v3/card-bundle/asset-generation/tts/mod-config/script 测试；舞台回归必跑 `tests/asset-packs-director.test.mjs`、`tests/fork-opening-scene.test.mjs`、`tests/fork-gal-mood-motion.test.mjs`。发布前执行 `tests/fork-ui-standard.test.mjs` 与 client build --check（涉及客户端先 build），public clean-home composition 验证新工具真实注册、approval answerer 可用；不以仅 parser 通过代替管理行为。

Stage A 验收实绩：只写本文；完成现有 owners/确认 seam/大小限制/CAS 差异复核及真实注册基线测量。12 份草案通过当前 DSH `assertSupportedJsonSchema`；对 116 个 action/分支实例执行 464 项语法断言（合法输入、未知外壳字段、未知 action 字段、缺 action），均通过；预算占位符已清除。`git diff --check -- docs/fork/workbench-tools.md` 无输出；本文为未跟踪文件，另直接检查全文件，无尾随空白。本阶段这些是 schema/文档检查，不是 owner 行为集成测试；未运行真实收费请求、生成/导入/删除、浏览器操作、构建、部署或提交。

已批准选择：12 工具；预算收紧为按 Skill 10 KiB/全部 25 KiB（实际测量见 Stage B 更新）；候选采用/交互裁切只交原应用 UI；提取现 UI 图片发布构造供工具共用，不恢复独立图片 staging。Stage B 已获批准并实现，公开交付与发布门禁以文首记录为准。

## 附录 A：输入 schema 草案与可复算测量

从仓库根用 Node 读取本文，取 `js schema-draft` fenced block（按换行 `split` 定位），在仅提供 `{Buffer,console}` 的 `vm.runInNewContext` 中执行即可复算 §6 表格；不导入/执行生产 owner。schema 校验用 `tavern-plugin/node_modules/@deepseek-ai/dsh-tools/lib/index.js` 的 `assertSupportedJsonSchema` / `validateJsonSchemaValue` 对 `drafts[*].parameters` 执行。

以下 JavaScript 仅用于文档表达 schema/计量，不是工具实现。`J` 表示既有 owner 管理的 JSON 值，`O` 表示结构化对象；只有声明为异构 payload 的位置允许开放结构。`?` 字段可省略，其他均必填。所有 action envelope 关闭未知字段。既有 `tavern_read_script` 不在新定义里，其 schema 从原注册读取。

```js schema-draft
const S = {type:'string'}, I = {type:'integer'}, B = {type:'boolean'}, N = {type:'null'};
const J = {description:'按读取投影返回的 owner 字段类型填写。'};
const O = {type:'object'};
const E = (...values) => ({type:'string',enum:values});
const A = items => ({type:'array',items});
const U = (...oneOf) => ({oneOf});
function obj(fields) {
  return {type:'object',additionalProperties:false,
    properties:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k.replace(/\?$/,''),v])),
    required:Object.keys(fields).filter(k=>!k.endsWith('?'))};
}
const rev = U(S,N), ref = obj({packId:S,kind:S,assetId:S}), fig = obj({packId:S,figureId:S});
const page = {'offset?':I,'limit?':{type:'integer',description:'默认20，最多50。'}};
const pack = {packId:S,expectedRevision:S};
const action = (names,fields={}) => obj({action:E(...names.split('|')),...fields});
const tool = (name,description,variants) => ({name:'tavern_'+name,description,
  parameters:obj({request:U(...variants)})});
const fieldPatch = keys => obj(Object.fromEntries(keys.split(' ').map(k=>[k+'?',J])));
const figurePatch = obj({'name?':S,'aliases?':U(A(S),N),'enabled?':B,'recall?':obj({mode:E('constant','keyword')}),'appearance?':E('live2d','sprite','avatar'),'heightCm?':U({type:'number'},N),'heightBasis?':U(E('standing','seated'),N),'elevationCm?':U({type:'number'},N),'imageColor?':U(S,N),'identityAppearance?':U(S,N),'identitySettei?':U(O,N),'outfits?':A(O),'emotions?':U(A(O),N),'voice?':U(O,N),'extensions?':U(O,N)});
const packPatch = obj({'name?':S,'description?':S,'category?':S,'aliases?':A(S),'author?':S,'license?':S});
const assetKinds = E('figures','backgrounds','music','sfx','ambience','skins','looks','cg','items','directions','performances','widgets','sprites','voices','bundles');
const stateValue = U(obj({auto:{type:'boolean',const:true}}),obj({fixed:J}),obj({ref:obj({source:S,path:S,'fields?':O})}),obj({formula:S}));
const mod = {modId:S,expectedRevision:S};
const config = {...mod,key:S,layer:E('global','card')};
const target = U(
  obj({packId:S,kind:E('identity-settei'),figureId:S}),
  obj({packId:S,kind:E('settei'),figureId:S,outfitKey:S}),
  obj({packId:S,kind:E('avatar-sheet'),figureId:S,outfitKey:S,'emotionIds?':A(S)}),
  obj({packId:S,kind:E('sprite','avatar'),figureId:S,outfitKey:S,emotionId:S}),
  obj({packId:S,kind:E('background'),'assetId?':S}));
const drafts = [
  tool('assets_read','只读素材小投影、绑定、依赖或字段说明。',[
    action('list',{'query?':S,...page}),action('item',{packId:S,kind:assetKinds,'id?':S,...page}),
    action('resolve',{refs:A(U(ref,fig))}),action('bindings',{'path?':S}),action('dependencies',{packId:S}),
    action('settings|catalogue'),action('schema',{kind:assetKinds})]),
  tool('assets_patch','通过素材 owner 做一次 CAS 修改；全局或共享影响须宿主确认。',[
    action('create-pack',{name:S,'description?':S,expectedRevision:N}),action('patch-pack',{...pack,patch:packPatch}),action('remove-pack',pack),
    action('item',{...pack,item:O}),action('remove-item',{...pack,kind:E('backgrounds','music','sfx','ambience','skins','looks','cg','items','directions','performances','widgets'),id:S}),
    action('create-figure',{...pack,figure:obj({name:S,'appearance?':E('live2d','sprite','avatar'),'outfits?':A(O)})}),action('patch-figure',{...pack,figureId:S,patch:figurePatch}),action('remove-figure',{...pack,figureId:S}),
    action('copy',{sourcePackId:S,itemRefs:A(obj({kind:S,id:S})),target:U(obj({newPackName:S}),obj(pack))}),
    action('bind',{'path?':S,expectedRevision:S,boundPackIds:A(S)}),action('global-packs',{expectedRevision:S,globalEnabledPackIds:A(S)}),
    action('catalogue-settings',{expectedRevision:S,sources:A(O),'preferredDownloadId?':S,'mirrorPrefix?':S}),
    action('avatar-crop',{...pack,figureId:S,outfitKey:S,scope:E('outfit','state'),'stateId?':S,crop:U(obj({x:{type:'number'},y:{type:'number'},w:{type:'number'},h:{type:'number'}}),N)}),
    action('emotion-fallback',{...pack,figureId:S,outfitKey:S,emotionId:S,enabled:B}),action('remove-emotion',{...pack,figureId:S,emotionId:S}),
    action('layered-sprite',{...pack,figureId:S,outfitKey:S,spriteKey:S,manifest:O,assets:O,'files?':A(obj({path:S,file:S}))}),
    action('layered-part',{...pack,figureId:S,outfitKey:S,rigId:S,partId:S,part:O,media:U(obj({hash:S}),obj({file:S}))}),
    action('remove-layered-part',{...pack,figureId:S,outfitKey:S,rigId:S,partId:S})]),
  tool('media_upload','把工作台文件交原媒体 owner；不自动绑定或采用生成候选。',[
    action('blob',{...pack,file:S,purpose:E('music','sound','ambience','voice-reference')}),
    action('image',{...pack,file:S,target:U(obj({kind:E('avatar','sprite'),figureId:S,outfitKey:S,emotionId:S}),obj({kind:E('settei'),figureId:S,outfitKey:S}),obj({kind:E('identity-settei'),figureId:S}),obj({kind:E('asset'),asset:O,slot:E('media')}),obj({kind:E('asset'),asset:O,slot:E('variant'),variant:S}))}),
    action('bundle',{...pack,directory:S,bundleKey:S,kind:E('live2d','widget','skin','performance'),entry:S}),
    action('mod-file',{...mod,layer:E('global','card'),file:S}),action('mod-media',{modId:S,packId:S,file:S})]),
  tool('assets_transfer','检查/导入/导出包或卡 ZIP，管理 catalogue 下载；先预览冲突。',[
    action('inspect',{kind:E('pack','card'),file:S,'path?':S}),action('inspect-url',{kind:E('card'),url:S,'path?':S}),
    action('preview-card',{inspectionId:S,decisions:O}),
    action('apply-pack',{inspectionId:S,expectedRevision:rev,decision:E('install','update','keep-both','noop','cancel'),'acceptScriptRisk?':B,'acceptVoiceFallback?':B}),
    action('apply-card',{inspectionId:S,expectedRevision:rev,decisions:O,'cancel?':B,'acceptScriptRisk?':B,'acceptVoiceFallback?':B}),
    action('export-pack',{packs:A(obj(pack)),output:S}),action('export-card',{'path?':S,expectedRevision:S,packIds:A(S),output:S}),
    action('refresh',{sourceId:S}),action('updates',{packIds:A(S)}),
    action('download',{selection:obj({sourceId:S,packId:S,version:S,downloadId:S,catalogueRevision:S}),'useMirrorPrefix?':B}),action('download',{url:S,'useMirrorPrefix?':B}),
    action('status',{jobId:S}),action('control',{jobId:S,actionId:E('pause','resume','cancel')})]),
  tool('stage_read','读取开场、全局舞台/judge 设置或只读提示词预览。',[
    action('card',{'path?':S}),action('engine|judge|bubbles'),
    action('director-preview',{playRef:S,turn:I,'section?':S,...page}),action('bubble-preview',{config:O}),
    action('schema',{section:E('openings','engine','judge')})]),
  tool('stage_patch','保存开场或全局舞台/judge 设置；全局写和付费测试须宿主确认。',[
    action('card',{'path?':S,expectedRevision:S,patch:fieldPatch('openings defaultSkin')}),
    action('engine',{expectedRevision:S,patch:obj({'stageToggles?':obj(Object.fromEntries(['dialogue','voice','stage','music','sfx','ambience'].map(k=>[k+'?',B]))),'dialogue?':O,'dialogueTheme?':S,'dialogueThemes?':A(O),'directorModel?':U(N,E('foreground'),obj({provider:S,model:S})),'dimensions?':O,'actionCaps?':O})}),
    action('judge',{expectedRevision:S,patch:obj({'enabled?':B,'provider?':E('unset','jev','openai','openai-compatible'),'model?':S,'baseUrl?':S,'keyName?':S,'threshold?':{type:'number'},'capPerKind?':I,'timeoutMs?':I,'preamble?':S})}),action('judge-test')]),
  tool('mods_read','读取已安装模组、配置 schema、值来源或公式结果。',[
    action('list|sources'),action('mod|packs|config',{modId:S}),action('resolve',{modId:S,key:S}),action('formula',{formula:S})]),
  tool('mods_patch','通过模组 owner 保存配置或权限；全局变更须宿主确认。',[
    action('authorize',{...mod,allowed:B}),action('scope',{...mod,scope:E('global','off')}),action('pack-scope',{...mod,packId:S,scope:E('global','off')}),
    action('settings',{...mod,values:O}),action('pack',{...mod,pack:O}),action('entry',{ref:O,entry:O,expectedRevision:S}),
    action('remove-pack',{...mod,packId:S}),action('config',{...config,value:stateValue}),action('clear-config',config)]),
  tool('voice_read','读取 TTS 服务/能力/读音和人物声音；仅返回凭据状态。',[
    action('services|provider-kinds|presets|choices|templates|engine-services'),action('voices|models',{serviceId:S,...page}),
    action('readings',{'id?':S,...page}),action('figure',{packId:S,figureId:S})]),
  tool('voice_patch','保存服务、读音或人物声音；全局写/真实测试须宿主确认，不接收密钥。',[
    action('engine-services',{expectedRevision:S,voiceServices:O}),
    action('save-service',{id:S,kind:S,label:S,config:O,expectedRevision:rev}),
    action('remove-service',{id:S,expectedRevision:S}),action('remove-service',{id:S,expectedRevision:S,force:{type:'boolean',const:true},reason:S}),
    action('test-service',{id:S}),action('save-preset',{preset:O,expectedRevision:rev}),action('remove-preset',{id:S,expectedRevision:S}),
    action('reading-create',{name:S,'from?':S}),action('reading-rename',{id:S,name:S}),action('reading-remove|reading-active',{id:S}),
    action('reading-edit',{id:S,expectedRevision:I,op:E('add'),entry:O}),action('reading-edit',{id:S,expectedRevision:I,op:E('set'),index:I,entry:O}),action('reading-edit',{id:S,expectedRevision:I,op:E('remove'),index:I}),
    action('assign-figure',{...pack,figureId:S,choice:U(obj({voiceId:U(S,N),'serviceId?':S,'language?':S}),obj({voiceSpec:O}))}),action('binding',{...pack,figureId:S,binding:U(O,N)}),action('pack-voice',{...pack,voiceId:S,voiceSpec:O,'figureId?':S}),
    action('save-template',{templateId:S,expectedRevision:rev,packId:S,packRevision:S,voiceId:S,binding:O}),
    action('assign-template',{templateId:S,templateRevision:S,...pack,figureId:S}),action('remove-template',{templateId:S,expectedRevision:S})]),
  tool('script_manage','管理剧本工作副本/绑定及 Helper 静音；游玩定位仍经原 continuity。',[
    action('info',{'path?':S}),action('import',{file:S,'title?':S}),action('bind',{path:S}),action('unbind|helpers'),action('mute',{id:S,muted:B}),
    action('browse',{playRef:S,position:I}),action('chunk-size',{playRef:S,chunkSize:I,revision:J,cardPath:S,scriptVersion:S}),action('point',{playRef:S,position:I,revision:J,cardPath:S,scriptVersion:S})]),
  tool('asset_generation','应用素材候选流程；每次生成须付费确认，采用交用户在应用选择。',[
    action('prepare',{target,expectedRevision:S,'userPrompt?':S,'references?':A(U(obj({hash:S,role:S}),obj({file:S,role:S}))),'quality?':E('low','medium','high','auto'),'count?':{type:'integer',description:'1..4，默认1；N张为N次单图请求。'},'redrawOf?':S,'note?':S,'useCandidateReference?':B}),
    action('generate',{planId:S,consentToken:S,'confirmNewRequestIds?':A(S)}),
    action('status|cancel|reject|retry-save',{jobId:S}),action('read',{jobId:S,'emotionId?':S}),action('list',{packId:S})])
];
const skillTools = {
  'tavern-features':[],
  'asset-library':['assets_read','assets_patch','media_upload','assets_transfer'],
  'figure-assets':['assets_read','assets_patch','media_upload'],
  'stage-setup':['assets_read','stage_read','stage_patch'],
  'stage-directing':['assets_read','assets_patch','stage_read','stage_patch'],
  'stage-mods':['mods_read','mods_patch','media_upload'],
  'figure-voice':['assets_read','voice_read','voice_patch','media_upload'],
  'script-play':['script_manage'],
  'card-sharing':['assets_read','assets_transfer'],
  'asset-generation':['assets_read','asset_generation']
};
const bytes = value => Buffer.byteLength(JSON.stringify(value),'utf8');
const additional = rows => rows.length ? bytes(rows)-1 : 0; // 追加到非空基线，计入逗号。
console.log(JSON.stringify({tools:drafts.map(t=>[t.name,additional([t])]),all:additional(drafts),
  skills:Object.fromEntries(Object.entries(skillTools).map(([k,names])=>[k,additional(drafts.filter(t=>names.includes(t.name.slice(7))))+(k==='script-play'?633:0)]))},null,2));
```
