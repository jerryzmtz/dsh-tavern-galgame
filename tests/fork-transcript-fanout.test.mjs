import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { transcriptSource } from './helpers/fork-transcript-perf-ui.mjs'
const read = name => fs.readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

test('closed-stage transcript selects only affected messages for parent, renewal, voice and demand updates', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => route.abort())
    await page.setContent('<style>#transcript-scroll{z-index:0!important}</style>')
    await page.addScriptTag({ content: await browserReactScript() + '\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n' + transcriptSource(read) })
    await page.waitForTimeout(300)
    const result = await page.evaluate(async () => {
      const p = transcriptProbe, wait = () => new Promise(resolve => setTimeout(resolve, 250))
      const snapshot = () => JSON.parse(JSON.stringify(p.counts))
      p.reset(); p.parent(); await wait(); const parent = snapshot()
      p.reset(); for (let i = 0; i < 10; i++) { p.tick(); await wait() } const periodic = snapshot()
      p.enableVoice(); await wait(); p.reset()
      p.character('b', { color: '#ff0000' }); await wait(); const config = snapshot()
      const color = document.querySelector('#transcript > :last-child .fork-bubble').style.getPropertyValue('--bubble-color')
      p.reset(); p.player(3); await wait(); const start = snapshot()
      p.reset(); p.player(9); await wait(); const handoff = snapshot()
      // Media fields mutate in place. Reference equality alone would miss play/pause.
      const player = p.playerStore.get()
      const audio = player.audio // private fork: retain the actual native audio and its event callbacks
      p.reset(); p.player(9); await wait(); const pause = snapshot()
      const paused = document.querySelectorAll('#transcript > *')[9].querySelector('.fork-voice-button').dataset.voiceState
      p.reset(); p.player(9); await wait(); const resume = snapshot();const sameAudio=p.playerStore.get().audio===audio
      const playing = document.querySelectorAll('#transcript > *')[9].querySelector('.fork-voice-button').dataset.voiceState
      p.reset(); p.stop(); await wait(); const stop = snapshot()
      p.reset(); p.demand(2); await wait(); const demand = snapshot()
      p.active(true); await wait(); p.reset(); p.demand(4); await wait(); const stageDemand = snapshot()
      p.active(false); await wait()
      p.character('b', { voice: 'fixture/other' }); await wait(); p.reset()
      p.renew(); await wait(); const catalogueStatus = snapshot()
      p.reset(); p.character('b',{voice:null}); await wait(); const catalogueBinding = snapshot()
      const retiredButtons = document.querySelector('#transcript > :last-child').querySelectorAll('.fork-voice-button').length
      let queries = 0
      const original = Element.prototype.querySelectorAll
      Element.prototype.querySelectorAll = function (selector) { if (selector === 'p, .fork-bubble') queries++; return original.call(this, selector) }
      const paragraph = document.querySelector('.fork-stage-paragraph:has(.fork-bubble)')
      paragraph.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
      await new Promise(resolve => setTimeout(resolve, 600))
      const pressed = paragraph.classList.contains('is-long-pressed')
      p.dispose()
      return { parent, periodic, config, color, start, handoff, pause, paused, resume, playing, sameAudio, stop, demand, stageDemand, catalogueStatus, catalogueBinding, retiredButtons, queries, pressed }
    })
    assert.deepEqual(errors, [])
    const publications = value => Object.keys(value.publications).sort()
    assert.deepEqual(publications(result.parent), [])
    assert.deepEqual(publications(result.periodic), ['141:0'], 'cloned config, unrelated player/demand, and parent updates leave history asleep')
    assert.equal(result.periodic.markdown, 10)
    assert.deepEqual(publications(result.config), ['141:0'])
    assert.equal(result.color, '#ff0000')
    assert.deepEqual(publications(result.start), ['4:0'])
    assert.deepEqual(publications(result.handoff), ['10:0', '4:0'])
    assert.deepEqual(publications(result.pause), ['10:0'])
    assert.equal(result.paused, 'paused')
    assert.deepEqual(publications(result.resume), ['10:0'])
    assert.equal(result.playing, 'playing');assert.equal(result.sameAudio,true)
    assert.deepEqual(publications(result.stop), ['10:0'])
    assert.deepEqual(publications(result.demand), [], 'stage demand cannot affect closed-stage chat leases')
    assert.deepEqual(publications(result.stageDemand), [], 'private fork: native prefetch owns demand without transcript lease updates')
    assert.equal(result.stageDemand.markdown, 0, 'hidden transcript freeze remains intact')
    assert.deepEqual(publications(result.catalogueStatus), [], 'private fork: pack revision renewal does not affect native routing')
    assert.deepEqual(publications(result.catalogueBinding), ['141:0'], 'private fork: only messages using a revoked native voice binding update')
    assert.equal(result.retiredButtons, 0)
    assert.equal(result.pressed, true)
    assert.equal(result.queries, 0, 'paragraph local pressed state does not rescan unchanged children')
  } finally { await browser.close() }
})

test('publication memo preserves translations, callbacks, native identity and regeneration decisions', () => {
  const bubbles = read('fork-bubbles.js'), stage = read('fork-gal-stage.js'), context = {}
  vm.runInNewContext(stage.slice(stage.indexOf('function forkGalIsSuperseded'), stage.indexOf('// Plain reading text')) +
    bubbles.slice(bubbles.indexOf('function forkBubbleShallowEqual'), bubbles.indexOf('let forkBubblePublicationMemo')) +
    ';this.equal=forkBubblePublicationEqual;', context)
  const source = { nodeId: 'n', nativeTurn: 1, order: 1, view: {} }
  const a = { sessionId: 's', voiceScope: '1:0', text: 'hello', streaming: false, stageSource: source, labels: { code: { copy: 'Copy' }, footnotes: 'Notes' }, codeLabels: { copy: 'Copy' }, fileMentions() {} }
  const b = { ...a, stageSource: { ...source, view: { unrelated: true } }, labels: { ...a.labels, code: { ...a.labels.code } }, codeLabels: { ...a.codeLabels } }
  assert.equal(context.equal(a, b), true)
  for (const patch of [{ text: 'streamed' }, { streaming: true }, { fileMentions() {} }, { labels: { ...a.labels, code: { copy: 'Translated' } } }, { codeLabels: { copy: 'Translated' } }, { stageSource: { ...source, nodeId: 'replacement' } }, { stageSource: { nodeId: 'n', nativeTurn: 1, order: 1, superseded: true } }, { stageSource: { ...source, view: { regeneratedDshTurns: { 1: 2 } } } }, { stageSource: { ...source, view: { suppressedDshTurns: [1] } } }, { interrupted: true }]) {
    assert.equal(context.equal(a, { ...b, ...patch }), false, JSON.stringify(patch))
  }
})
