// private fork: fake Fish HTTP server only; no cloud access or real credentials.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomInt } from 'node:crypto'
import { createFishAudioAdapter, fishRetryDelay } from '../tavern-plugin/packages/dsh-tts/src/providers/fish-audio.js'
import { providerConfig, presetParams, credentialRef } from '../tavern-plugin/packages/dsh-tts/src/providers/params.js'
import { createServiceSettings } from '../tavern-plugin/packages/dsh-tts/src/settings.js'
import { createTts } from '../tavern-plugin/packages/dsh-tts/src/service.js'
import { pcmWav } from '../tavern-plugin/packages/dsh-tts/src/providers/audio.js'
import { hash, voicePreset } from '../tavern-plugin/packages/dsh-tts/src/core.js'
import { fishMessagePack } from '../tavern-plugin/packages/dsh-tts/src/providers/fish-messagepack.js'
import { validateVoice } from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure-voice.js'

const pcm = Buffer.alloc(8820,1), audio = pcmWav(pcm,44100)
const secret = {key:'fake-private-key'}
// private fork: tags are voice-owned, not inferred from mood IDs.
const spec = {text:'Hello mixed text',language:'ja',mood:'joy',params:{referenceId:'voice-id',emotionTag:'happy'}}
const reference = {sha256:hash(audio),bytes:audio,promptText:'Approved transcript',promptLanguage:'ja'}

// Decode the wire independently of the production encoder, retaining binary vs string types.
function wire(call) {
  if (call.headers['content-type'] === 'application/json') return JSON.parse(call.bytes)
  assert.equal(call.headers['content-type'],'application/msgpack')
  let pos=0; const b=call.bytes
  const u32=()=>{const n=b.readUInt32BE(pos);pos+=4;return n}
  function read() {
    const tag=b[pos++]
    if(tag===0xc2||tag===0xc3)return tag===0xc3
    if(tag===0xce)return u32()
    if(tag===0xd2){const n=b.readInt32BE(pos);pos+=4;return n}
    if(tag===0xcb){const n=b.readDoubleBE(pos);pos+=8;return n}
    const size=u32()
    if(tag===0xc6||tag===0xdb){const v=b.subarray(pos,pos+size);pos+=size;return tag===0xc6?v:v.toString('utf8')}
    if(tag===0xdd)return Array.from({length:size},read)
    assert.equal(tag,0xdf);const out={};for(let i=0;i<size;i++)out[read()]=read();return out
  }
  const result=read();assert.equal(pos,b.length);return result
}
test('Fish MessagePack preserves bin, UTF-8, integer and fractional numeric wire types',()=>{
  assert.equal(fishMessagePack(44100).toString('hex'),'ce0000ac44')
  assert.equal(fishMessagePack(-1).toString('hex'),'d2ffffffff')
  assert.equal(fishMessagePack(Buffer.from([0,255])).toString('hex'),'c60000000200ff')
  assert.equal(fishMessagePack('音').toString('hex'),'db00000003e99fb3')
  const value={references:[{audio:audio,text:'日本語'}],sample_rate:44100,prosody:{speed:1.1,volume:-2},normalize:true}
  assert.deepEqual(wire({headers:{'content-type':'application/msgpack'},bytes:fishMessagePack(value)}),value)
})

async function server(t, handler) {
  const calls = [], errors = []
  const s = createServer(async (req,res) => {
    try {
      const chunks = []; for await (const b of req) chunks.push(b)
      const call = {url:req.url,method:req.method,headers:req.headers,bytes:Buffer.concat(chunks)}; calls.push(call)
      await handler(call,res,calls)
    } catch (e) { errors.push(e); res.writeHead(500);res.end() }
  })
  // This machine's ephemeral range is 1024..15000 and includes Fetch-blocked ports.
  // Bind a high test-only port; retry only EADDRINUSE, never a synthesis request.
  for (let attempt=0; ; attempt++) {
    s.listen(randomInt(16000,65536),'127.0.0.1')
    try { await once(s,'listening'); break }
    catch (error) { if (error.code !== 'EADDRINUSE' || attempt === 9) throw error }
  }
  t.after(async () => { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); assert.deepEqual(errors,[]) })
  return {calls,provider:{id:'fish',kind:'fish-audio',config:providerConfig('fish-audio',{url:'http://127.0.0.1:' + s.address().port})}}
}

test('Fish defaults, portable ID/figure preset and strict cost/parameter validation', () => {
  assert.deepEqual(providerConfig('fish-audio'),{url:'https://api.fish.audio',model:'s2.1-pro-free'})
  for (const model of ['', 'bad model',null]) assert.throws(() => providerConfig('fish-audio',{model}))
  for (const params of [{referenceId:'bad/id'},{referenceId:'x',model:'s2.1-pro'},{referenceId:'x',speed:3},{referenceId:'x',emotionTags:'yes'}]) assert.throws(() => presetParams('fish-audio',params))
  const preset = voicePreset({schemaVersion:1,id:'fish/my-voice',label:'Fish',enabled:true,kind:'fish-audio',languages:['ja','zh','en'],params:spec.params})
  assert.equal(preset.params.referenceId,'voice-id')
  const {schemaVersion,id,enabled,...portable} = preset
  assert.throws(()=>validateVoice({id,language:'ja',preset:portable}))
  assert.equal(providerConfig('fish-audio',{model:'future-model'}).model,'future-model')
})

test('Fish preserves mixed text, explicit free model and PCM decoding, with optional S2 emotion tags', async t => {
  const {calls,provider} = await server(t,(c,r) => {r.end(pcm)})
  const adapter = createFishAudioAdapter()
  for (const language of ['ja','zh','en']) {
    assert.deepEqual(await adapter.synthesize(provider,secret,{...spec,language}),audio)
    const c = calls.at(-1), body = wire(c)
    assert.equal(c.headers.authorization,'Bearer ' + secret.key)
    assert.equal(c.headers.model,'s2.1-pro-free')
    assert.deepEqual(body,{text:'[happy] ' + spec.text,reference_id:'voice-id',format:'pcm',sample_rate:44100,latency:'normal',prosody:{speed:1,volume:0},normalize:true})
  }
  await adapter.synthesize(provider,secret,{...spec,params:{...spec.params,emotionTags:false}})
  assert.equal(wire(calls.at(-1)).text,spec.text)
  await adapter.synthesize({...provider,config:{...provider.config,model:'s2.1-pro'}},secret,spec)
  assert.equal(calls.at(-1).headers.model,'s2.1-pro')
})

test('Fish serializes full response bodies and 429 Retry-After within the same free lane', async t => {
  let active = 0, maximum = 0
  const {calls,provider} = await server(t,async (c,r,all) => {
    maximum = Math.max(maximum,++active)
    if (all.length === 1) {r.writeHead(429,{'Retry-After':'3'});r.end('private')} else {
      r.write(pcm.subarray(0,200)); await new Promise(resolve => setTimeout(resolve,20));r.end(pcm.subarray(200))
    }
    active--
  })
  const waits = [], adapter = createFishAudioAdapter({sleep:async ms => waits.push(ms)})
  await Promise.all([adapter.synthesize(provider,secret,spec),adapter.synthesize(provider,secret,{...spec,text:'second'})])
  assert.equal(maximum,1);assert.equal(calls.length,3);assert.deepEqual(waits,[3000])
  assert.equal(fishRetryDelay(null,1),2000)
  assert.equal(fishRetryDelay('Thu, 01 Jan 1970 00:02:00 GMT',0,60000),60000)
  assert.equal(fishRetryDelay('90',0),90000)
})

for (const [status,code] of [[401,'FISH_AUTH_FAILED'],[402,'FISH_BILLING_REQUIRED'],[429,'FISH_RATE_LIMITED']]) test('Fish sanitized actionable HTTP ' + status, async t => {
  const {calls,provider} = await server(t,(c,r) => {r.writeHead(status);r.end('fake-private-key dialog details')})
  const adapter = createFishAudioAdapter({sleep:async()=>{}})
  await assert.rejects(adapter.synthesize(provider,secret,spec),e => e.code === code && e.message.includes(String(status)) && !e.message.includes(secret.key))
  assert.equal(calls.length,status === 429 ? 3 : 1)
  if (status === 429) {
    await assert.rejects(adapter.synthesize({...provider,config:{...provider.config,model:'s2.1-pro'}},secret,spec),{code})
    assert.equal(calls.length,4)
  }
})

test('Fish sends multiple inline references per request, never creates cloud models', async t => {
  const {provider,calls} = await server(t,(c,r) => {
    assert.equal(c.url,'/v1/tts'); assert.equal(c.method,'POST'); r.end(pcm)
  })
  const clone = {...spec,params:{},reference}, adapter = createFishAudioAdapter()
  await adapter.synthesize(provider,secret,clone)
  await adapter.synthesize(provider,secret,clone)
  assert.equal(calls.length,2)
  assert.deepEqual(wire(calls[0]).references,[{audio,text:reference.promptText}])
  assert.equal(wire(calls[0]).reference_id,undefined)
  const extra = {...reference,promptText:'Mood matched transcript'}
  await adapter.synthesize(provider,secret,{...clone,references:[extra,reference]})
  assert.deepEqual(wire(calls.at(-1)).references.map(r=>r.text),[extra.promptText,reference.promptText])
  const frame=Buffer.alloc(864);frame.writeUInt32BE(0xfffbb800)
  const mp3=Buffer.concat([frame,frame]),compressed={...reference,sha256:hash(mp3),bytes:mp3}
  await adapter.synthesize(provider,secret,{...clone,references:[compressed,reference]})
  assert.deepEqual(wire(calls.at(-1)).references.map(r=>r.audio),[mp3,audio])
  // private fork: inline references may retain a local fallback model without sending it to Fish.
  await adapter.synthesize(provider,secret,{...clone,model:{engine:'gpt-sovits',gpt:{sha256:'a'.repeat(64)}}})
  assert.deepEqual(wire(calls.at(-1)),wire(calls[0]))
  assert.equal(wire(calls.at(-1)).model,undefined)
  assert.equal(wire(calls.at(-1)).gpt,undefined)
  // private fork: Fish never interprets portable model metadata, regardless of its engine tag.
  const inlineBody=wire(calls[0])
  await adapter.synthesize(provider,secret,{...clone,model:{engine:'unknown',requirement:'local-only'}})
  assert.deepEqual(wire(calls.at(-1)),inlineBody)
  await adapter.synthesize(provider,secret,spec)
  const idBody=wire(calls.at(-1))
  await adapter.synthesize(provider,secret,{...spec,model:{engine:'gpt-sovits'}})
  assert.deepEqual(wire(calls.at(-1)),idBody)
  assert.equal(wire(calls.at(-1)).model,undefined)
  const before = calls.length
  // Already-validated reference bytes reach this internal adapter; integrity is checked at pack ingress.
  await assert.rejects(adapter.synthesize(provider,secret,{...clone,references:[]}),{code:'MISSING_REFERENCE'})
  await assert.rejects(adapter.synthesize(provider,secret,{...clone,params:{referenceId:'bypass'}}),{code:'INVALID_PARAMS'})
  assert.equal(calls.length,before)
})

test('Fish cancelled queued work and backoff send no extra request', async t => {
  const {provider,calls} = await server(t,(c,r) => {r.writeHead(429,{'Retry-After':'90'});r.end()})
  const adapter = createFishAudioAdapter(), controller = new AbortController()
  const first = adapter.synthesize(provider,secret,{...spec,signal:controller.signal})
  const second = adapter.synthesize(provider,secret,{...spec,signal:controller.signal})
  const checks = [assert.rejects(first,{code:'ABORTED'}),assert.rejects(second,{code:'ABORTED'})]
  while (!calls.length) await new Promise(resolve => setTimeout(resolve,5))
  controller.abort();await Promise.all(checks);assert.equal(calls.length,1)
})

test('Fish native service uses credential store, figure references, audio cache and export without credentials', async t => {
  const {provider,calls} = await server(t,(c,r) => {
    if (c.url.startsWith('/model?')) { r.end('{}');return }
    r.end(pcm)
  })
  const tts = createTts(), refs = []
  let settings = {enabled:true,providers:[],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const stored = new Map(), credentials = {resolve:async ref => {refs.push(ref);return {value:stored.get(ref)}},describe:async ref => ({configured:stored.has(ref),writable:true}),set:async(ref,value)=>stored.set(ref,value),unset:async ref=>stored.delete(ref)}
  const service = createServiceSettings({tts,get:()=>settings,replace:async v=>{settings=v},credentials:()=>credentials})
  t.after(async()=>{service.dispose();await tts.dispose()})
  const saved = await service.save({...provider,secrets:secret})
  assert.doesNotMatch(JSON.stringify(saved),/fake-private/)
  assert.equal(stored.get(credentialRef('fish','key')),secret.key)
  assert.equal((await tts.listServices()).find(p=>p.id==='fish').capabilities.paid,false)
  assert.equal(calls.length,0)
  await service.test({id:'fish'});assert.equal(calls.length,1);assert.equal(calls[0].method,'GET')
  await service.saveVoicePreset({preset:{schemaVersion:1,id:'fish/preset',label:'Fish',kind:'fish-audio',enabled:true,languages:['ja'],params:spec.params,providerId:'fish'}})
  const grant = tts.grantServiceConsumer({principal:'test',scope:'test'})
  const input = {voiceId:'fish/preset',text:spec.text,language:'ja',mood:'joy'}
  const rendered = await tts.synthesize(input,{grant:grant.grant})
  assert.equal(rendered.cacheHit,false);assert.equal((await tts.synthesize(input,{grant:grant.grant})).cacheHit,true)
  assert.deepEqual(await tts.readAudio({key:rendered.key,grant:grant.grant}),audio)
  const exported = await tts.exportPortableVoice({voiceId:'fish/preset'})
  assert.equal(exported.voice.params.referenceId,'voice-id');assert.equal(exported.voice.providerId,undefined)
  tts.registerVoiceSource({owner:'test',sourceId:'figure',revision:'1',voices:[{schemaVersion:1,id:'clone',label:'Clone',kind:'reference',enabled:true,languages:['ja'],params:{},model:{engine:'gpt-sovits',modelVersion:'v2ProPlus',gpt:{sha256:'a'.repeat(64)}},references:[{sha256:hash(audio),file:'default.wav',transcript:reference.promptText,language:'ja'},{sha256:hash(audio),file:'calm.wav',transcript:reference.promptText,language:'ja'},{sha256:hash(audio),file:'joy.wav',transcript:'Happy sample',language:'ja'}]}],bindings:{clone:'fish'},readReference:async()=>audio})
  const figure = tts.grantConsumer({principal:'test',scope:'figure',source:'figure'})
  await tts.synthesize({voice:{source:'figure',id:'clone'},text:'figure',language:'ja',mood:'sad'},{grant:figure.grant})
  assert.deepEqual(wire(calls.at(-1)).references.map(r=>r.text),[reference.promptText,reference.promptText,'Happy sample'])
  assert.equal(wire(calls.at(-1)).reference_id,undefined)
  assert.equal(wire(calls.at(-1)).text,'figure') // private fork: absent voice emotion tags remain absent
  assert.equal(wire(calls.at(-1)).model,undefined,'local model stays in the figure, not the cloud request')
  await tts.synthesize({voice:{source:'figure',id:'clone'},text:'figure',language:'ja',mood:'joy'},{grant:figure.grant})
  assert.deepEqual(wire(calls.at(-1)).references.map(r=>r.text),[reference.promptText,reference.promptText,'Happy sample'])
  const count = calls.length
  assert.equal((await tts.synthesize({voice:{source:'figure',id:'clone'},text:'figure',language:'ja',mood:'joy'},{grant:figure.grant})).cacheHit,true)
  assert.equal(calls.length,count)
  await tts.synthesize({voice:{source:'figure',id:'clone'},text:'figure',language:'ja',mood:'calm'},{grant:figure.grant})
  assert.equal(wire(calls.at(-1)).references.length,3)
  assert.ok(calls.every(c=>c.method === 'GET' || c.url === '/v1/tts'))
})

test('Fish env key works without a credential store, is visible but never exported, and stored keys win', async t => {
  const prior = process.env.FISH_AUDIO_API_KEY
  process.env.FISH_AUDIO_API_KEY = 'fake-env-key'
  t.after(()=>{if (prior === undefined) delete process.env.FISH_AUDIO_API_KEY; else process.env.FISH_AUDIO_API_KEY = prior})
  const {provider,calls} = await server(t,(c,r)=>r.end('{}'))
  const tts = createTts()
  let settings = {enabled:true,providers:[provider],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  let store
  const service = createServiceSettings({tts,get:()=>settings,replace:async v=>{settings=v},credentials:()=>store})
  t.after(async()=>{service.dispose();await tts.dispose()})
  const listing = await service.list()
  assert.equal(listing[0].secrets.key.configured,true)
  assert.equal(listing[0].secrets.key.source,'env')
  assert.doesNotMatch(JSON.stringify(listing),/fake-env-key/)
  assert.equal((await service.probe({...provider})).status,'connected')
  assert.equal(calls.at(-1).headers.authorization,'Bearer fake-env-key')
  store = {resolve:async()=>({value:secret.key})}
  await service.test({id:provider.id})
  assert.equal(calls.at(-1).headers.authorization,'Bearer ' + secret.key)
  assert.equal((await service.probe({...provider,secrets:{key:'fake-typed'}})).status,'connected')
  assert.equal(calls.at(-1).headers.authorization,'Bearer fake-typed')
  store = undefined; delete process.env.FISH_AUDIO_API_KEY
  assert.equal((await service.probe({...provider})).status,'credentials-required')
})
