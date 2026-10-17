import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const moduleSource = await readFile(new URL('../tavern-plugin/src/client/modules/frame-sizing.js', import.meta.url), 'utf8')
const domainSource = (await readFile(new URL('../tavern-plugin/lib/domain/frame-sizing.js', import.meta.url), 'utf8')).replace(/export \{[^}]+\}/, '')
const sizing = vm.runInNewContext(domainSource + moduleSource + ';({parse:tavernFrameSizing,height:tavernFrameSizingHeight})')

test('card defaults and stable panel overrides survive card export and preview projection', async () => {
  const { createCardPreparation } = await import('../tavern-plugin/lib/domain/card-preparation.js')
  const { projectCardOpeningPreviews } = await import('../tavern-plugin/lib/domain/card-opening-previews.js')
  const cards = createCardPreparation({ id: () => 'sizing', now: () => 1 })
  const data = { name: 'layout', first_mes: '<div>app</div>', extensions: { dsh_tavern: { keep: true,
    frameSizing: { default: { mode: 'viewport' }, panels: { status: { mode: 'content', maxHeight: 500 } } } } } }
  const imported = cards.create({ kind: 'import', payload: { kind: 'text', text: JSON.stringify({ spec: 'chara_card_v3', data }) } })
  const exported = cards.present({ card: imported, as: 'sillytavern-v3' })
  assert.deepEqual(exported.data.extensions, data.extensions)
  const extensions = cards.present({ card: imported, as: 'card-extensions' })
  assert.equal(sizing.parse('', extensions.frameSizing).mode, 'viewport')
  assert.equal(sizing.parse('<meta name="dsh-tavern-frame" data-panel-id="status">', extensions.frameSizing).mode, 'content')
  assert.equal(sizing.parse('', extensions.frameSizing, 'status').source, 'panel')
  assert.equal(sizing.parse('<meta name="dsh-tavern-frame" content="fixed" data-height="300">', extensions.frameSizing, 'status').height, 300)
  const preview = await projectCardOpeningPreviews({ card: exported.data, extensions })
  assert.deepEqual(preview.openings[0].frameSizing, extensions.frameSizing)
})
