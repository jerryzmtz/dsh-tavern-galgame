// private fork: whole-turn cloud warming stays bounded and backs off provider quotas.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createTts} from '../src/service.js'
import {pcmWav} from '../src/providers/audio.js'
import {boundedFetch} from '../src/providers/fetch.js'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
for(const kind of ['qwen','gpt-sovits-api']) test(kind+' endpoint concurrency is bounded',async t=>{
  const tts=createTts();t.after(()=>tts.dispose())
  const finish=[],starts=[]
  tts.registerProvider('test',{id:'p',kind,revision:'1',endpoint:'shared',capabilities:{},catalog:async()=>[],synthesize:async input=>{
    starts.push(input.text);await new Promise(resolve=>finish.push(resolve));return pcmWav(Buffer.alloc(100))
  }})
  const voice={schemaVersion:1,id:'v',label:'voice',enabled:true,kind,languages:['en'],params:kind==='qwen'?{voice:'Bella'}:{refAudioPath:'ref.wav',promptText:'hello',promptLang:'en'}}
  tts.registerVoiceSource({owner:'test',sourceId:'card',revision:'1',voices:[voice],bindings:{v:'p'}})
  const grant=tts.grantConsumer({source:'card',principal:'user',scope:'card'}).grant
  const jobs=['a','b','c','d'].map(text=>tts.synthesize({voice:{source:'card',id:'v'},text,language:'en'},{grant,scope:'card'}))
  await tick();assert.equal(starts.length,kind==='qwen'?2:1)
  while(starts.length<4){finish.shift()();await tick()}
  for(const done of finish)done();await Promise.all(jobs)
})
test('429 backoff honors Retry-After and caps attempts without logging credentials',async()=>{
  let calls=0;const waits=[]
  const fetch=boundedFetch(async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'3'}})},async ms=>waits.push(ms))
  assert.equal((await fetch('https://example.test',{})).status,429)
  assert.equal(calls,3);assert.deepEqual(waits,[3000,3000])
})
test('quota retry succeeds, abort stops retries, and authentication failures never retry',async()=>{
  let calls=0
  const fetch=boundedFetch(async()=>new Response('ok',{status:++calls===1?429:200}),async()=>{})
  assert.equal(await(await fetch('https://example.test',{})).text(),'ok');assert.equal(calls,2)
  const abort=new AbortController();calls=0
  const cancelled=boundedFetch(async()=>{calls++;return new Response('',{status:429})},async()=>abort.abort())
  await assert.rejects(cancelled('https://example.test',{signal:abort.signal}),{name:'AbortError'});assert.equal(calls,1)
  calls=0;const auth=boundedFetch(async()=>{calls++;return new Response('',{status:401})},()=>assert.fail('auth retried'))
  assert.equal((await auth('https://example.test',{})).status,401);assert.equal(calls,1)
})
