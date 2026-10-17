import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {createStageRuntimeHarness,runtimeSource,runtimePage,runtimeText,runtimeDirection} from './helpers/stage-runtime-harness.mjs'
const read=name=>readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
const mark=form=>({op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'sender',side:'in',form}})

for(const form of ['text','voice'])test('phone '+form+' waits for surface classification and never schedules automatic line TTS',()=>{
  const h=createStageRuntimeHarness(),source=runtimeSource()
  h.dispatch({type:'SESSION_INPUTS',settings:{config:{stage:{director:true}}}})
  h.dispatch({type:'SEND_ACK',source})
  h.dispatch({type:'TEXT_APPEND',source,text:runtimeText(1,[runtimePage(1,0,{voice:{identity:'line-voice'}})],true)})
  assert.equal(h.effects('prepare-one-shot').filter(row=>row.descriptor.kind==='voice').length,0,'Unknown surface cannot start TTS')
  h.dispatch({type:'DIRECTOR_SNAPSHOT',source,envelope:runtimeDirection(1,1,{entries:[{at:1,ops:[mark(form)],events:[]}]})})
  assert.equal(h.effects('prepare-one-shot').filter(row=>row.descriptor.kind==='voice').length,0,'A phone line never auto-reads')
})
test('ordinary dialogue resumes automatic speech after its sealed director prefix',()=>{
  const h=createStageRuntimeHarness(),source=runtimeSource()
  h.dispatch({type:'SESSION_INPUTS',settings:{config:{stage:{director:true}}}})
  h.dispatch({type:'SEND_ACK',source})
  h.dispatch({type:'TEXT_APPEND',source,text:runtimeText(1,[runtimePage(1,0,{voice:{identity:'line-voice'}})],true)})
  h.dispatch({type:'DIRECTOR_SNAPSHOT',source,envelope:runtimeDirection(1,1,{entries:[]})})
  assert.equal(h.effects('prepare-one-shot').filter(row=>row.descriptor.kind==='voice').length,1)
})

test('browser backlog shows one marked phone row per paragraph, text is silent and voice is manual',async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)))
  await page.setContent('<div id="root" class="fork-gal-theme-scope" data-theme="classic"></div>')
  await page.addStyleTag({content:await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css',import.meta.url),'utf8')})
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react;
    const forkVoicePlayer={subscribe:()=>()=>{},get:()=>null};
    const useLiveTavernView=()=>null,ForkHelpTip=()=>null,ForkIcon=()=>null;
    const forkBubbleCharacter=()=>null;
    const ForkVoiceButton=({voice})=>React.createElement('button',{onClick:voice.click},'Play');
  `+await read('fork-phone-beat.cjs')+await read('fork-stage-runtime.cjs')+await read('fork-gal-backlog.js')+`
    window.autoSpeech=[];
    for(const form of ['text','voice']){
      let state=createStageRuntimeState();
      const source=${JSON.stringify(runtimeSource())};
      const events=[{type:'SESSION_INPUTS',settings:{config:{stage:{director:true}}}},{type:'SEND_ACK',source},
        {type:'TEXT_APPEND',source,text:${JSON.stringify(runtimeText(1,[runtimePage(1,0,{voice:{identity:'line-voice'}})],true))}},
        {type:'DIRECTOR_SNAPSHOT',source,envelope:{...${JSON.stringify(runtimeDirection(1,1))},entries:[{at:1,events:[],ops:[{op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'sender',side:'in',form}}]}]}}];
      for(const event of events){const result=reduceStageRuntime(state,event);state=result.state;autoSpeech.push(...result.effects.filter(effect=>effect.type==='prepare-one-shot' && effect.descriptor.kind==='voice'));}
    }
    window.played=0;
    const voice={click:()=>played++},pages=[
      {kind:'line',para:1,name:'Sender',text:'Written ',anchor:{para:1,offset:0},voice},
      {kind:'line',para:1,name:'Sender',text:'message',anchor:{para:1,offset:8},voice},
      {kind:'line',para:2,name:'Sender',text:'Recorded message',anchor:{para:2,offset:0},voice}
    ];
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(ForkGalBacklog,{
      sessionId:'phone-backlog',turn:1,pages,page:2,direction:${JSON.stringify({phase:'done',through:2,entries:[{at:1,ops:[mark('text')]},{at:2,ops:[mark('voice')]}]})},
      colorOf:()=>'',avatarOf:()=>'',nameOf:()=>'',onJump(){},onClose(){}
    }));`})
  await page.locator('.fork-gal-backlog-row[data-phone-form="voice"]').waitFor()
  assert.equal(await page.locator('.fork-gal-backlog-row').count(),2,'Split subtitle cards become one phone history row')
  const text=page.locator('[data-phone-form="text"]'),voice=page.locator('[data-phone-form="voice"]')
  assert.equal(await text.locator('.fork-gal-backlog-text').textContent(),'Written message')
  assert.match(await text.locator('.fork-gal-backlog-tag').textContent(),/手机/)
  assert.equal(await page.locator('#root').evaluate(e=>getComputedStyle(e).getPropertyValue('--gal-ui-tag-display').trim()),'none','Classic hides decorative tags by default')
  assert.equal(await text.locator('.fork-gal-backlog-tag').isVisible(),true,'Phone text provenance stays visible in classic')
  assert.equal(await voice.locator('.fork-gal-backlog-tag').isVisible(),true,'Phone voice provenance stays visible in classic')
  assert.equal(await text.locator('button').count(),0,'Text messages have no history speech control')
  assert.equal(await page.evaluate(()=>played),0)
  assert.deepEqual(await page.evaluate(()=>autoSpeech),[],'Production browser reducer schedules no automatic phone TTS')
  await voice.getByRole('button',{name:'Play',exact:true}).click()
  assert.equal(await page.evaluate(()=>played),1)
  assert.deepEqual(errors,[])
})

// private fork (owner 2026-10): the phone stays out across narration between its lines and is put away after the
// director's last phone mark or a scene change; no new director command.
test('phone run spans a mixed beat sequence and ends at the last mark or a scene change',async()=>{
  const {forkPhoneRun}=(await import('node:module')).createRequire(import.meta.url)('../tavern-plugin/src/client/fork-phone-beat.cjs')
  const entry=(at,...ops)=>({at,ops})
  const scene=value=>({op:'scene.set',value:{background:value}})
  const direction={phase:'done',through:9,token:{sourceKey:'s',generation:1},baseline:{scene:{background:'room'}},entries:[entry(2,mark('text')),entry(4,mark('voice')),entry(5,scene('room')),entry(7,scene('street')),entry(8,mark('text'))]}
  const run=at=>forkPhoneRun(direction,at)?.start ?? null
  assert.deepEqual([1,2,3,4,5,6,7,8,9].map(run),[null,2,2,2,null,null,null,8,null])
  assert.equal(forkPhoneRun({...direction,entries:direction.entries.slice(0,2),phase:'partial',through:4},6)?.start,2,'An unsealed tail keeps the phone out')
  assert.equal(forkPhoneRun({...direction,entries:[entry(2,mark('text')),entry(3,scene('room')),entry(4,mark('text'))]},3)?.start,2,'Re-stating the same background is not a scene change')
})
