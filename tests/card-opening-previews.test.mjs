import assert from 'node:assert/strict'
import test from 'node:test'

import { projectCardOpeningPreviews } from '../tavern-plugin/lib/domain/card-opening-previews.js'

test('native swipe chooser receives opening bridge metadata without treating prose as a chooser', async () => {
  const card = { name: '选择台', first_mes: '<script>const ctx=SillyTavern.getContext();ctx.swipe.to(null,"right",{forceMesId:0,forceSwipeId:1});</script>', alternate_greetings: ['目标开场'] }
  const result = await projectCardOpeningPreviews({ card })
  assert.ok(result.openings[0].openingPreview)
  assert.equal(result.openings[0].openingPreview.openingIds[1], 'alternate:0')
  const prose = await projectCardOpeningPreviews({ card: { first_mes: 'He swiped his card. The character_menu appeared and he decided to jump.' } })
  assert.equal(prose.openings[0].openingPreview, null)
})

test('legacy angle-bracket names agree in preview, committed opening and display refresh without changing card source', async () => {
  const {projectOpeningCommit} = await import('../tavern-plugin/lib/domain/runtime-content-projection.js')
  const {projectReplyLayers} = await import('../tavern-plugin/lib/domain/reply-presentation.js')
  const source = '```start\n<user> visits <char>.\n```'
  const card = {name:'Host',first_mes:source}
  const options = {charName:card.name,macroState:{userName:'Guest'}}
  const preview = await projectCardOpeningPreviews({card,userName:'Guest'})
  assert.equal(preview.openings[0].usesUser,true)
  assert.match(preview.openings[0].text,/Guest visits Host/)
  assert.equal(projectOpeningCommit(source,options).bodyText,preview.openings[0].text)
  assert.equal(projectReplyLayers(source,options).displayText,preview.openings[0].text)
  assert.equal(card.first_mes,source)
  assert.equal(projectReplyLayers('<user-card>unchanged</user-card>',options).displayText,'<user-card>unchanged</user-card>')
})
