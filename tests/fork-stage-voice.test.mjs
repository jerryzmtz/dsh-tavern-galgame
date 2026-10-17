// private fork: migrate prefetch/handoff intent to native TTS; the host job queue is gone.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import {voiceFixture, tick} from './fixtures/native-voice-player.mjs'
import bubbleLine from '../tavern-plugin/src/client/fork-bubble-line.cjs'
import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork: canonical line ordinals.
const {forkBubbleCharacter}=bubbleLine // private fork: include the production name resolver in isolated VM seams.
const source = await readFile(new URL('../tavern-plugin/src/client/fork-voice.js',import.meta.url),'utf8')
const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js',import.meta.url),'utf8')
const paragraphs = stage.slice(stage.indexOf('// Plain reading text'),stage.indexOf('// Each page carries'))
const ctx = {}
vm.runInNewContext(source.slice(source.indexOf('function forkStageVoiceWindow'),source.indexOf('function useForkVoiceBubbles')),ctx)
const plain = value => JSON.parse(JSON.stringify(value))
const voice = n => ({owner:n<5?'part-a':'part-b',id:String(n)})

test('stage window: current + seven voiced lines, reading order across parts, no backlog or incomplete lines', () => {
  const pages=[{voice:voice(-1)},{kind:'narration'},...Array.from({length:14},(_,n)=>({voice:voice(n)}))]
  pages.splice(5,0,{voice:voice('partial'),pending:true})
  const window=(at,paused=false)=>plain(ctx.forkStageVoiceWindow(pages,at,paused)).map(v=>v.id)
  assert.deepEqual(window(2),['0','1','2','3','4','5','6','7'])
  assert.deepEqual(window(1),['0','1','2','3','4','5','6'])
  assert.deepEqual(window(7),['4','5','6','7','8','9','10','11'])
  assert.deepEqual(window(16),['13']);assert.deepEqual(window(2,true),[])
})
test('ready native clips are prepared once; cached page turns call play synchronously without descriptor/synthesis/audio requests',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose())
  await Promise.all([f.prefetch('a'),f.prefetch('a')])
  assert.equal(f.synths.length,1);assert.equal(f.reads.length,1);assert.equal(f.audios.length,1)
  assert.equal(f.audios[0].preload,'auto');assert.equal(f.audios[0].loadedAt,0)
  f.advance(500)
  let descriptors=0
  const playing=f.player.play(()=>{descriptors++;return f.descriptor},f.input('a'))
  assert.equal(f.player.get().audio,f.audios[0]);assert.equal(f.audios[0].playedAt,500)
  assert.equal(descriptors,0);assert.equal(f.synths.length,1)
  await playing;f.audios[0].onended();assert.equal(f.player.get(),null)
  await f.play('a');assert.equal(f.reads.length,1)
})
test('native handoff starts new audio immediately and fades old audio monotonically to silence at 120 ms',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose())
  await f.prefetch('a');await f.prefetch('b');await f.play('a')
  const old=f.player.get().audio,playing=f.play('b',{handoff:true})
  assert.equal(f.player.get().audio.paused,false);assert.equal(old.paused,false);assert.equal(old.onended,null)
  f.advance(60);assert.equal(old.volume,0.5)
  f.advance(50);assert.ok(old.volume>0&&old.volume<0.1)
  f.advance(10);assert.equal(old.paused,true);assert.equal(f.player.get().audio.paused,false)
  await playing
})
test('fast native turns keep one fading tail; stop clears tails and aborts late audio',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose())
  for(const id of ['a','b','c'])await f.prefetch(id)
  await f.play('a');await f.play('b',{handoff:true});f.advance(30);await f.play('c',{handoff:true})
  assert.equal(f.audios.filter(a=>!a.paused).length,2)
  f.player.stop();assert.equal(f.audios.filter(a=>!a.paused).length,0);assert.equal(f.timers.size,0)
  let finish;f.client.audio=()=>new Promise(resolve=>{finish=resolve})
  const pending=f.play('late');await tick();f.player.stop();finish({size:1000});await pending
  assert.equal(f.player.get(),null);assert.equal(f.audios.length,3)
})
test('prepared native LRU revokes URLs without evicting active playback',async t=>{
  const f=voiceFixture({maxClips:32});t.after(()=>f.player.dispose());await f.play('active')
  for(let i=0;i<40;i++)await f.prefetch(String(i))
  assert.equal(f.player.get().audio.src.startsWith('blob:'),true)
  const count=f.synths.length;await f.play('active');assert.equal(f.synths.length,count)
  await f.play('39');assert.equal(f.synths.length,count)
  assert.equal(f.revoked.length,9)
  await f.play('0');assert.equal(f.synths.length,count+1)
})
// private fork: session caching replaces the old 32-clip page window.
test('200 turns of ten voiced lines revisit without descriptor, synthesis, audio reads or Audio recreation',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose())
  for(let i=0;i<2000;i++)await f.prefetch(String(i))
  const audios=f.audios.slice(), counts=[f.synths.length,f.reads.length,f.audios.length]
  for(const i of [0,10,20,30,20,10,0,1999]) {
    await f.player.play(()=>{assert.fail('cached voice requested a descriptor')},f.input(String(i)))
    assert.equal(f.player.get().audio,audios[i])
  }
  assert.deepEqual([f.synths.length,f.reads.length,f.audios.length],counts)
  assert.equal(f.revoked.length,0)
})
test('native prefetch cancellation aborts removed window work, preserves the current request, and invalidation drops cached authority',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose());const pending=[]
  f.client.audio=(ticket,{signal})=>new Promise(resolve=>pending.push({ticket,signal,resolve}))
  const a=f.prefetch('a'),b=f.prefetch('b');await tick()
  const playing=f.play('a');f.player.cancelPrefetch([])
  assert.equal(pending[0].signal.aborted,false);assert.equal(pending[1].signal.aborted,true)
  pending.forEach(p=>p.resolve({size:1000}));assert.equal(await a,true);assert.equal(await b,false);await playing
  f.player.invalidate();assert.equal(f.player.get(),null);assert.equal(f.revoked.length,1)
  assert.equal(f.audios[0].src,'')
})
// private fork: deleted host lease-priority and poll-cadence tests. Native synthesis promises
// replace queue polling; bounded stage demand and chat restoration are checked on the hook.
// private fork: exercise the actual native bubble hook, not the retired lease queue.
test('mounted native bubble hook bounds stage prefetch, plays cached clicks, restores chat auto and stops on invalidation',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose())
  const slots=[],effects=[],listeners=new Set();let cursor=0,dirty=false,active='session',handles,invalidate
  const React={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(value!==slots[i]){slots[i]=value;dirty=true}}]},
    useReducer(reduce,initial){const [value,set]=this.useState(initial);return[value,()=>set(reduce)]},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()}})},
    useSyncExternalStore(subscribe,get){this.useEffect(()=>subscribe(()=>{dirty=true}),[subscribe]);return get()}}
  let descriptors=0
  const env={React,forkBubbleCharacter,forkVoicePlayer:f.player,forkTtsScope:{get:()=>f.client},useForkPackRevision(){},
    forkGalActive:{get:()=>active,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}},
    forkPackTransport:{service:{subscribe(fn){invalidate=fn;return()=>{}}}},tavernSessionSignals:{subscribe:()=>()=>{}},
    forkBubbleMood:value=>({id:value||'calm'}),forkBubbleMoodList:()=>[],rpc:async()=>{descriptors++;return f.descriptor}}
  vm.runInNewContext(stagePageSource+'\n'+paragraphs+'\n'+source.slice(source.indexOf('function forkPackSpeechInput'),source.indexOf('function ForkVoiceButton')),env)
  const segments=Array.from({length:20},(_,n)=>({kind:'bubble',alias:'actor',text:String(n),mood:'calm'}))
  const config={characters:[{alias:'actor',voice:'work/actor'}],stage:{textLanguage:'en'}}
  function flush(){for(let i=0;i<30;i++){cursor=0;dirty=false;handles=env.useForkVoiceBubbles({sessionId:'session',voiceScope:'node:0',stageSource:{nodeId:'node',nativeTurn:7},stageParaBase:3,voiceAuto:true},segments,'card',config);for(const effect of effects.splice(0))effect();if(!dirty)return}assert.fail('hook loop')}
  flush();assert.equal(descriptors,0,'stage suppresses automatic chat synthesis')
  // private fork: chat and stage use the same session/native-turn/flat-paragraph identity.
  assert.equal(handles[1].selectionKey,JSON.stringify(['session',7,4]))
  const window=ctx.forkStageVoiceWindow(Object.values(handles).map(voice=>({voice})),0,false)
  await Promise.all(window.map(handle=>handle.prefetch()));flush()
  assert.equal(descriptors,8);assert.equal(f.reads.length,8)
  const playing=handles[1].click({handoff:true});assert.equal(f.player.get().audio.paused,false)
  assert.equal(descriptors,8);await playing
  active='';listeners.forEach(fn=>fn());flush();await tick();flush()
  assert.equal(descriptors,20,'chat auto prefetch resumes without duplicating cached lines')
  // private fork: refresh is not revoke; only confirmed service loss stops audio.
  invalidate({type:'changed'});assert.ok(f.player.get()?.audio)
  invalidate({type:'unavailable'});assert.equal(f.player.get(),null);assert.ok(f.audios.every(audio=>audio.src===''))
  for(const slot of slots)slot?.cleanup?.()
})
// private fork: accepted speech cache identity follows speaker and language changes, not transport URLs.
test('session voice handle identity changes with voice binding or language, but not unrelated settings',async()=>{
  const ui=await readFile(new URL('../tavern-plugin/src/client/fork-stage-ui.js',import.meta.url),'utf8')
  const env={forkBubbleCharacter,forkTtsScope:{get:()=>({available:()=>true})},forkPackSpeechInput:segment=>({text:segment.text,mood:'calm'})}
  vm.runInNewContext(ui.slice(ui.indexOf('function forkStageVoiceHandle'),ui.indexOf('function forkStageVoiceWindowFromIndex')),env)
  const config={characters:[{alias:'actor',voice:'voice/a',voiceKey:'scope-a',voiceLanguage:'en'}],stage:{textLanguage:'en'}},descriptor={alias:'actor',text:'Hello',lineIdentity:[7,4]}
  // private fork: production paragraph IDs are canonical JSON, not arbitrary fixture labels.
  const paragraphId=JSON.stringify(['branch','node',0,1])
  const id=patch=>env.forkStageVoiceHandle('session',descriptor,{...config,...patch},paragraphId).id
  assert.equal(env.forkStageVoiceHandle('session',descriptor,config,paragraphId).selectionKey,JSON.stringify(['session',7,4]))
  assert.equal(env.forkStageVoiceHandle('session',descriptor,config,JSON.stringify(['other',7,'display',4])).selectionKey,JSON.stringify(['session',7,4]),'history hydration and branch identity do not select another reference')
  assert.equal(id({}),id({stage:{textLanguage:'en',music:false}}))
  assert.notEqual(id({}),id({characters:[{alias:'actor',voice:'voice/a',voiceKey:'scope-b',voiceLanguage:'en'}]}))
  assert.notEqual(id({}),id({characters:[{alias:'actor',voice:'voice/a',voiceKey:'scope-a',voiceLanguage:'ja'}]}))
})

test('legacy speaker names share stage prefetch failures with canonical figure bubble handles', async t => {
  const f=voiceFixture();t.after(()=>f.player.dispose())
  f.client.synthesize=async()=>{throw Object.assign(new Error('missing model'),{code:'QWEN_MODEL_NOT_FOUND'})}
  const ui=await readFile(new URL('../tavern-plugin/src/client/fork-stage-ui.js',import.meta.url),'utf8')
  const env={forkBubbleCharacter,forkVoicePlayer:f.player,forkTtsScope:{get:()=>f.client},useForkPackRevision(){},
    React:{useEffect(){},useSyncExternalStore:(_subscribe,get)=>get()},forkGalActive:{get:()=>null,subscribe(){}},
    forkBubbleMood:value=>({id:value||'calm'}),forkBubbleMoodList:()=>[],rpc:async()=>f.descriptor}
  vm.runInNewContext(stagePageSource+'\n'+paragraphs+'\n'+source.slice(source.indexOf('function forkPackSpeechInput'),source.indexOf('function ForkVoiceButton'))+'\n'+ui.slice(ui.indexOf('function forkStageVoiceHandle'),ui.indexOf('function forkStageVoiceWindowFromIndex')),env)
  const config={characters:[{alias:'f_canonical',name:'Actor',aliases:['old_actor'],ref:{packId:'pack',figureId:'figure'},voice:'preset',voiceKey:'stable',voiceLanguage:'en'}],stage:{textLanguage:'en'}}
  const segment={kind:'bubble',alias:'old_actor',name:'Actor',text:'Hello',mood:'calm'}
  const bubble=env.useForkVoiceBubbles({sessionId:'session',voiceScope:'node:0',stageSource:{nativeTurn:7}},[segment],'card',config)[0]
  const stageHandle=env.forkStageVoiceHandle('session',{...segment,lineIdentity:[7,0]},config,'paragraph')
  assert.equal(stageHandle.cacheKey,bubble.cacheKey)
  assert.equal(await stageHandle.prefetch(),false)
  assert.equal(bubble.error,'QWEN_MODEL_NOT_FOUND')
  assert.equal(f.player.get(),null,'prefetch warning does not need an active playback lease')
})

// private fork: use the real speech gate and consumer, not a descriptor-only stub.
test('stage voice event reaches native play through the mounted consumer',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose())
  const ui=await readFile(new URL('../tavern-plugin/src/client/fork-stage-ui.js',import.meta.url),'utf8')
  let cleanup
  const config={characters:[{alias:'actor',voice:'work/actor'}],stage:{textLanguage:'en'}}
  const env={forkBubbleCharacter,React:{useRef:current=>({current}),useCallback:fn=>fn,useLayoutEffect:fn=>{cleanup=fn()}},
    window:{addEventListener(){},removeEventListener(){}},Audio:class {},createStageRuntimeState:()=>({}),
    forkTtsScope:{get:()=>f.client},forkVoicePlayer:f.player,
    forkBubbleMood:value=>({id:value||'calm'}),forkBubbleMoodList:()=>[],rpc:async()=>f.descriptor,
    forkStageAudio:{},forkStageMusic:{play(){},stop(){}},forkStageSfx:{stop(){}},
    forkCreateSoundscapePlayer:()=>({apply(){},whenSettled(){},dispose(){}})}
  const phone=await readFile(new URL('../tavern-plugin/src/client/fork-phone-beat.cjs',import.meta.url),'utf8')
  vm.runInNewContext(phone+'\n'+source.slice(source.indexOf('function forkPackSpeechInput'),source.indexOf('function forkStageVoiceWindow'))+'\n'+ui+'\nglobalThis.consumers=forkStageConsumers;',env)
  let director
  const store={getSnapshot:()=>({settings:{config},accepted:{},director}),dispatch(){},
    select:()=>({subscribe:()=>()=>{},dispose(){}})}
  env.useForkStageConsumers('session',store,()=>assert.fail('voice became a generic event'))
  t.after(()=>cleanup())
  const event={kind:'voice',alias:'actor',text:'Hello',mood:'calm',lineIdentity:[7,4]}
  await env.consumers.get('session').play(event,{anchor:{paragraphId:JSON.stringify(['branch','node',0,1])}})
  assert.equal(f.synths.length,1)
  assert.equal(f.synths[0].input.text,'Hello')
  assert.equal(f.synths[0].input.selectionKey,JSON.stringify(['session',7,4]))
  assert.equal(f.player.get().owner,'session:stage')
  assert.equal(f.player.get().audio.paused,false)
  assert.equal(event.kind,'voice','consumer must not mutate the runtime event')
  await env.consumers.get('session').play({...event,streaming:true},{anchor:{paragraphId:JSON.stringify(['branch','node',0,2])}})
  assert.equal(f.synths.length,1,'incomplete speech remains gated')
  config.stage.director=true
  for(const form of ['text','voice']) {
    director={phase:'done',through:2,entries:[{at:2,ops:[{op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'actor',side:'in',form}}]}]}
    await env.consumers.get('session').play({...event,text:'Phone line',lineIdentity:[7,5]},{anchor:{para:2,paragraphId:'phone'}})
    assert.equal(f.synths.length,1,'Late automatic voice completion cannot bypass phone-only playback')
  }
})
