// private fork: backend-independent reference protocol; base URL + key, no installation identity.
import {fail,hash} from '../core.js'
export function createReferenceProvider({id,url,key,revision,paid=true,lifecycle,modelRequirements=[],fetch=globalThis.fetch}) {
  const endpoint=new URL(url)
  if (!['http:','https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('INVALID_INPUT')
  const base=endpoint.href.replace(/\/+$/,''), capabilities={voiceKinds:['reference'],referenceInput:['bytes-v1'],portableExport:true,catalogue:true,paid,
    ...(lifecycle ? {warmupTimeoutMs:lifecycle.readinessTimeoutMs,localEngine:'gpt-sovits',modelRequirements,referenceLimits:{count:1,bytes:8*1024**2,decodedDurationMs:180000,formats:['wav','mp3']}} : {})}
  async function request(route,body,signal,binary=false) {
    const secret=typeof key==='function'?await key():key
    if (!secret) fail('CREDENTIALS_REQUIRED')
    const response=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(body?120000:5000)])})
    if (!response.ok) fail('SERVICE_OFFLINE', response.status)
    return binary?Buffer.from(await response.arrayBuffer()):response.json()
  }
  const provider={id,kind:'reference-api',endpoint:base,revision:revision || hash({protocol:'reference-v1',url:base}),capabilities,
    onRequest:lifecycle?.onRequest,
    async health({signal}={}) {
      if (lifecycle && !lifecycle.ready()) return {state:'configured',sleeping:true}
      capabilities.paid=paid
      const info=await request('/v1/info',undefined,signal)
      if (typeof info.revision!=='string' || !info.revision || info.protocol!=='dsh-tts-reference-v1' || !Array.isArray(info.capabilities?.voiceKinds) || !info.capabilities.voiceKinds.includes('reference') || typeof info.capabilities.paid!=='boolean') fail('API_INCOMPATIBLE')
      capabilities.paid=info.capabilities.paid
      if (!lifecycle) provider.revision=hash({protocol:'reference-v1',url:base,revision:info.revision})
      return info
    },
    async catalog({signal}={}) {if (lifecycle && !lifecycle.ready()) return [];await provider.health({signal});const result=await request('/v1/voices',undefined,signal);if(!Array.isArray(result.voices))fail('INVALID_CATALOG');return result.voices},
    exportVoice(input,{signal}={}) {if (lifecycle && !lifecycle.ready()) fail('SERVICE_OFFLINE');return request('/v1/export',input,signal)},
    async synthesize(input,{signal}={}) {
      if (!input.reference) fail('REFERENCE_UNSUPPORTED')
      const release=lifecycle?.begin()
      try {
        await lifecycle?.start({signal})
        const {sha256,bytes,promptText,promptLanguage}=input.reference
        return await request('/v1/synthesize',{text:input.text,language:input.language,voice:{kind:'reference',model:input.model,params:input.params,reference:{sha256,base64:Buffer.from(bytes).toString('base64'),promptText,promptLanguage}}},signal,true)
      } finally { release?.() }
    },
  }
  return provider
}
