# dsh-tts

独立 DSH 静态包，提供宿主服务 `tts`、浏览器服务 `ttsClient` 和设置页 Speech Services。
Tavern 通过公开 source/grant 接口消费声音；本包不导入、不迁移、不接管 Tavern，也不依赖私有本地插件。

- 原生设置 namespace：`tts`，由 `settings.installSection` 注册。
- 密钥：DSH `credentials`，保留 `DSH_TAVERN_TTS_<ID>_<FIELD>` 引用规则。
- 缓存：composition 指定 `dataDir`，本 profile bundle 显式选择 `dshHomePath('profile-data', 'tavern', 'tts')`。其他 profile 必须覆盖整个 config。
- 控制：登录保护的 Connection exact Fetch route `/api/dsh-tts/v1/control`；请求 `{method,args}`。不接受浏览器提供的文件路径或伪造 ConsumerGrant。
- 音频：`GET /api/dsh-tts/v1/audio?ticket=...`，同源、登录 Cookie、最长 60 秒 ticket、private/no-store。
- 合成仅宿主调用：先 `registerProvider` / `registerVoiceSource`，消费者授权后 `grantConsumer`，再 `synthesize`。关闭来源/插件立即撤销访问。

## Fish Audio

<!-- private fork: built-in provider; no local engine dependency. -->

`fish-audio` 默认 Base URL `https://api.fish.audio`、模型 `s2.1-pro-free`。
API key 走既有 credentials；付费 `s2.1-pro` 只能明确选择，不自动回退。
预设使用 `params.referenceId`，人物自有 `reference` 音频则每次合成内联 `references`，
包含情绪槽与不同的 default，不创建持久模型。服务凭据缺失时支持 `FISH_AUDIO_API_KEY`。
免费请求单并发、429 尊重 Retry-After。
完整设置、参数、官方协议差异与验证见仓库 `docs/fork/fish-audio.md`。

## 通用参考音频服务

<!-- private fork: public provider protocol; no local lifecycle dependency. -->

设置页可添加 `reference-api`，与其他 provider 一样配置 Base URL + API key（密钥进 credentials）。
宿主也可调用 `registerReferenceProvider(owner,{id,url,key})`；注册返回可释放句柄，不启动或接管进程。
URL 允许 HTTP/HTTPS，不接受 URL 内凭据、query/hash，也不跟随 redirect。

服务协议 `dsh-tts-reference-v1`，全部请求使用 `Authorization: Bearer <key>`：

- `GET /v1/info`：`{protocol,revision,state,capabilities:{voiceKinds:['reference'],paid:boolean}}`。
  `revision` 标识合成实现版本并参与缓存身份；未知/失败时按可能收费处理，不能免费试听。
- `GET /v1/voices`：`{voices:[{id,label,languages,state,revision,...}]}`。允许空数组；声音目录仅供作者导出，不是合成真源。
- `POST /v1/export`：输入 `{voiceId,revision}`；输出 `{voice,media:{'<sha256>':'<base64 WAV>'}}`。
  `voice` 是完整 PortableVoice（kind=reference），含 references 的 SHA、transcript、language、file；宿主验证每份 WAV 和哈希。
- `POST /v1/synthesize`：输入 `{text,language,voice:{kind:'reference',model?,params,reference:{sha256,base64,promptText,promptLanguage}}}`；输出 PCM WAV。
  model 是可选、有界的不透明 provider JSON，params 是有界标量表；不含路径、URL、凭据等机器连接字段。
  provider 必须使用本次参考音频/原文/语言/参数；缺模型或不支持就失败，绝不回退全局 voiceId。

这不是 GPT-SoVITS 专用接口。云服务或免费独立服务均可实现；模型解释和参数范围属于实现方。
figure/包拥有参考音频字节。内置云预设的导出复制纯参数，不发付费合成请求。

`src` 为维护源，`node build.mjs` 生成 `lib`；客户端生成 DSH ModuleLoader 包，不捆绑 React。`node build.mjs --check` 验证产物。
`importProviders` 是纯转换函数，不读写旧 `voice/providers.json`，不移动凭据。完整限制、测试记录见仓库 `docs/fork/tts-plugins.md`。
