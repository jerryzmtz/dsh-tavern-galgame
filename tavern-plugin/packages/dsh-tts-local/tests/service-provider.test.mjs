// private fork: local lifecycle uses the public generic connection entry, not an engine adapter.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createTts} from '../../dsh-tts/src/service.js'
import {attachProvider} from '../src/manager.js'

test('lifecycle registers base URL/key through generic TTS and changes only on configuration',async t=>{
  const tts=createTts();t.after(()=>tts.dispose())
  let active=true,changed
  const connection={id:'my-provider',url:'http://localhost:12345',key:'test-only',revision:'one',fetch:async()=>new Response(JSON.stringify({protocol:'dsh-tts-reference-v1',revision:'test',state:'ready',capabilities:{voiceKinds:['reference'],paid:false}}))}
  const off=attachProvider({connection:async()=>active?connection:null,subscribe:fn=>{changed=fn;return()=>{changed=null}}},tts)
  t.after(off)
  await new Promise(setImmediate)
  const [provider]=await tts.listServices()
  assert.equal(provider.id,'my-provider');assert.equal(provider.kind,'reference-api');assert.equal(provider.capabilities.paid,false)
  active=false;changed({type:'configChanged'});await new Promise(setImmediate);assert.deepEqual(await tts.listServices(),[])
})
