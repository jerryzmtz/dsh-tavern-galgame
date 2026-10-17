import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const [scene, backlog, stage, fonts] = await Promise.all(['fork-gal-scene.js', 'fork-gal-backlog.js', 'fork-gal-stage.js', 'fork-fonts.js'].map(read))
const ctx = {}
vm.runInNewContext(scene.slice(scene.indexOf('function forkGalFrameRate'), scene.indexOf('// A line token')) +
  backlog.slice(backlog.indexOf('function forkGalBacklogWindow'), backlog.indexOf('// ---------- Backlog view')) +
  stage.slice(stage.indexOf('function forkGalSubtitleCache'), stage.indexOf('// Measure the actual film element')), ctx)

test('fps policy preserves Live2D/animated cadence, caps high-refresh displays and idles at 30', () => {
  assert.equal(ctx.forkGalFrameRate('high', true), 60)
  assert.equal(ctx.forkGalFrameRate('high', true, 144), 60)
  assert.equal(ctx.forkGalFrameRate('high', true, 50), 50)
  assert.equal(ctx.forkGalFrameRate('high', false), 30)
  assert.equal(ctx.forkGalFrameRate('low', true), 30)
  assert.equal(ctx.forkGalFrameRate('high', true, NaN), 60)
  assert.match(scene, /!state.figures.size && !\(desc.figures \|\| \[\]\).length && !desc.animatedUi/)
})

test('fractional pacing stays near 60 without integer truncation drift; sleeps do not catch up in bursts', () => {
  for (const refresh of [60, 144, 154, 180, 240]) {
    const pace = { last: 0, next: 0, fps: 0, vsync: 0 }, times = []
    for (let i = 1; i <= refresh * 10; i++) {
      const now = i * 1000 / refresh
      if (ctx.forkGalFrameDue(pace, now, 60)) times.push(now)
    }
    assert.ok(Math.abs(times.length - 600) <= 1, `${refresh} Hz: ${times.length} rendered frames`)
    assert.ok(Math.max(...times.slice(1).map((t, i) => t - times[i])) <= 1000 / 60 + 1000 / refresh + 0.01)
    assert.equal(ctx.forkGalFrameDue(pace, 20000, 60), true)
    assert.equal(ctx.forkGalFrameDue(pace, 20001, 60), false)
    assert.equal(ctx.forkGalFrameDue(pace, 20002, 30), true, 'rate change takes effect immediately')
  }
})

function texture(url, calls) {
  const baseTexture = { resource: { url }, destroy() { this.destroyed = true; calls.push('base:' + url) } }
  return { baseTexture, destroy(base) { assert.equal(base, false); calls.push('texture:' + url) } }
}
test('texture URL owners release on last instance only, deduplicate repeated slots and tolerate double disposal', () => {
  const pool = ctx.forkGalTextureOwners(), calls = [], a = texture('a.png', calls), b = texture('b.png', calls)
  const release1 = pool.retain([a, a, b]), release2 = pool.retain([a])
  release1()
  assert.deepEqual(calls, ['texture:b.png', 'base:b.png'])
  release2(); release2()
  assert.deepEqual(calls, ['texture:b.png', 'base:b.png', 'texture:a.png', 'base:a.png'])
})
test('URL owners protect shared textures during late/cancelled loads and free distinct wrappers on the same URL', () => {
  const pool = ctx.forkGalTextureOwners(), calls = [], a = texture('shared', calls), b = texture('shared', calls)
  const release = pool.retain([a])
  pool.begin(); release()
  assert.deepEqual(calls, [])
  const late = pool.retain([b]); pool.end()
  assert.deepEqual(calls, [])
  late()
  assert.deepEqual(calls, ['texture:shared', 'texture:shared', 'base:shared', 'base:shared'])
  const next = pool.retain([texture('failure', calls)])
  pool.begin(); next(); pool.end()
  assert.equal(calls.at(-1), 'base:failure', 'failed load still drains deferred releases')
})

test('backlog window includes visible variable-height rows plus exactly 20 on each side', () => {
  const offsets = [0]
  for (let i = 0; i < 1000; i++) offsets.push(offsets.at(-1) + (i % 2 ? 150 : 50))
  const range = ctx.forkGalBacklogWindow(offsets, offsets[500] + 10, 600, 20)
  assert.equal(range.start, 480)
  assert.equal(range.end, 527)
  const end = ctx.forkGalBacklogWindow(offsets, Infinity, 600, 20)
  assert.equal(end.end, 1000)
  assert.ok(end.start >= 970)
  assert.equal(ctx.forkGalBacklogWindow(offsets, -10, 600, 20).start, 0)
  assert.equal(ctx.forkGalBacklogWindow([0], 0, 600, 20).end, 0)
})

test('subtitle split cache keys text, width, font and size; LRU is bounded and font loads invalidate it', () => {
  const cache = ctx.forkGalSubtitleCache(2)
  let calls = 0
  const get = (text='abc', width=500, font='test', size='20px') => cache.get(text, width, font, size, () => ({ number: ++calls }))
  const first = get()
  assert.equal(get(), first)
  get('def'); get(); get('ghi')
  assert.equal(get(), first, 'recently read split remains cached')
  get('def'); assert.equal(calls, 4, 'oldest split was evicted')
  get('abc', 501); get('abc', 501, 'other'); get('abc', 501, 'other', '21px')
  assert.equal(calls, 7)
  cache.clear(); get('abc', 501, 'other', '21px'); assert.equal(calls, 8)
  assert.match(stage, /function fontLoaded\(\) \{ cache.clear\(\); measure\(\); \}/)
  // private fork: the foreground presentation clock owns the coalesced frame.
  assert.match(stage, /if \(scheduled\) return;\s*scheduled = forkForeground\.requestAnimationFrame/)
  assert.match(stage, /measureNode.current \|\| \(measureNode.current = element.cloneNode\(false\)\)/)
})

test('CONFIG shape-only previews do not register three theme font families', () => {
  assert.match(fonts, /if \(element.classList.contains\("fork-gal-config-theme-art"\)\) return;/)
})


test('frame cap maps 30/60/120/display, preserves idle and low quality, and switches without rebuilding', () => {
  for (const cap of [30, 60, 120]) {
    assert.equal(ctx.forkGalFrameRate('high', true, undefined, cap), cap)
    assert.equal(ctx.forkGalFrameRate('high', true, 144, cap), cap)
    assert.equal(ctx.forkGalFrameRate('high', true, 50, cap), Math.min(cap, 50))
    assert.equal(ctx.forkGalFrameRate('high', false, 144, cap), 30)
    assert.equal(ctx.forkGalFrameRate('low', true, 144, cap), 30)
  }
  for (const refresh of [undefined, NaN, 60, 144, 240]) {
    assert.equal(ctx.forkGalFrameRate('high', true, refresh, 0), 0)
    assert.equal(ctx.forkGalFrameRate('high', false, refresh, 0), 30)
  }
  assert.equal(ctx.forkGalFrameRate('high', true, 144, 90), 60)
  assert.equal(ctx.forkGalFrameRate('high', false, 24, 120), 24)
  const pace = { last: 0, next: 1000, fps: 30, vsync: 0 }
  for (let i = 1; i <= 240; i++) assert.equal(ctx.forkGalFrameDue(pace, i * 1000 / 240, 0), true)
  assert.equal(ctx.forkGalFrameDue(pace, 1001, 120), true)
  assert.equal(ctx.forkGalFrameDue(pace, 1002, 120), false)
  assert.equal(ctx.forkGalFrameDue(pace, 1003, 0), true)
  assert.match(scene, /return forkGalFrameRate\(quality, !idle, refreshRate, forkStageReading.get\(\).frameCap\)/)
})
