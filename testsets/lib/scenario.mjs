import { validateSourceCard } from './card-source.mjs'
import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { isDeepStrictEqual } from 'node:util'
import { refusalPatterns } from './refusal.mjs'

export async function loadScenario(file) {
  const absolute = path.resolve(file)
  const scenario = parse(await readFile(absolute, 'utf8'))
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) throw new Error('场景必须是 YAML/JSON 对象')
  if (!scenario.model?.provider || !scenario.model?.model) throw new Error('场景必须明确指定 model.provider 和 model.model')
  if (!Array.isArray(scenario.steps) || !scenario.steps.length) throw new Error('场景需要至少一个 steps 操作')
  refusalPatterns(scenario.refusalPatterns)
  if (scenario.continueOnFailure !== undefined && typeof scenario.continueOnFailure !== 'boolean') throw new Error('continueOnFailure 必须是布尔值')
  let mode = null, hasCandidates = false
  for (const step of scenario.steps) {
    if (!step || !['play', 'say', 'image', 'card'].includes(step.action)) throw new Error('不支持的操作：' + step?.action)
    const allowed = { play: ['action', 'sourceCard', 'card', 'cardName', 'expect'], card: ['action', 'sourceCard', 'card', 'expect'], say: ['action', 'input', 'inputFrom', 'candidates', 'expect'], image: ['action', 'expect'] }[step.action]
    for (const key of Object.keys(step)) if (!allowed.includes(key)) throw new Error('操作字段不支持：' + key)
    if (['play', 'card'].includes(step.action)) {
      mode = step.action
      hasCandidates = false
      if (step.sourceCard !== undefined) {
        validateSourceCard(step.sourceCard)
        if (step.card || step.cardName) throw new Error('sourceCard 不能与 card 或 cardName 同时配置')
      }
      if (step.card) { step.card = path.resolve(path.dirname(absolute), step.card); await access(step.card) }
      if (mode === 'play' && !step.card && !step.cardName && !step.sourceCard) throw new Error('play 操作需要 card 文件或已在测试库中的 cardName')
    } else if (!mode) throw new Error('必须先用 play 或 card 打开对话')
    if (step.action === 'image' && mode !== 'play') throw new Error('image 只能用于游玩对话')
    if (step.action === 'say') {
      if (step.inputFrom !== undefined) {
        const source = step.inputFrom
        if (step.input !== undefined || mode !== 'play' || !hasCandidates || !source || !Number.isSafeInteger(source.candidate) || source.candidate < 1 || !['action', 'scene'].includes(source.type || 'action') || Object.keys(source).some(k => !['candidate', 'type'].includes(k))) throw new Error('inputFrom 需要上一轮候选，candidate 为从 1 开始的序号，且不能同时提供 input')
      } else if (typeof step.input !== 'string' || !step.input.trim()) throw new Error('say 操作需要非空 input')
      hasCandidates = step.candidates === true
    }
    if (step.candidates !== undefined && (typeof step.candidates !== 'boolean' || mode !== 'play')) throw new Error('candidates 仅适用于游玩输入，且必须为布尔值')
    if (step.expect) validateExpect(step.expect)
  }
  const timeoutMs = scenario.timeoutMs ?? 300000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw new Error('timeoutMs 应在 1000 到 1800000 之间')
  return { ...scenario, timeoutMs, file: absolute }
}

function validateExpect(expect) {
  if (!expect || typeof expect !== 'object' || Array.isArray(expect)) throw new Error('expect 必须是对象')
  for (const [key, value] of Object.entries(expect)) {
    if (['contains', 'notContains', 'changedFiles'].includes(key)) {
      if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(key + ' 必须是字符串数组')
    } else if (['refused', 'backgroundRequired'].includes(key)) {
      if (typeof value !== 'boolean') throw new Error(key + ' 必须是布尔值')
    } else if (key === 'minChars') {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('minChars 必须是非负整数')
    } else if (key === 'state') {
      if (!Array.isArray(value) || !value.every(item => typeof item?.path === 'string' && Object.hasOwn(item, 'equals'))) throw new Error('state 需要 path / equals 数组')
    } else throw new Error('不支持的断言：' + key)
  }
}

export function assertions(expect = {}, { text = '', state = {}, changedFiles = [] }) {
  const results = []
  for (const file of expect.changedFiles || []) results.push({ check: 'changedFiles', expected: file, passed: changedFiles.includes(file) })
  for (const needle of expect.contains || []) results.push({ check: 'contains', expected: needle, passed: text.includes(needle) })
  for (const needle of expect.notContains || []) results.push({ check: 'notContains', expected: needle, passed: !text.includes(needle) })
  if (expect.minChars !== undefined) results.push({ check: 'minChars', expected: expect.minChars, actual: text.length, passed: text.length >= expect.minChars })
  for (const item of expect.state || []) {
    const actual = item.path.split('.').reduce((value, key) => value?.[key], state)
    results.push({ check: 'state', path: item.path, expected: item.equals, actual, passed: isDeepStrictEqual(actual, item.equals) })
  }
  return results
}

export { settledTurn } from '../../tavern-plugin/lib/domain/gameplay-settled-turn.js'

export { selectCandidate } from '../../tavern-plugin/lib/domain/candidate-selection.js'
