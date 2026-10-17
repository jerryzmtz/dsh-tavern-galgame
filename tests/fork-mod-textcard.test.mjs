import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {createBuiltinModRegistry} from '../tavern-plugin/lib/domain/mods/runtime.js'
import * as textcardRuntime from '../fork/mods/textcard/runtime.js'
import {createModRegistry} from '../tavern-plugin/lib/domain/mods/registry.js'
import {createModHostRuntime} from '../tavern-plugin/lib/fork-mod-runtime.js'
import {validateModCommand} from '../tavern-plugin/lib/domain/mods/commands.js'
import {parseModDsl} from '../tavern-plugin/lib/domain/mods/dsl.js'
import {createModStageCorrections} from '../tavern-plugin/lib/domain/mods/stage-corrections.js'
import {prepareAssetPackDirector,buildAssetPackRequest,createAssetPackTransaction} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {reduceAssetPackOperation} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {syntheticPack,cardExtension} from './fixtures/asset-packs/pack.mjs'
import stageRuntime from '../tavern-plugin/src/client/fork-stage-runtime.cjs'
import projection from '../tavern-plugin/src/client/fork-mod-projection.cjs'
import {PRESETS,INTENSITIES,textcardPayload} from '../fork/mods/textcard/presets.js'
import {configure,commandSchema} from '../fork/mods/textcard/runtime.js'

const modId='dsh.textcard',builtins=await createFirstPartyMods(),manifest=builtins.manifest(modId)
const source={branchId:'branch',sourceKey:'source',generation:0,textVersion:'source'}
const input={cardId:'card',gameId:'session',turn:1,source,authorityEpoch:1,catalogueRevision:'1'}
const command=intensity=>({...configure({manifest,settings:{values:{intensity}}}).commands[0],modId})
const legacyParams={placement:'before',style:'flash',text:['dream','contract','memory'],sub:'01'}
const params={placement:'before',text:'dream',sub:'01'}
const examples=JSON.parse(await readFile(new URL('./fixtures/textcard-templates.json',import.meta.url),'utf8'))
async function fixture(t) {
  const library=createModRegistry({capabilities:['stage.place']})
  await library.install({manifest,expectedRevision:library.snapshot().revision})
  await library.authorize({modId,allowed:true,expectedRevision:library.snapshot().revision})
  let store
  const stage=createModStageCorrections({read:async()=>store,update:async(_context,mutate)=>{const next=mutate(store);if(next)store=next}})
  const host=createModHostRuntime({library,builtins,sourceCurrent:()=>true,readText:async(id,path)=>builtins.file(id,path).toString('utf8'),stagePort:stage})
  t.after(()=>host.dispose())
  return {library,host,stage,get store(){return store},async enable(scope='global'){await library.setModScope({modId,scope,expectedRevision:library.snapshot().revision})}}
}
async function prepared(mods) {
  return prepareAssetPackDirector({snapshots:[{...await syntheticPack(),revision:'1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'1',engine:{widgetsEnabled:false},target:{sourceKey:'source',branchId:'branch',revision:1},units:Array.from({length:16},()=> 'Offline text.'),...(mods?{mods:{revision:'1',...mods},modPrompts:mods.fragments || []}:{})})
}

test('built-in release separates title replacement from additive styles, with no foreground or settlement prompt',()=>{
  assert.equal(manifest.commands.length,9)
  assert.deepEqual(manifest.commands.filter(row=>row.mode==='replaces').map(row=>[row.op,row.replaces]),[['mod.dsh.textcard.title','title.play']])
  assert.deepEqual(manifest.commands[0].params.properties.preset.enum,['word','name','marker','vertical','punct'])
  assert.equal(manifest.commands[0].op,'text.show')
  assert.equal(manifest.prompts.every(row=>row.target==='director'),true)
  assert.deepEqual(manifest.assetKinds,[])
  assert.deepEqual(manifest.defaultPacks,[])
  assert.deepEqual([...new Set(Object.values(PRESETS).map(row=>row.category))].sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,22,23])
  assert.equal(manifest.settingsSchema.fields[0].default,'standard')
  assert.equal(manifest.settingsSchema.fields[0].scope,'global')
})

test('schema/DSL/native admission reject exact bad fields with actionable repair',()=>{
  const cmd=command('standard'),context={modCommands:[cmd],actors:{},dimensions:{},catalogue:{rows:[],candidates:{}}}
  validateModCommand(cmd,params)
  validateModCommand(cmd,{text:'Echo'})
  assert.throws(()=>validateModCommand(cmd,{}),error=>error.path==='$.params.text')
  assert.deepEqual(parseModDsl('text show placement=before text="dream" sub="01"',[cmd]),{op:'text.show',...params})
  const invalid=[
    [{...params,preset:'overlay'},/Choose/], [{...params,ms:100},/Remove unknown field/],
    [{...params,text:[]},/string/], [{...params,text:'a'.repeat(97)},/96/],
  ]
  for(const [value,repair] of invalid) {
    assert.throws(()=>validateModCommand(cmd,value),error=>repair.test(error.message))
    assert.throws(()=>reduceAssetPackOperation({}, {op:'text.show',...value},context),error=>repair.test(error.message))
  }
  assert.equal(reduceAssetPackOperation({}, {op:'text.show',...params},context).operation.op,'mod.command')
})

test('all presets use measured frame timing; safety floor cannot be shortened by intensity',()=>{
  for(const intensity of Object.keys(INTENSITIES))for(const [style,preset] of Object.entries(PRESETS)) {
    const text=style==='morph'?['\u660e']:Array.from({length:preset.minItems || 1},()=> 'x')
    const payload=textcardPayload({style,text},intensity)
    assert.equal(payload.frames,payload.stepFrames.reduce((sum,frames)=>sum+frames,0))
    assert.equal(payload.fps,24);assert.equal(payload.minColourFrames,9)
    assert.ok(payload.stepFrames.every(frames=>Number.isSafeInteger(frames) && frames>=3))
    if(preset.colour)assert.ok(payload.stepFrames.every(frames=>frames>=9))
    assert.deepEqual(payload.history.parts,text)
  }
  assert.equal(textcardPayload({style:'title',text:['Title']}).frames,58)
  assert.equal(textcardPayload({style:'morph',text:['\u660e']}).frames,48)
  assert.equal(textcardPayload({style:'build',text:['memory']}).frames,82)
  assert.deepEqual(textcardPayload({style:'count',text:['3']}).steps,['3','2','1','0'])
  assert.equal(textcardPayload({style:'count',text:['3']}).history.text,'3 / 2 / 1 / 0')
  assert.equal(textcardPayload({style:'marker',text:['recall']}).history.text,'\u56de\u60f3')
  assert.equal(textcardPayload({style:'build',text:['m','memory']}).history.text,'memory')
})

test('title and additive cards share configured intensity across checkpoint/retry, not the installed default cap',async()=>{
  for(const [intensity,{cap}] of Object.entries(INTENSITIES)) {
    const commands=configure({manifest,settings:{values:{intensity}}}).commands.map(row=>({...row,modId}))
    const schemaCommands=commandSchema({manifest}).map(row=>({...row,modId}))
    const p=await prepared({commands,schemaCommands}),tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
    const first={sequence:1,through:cap,done:false,beats:Array.from({length:cap},(_,i)=>({at:i+1,ops:[{op:commands[i%commands.length].op,...examples[commands[i%commands.length].id]}]}))}
    assert.equal(tx.submit(first).ok,true)
    assert.equal(tx.submit(first).duplicate,true)
    const resumed=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding,checkpoint:tx.savepoint()})
    const receipt=resumed.submit({sequence:2,through:16,done:true,beats:[{at:cap+1,ops:[{op:'text.show',text:'extra'}]}]})
    assert.equal(receipt.errors[0].code,'CONFLICT')
    assert.match(JSON.stringify(receipt),new RegExp('limit '+cap))
    assert.equal(resumed.effect().entries.flatMap(entry=>entry.ops).length,cap)
  }
})

test('disabled contributes exactly zero bytes; prompt view exposes complete snippet and schema',async t=>{
  const h=await fixture(t)
  assert.equal(await h.host.prepare(input),null)
  const off=buildAssetPackRequest(await prepared(),true,undefined,'',true)
  const empty=buildAssetPackRequest(await prepared({commands:[],fragments:[]}),true,undefined,'',true)
  for(const key of ['system','messages','tools'])assert.deepEqual(empty[key],off[key])
  await h.enable()
  const active=await h.host.prepare(input)
  assert.equal(active.commands[0].caps.perTurn,8)
  assert.ok(active.commands.every(command=>command.caps.group==='textcard'),'title and additive cards share one intensity budget')
  // The runtime override must retain the tagged placement rule, not replace it with old prose.
  const rule=active.fragments.find(row=>row.id==='text-rule').text
  assert.equal(rule,builtins.file(modId,'prompts/textcard.txt').toString('utf8'))
  assert.match(rule,/Default after; title before/)
  assert.ok(Buffer.byteLength(rule)<=800)
  for(const [intensity,{cap}] of Object.entries(INTENSITIES)) {
    await h.library.saveModSettings({modId,values:{intensity},expectedRevision:h.library.snapshot().revision})
    assert.equal(h.host.configure(input)[0].caps.perTurn,cap)
    const configured=await h.host.prepare(input)
    assert.ok(configured.fragments.some(row=>row.text===rule.replace('Share 8 performances',`Share ${cap} performances`)))
  }
  const layered=await h.host.prepare({...input,settingsByMod:{[modId]:{values:{intensity:'restrained'}}}})
  assert.equal(layered.commands[0].caps.perTurn,5,'resolved card override wins over global intense')
  assert.ok(layered.fragments.some(row=>row.text.includes('Share 5 performances')))
  await h.host.command(layered,{modId,commandId:'show',params},{key:'override',at:1})
  assert.equal(h.store.performances[0].payload.intensity,'restrained')
  const on=buildAssetPackRequest(await prepared(active),true,undefined,'',true)
  assert.ok(!on.system.includes('text.show'))
  assert.ok(JSON.stringify(on.messages).includes('text.show'))
  assert.ok(JSON.stringify(on.tools).includes('text.show'))
  for(const fragment of active.fragments)assert.ok(on.sections.some(row=>row.text===fragment.text))
  assert.equal(on.sections.find(row=>row.key==='tools').text,JSON.stringify(on.tools))
  await h.enable('off')
  assert.equal(await h.host.prepare(input),null)
})

test('host places once under stable identity and generic backlog retains all sequence text without settlement',async t=>{
  const h=await fixture(t);await h.enable()
  const params={placement:'before',words:legacyParams.text,sub:'01'}
  const snapshot=await h.host.prepare(input),call={modId,commandId:'sequence',params},accepted={key:'0:0',at:2}
  assert.equal((await h.host.command(snapshot,call,accepted)).ok,true)
  assert.equal((await h.host.command(snapshot,call,accepted)).ok,true)
  assert.equal(h.store.performances.length,1)
  const rows=projection.projectModPerformances(JSON.parse(JSON.stringify(h.store)))
  assert.deepEqual(rows[0].payload.history.parts,[...params.words,params.sub])
  const context=vm.createContext({})
  vm.runInContext(await readFile(new URL('../tavern-plugin/src/client/fork-gal-backlog.js',import.meta.url),'utf8'),context)
  const entries=[{type:'page',turn:1,page:0,para:2,text:'Body'}]
  const history=context.forkStageModHistoryEntries(entries,[{turn:1,performances:rows}])
  assert.equal(history.length,2)
  assert.equal(history[1].text,'dream / contract / memory / 01')
  await h.enable('off')
  assert.equal(context.forkStageModHistoryEntries(entries,[{turn:1,performances:rows}]).length,2)
})

test('existing stage ledger consumes a card once through page navigation, history jumps and reopen',()=>{
  const {createStageRuntimeState,reduceStageRuntime}=stageRuntime
  const src={sessionId:'session',authorityEpoch:0,branchId:'branch',turn:1,sourceKey:'source',generation:0}
  const pages=[1,2,3].map(para=>({anchor:{paragraphId:'p'+para,para,offset:0}}))
  let state=createStageRuntimeState(),effects=[]
  const send=event=>{({state,effects}=reduceStageRuntime(state,event));return effects}
  const text={revision:1,streaming:false,hasReadableText:true,pages}
  const performance={id:'text-1',modId,at:2,kind:'dsh.textcard.card',payload:textcardPayload(legacyParams)}
  const envelope={phase:'done',revision:1,generation:0,bindingKey:'binding',prefixRevision:1,through:3,complete:true,baseline:{},entries:[],modCorrectionRevision:1,modPerformances:[performance]}
  send({type:'SEND',source:src,text});send({type:'DIRECTOR_SNAPSHOT',source:src,envelope});send({type:'PAGE',index:1})
  const shot=effects.find(row=>row.type==='prepare-one-shot');assert.ok(shot)
  send({type:'ONE_SHOT_READY',token:shot.token});assert.ok(effects.some(row=>row.type==='play-one-shot'))
  send({type:'PAGE',index:0});send({type:'PAGE',index:1});assert.ok(!effects.some(row=>row.type==='prepare-one-shot'))
  send({type:'HISTORY_JUMP',source:src,text,anchor:pages[1].anchor});send({type:'DIRECTOR_SNAPSHOT',source:src,envelope})
  assert.ok(!effects.some(row=>row.type==='prepare-one-shot' || row.type==='play-one-shot'))
  send({type:'STAGE_OPEN',opened:false});send({type:'STAGE_OPEN',opened:true});assert.ok(!effects.some(row=>row.type==='prepare-one-shot' || row.type==='play-one-shot'))
  state=createStageRuntimeState()
  send({type:'HISTORY_JUMP',source:src,text,anchor:pages[1].anchor});send({type:'DIRECTOR_SNAPSHOT',source:src,envelope})
  assert.ok(!effects.some(row=>row.type==='prepare-one-shot' || row.type==='play-one-shot'),'even unseen text cards never pop on first history navigation')
  state=createStageRuntimeState()
  send({type:'SEND',source:src,text});send({type:'DIRECTOR_SNAPSHOT',source:src,envelope})
  send({type:'SKIP_START'});send({type:'PAGE',index:1});send({type:'SKIP_END'})
  send({type:'PAGE',index:0});send({type:'PAGE',index:1})
  assert.ok(!effects.some(row=>row.type==='prepare-one-shot' || row.type==='play-one-shot'),'skipped text cards are not deferred until navigation')
})


test('a director retry replays identical one-shots once in its new generation, never on history or skip',()=>{
  const {createStageRuntimeState,reduceStageRuntime}=stageRuntime;
  const source={sessionId:'s',authorityEpoch:0,branchId:'b',turn:1,sourceKey:'same-body',generation:0};
  const pages=[1,2,3].map(para=>({anchor:{paragraphId:'p'+para,para,offset:0}}));
  const text={revision:1,streaming:false,hasReadableText:true,pages};
  const rows=[{id:'card',at:2,kind:'dsh.textcard.card',payload:textcardPayload(legacyParams)},
    {id:'item',at:2,kind:'dsh.items.item',payload:{action:'show',name:'Cake'}}];
  let state=createStageRuntimeState(),effects=[];
  const send=event=>{({state,effects}=reduceStageRuntime(state,event));return effects;};
  const accept=generation=>send({type:'DIRECTOR_SNAPSHOT',source,envelope:{phase:'done',revision:generation+1,generation,bindingKey:'b'+generation,prefixRevision:1,through:3,complete:true,baseline:{},entries:[],modPerformances:rows}});
  const play=()=>{const shots=effects.filter(e=>e.type==='prepare-one-shot');for(const shot of shots){send({type:'ONE_SHOT_READY',token:shot.token});assert.equal(effects.filter(e=>e.type==='play-one-shot').length,1);}return shots;};
  send({type:'SEND',source,text});accept(0);send({type:'PAGE',index:1});const first=play();assert.equal(first.length,2);
  send({type:'PAGE',index:0});accept(1);send({type:'PAGE',index:1});const retry=play();assert.equal(retry.length,2);
  assert.notDeepEqual(first.map(e=>e.token.key),retry.map(e=>e.token.key));
  send({type:'PAGE',index:0});send({type:'PAGE',index:1});assert.equal(play().length,0);
  send({type:'HISTORY_JUMP',source,text,anchor:pages[1].anchor});accept(2);assert.equal(play().length,0);
  send({type:'RESUME_LIVE',source,text,anchor:pages[0].anchor});accept(2);send({type:'PAGE',index:1});assert.equal(play().length,0);
  send({type:'PAGE',index:0});accept(3);send({type:'SKIP_START'});send({type:'PAGE',index:1});send({type:'SKIP_END'});
  send({type:'PAGE',index:0});send({type:'PAGE',index:1});assert.equal(play().length,0);
});

// private fork (B4, O11/O40/O41): the first live view plays a card that is placed while the reader is on its paragraph;
// Auto's hold follows the director prefix; a passed one-shot is not replayed (reason recorded).
test('first live view plays a late-placed gen-0 word card once; Auto waits for the paragraph prefix',()=>{
  const {createStageRuntimeState,reduceStageRuntime,stageRuntimeIndicators}=stageRuntime
  const pages=[1,2,3].map(para=>({anchor:{paragraphId:'p'+para,para,offset:0}}))
  const text={revision:1,streaming:false,hasReadableText:true,pages}
  let state=createStageRuntimeState(),effects=[]
  const send=event=>{({state,effects}=reduceStageRuntime(state,event));return effects}
  const waiting=()=>stageRuntimeIndicators(state).awaitingDirection
  const src={sessionId:'s',authorityEpoch:0,branchId:'b',turn:2,sourceKey:'k',generation:0}
  const envelope=(revision,through,extra={})=>({phase:'partial',revision,generation:0,bindingKey:'bk',prefixRevision:through,through,complete:false,baseline:{},entries:[],...extra})
  send({type:'SESSION_INPUTS',settings:{config:{enabled:true,stage:{director:true}}}})
  send({type:'SEND',source:src,text})
  assert.equal(waiting(),true,'body/director pending: Auto holds on page 1')
  send({type:'DIRECTOR_SNAPSHOT',source:src,envelope:{phase:'running',revision:1,generation:0}})
  assert.equal(waiting(),true)
  send({type:'DIRECTOR_SNAPSHOT',source:src,envelope:envelope(2,1)})
  assert.equal(waiting(),false,'prefix covers paragraph 1')
  send({type:'PAGE',index:1})
  assert.equal(waiting(),true,'manual paging is immediate; the new paragraph has no prefix yet')
  const card={id:'card-6',modId:'dsh.textcard',at:2,kind:'dsh.textcard.card',payload:textcardPayload({style:'word',text:['系统过载']})}
  const late={id:'card-1',modId:'dsh.textcard',at:1,kind:'dsh.textcard.card',payload:textcardPayload({style:'word',text:['一分钟？！']})}
  send({type:'DIRECTOR_SNAPSHOT',source:src,envelope:envelope(3,3,{modCorrectionRevision:1,modPerformances:[late,card]})})
  assert.equal(waiting(),false)
  assert.ok(effects.some(row=>row.type==='project'),'late persistent state applies to the current page')
  const shots=effects.filter(row=>row.type==='prepare-one-shot')
  assert.deepEqual(shots.map(row=>row.descriptor.performance.id),['card-6'])
  assert.equal(Object.values(state.ledger).find(row=>row.descriptor.performance?.id==='card-1').reason,'passed')
  send({type:'ONE_SHOT_READY',token:shots[0].token})
  assert.equal(effects.filter(row=>row.type==='play-one-shot').length,1)
  send({type:'PAGE',index:0});send({type:'PAGE',index:1})
  assert.ok(!effects.some(row=>row.type==='prepare-one-shot'),'played once')
  send({type:'DIRECTOR_SNAPSHOT',source:src,envelope:{...envelope(4,3),phase:'done',complete:true}})
  assert.equal(waiting(),false)

})
test('an echo keeps its source at through storage, chat pagination and the revealed stage paragraph',async t=>{
  const h=await fixture(t);await h.enable()
  const snapshot=await h.host.prepare(input)
  const echo={placement:'after',text:'The echoed phrase'}
  await h.host.command(snapshot,{modId,commandId:'show',params:echo},{key:'echo',at:2})
  const [performance]=projection.projectModPerformances(JSON.parse(JSON.stringify(h.store)))
  assert.equal(performance.at,2)
  assert.equal(performance.payload.placement,'after')
  const context=vm.createContext({})
  for(const file of ['fork-textcard-presets.cjs','fork-textcard-stage.js','fork-gal-backlog.js'])
    vm.runInContext(await readFile(new URL('../tavern-plugin/src/client/'+file,import.meta.url),'utf8'),context)
  const pages=[{para:1,offset:0,text:'Before'}, {para:2,offset:0,text:'First page'},
    {para:2,offset:10,text:'The echoed phrase'}].map(row=>({text:row.text,anchor:{paragraphId:'p'+row.para,para:row.para,offset:row.offset}}))
  const entries=pages.map((row,index)=>({type:'page',turn:1,page:index,para:row.anchor.para,anchor:row.anchor,text:row.text}))
  const legacy={...performance,id:'legacy',kind:'dsh.textcard.card',payload:textcardPayload({style:'word',text:[echo.text]})}
  delete legacy.payload.placement
  const title={...legacy,id:'title',at:1,payload:textcardPayload({style:'title',text:['Chapter'],placement:'before'})}
  const history=context.forkStageModHistoryEntries(entries,[{turn:1,performances:[performance,legacy,title]}])
  assert.deepEqual(Array.from(history,row=>row.type==='card'?row.key:row.text),[
    'card:1:title','Before','card:1:legacy','First page','The echoed phrase','card:1:'+performance.id])

  const {createStageRuntimeState,reduceStageRuntime}=stageRuntime
  const src={sessionId:'session',authorityEpoch:0,branchId:'branch',turn:1,sourceKey:'source',generation:0}
  const text={revision:1,streaming:false,hasReadableText:true,pages}
  const envelope={phase:'done',revision:1,generation:0,bindingKey:'binding',prefixRevision:1,through:2,complete:true,baseline:{},entries:[],modPerformances:[performance,legacy,title]}
  let state=createStageRuntimeState(),effects=[]
  const send=event=>{({state,effects}=reduceStageRuntime(state,event));return effects}
  const shots=()=>effects.filter(row=>row.type==='prepare-one-shot').map(row=>row.descriptor.performance?.id)
  send({type:'SEND',source:src,text});send({type:'DIRECTOR_SNAPSHOT',source:src,envelope})
  assert.deepEqual(shots(),['title'],'a scene/title lead-in precedes its paragraph')
  send({type:'PAGE',index:1})
  assert.deepEqual(shots(),['legacy'],'unmarked historical cards retain arrival timing')
  send({type:'READ_PROGRESS',source:src,anchor:pages[1].anchor,readThrough:10})
  assert.deepEqual(shots(),[],'the echo waits for the last page of its source paragraph')
  send({type:'PAGE',index:2});assert.deepEqual(shots(),[])
  send({type:'READ_PROGRESS',source:src,anchor:pages[1].anchor,readThrough:100})
  assert.deepEqual(shots(),[],'stale reveal callbacks cannot reveal the next page')
  send({type:'READ_PROGRESS',source:src,anchor:pages[2].anchor,readThrough:11})
  assert.deepEqual(shots(),[],'partial typewriter reveal does not spoil the phrase')
  send({type:'READ_PROGRESS',source:src,anchor:pages[2].anchor,readThrough:27})
  assert.deepEqual(shots(),[performance.id],'the echo plays after its line, even at the end of the reply')
  const shot=effects.find(row=>row.type==='prepare-one-shot')
  send({type:'ONE_SHOT_READY',token:shot.token})
  assert.ok(effects.some(row=>row.type==='play-one-shot'))
  send({type:'READ_PROGRESS',source:src,anchor:pages[2].anchor,readThrough:27});assert.deepEqual(shots(),[])
  send({type:'PAGE',index:0});send({type:'PAGE',index:1});send({type:'PAGE',index:2})
  send({type:'READ_PROGRESS',source:src,anchor:pages[2].anchor,readThrough:27});assert.deepEqual(shots(),[])

  for(const mode of ['history','skip']) {
    state=createStageRuntimeState()
    send({type:mode==='history'?'HISTORY_JUMP':'SEND',source:src,text,anchor:pages[2].anchor})
    if(mode==='skip')send({type:'SKIP_START',index:2})
    send({type:'DIRECTOR_SNAPSHOT',source:src,envelope})
    assert.deepEqual(shots(),[],mode+' consumes rather than defers the echo')
    assert.equal(Object.values(state.ledger).find(row=>row.descriptor.performance?.id===performance.id).status,'skipped')
  }
})


test('title replacement executes its own op and restores core title only when disabled',async t=>{
  const h=await fixture(t);await h.enable();
  const active=await h.host.prepare(input),schemaCommands=commandSchema({manifest}).map(row=>({...row,modId}));
  const title=active.commands.find(row=>row.id==='title'),params={placement:'before',text:'New chapter',sub:'01'};
  assert.deepEqual(parseModDsl('tc-title title placement=before text="New chapter" sub="01"',active.commands),{op:title.op,...params});
  assert.throws(()=>validateModCommand(title,{...params,text:['old array']}),/string/);
  assert.throws(()=>validateModCommand(active.commands[0],{...params,preset:'title'}),/Choose/);
  const on=await prepared({...active,schemaCommands}),tx=createAssetPackTransaction({prepared:on,getCurrentBinding:()=>on.binding});
  assert.equal(tx.submit({sequence:1,through:16,done:true,beats:[{at:1,ops:[{op:title.op,...params}]}]}).ok,true);
  await h.host.command(active,{modId,commandId:'title',params},{key:'title',at:1});
  assert.equal(h.store.performances[0].payload.template,'title');
  assert.equal(h.store.performances[0].payload.placement,'before');
  const rejected=createAssetPackTransaction({prepared:on,getCurrentBinding:()=>on.binding}).submit({sequence:1,through:16,done:true,beats:[{at:1,ops:[{op:'title.play',text:'Core title'}]}]});
  assert.equal(rejected.ok,false);assert.match(JSON.stringify(rejected),/mod.dsh.textcard.title/);
  await h.enable('off');
  const off=await prepared({commands:[],schemaCommands}),core=createAssetPackTransaction({prepared:off,getCurrentBinding:()=>off.binding});
  const result=core.submit({sequence:1,through:16,done:true,beats:[{at:1,ops:[{op:'title.play',text:'Core title'}]}]});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(buildAssetPackRequest(on).tools,buildAssetPackRequest(off).tools);
});


test('first-party semantics reject unknown relation nodes before director acceptance and allow repair',async t=>{
  let calls=0
  const validateCommand=(id,value)=>{
    calls++;assert.equal(id,'relate');assert.equal(Object.isFrozen(value),true)
    const ids=value.people.map(row=>row.id)
    for(const [i,link] of value.links.entries())if(!ids.includes(link.to))throw Object.assign(new Error('Unknown node '+link.to+'; use one of '+ids.join(', ')+'.'),{code:'MOD_API_UNSUPPORTED',path:'$.params.links['+i+'].to'})
  }
  const custom=createBuiltinModRegistry([{manifest,files:builtins.files(modId),module:{...textcardRuntime,validateCommand}}])
  const library=createModRegistry({capabilities:['stage.place']})
  await library.install({manifest,expectedRevision:library.snapshot().revision})
  await library.authorize({modId,allowed:true,expectedRevision:library.snapshot().revision})
  await library.setModScope({modId,scope:'global',expectedRevision:library.snapshot().revision})
  const host=createModHostRuntime({library,builtins:custom,sourceCurrent:()=>true,readText:async(id,path)=>builtins.file(id,path).toString('utf8')})
  t.after(()=>host.dispose())
  const ready=await host.prepare(input),string={type:'string',minLength:1,maxLength:24}
  const relation={...command('standard'),id:'relate',op:'mod.dsh.textcard.relate',admission:{},params:{type:'object',additionalProperties:false,required:['people','links'],properties:{
    people:{type:'array',minItems:2,maxItems:8,items:{type:'object',additionalProperties:false,required:['id'],properties:{id:string}}},
    links:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['from','to'],properties:{from:string,to:string}}}}}}
  const p=await prepared({commands:[relation],schemaCommands:[relation]}),tx=createAssetPackTransaction({prepared:p,validateModCommand:ready.validateCommand,getCurrentBinding:()=>p.binding})
  const op={op:relation.op,people:[{id:'p-01'},{id:'p-02'}],links:[{from:'p-01',to:'p-03'}]}
  const submit=value=>tx.submit({sequence:1,through:16,done:true,beats:[{at:1,ops:[value]}]})
  const malformed=submit({...op,people:[]});assert.equal(malformed.accepted,0);assert.equal(calls,0)
  const rejected=submit(op);assert.equal(rejected.accepted,0);assert.equal(calls,1,JSON.stringify(rejected))
  assert.equal(rejected.errors[0].code,'INVALID_ARGUMENT');assert.match(rejected.errors[0].path,/\.links\[0\]\.to$/)
  assert.equal(rejected.errors[0].message,'Unknown node p-03; use one of p-01, p-02.');assert.equal(rejected.errors[0].retryable,true)
  const repaired=submit({...op,links:[{from:'p-01',to:'p-02'}]});assert.equal(repaired.accepted,1);assert.equal(repaired.ok,true)
  assert.equal(tx.effect().entries.flatMap(entry=>entry.ops).length,1)
})

test('maximum compound inputs fit the existing correction store at the intense shared cap',async t=>{
  const people=Array.from({length:8},(_,i)=>({id:'p'+i+'x'.repeat(29),name:'名'.repeat(32)}))
  const links=Array.from({length:12},(_,i)=>({from:people[i%8].id,to:people[(i+1)%8].id,label:'关系'.repeat(12)}))
  for(const [commandId,params] of [['count',{from:60,label:'倒'.repeat(96)}],['relate',{people,links,heading:'图'.repeat(96)}]]) {
    const h=await fixture(t);await h.enable()
    await h.library.saveModSettings({modId,values:{intensity:'intense'},expectedRevision:h.library.snapshot().revision})
    const active=await h.host.prepare(input)
    for(let i=0;i<12;i++) {
      const result=await h.host.command(active,{modId,commandId,params},{key:'max-'+i,at:i+1})
      assert.equal(result.ok,true,JSON.stringify(result))
    }
    assert.equal(h.store.performances.length,12)
  }
})

test('installed textcard validator rejects semantic mistakes before acceptance and executes only the repaired relation',async t=>{
  const h=await fixture(t);await h.enable()
  const active=await h.host.prepare(input),p=await prepared(active)
  let tx
  const submit=op=>tx.submit({sequence:1,through:16,done:true,beats:[{at:1,ops:[op]}]})
  for(const op of [
    {op:'text.show',preset:'punct',text:'x'.repeat(13)},
    {op:'mod.dsh.textcard.sequence',kind:'signal',words:['x'.repeat(25)]},
    {op:'mod.dsh.textcard.relate',...examples.relate,links:[{from:'p-02',to:'p-03',label:'trust'}]},
  ]) {
    tx=createAssetPackTransaction({prepared:p,validateModCommand:active.validateCommand,getCurrentBinding:()=>p.binding})
    const rejected=submit(op)
    assert.equal(rejected.accepted,0,JSON.stringify(rejected))
    assert.equal(rejected.errors[0].code,'INVALID_ARGUMENT')
    assert.equal(rejected.errors[0].retryable,true)
    assert.equal(h.store,undefined)
    if(op.op.endsWith('.relate')) {
      assert.match(rejected.errors[0].path,/\.links\[0\]\.to$/)
      assert.equal(rejected.errors[0].message,'Unknown node p-03; use one of p-01, p-02.')
    }
  }
  const repaired=submit({op:'mod.dsh.textcard.relate',...examples.relate})
  assert.equal(repaired.ok,true,JSON.stringify(repaired));assert.equal(repaired.accepted,1)
  await h.host.command(active,{modId,commandId:'relate',params:examples.relate},{key:'repaired',at:1})
  assert.equal(h.store.performances.length,1)
  assert.equal(h.store.performances[0].kind,'dsh.textcard.compound')
  assert.deepEqual(h.store.performances[0].payload.graph.links,examples.relate.links)
})
