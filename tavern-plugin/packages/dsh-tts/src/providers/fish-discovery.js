import { fail, TtsError } from '../core.js'
import { providerConfig } from './params.js'

const strings = (value, max = 80) => Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0,32).map(v => v.slice(0,max)) : []
export const usableFishVoice = v => v?.type === 'tts' && v.state === 'trained' && !v.dmca_taken_down && !v.takedown_category && v.pvc_release_state !== 'retiring'
export function fishVoiceMetadata(v) {
  if (!usableFishVoice(v) || typeof v._id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(v._id) || typeof v.title !== 'string') fail('VOICE_NOT_FOUND')
  return {voiceId:v._id,name:v.title.slice(0,200),languages:strings(v.languages),gender:null,toneTags:strings(v.tags),visibility:['public','unlist','private'].includes(v.visibility) ? v.visibility : 'unknown',licensed:typeof v.licensed === 'boolean' ? v.licensed : null,
    licenseNote:v.licensed === true ? 'Fish reports rights secured from the voice owner; check current service terms before use.' : 'Public visibility is not a license grant; check author permission before use.'}
}
export function createFishDiscovery({fetch = globalThis.fetch} = {}) {
  async function get(provider, secret, route) {
    if (!secret?.key) fail('CREDENTIALS_REQUIRED')
    const config = providerConfig('fish-audio',provider.config), signal = AbortSignal.timeout(10000)
    try {
      const response = await fetch(config.url + route,{method:'GET',headers:{Authorization:'Bearer ' + secret.key},redirect:'error',signal})
      if (!response.ok) { await response.body?.cancel(); fail(({401:'FISH_AUTH_FAILED',403:'FISH_AUTH_FAILED',404:'VOICE_NOT_FOUND',429:'FISH_RATE_LIMITED'})[response.status] || 'FISH_REQUEST_FAILED') }
      const chunks = []; let size = 0
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 ** 2) fail('FISH_REQUEST_FAILED'); chunks.push(chunk) }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (error) { if (error instanceof TtsError) throw error; fail(signal.aborted ? 'TIMEOUT' : 'FISH_REQUEST_FAILED') }
  }
  return {
    async validate(provider, secret, {voiceId}) {
      if (typeof voiceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(voiceId)) fail('INVALID_INPUT')
      const result = fishVoiceMetadata(await get(provider,secret,'/model/' + encodeURIComponent(voiceId)))
      if (result.voiceId !== voiceId) fail('FISH_REQUEST_FAILED')
      return result
    },
    async search(provider, secret, {query = '',language,page = 1} = {}) {
      if (typeof query !== 'string' || query.length > 200 || /\0/.test(query) || !Number.isSafeInteger(page) || page < 1 || page > 10000 || (language !== undefined && (typeof language !== 'string' || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language)))) fail('INVALID_INPUT')
      const params = new URLSearchParams({self:'false',page_size:'20',page_number:String(page),title:query})
      if (language) params.set('language',language)
      const data = await get(provider,secret,'/model?' + params)
      if (!Array.isArray(data.items) || data.items.length > 100 || !Number.isSafeInteger(data.total) || data.total < 0) fail('FISH_REQUEST_FAILED')
      const voices = data.items.filter(v => usableFishVoice(v) && v.visibility === 'public').map(fishVoiceMetadata)
      return {voices,page,pageSize:20,total:data.total,hasMore:typeof data.has_more === 'boolean' ? data.has_more : page * 20 < data.total,windowLimited:data.window_limited === true}
    },
  }
}
