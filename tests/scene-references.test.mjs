// private fork: current tagged snapshots remain readable without migrating historical snapshots.
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneReferences } from '../tavern-plugin/lib/domain/scene-references.js'

const snapshot = text => ({ cardContextSnapshotVersion: 5, cardContextSnapshot: '【故事设定 · 人物卡】\n名字: 林岚\n\n' + text })
const context = { target: { turn: 2 }, sources: [{ id: 'target', turn: 2, text: '林岚走进青石车站。' }] }

test('many tiny matching paragraphs cannot inflate reply metadata beyond three fragments', () => {
  const refs = createSceneReferences({ ...context, snapshot: snapshot('设定: ' + Array.from({ length: 800 }, (_, index) => '林岚' + index).join('\n\n')) })
  for (let index = 0; index < 3; index++) assert.equal(refs.read({ query: '林岚' }).sources.length, 3)
})

test('current planner tags preserve description/scenario reads without leaking personality or instructions', async () => {
  const planned = await createContextPlanner({ prompt: () => '' }).plan({ purpose: 'play-card-snapshot', chat: {},
    card: { name: '林岚', description: '她戴着银色眼镜。', scenario: '青石车站有蓝色座椅。', personality: '林岚 PRIVATE_PERSONALITY', system_prompt: '青石车站 PRIVATE_INSTRUCTION' },
    worldBookContext: '青石车站的站牌是绿色的。' })
  const current = { cardContextSnapshotVersion: 5, cardContextSnapshot: planned.text }
  const refs = createSceneReferences({ ...context, snapshot: current })
  assert.equal(refs.metadata.cardName, '林岚')
  assert.match(JSON.stringify(refs.read({ query: '林岚' })), /银色眼镜/)
  const station = JSON.stringify(refs.read({ query: '青石车站' }))
  assert.match(station, /蓝色座椅/)
  assert.match(station, /绿色/)
  assert.doesNotMatch(station, /PRIVATE_/)
  const perEntry = createSceneReferences({ ...context, snapshot: current, worldbook: { entries: [] } })
  assert.doesNotMatch(JSON.stringify(perEntry.read({ query: '青石车站' })), /绿色/)
})
