// Deterministic mounted-hook and cache load measurements; no DOM, host, or user data.
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
async function source(name, before) {
  const file = 'tavern-plugin/src/client/' + name + '.js'
  return before ? execFileSync('git', ['show', 'HEAD:' + file], { encoding: 'utf8' }) : readFile(file, 'utf8')
}
for (const before of [true, false]) {
  const prefix = before ? 'HEAD' : 'working'
  const timers = new Map(), cleanups = []; let serial = 0, now = 0, ticks = 0
  const ctx = { Date: { now: () => now }, setTimeout(fn, ms) { timers.set(++serial, { fn, due: now + ms }); return serial }, clearTimeout(id) { timers.delete(id) }, setInterval(fn, ms) { timers.set(++serial, { fn, due: now + ms, repeat: ms }); return serial }, clearInterval(id) { timers.delete(id) }, forkGalActive: { get: () => '', subscribe: () => () => {} } }
  const effects = []
  ctx.React = { useState: value => [typeof value === 'function' ? value() : value, () => {}], useReducer: () => [0, () => {}], useRef: value => ({ current: value }), useSyncExternalStore: (_, get) => get(), useEffect: fn => effects.push(fn) }
  vm.createContext(ctx)
  vm.runInContext(await source('fork-voice', before) + ';useForkVoicePrefs=()=>[{}];useForkVoiceGlobal=()=>({enabled:false});useForkVoices=()=>{};this.hook=useForkVoiceBubbles;', ctx)
  for (let i = 0; i < 100; i++) { ctx.hook({ sessionId: 's', voiceScope: String(i) }, [], 'card', {}); for (const fn of effects.splice(0)) cleanups.push(fn()) }
  for (now = 100; now <= 10000; now += 100) for (const [id, timer] of [...timers]) if (timer.due <= now) {
    if (timer.repeat) { timer.due += timer.repeat; ticks++ } else timers.delete(id)
    timer.fn()
  }
  console.log(prefix, '100 idle voice hooks:', { repeatingCallbacksIn10s: ticks, activeTimers: timers.size })
  cleanups.forEach(fn => fn?.())
  const audio = { rpc: () => new Promise(() => {}), forkAudioMeasurement: value => value?.v === 1 }
  const audioSource = (await source('fork-stage-audio', before)).replace('        subscribe(fn)', '        sizes: () => ({catalogue:catalogue.size,queued:queued.size,queue:queue.length}),\n        subscribe(fn)')
  vm.runInNewContext(audioSource + ';this.audio=forkStageAudio', audio)
  audio.audio.register(Array.from({ length: 4000 }, (_, i) => ({ url: '/asset/' + i })))
  console.log(prefix, '4000 audio entries:', audio.audio.sizes())
  const bubble = {}, bubbleSource = await source('fork-bubbles', before)
  vm.runInNewContext(bubbleSource.slice(bubbleSource.indexOf('const forkBubbleStore ='), bubbleSource.indexOf('function useForkBubbles(')).replace('const entries = new Map();', 'const entries = new Map(); globalThis.entries=entries;') + ';this.store=forkBubbleStore', bubble)
  for (let i = 0; i < 1000; i++) bubble.store.set('s' + i, { config: {} })
  console.log(prefix, '1000 sessions retained:', bubble.entries.size)
}
