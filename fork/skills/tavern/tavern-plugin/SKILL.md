---
name: tavern-plugin
description: "编写或修改 DSH Tavern 插件：媒体、正文标记、按钮与面板，以及参与提示词、记忆、状态和后台结算的插件。普通人物卡使用改卡 Skill，通用工具使用 advanced-capabilities。"
---

# Tavern 插件

通过 `tavern_read_skill_reference` 读取 [插件接口](references/plugin-api.md)；按功能读取 [常见用法](references/plugin-recipes.md)，起步代码见 [示例](references/example-plugin.md)。使用公开接口版本 2 的宿主 `tavern`、浏览器 `tavernUi` 与 DSH 服务。

## 实现边界

- 用 `ctx.tavern.方法名()` 调用，服务靠调用上下文识别插件所有者。媒体和异步结果绑定接口给出的 gameId、turn、textVersion，不自行推测版本或将过期结果改绑到新轮次。
- 插件只用已公开接口，不修改 Tavern 程序、人物卡或会话文件，也不绕过接口访问 Tavern 数据目录。接口缺少能力时报告具体缺口，建议向上游提交接口需求。
- 密钥用 DSH credentials 保存，不写进代码、普通设置或日志。收费生成失败后报告失败媒体项和原因，不自动重试。
- 开场与插件加载前的旧轮次不会补发结算通知；需要读取时使用公开读接口，不自动生成或付费。插件数据和媒体不随官方游戏存档导出，不承诺完整往返。

## 安装与验证

一个插件放在持久数据目录 `plugins/<名称>/`，`package.json` 声明宿主入口 `index.mjs` 和可选浏览器入口 `client.js`，按示例使用受保护的入口。不再写入 `tools/` 或 `tools.cordis.yml`，那里不能加载浏览器侧。

检查 package JSON、Node 语法与入口路径。新目录插件的宿主侧会在几秒内加载，浏览器侧刷新后出现；修改已加载的宿主代码需要完整重启 DSH。只保存文件不能声称已加载；检查跳过原因与日志，实际验证相应界面、通知或版本切换后再报告可用。付费调用、重启或真实游戏写入必须在当次授权范围内。
