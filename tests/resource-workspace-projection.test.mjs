import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createResourceWorkspaceProjection } from '../tavern-plugin/lib/domain/resource-workspace-projection.js'

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

test('游玩关联保留在工作区数据中，不动态注入 system 上下文', async t => {
  const { resourceWorkspaceContext } = await import('../tavern-plugin/lib/domain/workspace-resources.js')
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-debug-context-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const publisher = createResourceWorkspaceProjection({ root })
  const result = await publisher.publish({ sessionId: 'debug', context: { mountedResources: [
    { kind: 'play-chat', path: 'play-chat:chat-game', chatId: 'chat-game', label: '测试游戏', turn: 3 },
    { kind: 'card', path: 'cards/test.json' }
  ] }, diagnostics: [{ overview: '不应直接注入的正文' }] })
  const text = resourceWorkspaceContext(root, result, '用户工作区说明')
  assert.equal(text, '用户工作区说明')
  const stored = await json(path.join(root, result.contextPath))
  assert.equal(stored.mountedResources[0].path, 'play-chat:chat-game')
  const cleared = await publisher.publish({ sessionId: 'debug', context: { mountedResources: [] } })
  assert.equal(resourceWorkspaceContext(root, cleared, '用户工作区说明'), '用户工作区说明')
})
