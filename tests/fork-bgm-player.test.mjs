// private fork: the BGM player (docs/fork/panel-ui-design.md §七) — auto/manual transitions, session-only
// persistence, list-order prev/next, bound-pack scoping and one owner across stage and chat.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { performanceFixture, performanceRef } from './helpers/performance-director-fixture.mjs'
import { performanceMusicRequest } from '../fork/mods/performance/projection.js'
import { createAssetPackPresentation } from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
const require = createRequire(import.meta.url)
const { createForkBgm, forkBgmStep, forkBgmSearch, FORK_BGM_STORAGE } = require('../tavern-plugin/src/client/fork-bgm-player.cjs')
const { createStageResourceOwner } = require('../tavern-plugin/src/client/fork-stage-resources.cjs')
const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

const track = (id, name = id.toUpperCase()) => ({ key: 'P/' + id, name, identity: 'P:music:' + id + ':h' })
const cue = id => ({ ref: { packId: 'P', kind: 'music', assetId: id }, identity: 'P:music:' + id + ':h', name: id.toUpperCase(), url: 'blob:runner-' + id })
const descriptor = id => ({ resource: true, kind: 'media', ref: { packId: 'P', kind: 'music', assetId: id }, revision: 'r1', hash: 'h', identity: 'P:music:' + id + ':h' })
function storage(initial = {}) { const map = new Map(Object.entries(initial)); return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), map } }
function fakeStore(initial) {
  let state = initial; const selectors = new Set()
  return {
    getSnapshot: () => state,
    set(patch) { state = { ...state, ...patch }; for (const selector of [...selectors]) selector.update(state) },
    select(fn, equal) {
      let value = fn(state); const listeners = new Set()
      const selector = { getSnapshot: () => value, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        update(next) { const fresh = fn(next); if (equal(value, fresh)) return; value = fresh; listeners.forEach(listener => listener()) },
        dispose() { listeners.clear(); selectors.delete(selector) } }
      selectors.add(selector); return selector
    }
  }
}
function fakeMusic() {
  const calls = []; let identity = null, current = '', paused = true, finish = null
  return {
    calls,
    get: () => ({ identity, current, paused }),
    play(url, snap, id, options) { calls.push(['play', id, url, snap, options]); identity = id; current = url; paused = false; return new Promise(resolve => { finish = resolve }) },
    settle() { finish?.(); finish = null },
    pause() { calls.push(['pause']); paused = true },
    resume() { calls.push(['resume']); paused = false },
    stop() { if (current) calls.push(['stop']); identity = null; current = ''; paused = true; finish?.() }
  }
}
function fakeOwner() {
  const pins = []
  const pin = (identity, how) => { const value = { identity, how, released: false, handle: { url: 'blob:' + how + '-' + identity }, release() { value.released = true } }; pins.push(value); return value }
  return { pins, live: () => pins.filter(item => !item.released).map(item => item.identity), retain: identity => pin(identity, 'retain'), acquire: async item => pin(item.identity, 'acquire') }
}
const sessionState = (music, extra = {}) => ({ settings: { config: { stage: { enabled: true, music: true } } }, accepted: { music }, source: { sessionId: 's', authorityEpoch: 1 }, cursor: { mode: 'live', skipping: false }, ...extra })
function harness({ saved = {}, tracks = ['a', 'b', 'c'], stores } = {}) {
  const music = fakeMusic(), owner = fakeOwner(), local = storage(saved), reads = []
  const all = stores || { s: fakeStore(sessionState(cue('a'))) }
  let time = 0
  const bgm = createForkBgm({ music, now: () => ++time, owner: () => owner, storage: local, authority: source => JSON.stringify([source.sessionId, source.authorityEpoch]),
    session: id => all[id] || null, clock: { setTimeout: fn => { fn(); return 1 }, clearTimeout() {} },
    read: async id => { reads.push(id); return { tracks: tracks.map(id => ({ ref: { packId: 'P', kind: 'music', assetId: id }, identity: 'P:music:' + id + ':h', name: id.toUpperCase(), pack: 'Pack', url: descriptor(id) })) } } })
  return { bgm, music, owner, local, reads, stores: all, store: all.s }
}
const plays = music => music.calls.filter(call => call[0] === 'play').map(call => call[1])

const performanceToken = (instanceKey = 'one', phaseKey = 'entry', playbackEpoch = 1) => ({source:'source', instanceKey, phaseKey, playbackEpoch, visitId:1})
function acquire(h, options = {}) {
  const token = options.token || performanceToken(options.instanceKey, options.phaseKey)
  return h.bgm.acquirePerformance({sessionId:'s', authority:JSON.stringify(['s',1]), instanceKey:token.instanceKey, phaseKey:token.phaseKey,
    token, track:cue('b'), lock:true, restore:'previous', restoreTarget:{previous:cue('a').ref,directorRequest:null}, ...options})
}
function direct(h, id, key) { h.store.set({accepted:{music:id ? cue(id) : null, musicRequest:{key,ref:id ? cue(id).ref : null}}}) }

test('performance lock delays explicit director requests, including repeated refs and stop', async () => {
  for (const requests of [[], [['c','1'],['c','2']], [['c','1'],['a','2']], [[null,'stop']]]) {
    const h = harness(); h.bgm.activate('s'); await tick()
    const lock = acquire(h); await tick()
    assert.equal(lock.status,'acquired'); assert.equal(h.bgm.get().follow,true)
    for (const [id,key] of requests) { direct(h,id,key); await tick(); assert.equal(h.bgm.get().current.source,'performance') }
    lock.handle.release({token:performanceToken()}); await tick()
    const expected = requests.length ? requests.at(-1)[0] : 'a'
    assert.equal(h.music.get().identity, expected ? cue(expected).identity : null)
    h.music.settle(); await tick(); assert.equal(h.owner.live().length,expected ? 1 : 0)
    h.bgm.dispose()
  }
})

test('forced director music overrides a performance immediately and survives updates, exit and cold acquisition', async () => {
  for (const stop of [false, true]) {
    const f = await performanceFixture(), p = f.prepare(), tx = f.transaction(p)
    const ref = {packId:performanceRef().packId,kind:'music',assetId:'turn-track'}
    const submit = (sequence, at, ops) => tx.submit({sequence,through:at,done:false,beats:[{at,ops}]})
    assert.equal(submit(1,1,[{op:'mod.dsh.performance.set',ref:performanceRef(),level:3}]).ok,true)
    const op = stop ? {op:'music.clear'} : {op:'music.set',ref}
    const reply = submit(2,2,[{...op,force:true,reason:'Scene changes now'}])
    assert.equal(reply.ok,true)
    assert.equal(reply.diagnostics?.some(item => item.code === 'PERFORMANCE_DEFERRED') || false,false)
    const request = performanceMusicRequest(tx.preview(),2)
    assert.equal(request.force,true)
    const restoreTarget = f.fold(tx.preview(),p,1).restore
    assert.equal(restoreTarget.directorRequest.force,true)
    for (const cold of [false,true]) {
      const h = harness(); h.bgm.activate('s'); await tick()
      const accepted = {music:stop ? null : cue('c'),musicRequest:request}
      if (cold) h.store.set({accepted})
      const lock = acquire(h,cold ? {restoreTarget,snap:true} : {}); await tick()
      if (!cold) h.store.set({accepted})
      await tick()
      const expected = stop ? null : cue('c').identity
      assert.equal(h.music.get().identity,expected,'forced selection is immediate')
      lock.handle.update({token:performanceToken(),track:cue('b')}); await tick()
      assert.equal(h.music.get().identity,expected,'later performance cues cannot retake BGM')
      lock.handle.release({token:performanceToken()}); await tick()
      assert.equal(h.music.get().identity,expected,'exit cannot restore the previous BGM')
      h.bgm.dispose()
    }
  }
})

test('manual override is a stored tombstone, follow on and reload cannot reacquire that instance', async () => {
  for (const action of [h => h.bgm.pick('P/c'), h => h.bgm.step(1), h => h.bgm.follow(false)]) {
    const h = harness(); h.bgm.activate('s'); await tick()
    const lock = acquire(h); await tick(); const notices=[]; h.bgm.subscribePerformance(e => notices.push(e))
    action(h); await tick()
    assert.equal(notices[0].type,'overridden')
    assert.equal(lock.handle.release({token:performanceToken()}),false)
    h.bgm.follow(true); await tick()
    assert.equal(acquire(h).status,'overridden')
    const saved = Object.fromEntries(h.local.map); h.bgm.dispose()
    const reload = harness({saved}); reload.bgm.activate('s'); await tick()
    assert.equal(acquire(reload).status,'overridden')
    assert.equal(acquire(reload,{instanceKey:'two'}).status,'acquired')
    assert.equal(JSON.parse(reload.local.map.get(FORK_BGM_STORAGE)).s,undefined)
    reload.bgm.dispose()
  }
})

test('performance updates preserve pause and previous; stale handles cannot release a replacement', async () => {
  const h=harness(); h.bgm.activate('s'); await tick()
  const first=acquire(h); await tick(); h.bgm.pause(true); await tick()
  const turn=performanceToken('one','turn',2)
  assert.equal(first.handle.update({phaseKey:'turn',token:turn,track:cue('c'),fadeMs:600}),true); await tick()
  assert.equal(h.music.get().current,''); assert.equal(h.bgm.get().paused,true)
  assert.equal(first.handle.update({token:performanceToken(),track:cue('b')}),false)
  h.bgm.pause(false); await tick()
  assert.equal(h.music.get().identity,cue('c').identity)
  assert.equal(h.music.calls.findLast(c => c[0]==='play')[4].fadeMs,600)
  const second=acquire(h,{instanceKey:'two'}); await tick()
  assert.equal(first.handle.release({token:turn}),false)
  assert.equal(second.handle.release({token:performanceToken('two')}),true); await tick()
  assert.equal(h.music.get().identity,cue('a').identity,'replacement inherits original restore target, not outgoing performance')
  h.bgm.dispose(); assert.equal(h.owner.live().length,0)
})

test('history uses semantic restore rather than another page, unlocked cue yields on same-ref request', async () => {
  const h=harness(); h.bgm.activate('s'); await tick(); direct(h,'c','before'); await tick()
  let lock=acquire(h,{snap:true}); await tick()
  assert.equal(h.music.calls.findLast(c => c[0]==='play')[3],true)
  lock.handle.release({token:performanceToken(),snap:true}); await tick()
  assert.equal(h.music.get().identity,cue('a').identity)
  lock=acquire(h,{instanceKey:'two',lock:false}); await tick()
  direct(h,'c','new-same-ref'); await tick()
  assert.equal(h.music.get().identity,cue('c').identity)
  assert.equal(acquire(h,{instanceKey:'two',lock:false}).status,'acquired'); await tick()
  assert.equal(h.music.get().identity,cue('c').identity,'same instance cannot reclaim an unlocked director handoff')
  assert.equal(lock.handle.release({token:performanceToken('two')}),true)
  h.bgm.dispose()
})

test('follow false retains the performance track outside the catalogue without persisting its URL', async () => {
  const h=harness(); h.bgm.activate('s'); await tick(); acquire(h,{track:cue('outside')}); await tick()
  h.bgm.follow(false); await tick()
  assert.equal(h.music.get().identity,cue('outside').identity)
  assert.equal(h.bgm.get().current.key,'P/outside')
  assert.ok(!h.local.map.get(FORK_BGM_STORAGE).includes('blob:'))
  h.bgm.dispose()
})

test('authority changes invalidate performance handles; missing restore refs silence without fallback', async () => {
  const h=harness(); h.bgm.activate('s'); await tick()
  const old=acquire(h); await tick()
  h.store.set({source:{sessionId:'s',authorityEpoch:2},accepted:{music:null,musicRequest:null}}); await tick()
  assert.equal(old.handle.update({token:performanceToken(),track:cue('b')}),false)
  assert.equal(old.handle.release({token:performanceToken()}),false)
  assert.equal(acquire(h).status,'stale'); assert.equal(h.music.get().current,'')
  h.bgm.dispose(); assert.equal(h.owner.live().length,0)
  const missing=harness(); missing.bgm.activate('s'); await tick()
  const lock=acquire(missing,{snap:true,restoreTarget:{previous:cue('missing').ref,directorRequest:null}}); await tick()
  lock.handle.release({token:performanceToken()}); await tick()
  assert.equal(missing.music.get().current,''); assert.equal(missing.bgm.get().error,true)
  missing.bgm.dispose()
})

test('canonical array identities survive transport copies and stored override reloads', async () => {
  const h=harness();h.bgm.activate('s');await tick()
  const instanceKey=['source','branch',1,0,0],phaseKey=[instanceKey,'source',0,0]
  const first=acquire(h,{token:performanceToken(instanceKey,phaseKey)});await tick()
  const copied=acquire(h,{token:structuredClone(performanceToken(instanceKey,phaseKey))});await tick()
  assert.equal(copied.handle,first.handle)
  h.bgm.pick('P/c');h.bgm.follow(true);await tick()
  const saved=Object.fromEntries(h.local.map);h.bgm.dispose()
  const reloaded=harness({saved});reloaded.bgm.activate('s');await tick()
  assert.equal(acquire(reloaded,{token:structuredClone(performanceToken(instanceKey,phaseKey))}).status,'overridden')
  reloaded.bgm.dispose()
})

test('list order: prev / next wrap and enter from outside the list; search keeps order', () => {
  const tracks = ['a', 'b', 'c'].map(id => track(id))
  assert.equal(forkBgmStep(tracks, 'P/a', 1).key, 'P/b')
  assert.equal(forkBgmStep(tracks, 'P/c', 1).key, 'P/a', 'next wraps')
  assert.equal(forkBgmStep(tracks, 'P/a', -1).key, 'P/c', 'prev wraps')
  assert.equal(forkBgmStep(tracks, 'G/x', 1).key, 'P/a', 'a cue outside the list: next enters at the top')
  assert.equal(forkBgmStep(tracks, 'G/x', -1).key, 'P/c')
  assert.equal(forkBgmStep([], 'P/a', 1), null)
  assert.deepEqual(forkBgmSearch([track('a', 'Rain Walk'), track('b', '夜'), track('c', 'rainy day')], 'RAIN').map(item => item.key), ['P/a', 'P/c'])
})

test('auto follows the director; a pick turns 导演选曲 off and later cues are recorded, not played; on jumps to the cue', async () => {
  const { bgm, music, owner, store } = harness()
  bgm.activate('s'); await tick()
  assert.deepEqual(plays(music), ['P:music:a:h'])
  assert.equal(music.get().current, 'blob:retain-P:music:a:h', 'the player plays its own pin of the runner-loaded cue')
  assert.deepEqual({ ...bgm.get().current }, { key: 'P/a', name: 'A', source: 'director' })
  store.set({ accepted: { music: cue('b') } }); await tick()
  assert.deepEqual(plays(music), ['P:music:a:h', 'P:music:b:h'])
  assert.deepEqual(owner.live(), ['P:music:a:h', 'P:music:b:h'], 'the outgoing track stays pinned through the crossfade')
  music.settle(); await tick()
  assert.deepEqual(owner.live(), ['P:music:b:h'])

  bgm.pick('P/c'); await tick()
  assert.equal(bgm.get().follow, false, 'a manual pick turns 导演选曲 off')
  assert.deepEqual({ ...bgm.get().current }, { key: 'P/c', name: 'C', source: 'manual' })
  assert.equal(plays(music).at(-1), 'P:music:c:h'); assert.equal(owner.pins.at(-1).how, 'acquire')
  store.set({ accepted: { music: cue('a') } }); await tick()
  assert.equal(plays(music).at(-1), 'P:music:c:h', 'the next directed cue does not override the pick')
  assert.equal(bgm.get().cue.key, 'P/a', 'but it is recorded')
  bgm.follow(true); await tick()
  assert.equal(plays(music).at(-1), 'P:music:a:h', 'back on: jump to the director\'s current cue')
  assert.equal(bgm.get().follow, true)
  const count = plays(music).length
  bgm.follow(false); await tick()
  assert.equal(plays(music).length, count, 'turning it off keeps what sounds (no restart)')
  assert.equal(bgm.get().current.key, 'P/a'); assert.equal(bgm.get().current.source, 'manual')
})

test('prev / next follow list order from what plays, pause keeps the track and resumes it', async () => {
  const { bgm, music } = harness()
  bgm.activate('s'); await tick()
  bgm.step(1); await tick()
  assert.equal(plays(music).at(-1), 'P:music:b:h', 'next from the cue a')
  bgm.step(1); await tick(); bgm.step(1); await tick()
  assert.equal(plays(music).at(-1), 'P:music:a:h', 'c → a wraps')
  bgm.step(-1); await tick()
  assert.equal(plays(music).at(-1), 'P:music:c:h')
  const count = plays(music).length
  bgm.pause(true); await tick()
  assert.deepEqual(music.calls.at(-1), ['pause']); assert.equal(bgm.get().paused, true)
  bgm.pause(false); await tick()
  assert.deepEqual(music.calls.at(-1), ['resume']); assert.equal(plays(music).length, count, 'resume does not restart')
})

test('card music off: nothing plays and the player shows disabled; on again plays the cue', async () => {
  const { bgm, music, store } = harness()
  bgm.activate('s'); await tick()
  store.set({ settings: { config: { stage: { enabled: true, music: false } } } }); await tick()
  assert.equal(bgm.get().enabled, false); assert.equal(bgm.get().current, null)
  assert.deepEqual(music.calls.at(-1), ['stop'])
  store.set({ settings: { config: { stage: { enabled: true, music: true } } } }); await tick()
  assert.equal(plays(music).at(-1), 'P:music:a:h')
})

test('session persistence: the mode and the pick survive a reload of that session; another session starts in auto', async () => {
  const first = harness({ stores: { s: fakeStore(sessionState(cue('a'))), t: fakeStore(sessionState(cue('b'))) } })
  first.bgm.activate('s'); await tick()
  first.bgm.pick('P/c'); await tick()
  const saved = JSON.parse(first.local.map.get(FORK_BGM_STORAGE))
  assert.deepEqual(Object.keys(saved), ['s']); assert.equal(saved.s.follow, false); assert.equal(saved.s.manual.key, 'P/c')
  first.bgm.activate('t'); await tick()
  assert.equal(first.bgm.get().follow, true, 'a new session starts in auto')
  assert.equal(plays(first.music).at(-1), 'P:music:b:h')
  first.bgm.activate('s'); await tick()
  assert.equal(first.bgm.get().follow, false); assert.equal(plays(first.music).at(-1), 'P:music:c:h', 'switching back restores the pick')

  // A page reload: a fresh controller over the same storage.
  const reload = harness({ saved: Object.fromEntries(first.local.map) })
  reload.bgm.activate('s'); await tick()
  assert.equal(reload.bgm.get().follow, false)
  assert.deepEqual(plays(reload.music), ['P:music:c:h'], 'the pick plays, not the cue')
  reload.bgm.follow(true); await tick()
  assert.equal(reload.local.map.get(FORK_BGM_STORAGE), '{}', 'auto is the default and is not stored')

  // A pick that left the card's packs hands back to the director on the next list.
  const gone = harness({ saved: Object.fromEntries(first.local.map), tracks: ['a', 'b'] })
  gone.bgm.activate('s'); await tick()
  assert.equal(gone.bgm.get().follow, true); assert.deepEqual(plays(gone.music), ['P:music:a:h'])
})

test('session storage keeps only the most recent sessions', async () => {
  const stores = Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['s' + i, fakeStore(sessionState(cue('a')))]))
  const { bgm, local } = harness({ stores })
  for (let i = 0; i < 40; i++) { bgm.activate('s' + i); await tick(); bgm.pause(true) }
  const saved = JSON.parse(local.map.get(FORK_BGM_STORAGE))
  assert.ok(Object.keys(saved).length <= 32)
  assert.ok(saved.s39, 'the newest session is kept')
})

test('one owner across stage and chat: the stage consumer never touches music; opening / closing does not replay', async () => {
  const { bgm, music, store } = harness()
  bgm.activate('s'); await tick()
  const count = music.calls.length
  store.set({ opened: true }); store.set({ opened: false }); store.set({ cursor: { mode: 'live', skipping: false } }); await tick()
  assert.equal(music.calls.length, count, 'stage open / close is not a music input')

  const ui = await read('fork-stage-ui.js'), touched = []
  let cleanup = null
  const ctx = vm.createContext({
    React: { useLayoutEffect: fn => { cleanup = fn() }, useRef: value => ({ current: value }), useCallback: fn => fn, useMemo: fn => fn(), useEffect() {} },
    createStageRuntimeState: () => ({}), Map, Promise, JSON, Audio: class {},
    forkCreateSoundscapePlayer: () => ({ apply() {}, whenSettled: () => Promise.resolve(), stop() {}, dispose() {}, resume() {}, snapshot() {} }),
    forkStageAudio: {}, forkStageMusic: new Proxy({}, { get: (_, name) => () => touched.push(name) }),
    forkStageSfx: { stop() {}, stopToken() {}, play() {} }, forkVoicePlayer: { stop() {} },
    window: { addEventListener() {}, removeEventListener() {} }
  })
  vm.runInContext(ui + ';this.api={useForkStageConsumers,forkStageConsumers};', ctx)
  const events = [], stage = { getSnapshot: () => store.getSnapshot(), dispatch: event => events.push(event.type) }
  ctx.api.useForkStageConsumers('s', stage, () => {})
  await ctx.api.forkStageConsumers.get('s').present({ type: 'present', accepted: { music: cue('b'), presentationRevision: 2 }, groups: ['music'], transition: 'normal' })
  ctx.api.forkStageConsumers.get('s').present({ type: 'revoke-presentation' })
  cleanup()
  assert.deepEqual(events, ['STAGE_OPEN', 'STAGE_OPEN'])
  assert.deepEqual(touched, [], 'only the BGM player drives forkStageMusic')
})

test('resource owner: the player co-owns a runner-loaded track until it lets go', async () => {
  const owner = createStageResourceOwner({ service: { leaseMedia: async () => ({ revision: 'r1', url: '/m', ticket: 't' }), releaseLease() {} },
    fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/ogg' } }),
    urls: { createObjectURL: () => 'blob:m', revokeObjectURL: url => revoked.push(url) } })
  const revoked = [], authority = JSON.stringify(['s', 1])
  assert.equal(owner.retain('P:music:a:h', authority), null, 'nothing loaded yet')
  const runner = await owner.acquire(descriptor('a'), authority)
  const mine = owner.retain('P:music:a:h', authority)
  assert.equal(mine.handle.url, 'blob:m')
  runner.release(); owner.revoke({ packId: 'other' }, authority)
  assert.equal(owner.snapshot().pins, 1)
  mine.release(); assert.equal(owner.snapshot().pins, 0)
})

test('track list: enabled music of the card\'s bound packs only, in binding then pack order', async () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', G = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const asset = (id, kind = 'music', enabled = true) => ({ kind, id, name: id, enabled, media: 'hash-' + id })
  const packs = {
    [A]: { revision: 'ra', manifest: { id: A, name: '甲', assets: [asset('a1'), asset('s1', 'sfx'), asset('a2', 'music', false), asset('a3')] } },
    [B]: { revision: 'rb', manifest: { id: B, name: '乙', assets: [asset('b1')] } },
    [G]: { revision: 'rg', manifest: { id: G, name: '全局', assets: [asset('g1')] } }
  }
  const service = { apiVersion: 2, subscribe: () => () => {}, getPackSnapshot: async ({ packId }) => packs[packId] || null,
    resolveAssets: async ({ refs }) => refs.map(ref => { const value = packs[ref.packId].manifest.assets.find(item => item.id === ref.assetId); return { ref, revision: packs[ref.packId].revision, value, diagnostics: [] } }) }
  // private fork: music permissions come from the card's package set, without cast tables.
  const raw = { extensions: { dsh_tavern: { schemaVersion: 1, assetBindings: { boundPackIds: [B, A] } } } }
  const presentation = createAssetPackPresentation({ raw, getService: () => service, origin: 'http://localhost', scope: 'test' })
  const tracks = await presentation.musicTracks()
  assert.deepEqual(tracks.map(item => [item.pack, item.ref.assetId]), [['乙', 'b1'], ['甲', 'a1'], ['甲', 'a3']], 'no disabled, non-music or globally enabled tracks')
  assert.deepEqual(tracks[1].url, { resource: true, kind: 'media', ref: { packId: A, kind: 'music', assetId: 'a1' }, revision: 'ra', hash: 'hash-a1', identity: `${A}:music:a1:hash-a1` })
  assert.equal(tracks[1].identity, tracks[1].url.identity, 'the list identity matches director cue identities')
  presentation.dispose()
})

test('wiring: the stage HUD chip, the chat header slot, the RPC and the shared theme tokens', async () => {
  const [stage, controls, binding, css, index] = await Promise.all([read('fork-gal-stage.js'), read('features/play-controls.js'), read('fork-stage-session-binding.js'),
    readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8'), readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')])
  assert.match(stage, /h\(ForkBgmStage, \{ sessionId, place, live: runtime\.cursor\.mode !== 'history' && !skipping \}\)/)
  assert.match(controls, /id: "dsh-fork-bgm-player", order: 82/)
  assert.match(binding, /forkBgm\.activate\(ctx\.sessions\.list\.getSnapshot\(\)\.current \|\| null\)/)
  assert.match(index, /case 'getStageMusicTracks'/)
  // One component on --bgm-* tokens; the stage maps them from its theme, chat from the host theme.
  assert.match(css, /\.fork-gal-stage \.fork-bgm-panel \{\n  --bgm-surface: var\(--gal-ui-surface-2\);/)
  // private fork: legibility — the chat popover is opaque even on a glass skin (host bg tokens at ~20% alpha), and the
  // play glyph is black/white by the accent's lightness so it keeps >= 4.5:1 on the accent fill (and on its hover).
  // private fork: the chat placement now takes every paint from the validated surface table (popover level).
  assert.match(css, /\.fork-bgm\.is-chat \{\n  --bgm-surface: var\(--fk-s-popover-bgSolid\);/)
  assert.match(css, /--bgm-on-accent: var\(--fk-s-popover-onAccent\); --bgm-play-hover: var\(--fk-s-popover-accentHover\);/)
  assert.match(css, /--bgm-on-accent: var\(--gal-ui-accent-ink\);/)
  assert.match(css, /\.fork-bgm \.fork-bgm-play \{[^}]*color: var\(--bgm-on-accent\); \}/)
  assert.match(css, /\.fork-bgm \.fork-bgm-play:hover:not\(:disabled\) \{ background: var\(--bgm-play-hover\); \}/)
  // The entrance never fades: a stalled first frame must not leave the panel translucent.
  assert.match(css, /\.fork-bgm-panel \{[^}]*animation: fork-bgm-in \.16s ease-out; \}/)
  assert.match(css, /@keyframes fork-bgm-in \{ from \{ transform: translateY\(-4px\); \} \}/)
  const rules = css.slice(css.indexOf('/* ---------- BGM player'), css.indexOf('/* Stage chip:'))
  assert.ok(!/--gal-ui-|--fork-/.test(rules.slice(rules.indexOf('.fork-bgm-panel.is-chat'))), 'component rules read only --bgm-*')
})
