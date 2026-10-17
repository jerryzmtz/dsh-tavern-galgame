// private fork: the actual local adapter sends bytes/model/parameters, never a service voice fallback.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createReferenceProvider} from '../tavern-plugin/packages/dsh-tts/src/providers/reference-api.js'
import {createTts} from '../tavern-plugin/packages/dsh-tts/src/service.js'
import {createServiceSettings,Settings} from '../tavern-plugin/packages/dsh-tts/src/settings.js'
import {referenceVoice} from './fixtures/asset-packs/voice.mjs'
import {syntheticPack,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

test('portable provider forwards the exact selected reference and never calls legacy synthesis',async t=>{
  const pack=await syntheticPack(),voice=referenceVoice(pack),calls=[],tts=createTts()
  // private fork: selection precedes the single-reference adapter, never first-item truncation.
  voice.references=voice.references.slice(-1)
  const reference=pack.files.get('media/'+voice.references[0].sha256+'.wav')
  const provider=createReferenceProvider({id:'reference',url:'http://127.0.0.1:1234',key:'fixture-only',fetch:async(url,options)=>{
    if(url.endsWith('/v1/info'))return new Response(JSON.stringify({protocol:'dsh-tts-reference-v1',revision:'test',capabilities:{voiceKinds:['reference'],paid:false}}))
    calls.push({url,body:JSON.parse(options.body)});return new Response(reference,{headers:{'Content-Type':'audio/wav'}})
  }})
  t.after(()=>tts.dispose());tts.registerProvider('fixture',provider)
  voice.params={speed_factor:1.25,seed:42}
  tts.registerVoiceSource({owner:'fixture',sourceId:'figure',revision:'r1',voices:[voice],bindings:{voice:provider.id},readReference:()=>reference})
  const grant=tts.grantConsumer({principal:'browser',source:'figure',scope:'preview'})
  const result=await tts.synthesize({voice:{source:'figure',id:'voice'},text:'saved figure',language:'ja'},{grant:grant.grant,scope:'preview'})
  assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:1234/v1/synthesize')
  assert.deepEqual(calls[0].body.voice.model,voice.model);assert.deepEqual(calls[0].body.voice.params,voice.params)
  assert.equal(calls[0].body.voice.reference.base64,reference.toString('base64'))
  assert.equal(calls[0].body.voice.reference.promptText,voice.references[0].transcript)
  assert.equal(calls[0].body.voice.kind,'reference');assert.equal('voiceId' in calls[0].body,false)
  assert.deepEqual(await tts.readAudio({key:result.key,grant:grant.grant}),reference)
})

test('ordinary configured reference provider exports a closed voice without the lifecycle plugin',async t=>{
  const pack=await syntheticPack(),voice=referenceVoice(pack),tts=createTts(),secrets=new Map(),requests=[]
  const media=Object.fromEntries(Object.values(voice.references).map(ref=>[ref.sha256,pack.files.get('media/'+ref.sha256+'.wav').toString('base64')]))
  let config=Settings({})
  const settings=createServiceSettings({tts,get:()=>config,replace:async next=>{config=next},credentials:()=>({resolve:async key=>({value:secrets.get(key)}),describe:async()=>({writable:true}),set:async(key,value)=>secrets.set(key,value),unset:async key=>secrets.delete(key)}),fetch:async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer fixture-key');requests.push(url)
    const result=url.endsWith('/v1/info')?{protocol:'dsh-tts-reference-v1',revision:'one',state:'ready',capabilities:{voiceKinds:['reference'],paid:false}}:url.endsWith('/v1/voices')?{voices:[{id:'author/voice',kind:'reference',label:'Portable',languages:['ja'],state:'ready',revision:'one'}]}:{voice,media}
    return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}})
  }})
  t.after(async()=>{settings.dispose();await tts.dispose()})
  await settings.save({id:'any-endpoint',kind:'reference-api',label:'Reference server',config:{url:'https://reference.invalid'},secrets:{key:'fixture-key'}})
  assert.equal(JSON.stringify(config).includes('fixture-key'),false)
  const exported=await tts.exportPortableVoice({voiceId:'author/voice',serviceId:'any-endpoint'})
  assert.equal(exported.voice.kind,'reference');assert.deepEqual(exported.voice.model,voice.model)
  assert.ok(Object.values(exported.media).every(b=>b instanceof Uint8Array))
  assert.equal((await tts.listServices())[0].capabilities.paid,false)
  assert.ok(requests.every(url=>!url.endsWith('/v1/synthesize')))
})
