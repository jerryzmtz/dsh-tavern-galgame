// private fork: G12-G13. All HTTP is mocked; no keys or paid provider calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createOpenAICompatibleAdapter } from '../src/providers/openai-compatible.js'
import { createQwenAdapter } from '../src/providers/qwen.js'
import { createVolcengineAdapter } from '../src/providers/volcengine.js'
import { providerConfig, presetParams } from '../src/providers/params.js'
import { createServiceSettings, validateSettings } from '../src/settings.js'
import { createTts } from '../src/service.js'
import { voicePreset } from '../src/core.js'
import { pcmWav } from '../src/providers/audio.js'

const config = providerConfig('openai-compatible',{url:'https://speech.invalid',modelsPath:'/v1/models',voicesPath:'/v1/voices'})
const preset = {schemaVersion:1,id:'custom/voice',label:'Voice',enabled:true,kind:'openai-compatible',providerId:'custom',languages:['en'],params:{voice:'alloy',model:'tts-1',speed:1.1,instructions:'Calm'}}

test('custom endpoints reject URL credentials, queries, cross-origin paths and unsupported parameters',() => {
  for (const url of ['file:///tmp','https://user:password@speech.invalid','https://speech.invalid?token=x','https://speech.invalid/#x']) assert.throws(() => providerConfig('openai-compatible',{url}))
  for (const path of ['https://elsewhere.invalid/models','//elsewhere.invalid/models','/models?key=x','/../models','/x\\models','']) assert.throws(() => providerConfig('openai-compatible',{url:'https://speech.invalid',speechPath:path}))
  assert.equal(config.speechPath,'/v1/audio/speech')
  assert.equal(voicePreset(preset).params.speed,1.1)
  assert.throws(() => presetParams('openai-compatible',{voice:'alloy',model:'tts-1',key:'not-allowed'}))
  assert.throws(() => presetParams('openai-compatible',{voice:'alloy',model:'tts-1',speed:9}))
})

test('custom discovery parses common envelopes and uses only GET; synthesis requests WAV',async () => {
  const calls = [], key = randomUUID(), audio = pcmWav(Buffer.alloc(100,1))
  const adapter = createOpenAICompatibleAdapter({fetch:async (url, options) => {
    calls.push({url,options})
    if (url.endsWith('/models')) return Response.json({data:[{id:'tts-1'}]})
    if (url.endsWith('/voices')) return Response.json({voices:[{voice_id:'alloy',name:'Alloy',languages:['en']}]})
    return new Response(audio)
  }})
  const list = await adapter.voices({config},{key})
  assert.deepEqual(list.models,[{id:'tts-1',label:'tts-1'}]); assert.equal(list.voices[0].id,'alloy')
  assert.equal(calls.every(c => !c.options.method || c.options.method === 'GET'),true)
  assert.equal(calls.every(c => c.options.redirect === 'error' && c.options.headers.Authorization === 'Bearer ' + key),true)
  assert.equal(JSON.stringify(list).includes(key),false)
  assert.deepEqual(await adapter.synthesize({config},{key},{text:'Hello',params:preset.params}),audio)
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),{...preset.params,input:'Hello',response_format:'wav'})
  assert.equal(calls.at(-1).url,'https://speech.invalid/v1/audio/speech')
})

test('optional discovery makes no requests; network, HTTP and malformed JSON errors never expose content',async () => {
  const manual = {config:providerConfig('openai-compatible',{url:'https://speech.invalid'})}
  const adapter = createOpenAICompatibleAdapter({fetch:async () => {throw Error('must not call')}})
  assert.deepEqual(await adapter.voices(manual,{}),{models:[],voices:[],source:'manual'})
  const privateValue = randomUUID()
  for (const fetch of [async () => {throw Error(privateValue)},async () => new Response(privateValue,{status:401}),async () => new Response(privateValue),async () => Response.json(null),async () => Response.json({data:[null]})]) {
    await assert.rejects(createOpenAICompatibleAdapter({fetch}).voices({config},{}),e => !e.message.includes(privateValue))
  }
})

test('custom service stores credentials only in existing credential store and roundtrips presets through synthesis',async t => {
  let settings = {enabled:true,providers:[],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const tts = createTts(), store = new Map(), calls = [], key = randomUUID(), audio = pcmWav(Buffer.alloc(100,1))
  const credentials = {resolve:async ref => ({value:store.get(ref)}),describe:async ref => ({configured:store.has(ref),writable:true}),set:async (ref,value) => store.set(ref,value),unset:async ref => store.delete(ref)}
  const services = createServiceSettings({tts,get:() => settings,replace:async next => {settings=next},credentials:() => credentials,fetch:async (url,options) => {
    calls.push(options.method || 'GET')
    return options.method === 'POST' ? new Response(audio) : Response.json({data:[{id:url.endsWith('/models') ? 'tts-1' : 'alloy'}]})
  }})
  t.after(async () => {services.dispose();await tts.dispose()})
  await services.save({id:'custom',kind:'openai-compatible',config,secrets:{key}})
  assert.equal(JSON.stringify(settings).includes(key),false); assert.equal(JSON.stringify(await services.list()).includes(key),false)
  assert.equal((await services.probe({id:'custom',kind:'openai-compatible',config})).status,'connected')
  assert.equal((await services.voices({id:'custom'})).models[0].id,'tts-1')
  assert.equal(calls.includes('POST'),false)
  await services.saveVoicePreset({preset,expectedRevision:null});validateSettings(settings)
  assert.equal((await tts.listServiceVoices()).find(v => v.id === preset.id).state,'ready')
  const {grant} = tts.grantServiceConsumer({principal:'test',scope:'test'})
  const result = await tts.synthesize({voiceId:preset.id,text:'Hello',language:'en'},{grant,scope:'test'})
  assert.deepEqual(await tts.readAudio({key:result.key,grant}),audio)
  assert.equal(calls.filter(c => c === 'POST').length,1)
  assert.equal((await tts.exportVoicePresets([preset.id]))[0].kind,'openai-compatible')
})

test('keyless custom services and GPT-SoVITS reference presets remain usable without fake voice catalogues',async t => {
  const tts = createTts(); let settings = {providers:[],voices:[]}
  // private fork (voice settings r3): without list routes the explicit test asks the free GET /v1/models first.
  const calls = []
  const services = createServiceSettings({tts,get:() => settings,replace:async next => {settings=next},credentials:() => undefined,fetch:async (url,options) => {calls.push([options.method || 'GET',new URL(url).pathname]);return Response.json({data:[]})}})
  t.after(async () => {services.dispose();await tts.dispose()})
  const manual = providerConfig('openai-compatible',{url:'http://127.0.0.1:9881'})
  await services.save({id:'custom',kind:'openai-compatible',config:manual})
  assert.equal(calls.length,0,'saving never tests')
  assert.equal((await services.probe({id:'custom',kind:'openai-compatible',config:manual})).status,'connected')
  assert.deepEqual(await services.test({id:'custom'}),{ok:true,status:'connected',voiceCount:0,reachable:true,synthesisTested:false,credentialScope:'catalog'})
  assert.deepEqual(calls,[['GET','/v1/models'],['GET','/v1/models']])
  assert.equal((await tts.health({serviceId:'custom'}))[0].state,'configured')
  assert.equal(voicePreset({...preset,kind:'gpt-sovits-api',params:{refAudioPath:'reference.wav',promptText:'Hello',promptLang:'en'}}).params.speedFactor,1)
})

// private fork (voice settings r3): 测试连接 must really check paid endpoints, with mocked HTTP only.
test('OpenAI-compatible test: free model list first, else one tiny synthesis; provider errors in plain words',async () => {
  const provider = {config:providerConfig('openai-compatible',{url:'https://speech.invalid'})}
  const run = async (models, speech) => { const calls = []; const adapter = createOpenAICompatibleAdapter({fetch:async (url,options) => { calls.push({path:new URL(url).pathname,method:options.method || 'GET',body:options.body,auth:options.headers.Authorization}); return new Response(null,{status:url.endsWith('/v1/models') ? models : speech}) }})
    try { return {result:await adapter.verify(provider,{key:'k'}),calls} } catch (error) { return {error:error.message,calls} } }
  let r = await run(200,500); assert.deepEqual(r.result,{status:'connected'}); assert.equal(r.calls.length,1); assert.equal(r.calls[0].auth,'Bearer k')
  r = await run(401,200); assert.match(r.error,/密钥无效（HTTP 401）/); assert.equal(r.calls.length,1)
  r = await run(404,200); assert.deepEqual(r.result,{status:'connected',synthesisTested:true}); assert.deepEqual(r.calls.map(c => c.method + ' ' + c.path),['GET /v1/models','POST /v1/audio/speech'])
  assert.equal(JSON.parse(r.calls[1].body).input,'嗯','one character only')
  r = await run(404,403); assert.match(r.error,/密钥无效/)
  r = await run(404,404); assert.match(r.error,/找不到合成接口/)
  r = await run(404,422); assert.equal(r.result.status,'reachable')
  const offline = createOpenAICompatibleAdapter({fetch:async () => { throw Error('secret-detail') }})
  await assert.rejects(offline.verify(provider,{key:'k'}),e => /连不上服务/.test(e.message) && !e.message.includes('secret'))
})

test('Volcengine test synthesizes one character; a speaker refusal still proves the key, bad grants are reported',async () => {
  const provider = {config:providerConfig('volcengine',{appId:'app'})}, calls = []
  const respond = body => createVolcengineAdapter({fetch:async (url,options) => { calls.push({url,options}); return body() }})
  const ok = respond(() => new Response(JSON.stringify({code:0,data:Buffer.alloc(8).toString('base64')}) + '\n' + JSON.stringify({code:20000000})))
  assert.deepEqual(await ok.verify(provider,{accessKey:'ak'}),{status:'connected',synthesisTested:true})
  assert.equal(calls[0].options.method,'POST'); assert.equal(JSON.parse(calls[0].options.body).req_params.text,'嗯')
  assert.equal(calls[0].options.headers['X-Api-Access-Key'],'ak')
  const speaker = respond(() => Response.json({code:45000000,message:'speaker permission denied'},{status:403}))
  assert.equal((await speaker.verify(provider,{accessKey:'ak'})).status,'connected')
  const grant = respond(() => Response.json({code:45000010,message:'grant not found'},{status:401}))
  await assert.rejects(grant.verify(provider,{accessKey:'bad'}),/凭据无效/)
  const quota = respond(() => new Response(JSON.stringify({code:55000000,message:'quota exceeded'})))
  await assert.rejects(quota.verify(provider,{accessKey:'ak'}),/额度已用完/)
})

test('Qwen discovery only offers Bella-compatible transport models, not instruct or Qwen-Audio',async () => {
  for (const region of ['cn','intl']) {
    const ids = ['qwen3-tts-flash','qwen3-tts-flash-2025-11-27','qwen3-tts-instruct-flash','qwen3-tts-instruct-flash-2026-01-26','qwen-audio-3.1-tts-flash','qwen-audio-3.1-tts-next','qwen-audio-3.0-tts-flash','qwen3-chat','qwen3-tts-flash-realtime']
    const urls = [], adapter = createQwenAdapter({fetch:async url => {urls.push(url);return Response.json({data:ids.map(id => ({id}))})}})
    const result = await adapter.voices({config:{region}},{key:randomUUID()})
    assert.equal(new URL(urls[0]).hostname,region === 'cn' ? 'dashscope.aliyuncs.com' : 'dashscope-intl.aliyuncs.com')
    assert.deepEqual(result.models.map(m => [m.id,m.instruct]),[['qwen3-tts-flash',false],['qwen3-tts-flash-2025-11-27',false]])
    assert.equal(result.modelSource,'live'); assert.ok(result.voices.some(v => v.id === 'Bella'))
  }
})

test('Qwen empty or unsupported-only discovery falls back without offering the unavailable instruct model',async () => {
  for (const ids of [[],['qwen3-tts-instruct-flash','qwen-audio-3.1-tts-flash','qwen-audio-3.1-tts-next']]) {
    const adapter = createQwenAdapter({fetch:async () => Response.json({data:ids.map(id => ({id}))})})
    const result = await adapter.voices({config:{region:'cn'}},{key:'fake'})
    assert.deepEqual(result.models,[{id:'qwen3-tts-flash',label:'Qwen3-TTS Flash',instruct:false}])
    assert.equal(result.modelSource,'builtin')
  }
})
