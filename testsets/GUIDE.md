# 接口与案例说明

先启动正式酒馆，更新插件后重启以加载新 API。运行器通过正式启动器的本地认证连接；认证链接与 Cookie 不写入报告。

```yaml
name: 两轮游玩
model:
  provider: deepseek-official
  model: deepseek-v4-flash
  reasoningEffort: high
timeoutMs: 300000
steps:
  - action: play
    sourceCard: avra-complete.json
  - action: say
    input: 我向阿芙拉询问去集市的方向。
    candidates: true
    expect:
      minChars: 15
      refused: false
  - action: say
    inputFrom:
      candidate: 1
      type: action
    expect:
      minChars: 15
```

`pnpm test:play 路径/scenario.yaml` 执行；模型请求会计费。每轮等待真实正文和后台结算，候选从上一轮持久结果选取。断言失败默认停止；`continueOnFailure: true` 允许继续断言失败后的步骤，执行异常仍停止。未执行步骤标记 `not-run`。

`expect.refused` 标记预期是否拒绝；报告同时保存规则命中证据与原文。规则标记不等于模型安全系统的确切判断。`expect.backgroundRequired` 默认 `true`，后台没有调用或失败不能通过；如正式设置关闭后台，可显式设 `false`，此时显示未调用。

`action: card` 创建正式卡片工作台会话，`sourceCard` 指定要编辑的正式卡；省略时为空白工作台。`action: image` 在游玩回复后调用正式生图任务，需正式酒馆已配置生图。不为测试修改全局设置。卡片编辑产生的资源改动与正式工作台一致，请用专门测试卡。

## 正式接口

所有请求使用已有认证的 `POST /api/dsh-tavern/gameplay.<方法>`，JSON 请求/响应。响应沿用 `{ok, ...结果}`；失败 `{ok:false,error}`。创建后的操作必须携带接口生成的 `sessionId`，不能操纵普通玩家会话。

| 方法 | 参数 / 返回 |
|---|---|
| `capabilities` | 协议版本、脚本运行时支持状态 |
| `cards` | 正式卡库的文件路径和名称 |
| `create` | `sourceCard`, `mode: story/card`, `model`；返回 `sessionId`, `chat`, `model`, `requiresBrowser`，初始化失败保留会话身份及 `error` |
| `send` | `sessionId`, `input`；或 `inputFrom`, `previousRequestId`；由原生 Session 接收输入 |
| `state` | `sessionId`；完整游戏存档、后台活动状态 |
| `candidates` | `sessionId`；复用正式候选任务 |
| `requests` | `sessionId`；正式模型请求与输出日志 |
| `native` | `sessionId`, 可选 `nativeSessionId`；主会话或关联 Agent 原生事件 |
| `resources` | `sessionId`；正式资源的哈希清单 |
| `image` / `imageStatus` | `sessionId`；正式生图生成/状态 |
| `cancel` | `sessionId`；停止该测试会话的正文和后台任务 |

接口复用原生 `sessionController.create/prompt` 和酒馆 `startChat/submitTask/generateSceneImage`，不构造 system、世界书或独立 Agent 循环。模型设置调用原生会话选择底层方法，避免原生 UI 选择方法附带的全局默认保存；此适配针对当前 DSH rc.1，不兼容的宿主会明确报错。

## 证据与限制

每轮保留输入、正文、各 Agent 请求与响应、工具调用、存档快照、候选和错误，写入 `results/.../run-*`。不再产生浏览器截图。报告 UI 可以继续查看历史截图。运行失败或中断会尝试取消本次测试任务，正式服务保持运行。

测试客户端为普通游玩会话启动独立无头 Chromium，加载正式模板执行器与服务端的版本化模板资源；等待就绪后才进入输入步骤。创建步骤记录 `templateRuntime: ready`。初始化失败保留测试会话身份并停止，不发送模型输入。成功、失败和中断都关闭模板浏览器。首次使用需执行 `pnpm exec playwright install chromium`；浏览器认证信息不写入报告。

正式资源与设置的读取时机也遵循正式游戏：新游戏会生成原有快照，游戏途中不会强制重载卡片。报告的存档快照与模型请求记录能检查实际注入内容。

MVU/人物卡浏览器脚本尚未由测试浏览器托管。遇到此类卡时发送接口失败并保存原因；模板调用浏览器斜杠命令也会明确失败。不能把这些卡当作已完成纯 API 等价验证。
