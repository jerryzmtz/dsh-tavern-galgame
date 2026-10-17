import { readFileSync } from 'node:fs'

export const SYSTEM_PROMPT_DEFINITIONS = Object.freeze([
  ['system-append', 'system附加指令', '默认开启，可按需关闭。内容会添加到前台、后台、卡片及文生图 Agent 的 system 提示词最前面（位于外部预设之前），修改后从下一次请求生效。'],
  ['story', '正文 Agent 核心提示词', '控制普通游玩正文的续写规则。'],
  ['script-story', '剧本模式正文补充', '控制绑定剧本时追加给正文 Agent 的规则。'],
  ['candidate-story', '普通剧情候选项', '控制普通剧情候选项的数量、类型和输出格式。'],
  ['candidate-script', '剧本候选项', '控制剧本模式候选项及剧本推进规则。'],
  ['posture-settlement', '姿势状态结算', '控制后台姿势结算的工具提交。'],
  ['story-compaction', '前台上下文压缩', '用于前台手动和自动压缩：把更早的剧情写成摘要，最近 10 轮原文原样附在摘要后。修改后下次压缩生效；后台仍使用 DSH 内置压缩提示词。'],
  ['card-system', '卡片 Agent 系统指令', '默认空白；从 card-system.md 读取，非空时仅注入卡片 Agent。'],
  ['card-workspace', '卡片 Agent 工作区说明', '仅注入卡片 Agent 的 system。可编辑完整说明；{{resourceRoot}} 自动替换为当前资源根目录，{{projectionPaths}} 自动替换为当前会话的投影文件路径。保存后下一次请求生效。'],
  ['scene-image-system', '文生图 Agent 系统指令', '控制生图 Agent 的角色与职责，修改后下一次生图任务生效。'],
  ['scene-plan', '文生图画面规划', '控制从剧情规划画面的要求，修改后下一次生图任务生效。'],
  ['scene-image-adjustment', '文生图画面调整', '控制按用户要求调整画面的规则，修改后下一次调整任务生效。'],
].map(function (item) { return Object.freeze({ name: item[0], label: item[1], description: item[2] }) }))

export const SYSTEM_PROMPT_NAMES = Object.freeze(SYSTEM_PROMPT_DEFINITIONS.map(function (item) { return item.name }))

const knownNames = new Set([...SYSTEM_PROMPT_NAMES,
  'card-reference', 'card-task-edit', 'card-task-extract', 'card-task-script',
  'card-task-worldbook', 'card-task-preset', 'card-task-debug-play'
])

export function createPromptCatalog(directory = new URL('../prompts/', import.meta.url)) {
  return function promptFromFile(name) {
    if (!knownNames.has(name)) throw new Error('未知提示词: ' + String(name))
    const text = readFileSync(new URL(name + '.md', directory), 'utf8').trim()
    if (text === '' && name !== 'card-system' && name !== 'system-append') throw new Error('提示词文件不能为空: ' + name + '.md')
    return text
  }
}

export const prompt = createPromptCatalog()
