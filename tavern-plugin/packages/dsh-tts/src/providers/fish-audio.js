// private fork: inline references belong to each request, never to persistent cloud models.
import { setTimeout as delay } from 'node:timers/promises'
import { hash, fail, TtsError, wav } from '../core.js'
import { pcmWav } from './audio.js'
import { presetParams, providerConfig } from './params.js'
import { fishMessagePack } from './fish-messagepack.js'
import recommended from '../shared/fish-recommended.json' with {type:'json'}

export const FISH_MOODS = Object.freeze({}) // private fork: styles belong to voice declarations.
export {FISH_MODELS} from './fish-models.js'
import {FISH_MODELS, fishModel} from './fish-models.js'
export function fishRetryDelay(value, attempt, now = Date.now()) {
  const seconds = value === null ? NaN : Number(value)
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  return Math.max(1000 * 2 ** attempt, requested || 0)
}
function failure(status) {
  const code = {401:'FISH_AUTH_FAILED',402:'FISH_BILLING_REQUIRED',429:'FISH_RATE_LIMITED'}[status] || 'FISH_REQUEST_FAILED'
  const error = new TtsError(code, status)
  error.message = {401:'Fish Audio API key is invalid (401).',402:'Fish Audio quota or balance is insufficient (402); the model was not changed.',429:'Fish Audio is busy or rate limited (429); please retry later.'}[status] || `Fish Audio request failed (${status}).`
  throw error
}
export function createFishAudioAdapter({fetch = globalThis.fetch, sleep = (ms, signal) => delay(ms, undefined, {signal})} = {}) {
  const lanes = new Map()
  async function request(p, key, route, init, signal) {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      const response = await fetch(p.config.url + route, {...init, headers:{Authorization:'Bearer ' + key,...init.headers},redirect:'error',signal})
      if (response.status === 429 && fishModel(p.config.model).billing === 'free' && attempt < 2) {
        const wait = fishRetryDelay(response.headers.get('retry-after'), attempt)
        await response.body?.cancel()
        // Do not shorten Retry-After: the operation deadline aborts long waits instead.
        await sleep(wait, signal); continue
      }
      if (!response.ok) { await response.body?.cancel(); failure(response.status) }
      const chunks = []; let size = 0
      for await (const chunk of response.body) {
        size += chunk.length; if (size > 32 * 1024 ** 2) fail('INVALID_AUDIO')
        chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    }
  }
  function inlineReferences(references) {
    if (!references.length) fail('MISSING_REFERENCE')
    return references.map(reference => ({audio:reference.bytes,text:reference.promptText}))
  }
  return {
    async catalog() { return {items:[]} },
    // private fork (voice settings r3): the curated picks are the starting list; the picker searches Fish's own
    // (free) model listing by name and keeps manual ID entry.
    async voices() { return {voices:recommended.map(v => ({id:v.voiceId,label:v.name,languages:v.languages || [],...(v.gender ? {gender:v.gender} : {}),description:(v.toneTags || []).slice(0,3).join(' · ')})),models:structuredClone(FISH_MODELS),source:'builtin',search:true} },
    // Explicit connection test only; never synthesize or create a voice during discovery.
    async probe(provider, secret) {
      const p = {...provider,config:providerConfig('fish-audio',provider.config)}
      if (!secret.key) fail('CREDENTIALS_REQUIRED')
      try { await request(p,secret.key,'/model?page_size=1',{method:'GET'},AbortSignal.timeout(10000)) }
      catch (error) { if (error instanceof TtsError) throw error; fail('SERVICE_OFFLINE') }
    },
    synthesize(provider, secret, spec) {
      const p = {...provider,config:providerConfig('fish-audio',provider.config)}
      if (!secret.key) fail('CREDENTIALS_REQUIRED')
      const signal = AbortSignal.any([AbortSignal.timeout(120000),...(spec.signal ? [spec.signal] : [])])
      // One lane per endpoint, shared by presets and inline references, including body reads/backoff.
      const previous = lanes.get(p.config.url) || Promise.resolve()
      const work = previous.catch(() => {}).then(async () => {
        signal.throwIfAborted()
        const references = spec.references || (spec.reference ? [spec.reference] : undefined)
        // private fork: portable local model metadata is unrelated to Fish in either voice mode.
        // Only p.config.model selects the Fish model; spec.model is never sent upstream.
        const params = presetParams('fish-audio',spec.params, references ? {referenceId:'inline'} : {})
        if (references && spec.params?.referenceId !== undefined) fail('INVALID_PARAMS')
        const voice = references ? {references:inlineReferences(references)} : {reference_id:params.referenceId}
        const mood = params.emotionTags ? params.emotionTag : undefined
        // Fish auto-detects language; preserve the full mixed-language text, without filtering.
        const body = {text:(mood ? '[' + mood + '] ' : '') + spec.text,...voice,format:'pcm',sample_rate:44100,latency:params.latency,prosody:{speed:params.speed,volume:params.volume},normalize:params.normalize}
        const pcm = await request(p,secret.key,'/v1/tts',{method:'POST',headers:{'Content-Type':references ? 'application/msgpack' : 'application/json',model:p.config.model},body:references ? fishMessagePack(body) : JSON.stringify(body)},signal)
        return wav(pcmWav(pcm,44100))
      }).catch(error => { if (error instanceof TtsError) throw error; fail(signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED' : 'SERVICE_OFFLINE') })
      lanes.set(p.config.url,work)
      void work.finally(() => { if (lanes.get(p.config.url) === work) lanes.delete(p.config.url) }).catch(() => {})
      return work
    },
  }
}
