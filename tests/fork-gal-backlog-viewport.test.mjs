// private fork: duplicate layout/resize/scroll reads must preserve viewport state identity.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/fork-gal-backlog.js', import.meta.url), 'utf8')
const start = source.indexOf('    function readViewport()')
const handler = source.slice(start, source.indexOf('    React.useLayoutEffect', start))

test('backlog viewport changes only for new measurements, including queued and zero-height reads', () => {
  let state = { top: Infinity, height: 800 }
  const queue = [], box = { scrollTop: 0, clientHeight: 0 }
  const scope = { scroller: { current: box }, setViewport: update => queue.push(update) }
  vm.runInNewContext(handler, scope)
  const flush = () => { for (const update of queue.splice(0)) state = typeof update === 'function' ? update(state) : update }
  scope.readViewport(); flush()
  assert.equal(state.top, 0); assert.equal(state.height, 0)
  const zero = state
  for (let i = 0; i < 100; i++) scope.readViewport()
  flush(); assert.equal(state, zero)
  box.scrollTop = 125; box.clientHeight = 400
  scope.readViewport(); scope.readViewport()
  box.scrollTop = 250
  flush()
  assert.equal(state.top, 125, 'captures the measurement, not a later DOM value')
  assert.equal(state.height, 400)
  assert.notEqual(state, zero)
  scope.readViewport(); flush()
  assert.equal(state.top, 250)
  const scrolled = state
  scope.readViewport(); flush(); assert.equal(state, scrolled)
  scope.scroller.current = null
  scope.readViewport(); assert.equal(queue.length, 0)
})
