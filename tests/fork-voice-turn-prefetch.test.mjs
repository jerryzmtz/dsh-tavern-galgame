// private fork: whole-turn warming is session-owned, bounded and playback-free.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {voiceFixture,tick} from './fixtures/native-voice-player.mjs'
import bubbleLine from '../tavern-plugin/src/client/fork-bubble-line.cjs'

test('two workers keep reading order and promote a jumped-to clip without cancelling the turn',async t=>{
  const f=voiceFixture(); t.after(()=>f.player.dispose())
  const finish=new Map(), order=[]
  f.client.synthesize=({text},{signal})=>new Promise(resolve=>{order.push(text);finish.set(text,()=>resolve({key:text,ticket:text}));assert.equal(signal.aborted,false)})
  const pending=['a','b','c','d','e'].map(id=>f.prefetch(id))
  await tick();assert.deepEqual(order,['a','b']);assert.equal(f.player.get(),null)
  // Page cancellation must stop playback without destroying whole-turn background work.
  f.player.stopPlayback()
  const playing=f.play('e');finish.get('a')();await tick();assert.deepEqual(order,['a','b','e'])
  finish.get('b')();await tick();assert.deepEqual(order,['a','b','e','c'])
  finish.get('e')();await tick();finish.get('c')();await tick();finish.get('d')()
  assert.ok((await Promise.all(pending)).every(Boolean));assert.equal(await playing,true)
})

test('transcript and stage use a shared prepared clip, while disabled player performs no synthesis',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose())
  const input={...f.input('chat'),cacheKey:'same-speech'}
  await f.player.prefetch(f.descriptor,input)
  const playing=f.player.play(f.descriptor,{...input,owner:'stage',id:'paragraph'})
  assert.equal(f.player.get().audio.paused,false);await playing;assert.equal(f.synths.length,1)
  f.player.setEnabled(false);assert.equal(await f.prefetch('off'),false);assert.equal(f.synths.length,1)
})

test('stage window includes the entire viewed turn and only its next turn; jumps prioritize current line',async()=>{
  const source=await readFile(new URL('../tavern-plugin/src/client/fork-stage-ui.js',import.meta.url),'utf8')
  const env={forkStageVoiceHandle:(_id,voice)=>voice,forkStageVoiceAvailable:()=>true} // private fork: one TTS lookup per window
  vm.runInNewContext(source.slice(source.indexOf('function forkStageVoiceWindowFromIndex'),source.indexOf('// The runner awaits')),env)
  const pages=n=>Array.from({length:20},(_,i)=>({voice:{owner:'stage',id:n+':'+i},anchor:{paragraphId:n+':'+i}}))
  const a=pages(1),b=pages(2),c=pages(3),index=new Map([[1,{text:{pages:a}}],[2,{text:{pages:b}}],[3,{text:{pages:c}}]])
  const result=env.forkStageVoiceWindowFromIndex('session',index,1,a,10,{})
  assert.equal(result.length,40);assert.equal(result[0].id,'1:10');assert.equal(result[10].id,'1:0');assert.equal(result[20].id,'2:0')
  assert.ok(!result.some(v=>v.id.startsWith('3:')))
})

test('new turns auto synthesize while permanent failures stay remembered across settings polls',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose())
  const [voice,ui,binding]=await Promise.all(['fork-voice.js','fork-stage-ui.js','fork-stage-session-binding.js'].map(file=>readFile(new URL('../tavern-plugin/src/client/'+file,import.meta.url),'utf8')))
  const synthesize=f.client.synthesize
  let failures=0
  f.client.synthesize=async(input,options)=>{if(input.text==='bad input'){failures++;throw Object.assign(new Error('PROVIDER_REJECTED'),{status:400})}return synthesize(input,options)}
  const config={characters:[{alias:'actor',voice:'work/actor'}],stage:{textLanguage:'en'}}
  const row=text=>({text:{streaming:false,pages:[text,'bad input'].map((text,n)=>({voice:{alias:'actor',text},anchor:{paragraphId:String(n)}}))}})
  let state={settings:{config},latestSource:{turn:1},opened:false,textIndex:new Map([[1,row('Hello')]])},descriptors=0
  const store={getSnapshot:()=>state,select:()=>({subscribe:()=>()=>{},dispose(){}})}
  const env={ctx:{sessions:{list:{getSnapshot:()=>({current:'s'})}}},owner:{get:()=>store},forkStageUiEqual:()=>true,
    forkBubbleCharacter:bubbleLine.forkBubbleCharacter,forkBubbleMood:()=>null,forkBubbleMoodList:()=>[],
    forkVoicePlayer:f.player,forkTtsScope:{get:()=>f.client},rpc:async()=>{descriptors++;return f.descriptor}}
  vm.runInNewContext(voice.slice(voice.indexOf('function forkPackSpeechInput'),voice.indexOf('function forkStageVoiceWindow'))+'\n'+ui.slice(ui.indexOf('function forkStageVoiceHandle'),ui.indexOf('function forkStageVoiceWindowFromIndex'))+'\n'+binding.slice(binding.indexOf('        let voiceStore'),binding.indexOf('        const stopVoiceSession'))+'\nglobalThis.sync=syncVoice;',env)
  env.sync();await tick()
  assert.deepEqual(f.synths.map(call=>call.input.text),['Hello'])
  state={...state,latestSource:{turn:2},textIndex:new Map([...state.textIndex,[2,row('New turn')]])}
  env.sync();await tick()
  assert.deepEqual(f.synths.map(call=>call.input.text),['Hello','New turn'])
  for(let minute=0;minute<3;minute++){f.advance(60000);state={...state,settings:{config:{...config}}};env.sync();await tick()}
  assert.equal(descriptors,3,'settings polls neither retry permanent failures nor resynthesize cached speech')
  assert.equal(failures,1)
  assert.equal(f.synths.length,2)
  const failed=env.forkStageVoiceHandle('s',{alias:'actor',text:'bad input'},config,'1')
  assert.equal(f.player.getError(failed),'PROVIDER_REJECTED')
  await failed.click({automatic:true});assert.equal(failures,1)
  await failed.click();assert.equal(failures,2,'explicit replay resets the failure state')
  assert.equal(f.player.get().error,'PROVIDER_REJECTED')
})

test('session owner warms latest completed turn without mounted bubbles; historical turns stay cold',async()=>{
  const source=await readFile(new URL('../tavern-plugin/src/client/fork-stage-session-binding.js',import.meta.url),'utf8')
  const row=turn=>({text:{streaming:false,pages:[{voice:{text:String(turn)},anchor:{paragraphId:String(turn)}}]}})
  let state={settings:{config:{}},latestSource:{turn:4},source:{turn:1},opened:false,textIndex:new Map([1,2,3,4].map(n=>[n,row(n)]))}
  const warmed=[],store={getSnapshot:()=>state,select:()=>({subscribe:()=>()=>{},dispose(){}})}
  const env={ctx:{sessions:{list:{getSnapshot:()=>({current:'s'})}}},owner:{get:()=>store},forkStageUiEqual:()=>true,
    forkStageVoiceHandle:(_id,voice)=>({id:voice.text,prefetch:()=>warmed.push(voice.text)}),forkVoicePlayer:{cancelPrefetch(){}},
    forkStageVoiceAvailable:()=>true} // private fork: one TTS lookup per sync
  vm.runInNewContext(source.slice(source.indexOf('        let voiceStore'),source.indexOf('        const stopVoiceSession'))+'\nglobalThis.sync=syncVoice;',env)
  env.sync();assert.deepEqual(warmed,['4']);warmed.length=0
  state={...state,opened:true};env.sync();assert.deepEqual(warmed,['4','1','2']);warmed.length=0
  state={...state,opened:false,interrupted:true};env.sync();assert.deepEqual(warmed,[])
  state={...state,interrupted:false,textIndex:new Map([[4,{text:{...row(4).text,streaming:true}}]])};env.sync();assert.deepEqual(warmed,[])
})
