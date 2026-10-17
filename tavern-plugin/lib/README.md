# 插件服务端

`index.js` 是 DSH 插件入口，负责创建存储、会话与后台运行模块，连接依赖，
注册宿主能力并恢复运行状态。主要实现按以下职责组织：

- `tools/`：按用途注册模型工具，包含原有描述、参数、输出格式和执行逻辑。
- `hooks/request.js`：请求坐标、重试限制和前台步骤准备。
- `hooks/model-stream.js`：导入上下文检查、模板投影、压缩请求和模型日志。
- `hooks/turn-lifecycle.js`：回合结束、失败清理、正文提交和 system 提示词组装。
- `http/routes.js`：HTTP 路由、资源响应、请求校验和 RPC 错误封装。
- `domain/compatibility-turn.js`：SillyTavern 世界书匹配与兼容请求编译。
- `domain/` 的其他文件：既有业务规则和运行模块。

这些文件是 ES 模块。纯函数和固定定义直接 import；每次插件启动独有的对象与
函数由入口显式传入。注册函数同步执行，保留入口中的调用顺序；不要把模块级
可变状态用于保存某个 Profile 的运行对象，也不要将共享闭包整体作为上下文传入。

入口仍保留共享依赖较多的会话装配和 RPC 方法分派。后续拆分应先明确模块需要的
依赖与初始化时机，避免为了缩短入口而引入巨大的依赖对象或循环依赖。

改动工具或 hooks 后运行相关行为测试及 `tests/plugin-startup.test.mjs`；
后者在隔离 Profile 中调用真实 `apply()` 并检查各类工具已注册。
HTTP 行为由 `tests/mvu-asset-route.test.mjs` 和 `tests/tavern-rpc-errors.test.mjs`
等测试覆盖，打包资源由 `tests/plugin-package.test.mjs` 检查。
