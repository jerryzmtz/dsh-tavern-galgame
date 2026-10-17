# 真实游戏 API 测试

测试直接调用正在运行的正式酒馆。人物卡、世界书、预设、system 构造、提示词覆盖、后台结算均使用正式实现与正式配置；每次运行创建独立 `test-*` 会话，不覆盖已有游戏存档，不创建测试 Profile。

普通游玩会自动启动无头 Chromium，复用正式页面的完整模板执行器，并按服务返回的版本加载模板资源；执行器就绪后才发送输入，测试结束或失败时关闭。首次使用运行 `pnpm exec playwright install chromium`。

内置安全示例为 `ordinary-tavern/`：先在正式酒馆导入该目录的 `ordinary-tavern.json`，再运行 `node testsets/run.mjs ordinary-tavern`（也是省略案例名时的默认案例）。三轮覆盖 EJS 世界书、正文、后台结算和候选续写；模型配置可在 `scenario.yaml` 中调整。

```sh
node testsets/run.mjs my-case --check  # 只检查
node testsets/run.mjs my-case          # 真实模型请求
node testsets/report-ui.mjs                             # http://127.0.0.1:4318
```

先在本地创建 `testsets/my-case/scenario.yaml`，配置格式参见 `examples/`。个人案例目录默认被 Git 忽略，不随仓库提交。

打开网页后，选择左侧案例可查看模型、输入、候选步骤及断言，点击“启动测试”即可执行。页面自动刷新运行状态并打开本次报告，同一网页服务同时只运行一个测试。运行时可点击“中止测试”，执行器会停止后续步骤、清理测试会话并保存已有报告；清理完成前禁止启动新测试。关闭网页不会停止测试。案例从 `testsets/<案例名>/scenario.yaml` 读取；配置无效时禁用执行。网页服务支持 `--runtime-home PATH` 和 `--results PATH`。

人物卡用 `sourceCard: 你的测试卡.json` 引用。在正式酒馆保存修改后，下次新开测试由正式游戏直接读取。模型与推理强度只设置到新测试会话；后台模型仍遵循正式酒馆的后台模型设置。

- `test-play.mjs`：多轮案例运行器。
- `lib/api.mjs`：正式游戏 HTTP 客户端。
- `lib/template-browser.mjs`：每个测试会话的完整模板浏览器宿主。
- `lib/recording.mjs`：各 Agent 输出、工具结果和失败记录。
- `lib/scenario.mjs`、`lib/refusal.mjs`：断言及拒绝标记。
- `results/`：每次报告、输入、请求、回复、原生事件和存档快照，不提交。
- `ui/`、`report-ui.mjs`：案例列表、手动启动与报告界面。
- 正式能力接口位于 `tavern-plugin/lib/gameplay-api.js`。

可传 `--runtime-home PATH`、`--output PATH`。不再支持 `--headed`、自动导入 `card` 文件或测试配置覆盖；旧 `tavernSettings` 不会改写正式设置，报告会注明。旧 `profiles/` 与已有报告保留，但不再使用。

**当前边界：**完整提示词模板已由测试浏览器托管；依赖 MVU 或人物卡浏览器脚本的游戏仍会在发送前明确失败。模板调用浏览器斜杠命令时也会明确报错。普通卡的正文、后台、候选续写已经支持。卡片 Agent 和文生图调用正式能力；卡片 Agent 的资源编辑会作用于正式卡库，需用专门测试卡。

详见 [接口与案例说明](./GUIDE.md)。
