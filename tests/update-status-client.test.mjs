import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function rpcFor(fetch) {
  const start = source.includes('\t\tasync function readTavernJsonResponse(') ? source.indexOf('\t\tasync function readTavernJsonResponse(') : source.indexOf('\t\tfunction rpc(method,')
  const end = source.indexOf('\n\t\tfunction rpcWithTimeout', start)
  return new Function('fetch', 'tavernRuntimeGenerationMonitor', source.slice(start, end) + ';return rpc')(fetch, { observe() {} })
}
const ok = () => Response.json({ ok: true, status: { phase: 'update-available' } })
const tick = () => new Promise(resolve => setImmediate(resolve))

function updaterHarness({ call, initial = { phase: 'loading', host: 'cli' }, askConfirm = async () => true, polling = false } = {}) {
  const marker = source.indexOf('async function refreshUpdateStatus()')
  const pollStart = source.lastIndexOf('React.useEffect(function () {', marker)
  const pollEnd = source.indexOf('\n\t\t\tReact.useEffect(', marker)
  const helperStart = source.indexOf('function publishUpdateStatus(')
  const helperEnd = source.indexOf('const updateStartedAtRef', helperStart)
  const actionStart = source.indexOf('async function checkUpdate()')
  const actionEnd = source.indexOf('const h = React.createElement;', actionStart)
  const reports = [], cleared = [], states = [], calls = [], signals = [], timers = new Map()
  let timerId = 0
  const updateStatusRef = { current: initial }, updateActionRef = { current: { pending: false, generation: 0 } }
  let current = initial, poll, cleanup
  const actions = new Function('React', 'window', 'call', 'setUpdateStatus', 'tavernErrorHub', 'updateStartedAtRef', 'isMissingUpdateApiError', 'updateStatusRef', 'updateActionRef', 'askConfirm', 'updateRecoveryRef',
    source.slice(helperStart, helperEnd) + source.slice(actionStart, actionEnd) + source.slice(pollStart, pollEnd) + ';return { checkUpdate, performUpdate, cancelUpdate, isUpdateBusy }')(
    { useEffect(fn) { if (polling) cleanup = fn() } },
    { setInterval(fn) { poll = fn; return 1 }, clearInterval() {}, setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id }, clearTimeout(id) { timers.delete(id) } },
    (method, args, options) => { calls.push(method); signals.push(options?.signal); return call(method, args, undefined, options) },
    state => { current = typeof state === 'function' ? state(current) : state; states.push(current) },
    { report: (label, error) => reports.push({ label, error }), resolve: label => cleared.push(label) },
    { current: 0 }, error => /未知方法: getUpdateStatus/.test(error.message), updateStatusRef, updateActionRef, askConfirm,
    { current: { sawOffline: false, reloading: false } })
  return { ...actions, reports, cleared, states, calls, signals, expire: () => { for (const timer of [...timers.values()]) timer() }, updateActionRef, status: () => current, poll: () => poll(), stop: () => cleanup?.() }
}
function pollHarness(fetch) { return updaterHarness({ call: rpcFor(fetch), polling: true }) }
function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

test('网络中断可恢复，认证和业务错误立即提示', async () => {
  let calls = 0
  const network = pollHarness(async () => { if (++calls === 1) throw new TypeError('Failed to fetch'); return ok() })
  await tick()
  assert.equal(network.reports.length, 0)
  await network.poll()
  assert.equal(network.states.at(-1).phase, 'update-available')
  network.stop()
  for (const response of [() => new Response('', { status: 401 }), () => Response.json({ ok: false, error: '状态文件损坏' })]) {
    const h = pollHarness(async () => response())
    await tick()
    assert.equal(h.reports.length, 1)
    h.stop()
  }
})

for (const phase of ['running', 'cancelling', 'blocked']) {
  test(`${phase} 禁止检查和启动，取消必须由后台声明可用`, async () => {
    const h = updaterHarness({ initial: { phase, cancellable: false }, call: async () => assert.fail('must not call API') })
    await Promise.all([h.checkUpdate(), h.performUpdate(), h.cancelUpdate()])
    assert.deepEqual(h.calls, [])
    assert.equal(h.isUpdateBusy(h.status()), true)
  })
}

for (const [action, initial, busyPhase] of [
  ['performUpdate', { phase: 'update-available' }, 'running'],
  ['cancelUpdate', { phase: 'running', cancellable: true }, 'cancelling'],
]) {
  test(`${action} 响应丢失时保持忙碌，由只读状态轮询恢复`, async () => {
    const h = updaterHarness({ initial, polling: true, call: async method => {
      if (method === 'getUpdateStatus') return { status: { phase: 'repair-required' } }
      throw new TypeError('Failed to fetch')
    } })
    await h[action]()
    assert.equal(h.status().phase, busyPhase)
    assert.match(h.status().error, /尚未确认/)
    await Promise.all([h.checkUpdate(), h.performUpdate(), h.cancelUpdate()])
    assert.equal(h.calls.filter(method => method !== 'getUpdateStatus').length, 1)
    await h.poll()
    assert.equal(h.status().phase, 'repair-required')
    h.stop()
  })
}

for (const [action, initial, busyPhase] of [
  ['performUpdate', { phase: 'update-available' }, 'running'],
  ['cancelUpdate', { phase: 'running', cancellable: true }, 'cancelling'],
]) {
  test(`${action} 请求挂起会解除等待，迟到响应不覆盖新状态`, async () => {
    const mutation = deferred()
    const h = updaterHarness({ initial, polling: true, call: async method => {
      if (method === 'getUpdateStatus') return { status: { phase: 'repair-required' } }
      return mutation.promise
    } })
    const pending = h[action]()
    await tick()
    h.expire()
    await pending
    assert.equal(h.status().phase, busyPhase)
    assert.equal(h.updateActionRef.current.pending, false)
    assert.equal(h.signals.at(-1).aborted, true)
    await h.poll()
    assert.equal(h.status().phase, 'repair-required')
    mutation.resolve({ status: { phase: 'running', cancellable: true } })
    await tick()
    assert.equal(h.status().phase, 'repair-required')
    assert.equal(h.calls.filter(method => method !== 'getUpdateStatus').length, 1)
    h.stop()
  })
}
