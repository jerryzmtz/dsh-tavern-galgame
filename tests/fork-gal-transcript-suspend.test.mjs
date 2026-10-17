import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { transcriptSource } from './helpers/fork-transcript-perf-ui.mjs'
const read = name => fs.readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

// private fork: stage demand now comes from session descriptors, not hidden voice/publication hooks.
test('stage freezes the whole transcript tree while the session source and stage voice keep advancing', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.setContent('<style>p{margin:16px 0}#transcript-scroll{z-index:0!important}</style>')
    await page.addScriptTag({ content: await browserReactScript() + '\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n' + transcriptSource(read) })
    await page.waitForFunction(() => window.transcriptProbe)
    await page.waitForTimeout(200)
    const result = await page.evaluate(async () => {
      const p = transcriptProbe, wait = () => new Promise(resolve => setTimeout(resolve, 40))
      p.mount.scrollTop = 12000
      const scroll = p.mount.scrollTop, height = p.mount.scrollHeight
      const original = document.querySelector('#transcript .fork-stage-markdown')
      p.active(true); await wait(); p.reset()
      for (let i = 0; i < 12; i++) { p.tick(); await wait() }
      p.enableVoice(); await wait()
      const voice = p.stageVoice(140)
      voice.click(); await wait()
      const hidden = { ...p.counts, voiceOwner:voice.owner, scroll:p.mount.scrollTop,height:p.mount.scrollHeight,
        ranges:[...CSS.highlights.values()].reduce((n,h)=>n+h.size,0), retained:original===document.querySelector('#transcript .fork-stage-markdown'),
        text:p.runtime.getSnapshot().textIndex.get(141).parts[0].text, voices:p.parts.get('offline').size }
      p.enableVoice(false); await wait()
      p.active(false); await wait()
      const restored = {scroll:p.mount.scrollTop, text:document.querySelector('#transcript')?.textContent,
        renders:p.counts.markdown,ranges:[...CSS.highlights.values()].reduce((n,h)=>n+h.size,0)}
      p.dispose(); await wait()
      return { scroll,height,hidden,restored,remaining:CSS.highlights.size }
    })
    assert.deepEqual(errors, [])
    assert.equal(result.hidden.markdown, 0, 'even parent/config/player/demand updates must not invoke ForkBubbleMarkdown')
    assert.equal(result.hidden.host, 0, 'host Markdown is frozen too')
    assert.equal(result.hidden.ranges, 0)
    assert.equal(result.hidden.retained, true)
    assert.equal(result.hidden.scroll, result.scroll)
    assert.equal(result.hidden.height, result.height)
    assert.equal(result.hidden.voices, 141, 'all source parts survive independently of transcript mounts')
    assert.ok(result.hidden.voiceOwner, 'stage still receives playable voice handles')
    assert.ok(result.hidden.rpc > 0, 'the local voice RPC seam receives the click without mounting transcript UI')
    assert.match(result.hidden.text, /Latest 12/)
    assert.equal(result.restored.scroll, result.scroll)
    assert.match(result.restored.text, /Latest 12/)
    assert.ok(result.restored.renders >= 141)
    assert.ok(result.restored.ranges > 0)
    assert.equal(result.remaining, 0)
  } finally { await browser.close() }
})
