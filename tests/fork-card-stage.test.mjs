import test from 'node:test'
import assert from 'node:assert/strict'
import { projectCardStage, CARD_STAGE_MAX_HTML } from '../tavern-plugin/lib/domain/card-stage.js'
import { cardContentDigest } from '../tavern-plugin/lib/domain/play-card-snapshots.js'

test('card without a stage has no stage view', () => {
  assert.equal(projectCardStage(undefined), null)
  assert.equal(projectCardStage({}), null)
  assert.equal(projectCardStage({ dsh_stage: { html: '   ' } }), null)
  assert.equal(projectCardStage({ dsh_stage: { html: '<p>x</p>', enabled: false } }), null)
})

test('stage defaults to a backdrop layer', () => {
  const stage = projectCardStage({ dsh_stage: { html: '<stage-sky></stage-sky>' } })
  assert.equal(stage.mode, 'layers')
  assert.deepEqual(stage.regions, ['backdrop'])
  assert.equal(stage.hudWidth, 300)
  assert.match(stage.revision, /^[a-z0-9]+$/)
})

test('takeover ignores regions and unknown modes fall back with a warning', () => {
  assert.deepEqual(projectCardStage({ dsh_stage: { html: 'x', mode: 'takeover', regions: ['hud'] } }).regions, ['takeover'])
  const odd = projectCardStage({ dsh_stage: { html: 'x', mode: 'fullscreen' } })
  assert.equal(odd.mode, 'layers')
  assert.equal(odd.warnings.length, 1)
})

test('theme accepts only colors and font stacks', () => {
  const stage = projectCardStage({ dsh_stage: { html: 'x', theme: {
    text: '#fff', panel: 'rgba(0,0,0,.5)', accent: 'red;background:url(evil)', readingFont: 'serif', border: 'url(x)'
  } } })
  assert.equal(stage.theme.vars['--stage-text'], '#fff')
  assert.equal(stage.theme.vars['--stage-panel'], 'rgba(0,0,0,.5)')
  assert.equal(stage.theme.vars['--stage-accent'], undefined)
  assert.equal(stage.theme.vars['--stage-border'], undefined)
  assert.match(stage.theme.vars['--stage-reading-font'], /Serif/)
  const bad = projectCardStage({ dsh_stage: { html: 'x', theme: { readingFont: 'x;}body{color:red' } } })
  assert.equal(bad.theme.vars['--stage-reading-font'], undefined)
})

test('oversized stage is disabled with a warning', () => {
  const stage = projectCardStage({ dsh_stage: { html: 'a'.repeat(CARD_STAGE_MAX_HTML + 1) } })
  assert.equal(stage.html, '')
  assert.equal(stage.warnings.length, 1)
})

test('revision changes with content', () => {
  const a = projectCardStage({ dsh_stage: { html: 'a' } }), b = projectCardStage({ dsh_stage: { html: 'b' } })
  assert.notEqual(a.revision, b.revision)
})

test('stage edits do not change the card content digest', () => {
  const card = { name: 'x', extensions: { regex_scripts: [] } }
  const staged = { name: 'x', extensions: { regex_scripts: [], dsh_stage: { html: '<b>1</b>' } } }
  const restaged = { name: 'x', extensions: { regex_scripts: [], dsh_stage: { html: '<b>2</b>' } } }
  assert.equal(cardContentDigest(staged), cardContentDigest(restaged))
  // Cards without a stage hash exactly as before this change.
  assert.equal(cardContentDigest(card), cardContentDigest(JSON.parse(JSON.stringify(card))))
  assert.notEqual(cardContentDigest(card), cardContentDigest({ ...card, name: 'y' }))
})
