import test from 'node:test'
import assert from 'node:assert/strict'
import { projectWorldBookTemplates } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'

const runtime = await UpstreamTemplateRuntime.create()
async function project(entries, variables = {}) {
  return await projectWorldBookTemplates({ includeConstants: true, runtime, worldBook: { view: { entries } }, chat: { variables }, card: { name: '测试' } })
}

test('命定之诗模式：常驻 setvar 供条件条目 getvar 使用，不写入持久变量', async () => {
  const setter = { ref: 'dlc', enabled: true, constant: true, content: '{{setvar::补充::龙姬解封}}' }
  const current = await project([setter])
  const planner = createContextPlanner({ prompt: () => '' })
  const body = await planner.plan({ purpose: 'body', card: {}, chat: { macroState: current.macroState }, worldBookContext: '城市：{{getvar::补充}}' })
  assert.match(body.text, /城市：龙姬解封/)
  setter.enabled = false
  const disabled = await project([setter])
  const next = await planner.plan({ purpose: 'body', card: {}, chat: { macroState: disabled.macroState }, worldBookContext: '城市：{{getvar::补充}}' })
  assert.doesNotMatch(next.text, /龙姬解封/)
})
