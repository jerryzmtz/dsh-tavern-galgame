// private fork: follow upstream module extraction without weakening behavior assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/runtime/host-artifacts.js', import.meta.url), 'utf8')
const start = source.indexOf('function tavernStaticAssetShim()')
const end = source.indexOf('function tavernIconDependencies()', start)
const html = vm.runInNewContext(source.slice(start, end) + ';tavernStaticAssetShim()')
const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]

function run(style) {
  const queue = []; let callback, writes = 0
  class Element {
    constructor() { this.nodeType = 1; this.tagName = 'DIV'; this.attrs = { style } }
    getAttribute(key) { return this.attrs[key] }
    setAttribute(key, value) { writes++; this.attrs[key] = value; queue.push({ target: this }) }
  }
  vm.runInNewContext(script, { window: {}, Element, document: { documentElement: {} }, MutationObserver: class {
    constructor(fn) { callback = fn }
    observe() {}
  } })
  const node = new Element(); queue.push({ target: node })
  for (let i = 0; queue.length && i < 50; i++) callback(queue.splice(0))
  return { style: node.attrs.style, writes, pending: queue.length }
}

test('quoted CSS image filenames with parentheses are proxied once and mutation delivery settles', () => {
  for (const quote of ['"', "'"]) {
    const url = 'https://images.example/portrait%20(1).png'
    const result = run('background-image: url(' + quote + url + quote + '); color: red')
    assert.equal(result.pending, 0, 'style observer must never write the same value back forever')
    assert.equal(result.writes, 1)
    assert.ok(result.style.includes('/api/dsh-tavern/static-assets?url=' + encodeURIComponent(url)))
    assert.ok(result.style.includes('color: red'))
  }
})

test('HTTPS text not parsed as a CSS url is not rewritten or requeued', () => {
  for (const style of ['--source: "https://images.example/portrait(1).png"', 'content: "https://example.test"']) {
    const result = run(style)
    assert.equal(result.pending, 0)
    assert.equal(result.writes, 0)
    assert.equal(result.style, style)
  }
})

test('real browser remains responsive after dynamic image styles and opaque HTTPS custom properties', { timeout: 20000 }, async t => {
  let chromium
  try { ({ chromium } = await import('playwright')) } catch { return t.skip('playwright unavailable') }
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('**/*', route => route.fulfill({ status: 200, body: '' }))
  await page.setContent('<base href="https://frame.test/"><div id="image"></div><div id="custom"></div>')
  await page.evaluate(() => {
    const Native = window.MutationObserver
    window.shimCallbacks = 0; window.loopStopped = false
    window.MutationObserver = class extends Native {
      constructor(fn) { super((records, observer) => {
        if (++window.shimCallbacks > 100) { window.loopStopped = true; observer.disconnect(); return }
        fn(records, observer)
      }) }
    }
  })
  await page.addScriptTag({ content: script })
  const result = await page.evaluate(async () => {
    document.getElementById('image').style.backgroundImage = 'url("https://images.example/portrait%20(1).png")'
    document.getElementById('custom').style.setProperty('--source', '"https://images.example/not-a-css-url"')
    await new Promise(resolve => setTimeout(resolve, 50))
    return { loopStopped: window.loopStopped, callbacks: window.shimCallbacks, image: document.getElementById('image').style.backgroundImage }
  })
  assert.equal(result.loopStopped, false)
  assert.ok(result.callbacks <= 3, JSON.stringify(result))
  assert.ok(result.image.includes('/api/dsh-tavern/static-assets?url='))
})

test('ordinary and multiple URLs settle, already proxied and non-HTTPS styles remain untouched', () => {
  const mixed = run('background: url(https://example.test/a.png), url("https://example.test/b(2).png")')
  assert.equal(mixed.pending, 0)
  assert.equal(mixed.writes, 1)
  assert.equal((mixed.style.match(/static-assets\?url=/g) || []).length, 2)
  for (const style of ['background: url(/api/dsh-tavern/static-assets?url=https%3A%2F%2Fexample.test%2Fa.png)', 'color: red', 'background: url(data:image/png;base64,abcd)']) {
    assert.deepEqual(run(style), { style, writes: 0, pending: 0 })
  }
})
