import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
const read=name=>readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
const card=await read('fork-asset-pack-card-ui.js'),voice=await read('fork-asset-pack-voice-ui.js')
const inline=await read('fork-inline-field.js') // private fork (UI standard phase 2 batch 7): SwitchRow's switch is ForkSwitch
const slice=(source,from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,from);return source.slice(start,end)}

// private fork (owner 2026-10 voice-row): the 配音 row is rendered for real (React + jsdom): 「配音 › ⚠」, the name and the
// 「›」 open 声音设置, and the ⚠ neither blinks across re-reads nor outlives the failure it reports.
async function mount(t) {
  const dom=new JSDOM('<!doctype html><div id="root"></div>')
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:false})
  const React=(await import('react')).default,{createRoot}=await import('react-dom/client')
  const h=React.createElement
  const sandbox={React,h,Help:()=>null,Glyph:({name})=>h('i',{'data-glyph':name}),voiceIssueText:code=>'text:'+code,voiceErrorText:e=>String(e?.message||e)}
  const rows=[{ref:{packId:'pack',figureId:'on'},pack:{revision:'r1'},figure:{name:'On',enabled:true,voice:{voice:'v'}}},
    {ref:{packId:'pack',figureId:'off'},pack:{revision:'r1'},figure:{enabled:false,voice:{voice:'v'}}},
    {ref:{packId:'pack',figureId:'muted'},pack:{revision:'r1'},figure:{enabled:true,voice:{voice:'v',source:null}}}]
  sandbox.stageFigureRows=()=>rows
  vm.runInNewContext([slice(voice,'function useVoiceLoad(','function voiceTts('),slice(voice,'function useVoiceRefresh(','function useVoiceModelStatus('),
    slice(inline,'function ForkSwitch(','function ForkSegmented('),slice(card,'function SwitchRow(','// A state that needs an action'),slice(card,'function useStageConfirmedVoiceWarnings(','const stageNeedText')].join('\n')+
    ';this.StageVoiceRow=StageVoiceRow;this.SwitchRow=SwitchRow',sandbox)
  const listeners=new Set(),calls=[],state={issues:[],hold:null,fail:false,opened:0,toggled:0}
  const binding={tts:{subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn)}},
    rpc:async(method,ref)=>{calls.push(ref.figureId);if(state.hold)await state.hold;if(state.fail)throw Error('offline');return {issues:state.issues}}}
  const ctx={binding,ttsState:'ready',engine:{revision:1},nav:{openTab:()=>{}},openVoice:()=>{state.opened++}}
  const row=(key,status,onOpen)=>h(sandbox.SwitchRow,{key,label:'配音',checked:true,onChange:()=>{state.toggled++},status,onOpen})
  const root=createRoot(document.getElementById('root'))
  // No act() in this React build: let the scheduler and pending reads run.
  const settle=()=>new Promise(r=>setTimeout(r,30))
  const render=async next=>{root.render(h(sandbox.StageVoiceRow,{ctx:next||ctx,row}));await settle()}
  const emit=async()=>{for(const fn of listeners)fn({type:'modelValidationChanged'});await settle()}
  const mark=()=>document.querySelector('.ap-switch-warn')
  t.after(async()=>{root.unmount();await settle();dom.window.close()})
  return {React,ctx,state,calls,render,settle,emit,mark}
}

test('stage voice row: 「配音 › ⚠」, name and 「›」 open 声音设置, ⚠ only for a current confirmed failure',async t=>{
  const {ctx,state,calls,render,settle,emit,mark}=await mount(t)
  await render();await settle()
  assert.deepEqual(calls,['on'],'only enabled, voiced figures are read')
  assert.equal(mark(),null,'no failure: no ⚠')
  const jump=document.querySelector('button.ap-kind-jump')
  assert.ok(jump,'the 「›」 is always there');assert.equal(jump.getAttribute('aria-label'),'声音设置')
  assert.ok(document.querySelector('.ap-hint-chip') === null, 'no 声音设置 pill')
  jump.click();assert.equal(state.opened,1)
  // private fork (settings-ux r2, owner 2026-10): the whole row but the switch opens 声音设置.
  document.querySelector('.ap-switch-name').click()
  assert.equal(state.opened,2,'the name opens 声音设置');assert.equal(state.toggled,0,'and does not flip the switch')
  document.querySelector('.ap-switch-row').click()
  assert.equal(state.opened,3,'so does the row');assert.equal(state.toggled,0,'without flipping the switch')
  document.querySelector('input[role=switch]').click()
  assert.equal(state.toggled,1,'the switch toggles');assert.equal(state.opened,3,'and opens nothing')

  state.issues=[{code:'QWEN_MODEL_NOT_FOUND',field:'model'}];await emit();await settle()
  assert.match(mark()?.getAttribute('aria-label')||'',/On：text:QWEN_MODEL_NOT_FOUND/)
  const main=document.querySelector('.ap-switch-main'),order=[...main.children].map(n=>n.className||n.tagName)
  assert.deepEqual(order.slice(1),['ap-switch-name','ap-kind-jump','ap-hint-mark ap-switch-warn'],'name, 「›」, ⚠ — the switch is moved right by CSS')
  mark().click();assert.equal(state.toggled,1,'the ⚠ does not flip the switch')

  // Synthesis events and engine/pack re-renders re-read in place: the ⚠ stays put while a read is pending.
  for(let i=0;i<5;i++){
    let release;state.hold=new Promise(r=>{release=r})
    await emit();assert.ok(mark(),'still shown while re-reading (event '+i+')')
    await render({...ctx,engine:{revision:2+i}});assert.ok(mark(),'still shown across a re-render (event '+i+')')
    release();state.hold=null;await settle();assert.ok(mark(),'still shown after the read (event '+i+')')
  }

  state.issues=[];await emit();await settle()
  assert.equal(mark(),null,'a model restored to a working one clears the ⚠ on the next read')
  state.issues=[{code:'SERVICE_OFFLINE'}];await emit();await settle()
  assert.equal(mark(),null,'network/list failures are not model evidence')
  state.fail=true;await emit();await settle()
  assert.equal(mark(),null)
})

test('a finished synthesis is not a pack change (no stage reload → re-synthesis → event loop)',async()=>{
  const launcher=await read('fork-asset-launcher.js'),body=slice(launcher,"get('ttsClient').subscribe(",'const offRate')
  assert.ok(body.indexOf("modelValidationChanged') return")>=0&&body.indexOf("modelValidationChanged') return")<body.indexOf('forkPackChanged(event)'))
})
test('stage voice row: plugin off / no service is a ⚠ beside the 「›」, not a pill',async t=>{
  const {ctx,render,settle,mark}=await mount(t)
  await render({...ctx,ttsState:'off'});await settle()
  assert.equal(mark()?.getAttribute('aria-label'),'配音插件未启用')
  await render({...ctx,ttsState:'empty'});await settle()
  assert.equal(mark()?.getAttribute('aria-label'),'没有可用的语音服务')
  assert.ok(document.querySelector('.ap-hint-chip') === null)
})
