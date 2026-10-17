// private fork (rename-mod, owner 2026-10): the user-facing widget term is 模组 (display text only; ids stay widgets).
// private fork: sprite/avatar variant labels use the owner term chafen.
// private fork: 舞台设置 page and character modal (docs/fork/card-centric-ux.md), synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {syntheticPack,PACK_ID,FIGURE_ID,OTHER_PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {searchPackFigures} from '../tavern-plugin/lib/domain/figure-search.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {CORE_TIME_PARAMS} from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-time.js'
import {stageSource} from './harness/card-centric-stage.mjs'
import {createReadingPresetStore} from '../tavern-plugin/packages/dsh-tts/src/reading-presets.js'

const {source,picker}=await stageSource()
const MOODS=[{id:'joy',label:'喜悦',color:'#e0932a'},{id:'shy',label:'害羞',color:'#1fa5b8'}]
const button=(tree,label)=>walk(tree).find(n=>n.type==='button'&&text(n)===label)
const byLabel=(tree,label)=>walk(tree).find(n=>n.props['aria-label']===label)
const clone=v=>JSON.parse(JSON.stringify(v))
const OWN='55555555-5555-4555-8555-555555555555'

function factory(r,extra={},seed={}){
  const session=new Map(),storage=new Map(Object.entries(seed)) // private fork (pack row previews): seeded localStorage
  const context={TextEncoder,setTimeout,clearTimeout,setInterval,clearInterval,Date,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k)},
    document:{activeElement:null,addEventListener(){},removeEventListener(){}}}
  vm.runInNewContext(source+';this.create=createForkAssetPackUI;',context)
  context.React=r.React;vm.runInNewContext(picker,context)
  const views=context.create(r.React,{VoicePicker:context.ForkBubbleLibraryPicker,AvatarImage:p=>r.React.createElement('img',p),
    emotions:{moods:MOODS,palette:['#111111','#222222','#333333'],max:8,upsert:(list,v)=>[...list,{id:'c00001',label:v.label.trim(),note:v.note||''}]},...extra})
  return {views,session,storage}
}
async function setup(t,{extension,packs,tts,prepareImage,extra,global,seed,mods}={}){
  const r=assetRenderer();t.after(()=>r.dispose())
  const pack=await syntheticPack(),snapshot={...pack,revision:'pack-r1'}
  const state={extension:extension===undefined?{schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID]},stage:{}}:extension,revision:1}
  let engine={values:defaultAssetEngineSettings(),revision:'e1',writable:true}
  const calls=[],packList=packs||[snapshot]
  const reply=()=>({path:'cards/c.json',...(mods?{cardId:'card-1'}:{}),revision:'card-r'+state.revision,extension:clone(state.extension),effectiveStage:{}})
  const binding={tts,download(){},globalEnabledPackIds:global||[],
    service:{apiVersion:2,capabilities:['packs','figures'],subscribe:()=>()=>{},listPackSummaries:async()=>packList,getPackSnapshot:async({packId})=>packList.find(p=>p.manifest.id===packId),
      putBlob:async a=>{calls.push(['putBlob',a]);return {snapshot:{...packList[0],revision:'p2'},hash:'b'.repeat(64)}},
      createSimpleSprite:async a=>{calls.push(['createSimpleSprite',a]);return {snapshot:{...packList[0],revision:'p3'},sprite:{manifestKey:a.spriteKey,assets:{'assets/default.png':'b'.repeat(64)}}}},
      createFigure:async a=>{calls.push(['createFigure',a]);return {snapshot:{...packList[0],revision:'p4'},figureId:'66666666-6666-4666-8666-666666666666'}}},
    rpc:async(method,args)=>{calls.push([method,clone(args||{})])
      if(method==='getCardAssetBindings')return reply()
      if(method==='saveCardAssetBindings'){assert.equal(args.expectedRevision,'card-r'+state.revision);state.extension={...(state.extension||{schemaVersion:1}),...clone(args.patch)};state.revision++;return reply()}
      if(method==='getAssetEngineSettings')return clone(engine)
      if(method==='saveAssetEngineSettings'){assert.equal(args.expectedRevision,engine.revision);engine={...engine,revision:engine.revision+'x',values:{...engine.values,stageToggles:{...engine.values.stageToggles,...args.patch.stageToggles}}};return clone(engine)}
      if(method==='getAssetVoiceServices')return {services:[{id:'local',kind:'reference-api',capabilities:{voiceKinds:['reference'],paid:false}}]}
      if(method==='getCardOpeningScenes')return clone(OPENINGS)
      if(method==='getAssetPackDependencies')return {available:true,count:2,cards:[{path:'cards/c.json'},{path:'cards/other.json'}]}
      throw new Error(method)}}
  if(mods)binding.engineRpc=async(method,args)=>{calls.push([method,clone(args||{})]);
    if(method==='listMods')return {revision:'mods-r1',mods:clone(mods)};
    if(method==='setModScope'){assert.equal(args.expectedRevision,'mods-r1');mods.find(row=>row.id===args.modId).scope=args.scope;return {revision:'mods-r2'};}
    throw new Error(method)};
  const f=factory(r,{...(prepareImage?{prepareImage}:{}),...extra},seed),opened=[]
  const nav={openTab:async type=>opened.push(type),openLibrary:async target=>opened.push(target)}
  const props={binding,ready:true,sessionId:'s',path:'cards/c.json',cardName:'Card',nav,renderGlobal:()=>'GLOBAL',renderDebug:()=>'DEBUG',onEngine(){}}
  r.render(f.views.StagePage,props)
  return {r,f,state,calls,binding,opened,props,tree:await r.settle()}
}
// private fork (docs/fork/reading-dictionary.md, owner 2026-10): the 读音词典 left 舞台设置; the global editor (配音 page)
// shows the active preset as a windowed list and saves one row per edit (editReading), never the whole list.
test('private fork: 舞台设置 has no 读音词典; the global editor windows 5,000 rows, searches and saves one row per edit',async t=>{
  const page=await setup(t)
  assert.equal(walk(page.tree).some(n=>text(n)==='读音词典'||n.props?.['aria-label']==='添加读音'),false)
  const r=assetRenderer();t.after(()=>r.dispose())
  const store=createReadingPresetStore(),calls=[]
  const imported=await store.importPreset({document:{version:1,kind:'dsh-tts-readings',name:'大',entries:[...Array.from({length:4999},(_,i)=>({forms:'語'+i,reading:'ご'+i})),{forms:'名',reading:'Alice'}]}})
  await store.setActive({id:imported.id})
  const api={readingPresets:()=>store.list(),readingPreset:a=>store.get(a),editReading:a=>store.edit(a),setActiveReadingPreset:a=>store.setActive(a),createReadingPreset:a=>store.create(a)}
  const call=async(method,args={})=>{calls.push([method,clone(args)]);return clone(await api[method](args))}
  const views=factory(r).views;r.render(views.ReadingsEditor,{call})
  let tree=await r.settle()
  const rows=()=>walk(tree).filter(n=>n.props?.role==='row')
  assert.equal(byLabel(tree,'读音').props['aria-rowcount'],5000)
  assert.ok(rows().length>0&&rows().length<=30,'only the rows in view mount: '+rows().length)
  assert.equal(walk(tree).some(n=>n.type==='select'||n.type==='details'),false)
  // The preset menu reads 「大 ⌄」; its ⋯ holds 新建 / 重命名 / 复制 / 导出 / 导入 / 删除…
  byLabel(tree,'预设操作').props.onClick();tree=await r.settle()
  assert.deepEqual(walk(tree).filter(n=>n.props?.role==='menuitem').map(text),['新建','重命名','复制','导出','导入','删除…'])
  byLabel(tree,'预设操作').props.onClick();tree=await r.settle()
  byLabel(tree,'搜索读音').props.onChange({target:{value:'語4998'}});tree=await r.settle()
  assert.equal(rows().length,1);assert.ok(byLabel(tree,'读音 語4998'))
  const before=calls.length
  byLabel(tree,'读音 語4998').props.onChange({target:{value:'ごよん'}});tree=await r.settle()
  assert.equal(calls.length,before,'typing sends nothing')
  byLabel(tree,'读音 語4998').props.onBlur();tree=await r.settle()
  const sent=calls.slice(before)
  assert.deepEqual(sent,[['editReading',{id:sent[0][1].id,expectedRevision:0,op:'set',index:4998,entry:{forms:['語4998'],reading:'ごよん'}}]],'one row, never the list')
  assert.equal((await store.get({})).entries[4998].reading,'ごよん')
  // ⚠ only while the inferred language may be wrong; an explicit language clears it and writes input entries only.
  byLabel(tree,'搜索读音').props.onChange({target:{value:'Alice'}});tree=await r.settle()
  const warned=walk(tree).filter(n=>n.type==='button'&&String(n.props.className).includes('ap-reading-lang is-warn'))
  assert.equal(warned.length,1);assert.match(warned[0].props.title,/^⚠ /)
  warned[0].props.onClick();tree=await r.settle()
  walk(tree).find(n=>n.props.role==='menuitemradio'&&text(n)==='英语').props.onClick();tree=await r.settle()
  assert.deepEqual(calls.at(-1)[1].entry,{forms:['名'],reading:'Alice',languageOverride:'en'})
  assert.equal(walk(tree).some(n=>n.type==='button'&&String(n.props.className).includes('is-warn')),false)
  // Add: the dashed ＋ (no text) opens 写法 → 读音; Enter in 读音 adds one row.
  assert.equal(text(byLabel(tree,'添加读音')),'')
  byLabel(tree,'添加读音').props.onClick();tree=await r.settle()
  byLabel(tree,'新写法').props.onChange({target:{value:'見滝原，见泷原'}});tree=await r.settle()
  byLabel(tree,'新读音').props.onChange({target:{value:'みたきはら'}});tree=await r.settle()
  byLabel(tree,'新读音').props.onKeyDown({key:'Enter',preventDefault(){},stopPropagation(){}});tree=await r.settle()
  assert.deepEqual(calls.at(-1),['editReading',{id:calls.at(-1)[1].id,expectedRevision:2,op:'add',entry:{forms:'見滝原，见泷原',reading:'みたきはら'}}])
  assert.equal((await store.get({})).entries.length,5001)
})

const saves=calls=>calls.filter(([m])=>m==='saveCardAssetBindings').map(([,a])=>a)
const CLASSROOM={packId:PACK_ID,kind:'backgrounds',assetId:'classroom'}
const FIGURE_REF={packId:PACK_ID,figureId:FIGURE_ID}
const OPENINGS={lead:FIGURE_REF,greetings:[{id:'primary',key:'0123456789abcdef',preview:'早上好。'},{id:'alternate:0',key:'fedcba9876543210',preview:'晚上好。'}],
  scenes:{primary:{configured:false,background:CLASSROOM,timeOfDay:null,music:null,cast:[{figure:FIGURE_REF,outfitKey:null,emotion:'calm'}]},
    'alternate:0':{configured:true,background:CLASSROOM,timeOfDay:'night',music:null,cast:[]}}}

test('private fork: explicit stage defaults, aliases, unbinding and return intents',()=>{
  const {views}=factory(assetRenderer()),s=views.stage
  const legacy={assetBindings:{boundPackIds:[PACK_ID],characters:{a:{figure:null}}},characters:{a:{name:'A',voiceLanguage:'ja'}}}
  assert.deepEqual(clone(s.stagePatch(legacy,{widgets:false})),{stage:{widgets:false}},'card writes never materialize global switches')
  assert.deepEqual(clone(s.stagePatch({...legacy,stage:{widgets:false,directionStyle:'x'}},{directionStyle:undefined})).stage.widgets,false)
  assert.equal(Object.hasOwn(s.stagePatch({...legacy,stage:{directionStyle:'x'}},{directionStyle:undefined}).stage,'directionStyle'),false,'undefined restores inheritance')
  assert.deepEqual(clone(s.stageActive({dialogue:false,voice:true,stage:true})),{dialogue:false,voice:false,stage:false})
  assert.deepEqual(clone(s.stageEnable('voice')),{dialogue:true,voice:true})
  // private fork: no alias allocator or bindFigurePatch remains on the card surface.
  assert.equal(s.cardAliasFor,undefined);assert.equal(s.bindFigurePatch,undefined)
  assert.deepEqual(clone(s.unbindPatch({assetBindings:{boundPackIds:[PACK_ID,OTHER_PACK_ID]}},PACK_ID)),{assetBindings:{boundPackIds:[OTHER_PACK_ID]}})
  const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}
  // private fork: only the machine service panel consumes return intents; no cast voice editor remains.
  s.writeStageReturn(storage,{label:'返回舞台设置',payload:{cardPath:'cards/c.json'}},1000) // private fork (settings polish): the ‹ label reads 返回舞台设置
  assert.deepEqual(JSON.parse(store.get(s.RETURN_KEY)),{toTab:'dsh-tavern:bubbles',label:'返回舞台设置',payload:{cardPath:'cards/c.json'},createdAt:1000})
})
// private fork: calibration belongs to unchanged own image keys, never a state mapping.
test('simple sprite rewrites keep unchanged calibration and refuse complex manifests',()=>{
  const s=factory(assetRenderer()).views.stage,outfit={enabled:true,sprite:{manifestKey:'k',assets:{'assets/calm.png':'a','assets/joy.png':'b'},avatarCrop:{calm:{x:0,y:0,w:1,h:1},joy:{x:0,y:0,w:1,h:1}}}}
  const manifest={kind:'layered-static-sprites',emotions:{calm:{stage:{src:'assets/calm.png',width:5,height:9}},joy:{stage:{src:'assets/joy.png',width:5,height:9}}}}
  assert.deepEqual(clone(s.simpleSpriteImages(outfit,manifest)),{calm:{hash:'a',width:5,height:9},joy:{hash:'b',width:5,height:9}})
  assert.equal(s.simpleSpriteImages(outfit,{...manifest,mouthAtlas:{}}),null)
  const next=s.replaceOutfitSprite(outfit,{manifestKey:'k2',assets:{}},{calm:{},joy:{}},'joy')
  assert.deepEqual(clone(next.sprite),{manifestKey:'k2',assets:{},avatarCrop:{calm:{x:0,y:0,w:1,h:1}}})
  assert.equal(s.emotionSlot({outfits:[{...outfit,avatars:{shy:'c'}}]},{k:manifest},'shy').hash,'c')
  assert.equal(s.emotionSlot({outfits:[outfit]},{k:manifest},'joy').hash,'b');assert.equal(s.emotionSlot({outfits:[outfit]},{k:manifest},'anger'),null)
})
test('a card without stage settings shows one first-run action that writes explicit defaults',async t=>{
  const f=await setup(t,{extension:null});assert.match(text(f.tree),/这张卡还没有舞台设置/);assert.equal(walk(f.tree).filter(n=>n.props.className==='ap-primary').length,1)
  // private fork (B2 O05): the first-run action names the stage it enables.
  await button(f.tree,'启用舞台（对话气泡）').props.onClick();const tree=await f.r.settle()
  assert.deepEqual(saves(f.calls)[0].patch,{assetBindings:{boundPackIds:[]},stage:{}})
  // private fork (packs-v3): the section is 「当前素材包」 with a 「管理」 button.
  assert.match(text(tree),/素材包 \d+/);assert.doesNotMatch(text(tree),/当前素材包|导入导出/) // private fork (pack section merge): one 「素材包 N」 section
  assert.ok(byLabel(tree,'添加角色') === undefined, 'private fork: new figures are authored in the library')
})
// private fork: no grey helper text — switches are icon + name; an unmet dependency greys and disables the switch
// and only then carries a 「?」 naming the missing upstream switch.
test('switches save at once; a dependent switch is disabled with a ? naming what it needs',async t=>{
  const f=await setup(t);let tree=f.tree
  // private fork (owner 2026-10 r3): no 「双语配音」 switch (a figure's voice language decides); the sounds in 基础设置
  // need 舞台模式.
  assert.equal(walk(tree).some(n=>n.props['aria-label']==='双语配音'),false)
  assert.equal(walk(tree).some(n=>/ap-switch-note|ap-note-muted/.test(n.props.className||'')),false,'no grey subtitles')
  byLabel(tree,'舞台模式').props.onChange({target:{checked:false}});tree=await f.r.settle()
  assert.deepEqual(f.calls.filter(([m])=>m==='saveAssetEngineSettings').at(-1)[1].patch,{stageToggles:{stage:false}})
  assert.equal(byLabel(tree,'BGM').props.disabled,true);assert.equal(byLabel(tree,'BGM 说明').props['aria-label'],'BGM 说明')
  assert.ok(walk(tree).filter(n=>n.props.role==='tooltip').some(n=>/^需要舞台模式$/.test(text(n)))) // private fork (stage panel): 基础设置 has its own (?) first
  byLabel(tree,'配音').props.onChange({target:{checked:true}});tree=await f.r.settle()
  assert.deepEqual(f.calls.filter(([m])=>m==='saveAssetEngineSettings').at(-1)[1].patch,{stageToggles:{voice:true}})
  assert.equal(saves(f.calls).length,0)
  assert.ok(button(tree,'保存') === undefined)
})
// private fork: no grey helper text — pack rows show name + one item count (no UUID); cast rows show icon chips
// (figure source, voice, language) with the details in tooltips, and no raw alias even in advanced mode.
// private fork (packs-v3): the shared pack row: title · users · count · read-only state tag.
// private fork (owner 2026-10 v3.1, UI comment 9–10): 当前素材包 rows are title + faces + a short state tag (本卡 / 全局);
// no item count and no card count.
test('pack rows and cast rows use icons instead of grey text, without ids or aliases',async t=>{
  const f=await setup(t),tree=f.tree
  const row=walk(packSection(tree)).find(n=>n.type==='li'&&n.props.className==='ap-pack-row is-openable is-compact') // private fork (rename-mod): 模组 precedes 素材包, so pack rows are read inside the 素材包 section
  assert.equal(walk(row).some(n=>n.type==='code'||/ap-alias/.test(n.props.className||'')),false,'no pack UUID')
  assert.doesNotMatch(text(row),new RegExp(PACK_ID));assert.equal(walk(row).some(n=>n.props.title===PACK_ID),false,'no ID tooltip')
  assert.equal(walk(row).some(n=>/ap-pack-count|ap-pack-cards/.test(n.props.className||'')),false,'no item / card counts')
  // private fork (stage panel, owner 2026-10): 素材包 rows end with the same state chip as 模组 rows (opens the menu).
  // private fork (UI standard chips, owner 2026-10): the one chip is the text-only PackStateTag.
  const statePill=walk(row).find(n=>n.type==='button'&&n.props.className==='ap-state-tag')
  assert.equal(text(statePill),'本卡');assert.equal(statePill.props['data-state'],'card');assert.equal(statePill.props['aria-haspopup'],'menu')
  // private fork (pack row previews, owner 2026-10): the row previews what the pack holds instead of the card's faces.
  assert.ok(walk(row).find(n=>n.props.className==='ap-pack-previews'),'content previews after the name')
  assert.equal(walk(row).some(n=>n.props.className==='ap-pack-users'),false,'no card faces in 舞台设置')
  // private fork (stage setup wizard, owner 2026-10-15): no 人物 section (figures are edited in the 素材库 / 设置向导).
  assert.equal(walk(tree).some(n=>/ap-cast-row|ap-cast-badge/.test(n.props.className||'')),false)
  assert.equal(walk(tree).some(n=>n.type==='p'&&/每种差分的图片在角色窗口/.test(text(n))),false,'emotion note only behind ?')
  assert.equal(walk(tree).some(n=>/ap-note-muted|ap-switch-note|ap-avatar-note/.test(n.props.className||'')),false)
})
// private fork (owner 2026-10 r5): pack rows stack only real faces — a figure without any picture is named in the
// tooltip, never drawn as a blank disc. private fork (owner 2026-10 v3.1): avatars, sprites and Live2D are separate
// assets — a Live2D-only figure without an avatar shows the silhouette (no Live2D snapshot stands in for it) and no
// face in the pack row. private fork (owner 2026-10 v3.1 r2): the 管理 rows have no count cells any more.
test('pack rows draw only real faces; a Live2D-only figure is a silhouette, never a snapshot',async t=>{
  const pack=await syntheticPack(),faceless=structuredClone(pack);faceless.revision='pack-r1'
  faceless.figures[FIGURE_ID].outfits=[{key:'plain',label:'Plain',enabled:true}]
  const f=await setup(t,{packs:[faceless]}),row=walk(packSection(f.tree)).find(n=>n.type==='li'&&/^ap-pack-row/.test(n.props.className||'')) // private fork (rename-mod): 模组 precedes 素材包, so pack rows are read inside the 素材包 section
  // private fork (pack row previews, owner 2026-10): a figure without a calm avatar is skipped in the previews, no placeholder.
  const strip=walk(row).find(n=>n.props.className==='ap-pack-previews')
  assert.match(strip.props.title,/^人物、/);assert.equal(walk(strip).some(n=>/is-faces|ap-avatar|ap-figure-silhouette/.test(n.props.className||'')),false,'no placeholder disc')
  const managed=await manage(f),managedRow=walk(managed).find(n=>n.type==='li'&&n.props.className==='ap-pack-row is-openable')
  assert.equal(walk(managedRow).some(n=>/ap-pack-cards|ap-pack-count/.test(n.props.className||'')),false,'no card / item count cells')
  const live=structuredClone(pack);live.revision='pack-r1'
  live.figures[FIGURE_ID].outfits=[{key:'casual',label:'Casual',enabled:true,live2d:{bundleKey:'casual',emotionMap:{}}}]
  const frames=[],kit={snapshots:{peek:()=>({}),request:async(source,names,frame)=>{frames.push(frame);return {'':'data:image/webp;base64,AAAA'}}}}
  const g=await setup(t,{packs:[live],extra:{live2d:kit}})
  g.r.render(g.f.views.StagePage,{...g.props,binding:{...g.binding,service:{...g.binding.service,leaseBundle:async()=>({url:'/bundle',ticket:'t'})}}})
  let tree=await g.r.settle();tree=await g.r.settle()
  // private fork (stage setup wizard, owner 2026-10-15): no 人物 section; the page still takes no Live2D snapshot.
  assert.equal(frames.length,0,'no snapshot is taken')
  const face=walk(walk(packSection(tree)).find(n=>n.type==='li'&&/^ap-pack-row/.test(n.props.className||''))).find(n=>/ap-avatar is-mini/.test(n.props.className||'')) // private fork (rename-mod): 模组 precedes 素材包, so pack rows are read inside the 素材包 section
  assert.equal(face,undefined,'no stand-in face in the pack row')
})
// private fork (pack row previews, owner 2026-10): every 素材包 row previews the pack's content right after its name, in a
// fixed order — the default outfit's calm avatar per figure, then pictures, then one icon per audio kind and the other
// kinds; the kind names are the tooltip, no counts. A tiny picture already made (content-addressed, localStorage) paints
// at once on a warm open.
test('pack rows preview the pack content: faces, pictures, kind icons; warm pictures paint at once',async t=>{
  const pack=await syntheticPack(),face=pack.figures[FIGURE_ID].outfits[0].avatars.calm,day=pack.manifest.assets.find(a=>a.kind==='backgrounds'&&a.id==='classroom').variants.entries[0].content.media
  const seed={['dsh-tavern:pack-tiny:v1:'+face+'|face']:'data:image/webp;base64,RkFDRQ==',['dsh-tavern:pack-tiny:v1:'+day+'|wide']:'data:image/webp;base64,REFZ'}
  const f=await setup(t,{seed}),row=walk(packSection(f.tree)).find(n=>n.type==='li'&&/^ap-pack-row/.test(n.props.className||'')) // private fork (rename-mod): 模组 precedes 素材包, so pack rows are read inside the 素材包 section
  const strip=walk(row).find(n=>n.props.className==='ap-pack-previews')
  assert.equal(strip.props.title,'人物、背景、音乐、音效、环境音、配音、滤镜、模组')
  assert.deepEqual(walk(strip).filter(n=>/^ap-pv-group/.test(n.props.className||'')).map(n=>n.props.className),['ap-pv-group is-faces','ap-pv-group is-pictures','ap-pv-group is-icons'])
  const images=walk(strip).filter(n=>n.type==='img')
  assert.deepEqual(images.map(n=>n.props.src),['data:image/webp;base64,RkFDRQ==','data:image/webp;base64,REFZ'],'the calm avatar, then the background')
  assert.ok(images.every(n=>n.props.decoding==='async'&&n.props.loading==='lazy'))
  assert.equal(walk(strip).filter(n=>n.type==='svg').length,6,'音乐 · 音效 · 环境音 · 配音 · 滤镜 · 模组, one icon each')
  assert.doesNotMatch(text(strip),/\d/,'no counters')
})
// Installed mod switches are global; legacy widget packs remain export data, not mod registry rows.
const packSection=tree=>walk(tree).find(n=>n.type==='section'&&/ap-pack-section/.test(n.props.className||''))
const widgetSection=tree=>walk(tree).find(n=>n.type==='section'&&/ap-widget-section/.test(n.props.className||''))
async function phonePack(){
  const phone=await syntheticPack();phone.revision='phone-r1'
  phone.manifest={...phone.manifest,id:OTHER_PACK_ID,name:'通用模组',figures:[],assets:[{...phone.manifest.assets.find(a=>a.kind==='widgets'),id:'phone',name:'手机'}]}
  phone.figures={};phone.widgets={phone:phone.widgets.clock}
  return phone
}
test('private fork: registry mods sit between basic settings and packs and switch globally',async t=>{
  const f=await setup(t,{mods:[{id:'fixture.phone',name:'Phone',scope:'off',authorized:true}],extension:{schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID]},stage:{}}})
  let tree=f.tree
  const sections=walk(tree).filter(n=>n.type==='section'),titles=sections.map(n=>text(walk(n).find(c=>c.props.className==='ap-section-title')))
  assert.equal(titles.indexOf('模组'),titles.indexOf('基础设置')+1)
  assert.equal(titles.indexOf('素材包'),titles.indexOf('模组')+1)
  assert.equal(walk(sections.find(n=>text(n).startsWith('基础设置'))).some(n=>n.props['aria-label']==='Phone'),false)
  assert.equal(text(walk(widgetSection(tree)).find(n=>n.props.className==='ap-section-meta')),'1')
  assert.ok(byLabel(widgetSection(tree),'Phone 设置'))
  byLabel(widgetSection(tree),'Phone').props.onChange({target:{checked:true}})
  for(let i=0;i<3;i++)tree=await f.r.settle()
  assert.deepEqual(f.calls.filter(([method])=>method==='setModScope'),[['setModScope',{modId:'fixture.phone',scope:'global',expectedRevision:'mods-r1'}]])
  assert.equal(saves(f.calls).length,0,'mod switches never write the card or its widget gate')
  assert.deepEqual(f.state.extension.assetBindings.boundPackIds,[PACK_ID])
  assert.deepEqual(f.state.extension.stage,{})
})
test('private fork: widget packs do not inflate the installed mod count or expose per-card enable chips',async t=>{
  const mine=await syntheticPack(),phone=await phonePack();mine.revision='pack-r1'
  const f=await setup(t,{mods:[],packs:[mine,phone],extension:{schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID,OTHER_PACK_ID]},stage:{widgets:true}}})
  const section=widgetSection(f.tree)
  assert.equal(text(walk(section).find(n=>n.props.className==='ap-section-meta')),'0')
  assert.match(text(section),/没有安装模组/)
  assert.equal(walk(section).some(n=>n.props['data-state']||n.props.role==='switch'),false)
  assert.equal(saves(f.calls).length,0)
  assert.deepEqual(f.state.extension.assetBindings.boundPackIds,[PACK_ID,OTHER_PACK_ID])
})
test('private fork: card export preserves a bound legacy widget-only pack without exposing its enable controls',async t=>{
  const mine=await syntheticPack(),phone=await phonePack();mine.revision='pack-r1'
  const f=await setup(t,{mods:[],packs:[mine,phone],extension:{schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID,OTHER_PACK_ID]},stage:{widgets:true}}}),exports=[]
  f.binding.service.exportCardBundle=async a=>{exports.push(clone(a));return {bytes:new Uint8Array(),filename:'c.zip'}}
  let tree=f.tree
  headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  assert.equal(walk(tree).some(n=>n.props.role==='checkbox'&&n.props['aria-label']==='通用模组'),false)
  await headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  assert.deepEqual(exports[0].packIds,[PACK_ID,OTHER_PACK_ID])
  assert.equal(saves(f.calls).length,0)
})
// private fork (engine ui r2, owner 2026-10): 引擎设置 is the last row of 基础设置 in 高级 mode (a page row: icon, name, ›, no switch);
// there is no 全局设置 section any more, and 基础 mode has no entry.
// private fork (settings polish, owner 2026-10): 基础设置 ends with 「舞台模型」 in 基础 and 高级 — its quiet › opens 引擎设置 (the
// separate 引擎设置 row is gone) and its menu reads 跟随后台 while unset.
// private fork (engine row, owner 2026-10): the row is 「舞台引擎」 like the page it opens (name and ›), its menu is 「模型」, and
// the separate 智能判断 row is gone (a section of that page).
// private fork (stage mode entry, owner 2026-10): no 「舞台引擎」 row and no model menu on 基础设置 any more — 「舞台模式」 has
// the › (like 配音) that opens the page (now titled 舞台模式), where the director model is chosen.
test('private fork: 舞台模式 carries the › to the stage mode page; no engine row or model menu',async t=>{
  const f=await setup(t);let opened=0
  {
    f.r.render(f.f.views.StagePage,{...f.props,onEngine:()=>opened++});const tree=await f.r.settle()
    const sections=walk(tree).filter(n=>n.type==='section'),basic=sections.find(n=>text(n).startsWith('基础设置'))
    assert.equal(walk(basic).some(n=>/ap-model-row/.test(n.props?.className||'')||/^舞台引擎/.test(text(n))),false,'no 舞台引擎 row')
    assert.equal(walk(basic).some(n=>/^模型：/.test(n.props?.['aria-label']||'')),false,'no model menu on 基础设置')
    assert.equal(walk(basic).some(n=>/ap-judge-row/.test(n.props?.className||'')||/^智能判断/.test(n.props?.['aria-label']||'')),false,'no 智能判断 row')
    // P4 wizard completion exposes all global audio/stage switches in basic settings.
    assert.ok(walk(basic).some(n=>n.props['aria-label']==='基础设置 说明'),'(?) beside 基础设置')
    for(const name of ['对话气泡','配音','舞台模式'])assert.ok(byLabel(basic,name),name)
    for(const name of ['BGM','音效','环境音'])assert.ok(byLabel(basic,name),name+' is visible in basic settings')
    assert.equal(sections.some(n=>text(n).startsWith('全局设置')),false,'no 全局设置 section')
    const row=walk(basic).find(n=>/ap-switch-row/.test(n.props?.className||'')&&walk(n).some(m=>m.props?.['aria-label']==='舞台模式设置'))
    assert.ok(row&&/is-openable/.test(row.props.className),'舞台模式 is an openable row')
    walk(row).find(n=>n.type==='button'&&n.props['aria-label']==='舞台模式设置').props.onClick()
  }
  assert.equal(opened,1)
})// private fork (section collapse, owner 2026-10): every first-level heading folds its section; the (?) and the head actions
// stay outside the toggle; the folded state is remembered in the panel's localStorage preferences; expanded by default.
test('private fork: section headings fold their sections, remembered across reopenings; actions never fold',async t=>{
  const f=await setup(t)
  const toggle=(tree,title)=>walk(tree).find(n=>n.type==='button'&&n.props.className==='ap-section-toggle'&&text(n).startsWith(title))
  const section=(tree,title)=>walk(tree).find(n=>n.type==='section'&&walk(n).includes(toggle(tree,title)))
  const body=(tree,title)=>section(tree,title).children.find(n=>n.props.className==='ap-section-body')
  for(const title of ['基础设置','素材包']){ // private fork (stage setup wizard): no 人物 section
    const button=toggle(f.tree,title);assert.ok(button,title+' heading is a toggle')
    assert.equal(button.props['aria-expanded'],true,title+' starts expanded');assert.equal(body(f.tree,title).props.hidden,undefined)
    assert.equal(button.props['aria-controls'],body(f.tree,title).props.id)
  }
  const packs=toggle(f.tree,'素材包')
  assert.equal(walk(packs).some(n=>n.type==='HelpTip'||String(n.props.className||'').includes('ap-manage')),false,'(?) and 管理 sit outside the toggle')
  assert.ok(walk(packs).some(n=>n.props.className==='ap-section-meta'),'the count is part of the title')
  packs.props.onClick();let tree=await f.r.settle()
  assert.equal(toggle(tree,'素材包').props['aria-expanded'],false);assert.equal(body(tree,'素材包').props.hidden,true)
  assert.equal(section(tree,'素材包').props['data-folded'],true)
  assert.ok(walk(section(tree,'素材包')).some(n=>n.props.className==='ap-section-meta'),'the count stays when folded')
  assert.deepEqual(JSON.parse(f.f.storage.get('dsh-tavern:stage-panel-folded')),{'素材包':true})
  assert.equal(toggle(tree,'基础设置').props['aria-expanded'],true,'other sections are untouched')
  // Reopening the page keeps the fold; 管理 in the folded head still works and unfolds the section.
  f.r.render(f.f.views.StagePage,{...f.props,key:'reopened'});tree=await f.r.settle()
  assert.equal(toggle(tree,'素材包').props['aria-expanded'],false,'remembered across reopenings')
  button(tree,'管理').props.onClick();tree=await f.r.settle()
  assert.equal(toggle(tree,'素材包').props['aria-expanded'],true,'管理 reveals the section');assert.ok(button(tree,'完成'))
  toggle(tree,'素材包').props.onClick();tree=await f.r.settle()
  assert.equal(JSON.parse(f.f.storage.get('dsh-tavern:stage-panel-folded'))['素材包'],true)
})
test('the panel never shrinks below its content inside the host flex-column tab (one surface for the whole page)',async()=>{
  const {readFile}=await import('node:fs/promises')
  const css=await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css',import.meta.url),'utf8')
  const rule=css.match(/\n\.ap-ui \{[^}]*\}/)[0];assert.match(rule,/min-height: 100%;/);assert.match(rule,/flex-shrink: 0;/)
  assert.doesNotMatch(css,/\.ap-hint-line \{[^}]*border-left/,'action hints are not indented grey notes')
})
// private fork: the old modal contract is replaced, not kept behind an optional toggle.
// private fork (packs-v3): 「管理」 grows the section in place; the state pill's 关闭 warns about affected characters in the
// menu, and only then asks before clearing their figures in the same write. No undo anywhere.
const manage=async f=>{button(f.tree,'管理').props.onClick();return f.r.settle()}
// private fork (owner 2026-10 global-first): 当前素材包 and the cast list 全局 (blue) rows before 本卡 (green) rows,
// whatever the binding order; 管理 keeps 全局 → 本卡 → 关闭.
test('当前素材包 lists 全局 packs before 本卡 packs',async t=>{
  const pack=await syntheticPack(),mine={...pack,revision:'pack-r1'},shared=structuredClone(mine)
  shared.manifest={...shared.manifest,id:OTHER_PACK_ID,name:'Global pack'};shared.figures[FIGURE_ID]={...shared.figures[FIGURE_ID],name:'Global figure'}
  const f=await setup(t,{packs:[mine,shared],global:[OTHER_PACK_ID],extension:{schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID,OTHER_PACK_ID]},stage:{}}})
  const list=walk(f.tree).find(n=>n.type==='ul'&&n.props['aria-label']==='当前素材包')
  const rows=walk(list).filter(n=>n.type==='li')
  assert.deepEqual(rows.map(n=>n.props['data-state']),['global','card'])
  assert.deepEqual(rows.map(n=>text(walk(n).find(m=>m.props.className==='ap-pack-name'))),['Global pack','Synthetic pack'])
  // private fork (stage setup wizard, owner 2026-10-15): the 人物 list left 舞台设置.
  assert.equal(walk(f.tree).some(n=>n.props.className==='ap-cast-row'),false)
  const managed=await manage(f)
  assert.deepEqual(walk(packSection(managed)).filter(n=>n.type==='li'&&/^ap-pack-row/.test(n.props.className||'')).map(n=>n.props['data-state']),['global','card']) // private fork (widgets section): 素材包 rows only
})
const pill=(tree,name)=>walk(tree).find(n=>n.type==='button'&&n.props.className==='ap-state-tag'&&String(n.props['aria-label']).startsWith(name+'：'))
const stateMenu=async(f,tree,name)=>{pill(tree,name).props.onClick();const next=await f.r.settle();return {tree:next,items:walk(next).filter(n=>n.props.role==='menuitemradio')}}
test('private fork: withdrawing a pack confirms affected figures and writes only package permission',async t=>{
  const f=await setup(t),name=(await syntheticPack()).manifest.name;let tree=await manage(f)
  assert.equal(text(button(tree,'完成')),'完成','管理 becomes 完成')
  let menu=await stateMenu(f,tree,name);tree=menu.tree
  // private fork (owner 2026-10 v3.1): short state labels 本卡 / 全局.
  // private fork (owner 2026-10 global-first): 全局, 本卡, 关闭.
  assert.deepEqual(menu.items.map(n=>n.props['aria-label']),['全局','本卡','关闭（Synthetic figure 将失去形象）'])
  assert.equal(menu.items.find(n=>n.props['aria-checked']).props['data-state'],'card')
  menu.items.find(n=>n.props['data-state']==='off').props.onClick();tree=await f.r.settle()
  const dialog=walk(tree).find(n=>n.props.role==='dialog')
  assert.match(text(dialog),/Synthetic figure 的形象来自这个素材包/)
  assert.equal(saves(f.calls).length,0)
  await button(dialog,'关闭').props.onClick();tree=await f.r.settle()
  assert.deepEqual(saves(f.calls).at(-1).patch,{assetBindings:{boundPackIds:[]}})
  assert.match(text(tree),/完成/,'still managing; the row stays in its frozen group');assert.ok(button(tree,'撤销') === undefined, 'no undo')
})
// private fork (packs-v3): every transition writes exactly the existing fields (card binding through the writer, the
// cross-card flag through setGlobalEnabled); a binding may sit under 全局启用.
test('state transitions write only the card binding and the global flag, with no confirmation without figures',async t=>{
  const ext={schemaVersion:1,assetBindings:{boundPackIds:[]},stage:{}}
  const empty=await syntheticPack();empty.manifest.figures=[];empty.figures={}
  const f=await setup(t,{extension:ext,packs:[empty]}),name=empty.manifest.name,global=[]
  f.binding.setGlobalEnabled=async(id,on)=>{f.calls.push(['global',id,on]);if(on)global.push(id);else global.splice(global.indexOf(id),1)}
  Object.defineProperty(f.binding,'globalEnabledPackIds',{get:()=>[...global]})
  let tree=await manage(f);const step=async label=>{const menu=await stateMenu(f,tree,name);menu.items.find(n=>n.props['aria-label']===label).props.onClick();for(let i=0;i<2;i++)tree=await f.r.settle()}
  const log=()=>f.calls.filter(([m])=>m==='global'||m==='saveCardAssetBindings').map(([m,a,b])=>m==='global'?'global:'+b:'bind:'+a.patch.assetBindings.boundPackIds.join())
  // private fork (owner 2026-10 v3.1): short state labels 本卡 / 全局.
  await step('本卡');assert.deepEqual(log(),['bind:'+PACK_ID])
  await step('全局');assert.deepEqual(log().slice(1),['global:true'],'binding kept under global')
  assert.equal(text(pill(tree,name)).trim(),'全局')
  await step('本卡');assert.deepEqual(log().slice(2),['global:false'],'already bound: only the flag')
  await step('全局');assert.deepEqual(log().slice(3),['global:true'])
  await step('关闭');assert.deepEqual(new Set(log().slice(4)),new Set(['bind:','global:false']),'global → 关闭 unbinds and clears the flag')
  assert.equal(walk(tree).some(n=>n.props.role==='dialog'),false,'no figures → no confirmation')
  await step('全局');assert.deepEqual(log().slice(6),['global:true'],'关闭 → 全局 never binds')
})
// private fork (packs-v3): a card only binds packs; there is no own pack, no 本卡 owner mark and no adopt/release.
test('bound pack rows carry no ownership: a plain state tag, three plain states, no owner menu',async t=>{
  const f=await setup(t);let tree=f.tree,name=(await syntheticPack()).manifest.name
  const rows=walk(packSection(tree)).filter(n=>n.type==='li'&&/^ap-pack-row/.test(n.props.className||''));assert.equal(rows.length,1) // private fork (widgets section): 素材包 rows only
  assert.equal(walk(rows[0]).some(n=>/ap-owner|ap-pill/.test(n.props.className||'')),false);assert.ok(byLabel(tree,'更多操作 '+name) === undefined)
  tree=await manage(f);const menu=await stateMenu(f,tree,name)
  assert.deepEqual(menu.items.map(n=>text(n).replace(/\s+/g,'')),['全局','本卡','关闭'],'private fork (owner 2026-10 global-first)')
})
// private fork (packs-v3): a missing pack offers only 关闭. private fork (owner 2026-10 v3.1 r2): rows show only this card's
// view of a pack — no 「N 张卡」 and no item count, in 当前素材包 and in 管理 alike; the binding counts are never read.
test('pack rows show no counts and a deleted pack can only be switched off',async t=>{
  const ext={schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID,OTHER_PACK_ID]},stage:{}}
  const f=await setup(t,{extension:ext})
  f.r.render(f.f.views.StagePage,{...f.props,binding:f.binding,key:'counts'});let tree=await f.r.settle();f.tree=tree
  let rows=walk(packSection(tree)).filter(n=>n.type==='li'&&/^ap-pack-row/.test(n.props.className||'')) // private fork (rename-mod): 模组 precedes 素材包, so pack rows are read inside the 素材包 section
  assert.equal(walk(rows[0]).some(n=>/ap-pack-cards|ap-pack-count/.test(n.props.className||'')),false)
  // private fork: missing bindings show uninstalled state and one-click removal; an unknown pack reads 「未知素材包」 (UI standard R2:
  // no raw id as a name) and its id is only in the name's tooltip (UI acceptance L12b, 2026-10).
  assert.ok(!text(rows[1]).includes(OTHER_PACK_ID),'no raw id as the name');assert.match(text(rows[1]),/未知素材包/);assert.match(text(rows[1]),/未安装/);assert.ok(walk(rows[1]).some(n=>String(n.props.title||'')===OTHER_PACK_ID),'id in the tooltip')
  tree=await manage(f);rows=walk(packSection(tree)).filter(n=>n.type==='li'&&/^ap-pack-row/.test(n.props.className||'')) // private fork (rename-mod): 模组 precedes 素材包, so pack rows are read inside the 素材包 section
  assert.equal(rows.some(r=>walk(r).some(n=>/ap-pack-cards|ap-pack-count/.test(n.props.className||''))),false,'no count cells in 管理')
  for(const r of rows)assert.doesNotMatch(text(r),/张卡|\d+\s*项/)
  byLabel(tree,'移除 未知素材包').props.onClick();tree=await f.r.settle()
  assert.deepEqual(f.state.extension.assetBindings.boundPackIds,[PACK_ID])
  assert.ok(byLabel(tree,'移除 未知素材包') === undefined)
})
// private fork (pack section merge, owner 2026-10): 当前素材包 and 导入导出 are one 「素材包」 section. Its head is 管理 · 导出 ·
// 导入; each row has a quiet 导出 icon that exports that pack alone, through the 素材库's pack export (exportPack).
test('private fork: private mod config carrier is not a missing public pack',async t=>{
  const ext={schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID,OTHER_PACK_ID]},modConfigPackId:OTHER_PACK_ID,stage:{}}
  const f=await setup(t,{extension:ext})
  const rows=walk(packSection(f.tree)).filter(n=>n.type==='li'&&/^ap-pack-row/.test(n.props.className||''))
  assert.equal(rows.length,1);assert.doesNotMatch(text(packSection(f.tree)),/未安装|缺失的素材包/)
  assert.deepEqual(f.state.extension.assetBindings.boundPackIds,[PACK_ID,OTHER_PACK_ID],'private carrier binding remains intact')
  assert.equal(f.calls.some(([method])=>method==='saveCardAssetBindings'),false)
})
const packHead=tree=>walk(tree).find(n=>n.props.className==='ap-pack-head-actions')
const headButton=(tree,label)=>walk(packHead(tree)).find(n=>n.type==='button'&&text(n)===label)
// private fork (widgets section, owner 2026-10): a row is name, faces and the state tag only — no size, no per-row 导出 icon
// (a single pack is exported from the 素材库 tab); the size shows beside the check in selection mode only.
test('pack rows have no size or row export; selection mode shows the size beside each check',async t=>{
  const f=await setup(t),name=(await syntheticPack()).manifest.name
  let tree=f.tree
  // UI standard §三.20 (acceptance U10): two .ap-manage buttons; 导入 is in the heading's ⋯.
  assert.deepEqual(walk(packHead(tree)).filter(n=>n.type==='button'&&/ap-manage/.test(n.props.className||'')).map(text),['管理','导出'])
  assert.ok(byLabel(packHead(tree),'素材包操作'),'⋯ in the heading')
  const row=()=>walk(walk(tree).find(n=>n.type==='ul'&&n.props['aria-label']==='当前素材包')).find(n=>n.type==='li')
  assert.ok(byLabel(tree,'导出 '+name) === undefined, 'no row export icon')
  assert.equal(walk(row()).some(n=>/ap-pack-size|ap-pack-export/.test(n.props.className||'')),false,'no size outside selection mode')
  headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  const kids=walk(row()).filter(n=>/^ap-pack-(check|size|title)$/.test(n.props.className||'')).map(n=>n.props.className)
  assert.deepEqual(kids,['ap-pack-check','ap-pack-size','ap-pack-title'],'check, size, then the name')
  assert.match(text(walk(row()).find(n=>n.props.className==='ap-pack-size')),/^\d+ KB$|MB$/)
  assert.doesNotMatch(text(tree),/一起导出/)
})
// Header 导出 enters selection mode: house-style checks (本卡 on, 全局 off — the old 「一起导出」 defaults), the head becomes
// 取消 · 导出, and confirming exports the card with exactly the checked packs (none → the card alone), then leaves the mode.
test('selection mode exports the card with exactly the checked packs; none means card only',async t=>{
  const mine=await syntheticPack(),shared=await syntheticPack()
  shared.manifest={...shared.manifest,id:OTHER_PACK_ID,name:'Global pack'}
  const f=await setup(t,{packs:[mine,shared],global:[OTHER_PACK_ID]}),exports=[]
  f.binding.service.exportCardBundle=async a=>{exports.push(clone(a));return {bytes:new Uint8Array(),filename:'c.zip'}}
  const check=(tree,name)=>walk(tree).find(n=>n.type==='button'&&n.props.role==='checkbox'&&n.props['aria-label']===name)
  let tree=f.tree
  assert.equal(check(tree,'Global pack'),undefined,'no checks outside selection mode')
  headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  assert.deepEqual(walk(packHead(tree)).filter(n=>n.type==='button').map(text),['取消','导出'])
  assert.equal(check(tree,'Global pack').props['aria-checked'],false,'global pack listed, unchecked')
  assert.equal(check(tree,mine.manifest.name).props['aria-checked'],true,'card pack checked')
  assert.equal(walk(walk(tree).find(n=>n.type==='section'&&/ap-pack-section/.test(n.props.className||''))).some(n=>n.type==='input'&&n.props.type!=='file'),false,'no native inputs in the section')
  assert.equal(walk(tree).some(n=>/ap-pack-export/.test(n.props.className||'')),false,'no row export while selecting')
  await headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  assert.deepEqual(exports[0],{path:'cards/c.json',expectedRevision:exports[0].expectedRevision,packIds:[PACK_ID]},'default = 本卡 packs')
  assert.equal(check(tree,'Global pack'),undefined,'confirming leaves selection mode')
  headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  check(tree,'Global pack').props.onClick();tree=await f.r.settle()
  await headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  assert.deepEqual(exports[1].packIds,[OTHER_PACK_ID,PACK_ID],'a checked global pack goes along (全局 first)')
  headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  check(tree,mine.manifest.name).props.onClick();tree=await f.r.settle()
  await headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  assert.deepEqual(exports[2].packIds,[],'nothing checked → the card alone')
  headButton(tree,'导出').props.onClick();tree=await f.r.settle()
  headButton(tree,'取消').props.onClick();tree=await f.r.settle()
  assert.equal(check(tree,'Global pack'),undefined,'取消 leaves selection mode');assert.equal(exports.length,3)
  // 导入 keeps the card ZIP flow: a zip-only hidden file input; it opens no tab.
  assert.equal(walk(tree).find(n=>n.type==='input'&&n.props.type==='file').props.accept,'.zip')
  byLabel(packHead(tree),'素材包操作').props.onClick();tree=await f.r.settle()
  const opened=f.opened.length;await walk(tree).find(n=>n.props.role==='menuitem'&&text(n)==='导入').props.onClick();assert.equal(f.opened.length,opened)
})
// private fork (stage setup wizard, owner 2026-10-15): the 人物 section (its tiles and ＋) left 舞台设置 — figures are 素材,
// edited in the 素材库 (the 素材包 row opens the pack, its 人物 list holds the lamps and ＋); a card's characters are set up
// in 设置向导 › 配角色. A figure therefore opens from its pack row.
async function openFigure(f,tree,name='Synthetic figure'){
  walk(packSection(tree)).find(n=>n.type==='button'&&n.props.className==='ap-pack-name').props.onClick();tree=await f.r.settle()
  walk(tree).find(n=>n.props.role==='option'&&text(n).includes(name)).props.onClick();return f.r.settle()
}
// private fork (stage cast entry, owner 2026-10): 「人物」 is back as a quick entry only — avatar + name pills that open the
// figure in the pack window; no lamp, no ＋ (figures are still edited in the 素材库).
test('舞台设置 人物 is a quick entry (no lamp or ＋); a pill and the pack row both open the figure on its first enabled outfit',async t=>{
  const f=await setup(t)
  const cast=walk(f.tree).find(n=>n.type==='section'&&/ap-cast-entry/.test(n.props.className||''))
  assert.ok(cast,'人物 section')
  assert.equal(walk(f.tree).some(n=>n.props['aria-label']==='新建原创人物'||/ap-cast-row|ap-cast-lamp|ap-cast-add/.test(n.props.className||'')),false)
  const pill=walk(cast).find(n=>n.type==='button'&&n.props.className==='ap-cast-pill'&&text(n).includes('Synthetic figure'))
  pill.props.onClick();const viaPill=await f.r.settle()
  assert.ok(walk(viaPill).some(n=>n.props['aria-label']==='服装'&&n.props.role==='radiogroup'),'the pill opens the figure editor')
  const f2=await setup(t)
  const tree=await openFigure(f2,f2.tree)
  const opened=walk(walk(tree).find(n=>n.props['aria-label']==='服装'&&n.props.role==='radiogroup')).find(n=>n.props['aria-checked']===true)
  assert.doesNotMatch(text(opened)+' '+(opened.props['aria-label']||''),/Casual/,'the first enabled outfit')
})
test('card advanced page no longer offers card emotion editing or raw JSON',async t=>{
  const f=await setup(t);assert.ok(button(f.tree,'添加差分') === undefined);assert.doesNotMatch(text(f.tree),/自定义差分|高级 JSON/)
  const tree=await openFigure(f,f.tree) // private fork (stage setup wizard): a figure opens from its pack row
  assert.ok(byLabel(tree,'角色备注') === undefined);assert.ok(byLabel(tree,'别名') === undefined);assert.ok(byLabel(tree,'自定义颜色') === undefined)
  assert.equal(saves(f.calls).length,0)
})
// private fork (packs-v3): the target pack is picked explicitly (nothing preselected; the card's packs listed first).
// private fork: calm uploads are shown as replace, never a separate default slot.
// private fork (packs-v3): a figure is edited in whatever pack it lives in; no read-only state, no copy-to-own-pack.
// private fork: character modal v2 (panel-ui-design.md §六之三) — one row grammar, a stage card with the card's outfit
// chips (assetBindings outfitKey), one tool group, delete in the header ⋯ menu, no footer.

test('private fork: figure voices need a service, not global presets or a card voice editor return intent',async t=>{
  const f=await setup(t,{tts:{listVoices:()=>{throw Error('Retired global catalogue dependency')},subscribe:()=>()=>{}}})
  byLabel(f.tree,'配音').props.onChange({target:{checked:true}});const tree=await f.r.settle()
  assert.ok(f.calls.some(([method])=>method==='getAssetVoiceServices'))
  assert.doesNotMatch(text(tree),/没有可用的语音服务/)
})

// private fork (avatar-actions, owner 2026-10): the 头像裁切 editor (crop metadata on the 立绘) was retired; 「从立绘裁切…」
// frames the 立绘 into an avatar file in the figure editor (tests/harness/figure-editor-v3.mjs avatar-actions).
// private fork (owner 2026-10 r5): 开场设置 opens in place. Closed: the title and a summary (主角, picture, BGM, skin), never
// the greeting text. Open: 主角, 皮肤, which greeting (自定义 marked) and that greeting's scene; every control saves at once.
const openingSection=tree=>walk(tree).find(n=>n.type==='section'&&/ap-opening-section/.test(n.props.className||''))
const openingScene=tree=>walk(tree).find(n=>n.props.role==='group'&&/^开场画面 · /.test(n.props['aria-label']||''))
async function openOpenings(f,tree){walk(openingSection(tree)).find(n=>n.type==='button'&&n.props.className==='ap-opening-toggle').props.onClick();return f.r.settle()}
async function pickGreeting(f,tree,label){walk(openingSection(tree)).find(n=>n.type==='button'&&/^开场白：/.test(n.props['aria-label']||'')).props.onClick();tree=await f.r.settle()
  walk(tree).find(n=>n.props.role==='menuitemradio'&&text(n)===label).props.onClick();return f.r.settle()}
test('opening settings: a closed summary, then 主角, the greeting choice and an in-place scene that saves at once',async t=>{
  const storedLead=OPENINGS.lead;OPENINGS.lead=null;t.after(()=>{OPENINGS.lead=storedLead})
  const f=await setup(t);let tree=f.tree
  let section=openingSection(tree);assert.ok(section,'section shown in advanced mode')
  const toggle=walk(section).find(n=>n.type==='button'&&n.props.className==='ap-opening-toggle')
  assert.equal(toggle.props['aria-expanded'],false);assert.match(text(toggle),/^开场设置/)
  assert.match(text(toggle),/Synthetic figure/,'the summary names the 主角 the stage opens with');assert.doesNotMatch(text(toggle),/早上好。/,'never the greeting text')
  tree=await openOpenings(f,tree);section=openingSection(tree)
  assert.equal(walk(section).some(n=>n.type==='select'),false,'no native select in 开场设置')
  // private fork (owner 2026-10 r2): 主角 is the styled picker with each figure's face (no native select). The card has no
  // stored lead here, so the figure is not checked and choosing it writes the lead.
  const lead=walk(section).find(n=>n.type==='button'&&/^主角：/.test(n.props['aria-label']||''));assert.ok(lead,'主角 is a styled picker')
  lead.props.onClick();tree=await f.r.settle()
  const leadMenu=walk(tree).find(n=>n.props.role==='menu'&&n.props['aria-label']==='主角')
  const leadItem=walk(leadMenu).find(n=>n.props.role==='menuitemradio'&&text(n).includes('Synthetic figure'))
  assert.ok(walk(leadItem).some(n=>/ap-avatar is-mini/.test(n.props.className||'')),'each figure shows its face')
  assert.notEqual(leadItem.props['aria-checked'],true,'no stored lead is checked')
  leadItem.props.onClick();tree=await f.r.settle()
  assert.deepEqual(saves(f.calls).at(-1).patch,{openings:{lead:FIGURE_REF}})
  // The greeting choice marks the greeting with its own scene; an unset greeting has nothing to reset.
  byLabel(tree,'开场白：开场白').props.onClick();tree=await f.r.settle()
  assert.deepEqual(walk(walk(tree).find(n=>n.props.role==='menu'&&n.props['aria-label']==='开场白')).filter(n=>n.props.role==='menuitemradio').map(text),['开场白','备选 1 · 自定义'])
  byLabel(tree,'开场白：开场白').props.onClick();tree=await f.r.settle()
  assert.ok(button(openingSection(tree),'使用默认') === undefined, 'an unset greeting has nothing to reset')
  // private fork: the pickers are styled menus (no native select); the trigger names the current choice.
  assert.ok(byLabel(openingScene(tree),'背景：Synthetic backgrounds'),'prefilled with the default scene')
  await button(openingScene(tree),'黄昏').props.onClick();tree=await f.r.settle()
  assert.equal(saves(f.calls).at(-1).patch.openings.scenes.primary.timeOfDay,'dusk','a change saves at once')
  byLabel(openingScene(tree),'Synthetic figure 表情：平和' /* private fork: declaration label */).props.onClick();tree=await f.r.settle()
  walk(openingScene(tree)).find(n=>n.props.role==='menuitemradio'&&text(n)==='喜悦').props.onClick();tree=await f.r.settle()
  assert.ok(byLabel(openingScene(tree),'Synthetic figure 表情：喜悦'),'the picked emotion shows on the trigger')
  assert.deepEqual(saves(f.calls).at(-1).patch.openings.scenes.primary,{greeting:'0123456789abcdef',background:CLASSROOM,timeOfDay:'dusk',music:null,cast:[{figure:FIGURE_REF,outfitKey:null,emotion:'joy'}]})
  assert.ok(byLabel(tree,'开场白：开场白 · 自定义'),'the edited greeting is marked 自定义')
  tree=await pickGreeting(f,tree,'备选 1 · 自定义')
  await button(openingSection(tree),'使用默认').props.onClick();await f.r.settle()
  assert.equal(Object.hasOwn(saves(f.calls).at(-1).patch.openings.scenes,'alternate:0'),false,'reset removes the scene')
  assert.ok(f.calls.some(([m,a])=>m==='getCardOpeningScenes'&&a.path==='cards/c.json'))
})
// private fork (owner 2026-10): an unset greeting opens with nobody on stage, and the editor shows exactly that (WYSIWYG):
// its first customisation starts from the empty default instead of a seeded 主角.
test('opening settings: the first edit of an unset greeting starts from the empty default stage',async t=>{
  const before=clone(OPENINGS.scenes.primary);Object.assign(OPENINGS.scenes.primary,{background:null,cast:[]});t.after(()=>{OPENINGS.scenes.primary=before})
  const f=await setup(t);let tree=await openOpenings(f,f.tree)
  assert.ok(byLabel(openingScene(tree),'移除 Synthetic figure') === undefined, 'nobody is on the default stage')
  byLabel(openingScene(tree),'背景：无').props.onClick();tree=await f.r.settle()
  walk(openingScene(tree)).find(n=>n.props.role==='menuitemradio'&&text(n)==='Synthetic backgrounds').props.onClick();tree=await f.r.settle()
  assert.deepEqual(saves(f.calls).at(-1).patch.openings.scenes.primary,{greeting:'0123456789abcdef',background:CLASSROOM,timeOfDay:null,music:null,cast:[]})
})// private fork: 开场画面 preview — the picture and colour the stage would show for the chosen 时段.
const presentationSource=name=>readFile(new URL('../tavern-plugin/'+(name==='fork-stage-light.cjs'?'packages/dsh-presentation-protocol/src/':'src/client/')+name,import.meta.url),'utf8')
const cut=(source,a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j)}
const jpTime=id=>CORE_TIME_PARAMS[id]
// The client's real wiring: the launcher's timeGrade over the stage's createPackSceneLayers and look math.
async function stageTimeGrade(){
  const scene=await presentationSource('fork-gal-scene.js'),looks=await presentationSource('fork-gal-looks.js'),launcher=await presentationSource('fork-asset-launcher.js')
  const wiring=/timeGrade:(projection=>\{.*?\}),\n/.exec(launcher);assert.ok(wiring,'the launcher injects timeGrade')
  const context={}
  vm.runInNewContext(await presentationSource('fork-stage-light.cjs')+cut(scene,'// Colour matrices','// The time of day is graded')+cut(looks,'// ---------- Look helpers','// ---------- Look runtime')+
    await presentationSource('fork-pack-playback.cjs')+';this.timeGrade='+wiring[1]+';this.math={forkGalMatrix,forkGalLookNormalize,forkGalLookMatrix};',context)
  return context
}
// Only the night picture is authored; dusk always uses the global compensating grade.
function previewPack(snapshot){
  const pack=clone(snapshot),room=pack.manifest.assets.find(a=>a.kind==='backgrounds'&&a.id==='classroom')
  room.variants={default:'default',entries:[{id:'default',name:'Default',content:clone(room.variants.entries[0].content)},{id:'night',name:'Night',content:{media:'9'.repeat(64)}}]}
  return pack
}
test('opening preview resolves the variant like the stage and grades only a missing non-day variant',async()=>{
  const snapshot={...await syntheticPack(),revision:'pack-r1'},pack=previewPack(snapshot),seen=[],MARK=[2,0,0,0,0,0,2,0,0,0,0,0,2,0,0,0,0,0,1,0]
  const {views}=factory(assetRenderer(),{timeGrade:projection=>{seen.push(clone(projection));return MARK}}),preview=views.stage.openingPreview
  const room=pack.manifest.assets.find(a=>a.id==='classroom').variants.entries[0].content,ref={packId:PACK_ID,kind:'backgrounds',assetId:'classroom'}
  // private fork (perf: pack list summary): ctx.packs are list rows; the opening reads the lit packs' full documents (writer.pack).
  const withWriter=c=>({...c,writer:{pack:id=>c.packs.find(p=>p.manifest.id===id)}})
  const ctx=(over={})=>withWriter({packs:[pack],ext:{assetBindings:{boundPackIds:[PACK_ID],characters:{}}},binding:{globalEnabledPackIds:[]},engine:{values:{dimensions:{}}},prefs:{},...over})
  const view=(time,c=ctx())=>{const v=preview(c,ref,time);return {hash:v.hash,graded:!!v.grade}}
  assert.deepEqual(view(null),{hash:room.media,graded:false},'自动 = the base picture, no grade')
  assert.deepEqual(view('day'),{hash:room.media,graded:false},'day without a day variant is the base picture, never graded')
  assert.deepEqual(view('night'),{hash:'9'.repeat(64),graded:false},'an authored variant is shown as is')
  assert.equal(seen.length,0,'no grade is computed for a variant, day or 自动')
  assert.deepEqual(view('dusk'),{hash:room.media,graded:true},'dusk has no variant: base picture with the compensating grade')
  assert.deepEqual(seen.at(-1),{timeOfDay:'dusk',compensateBackground:true,time:{params:jpTime('dusk')}},'the matching time look (not the mood look) feeds the stage math')
  assert.equal(preview(ctx(),ref,'dusk').grade,MARK)
  // Like the opening scene: the global lighting dimensions gate time looks. private fork (global only, owner 2026-10): a
  // card's stored stage.dimensions (the retired override) is ignored either way.
  assert.equal(view('dusk',ctx({prefs:{dimensions:{'lighting.time':false}}})).graded,true,'a stored card override does not turn it off')
  assert.equal(view('dusk',ctx({engine:{values:{dimensions:{lighting:false}}}})).graded,false,'lighting off globally')
  assert.equal(view('dusk',ctx({engine:{values:{dimensions:{'lighting.time':false}}},prefs:{dimensions:{'lighting.time':true}}})).graded,false,'nor re-enable it')
  // Recalled, disabled or unbound pack looks cannot change global time grading.
  const other={manifest:{id:OTHER_PACK_ID,name:'Other',assets:[{id:'dusk-2',kind:'looks',enabled:true,layer:'mood',params:{gain:[0,0,0]}}]}}
  assert.equal(view('dusk',ctx({packs:[pack,other]})).graded,true,'a pack that is neither bound nor global is not a candidate')
  assert.equal(view('dusk',ctx({packs:[pack,other],binding:{globalEnabledPackIds:[OTHER_PACK_ID]}})).graded,true,'globally enabled pack looks do not override time')
  const disabled=clone(pack);disabled.manifest.assets.filter(a=>a.kind==='looks').forEach(a=>{a.enabled=false})
  assert.equal(view('dusk',ctx({packs:[disabled]})).graded,true,'disabled looks cannot disable global time')
  assert.deepEqual(clone(preview(ctx(),{...ref,assetId:'gone'},'dusk')),{asset:null,hash:null,grade:null},'a missing background previews nothing')
  const plain=factory(assetRenderer()).views.stage.openingPreview
  assert.equal(plain(ctx(),ref,'dusk').grade,null,'without the client wiring (standalone) the picture stays ungraded')
})
test('opening editor and list thumbnails follow 时段 with the stage colour matrix and no native select',async t=>{
  const stage=await stageTimeGrade(),M=stage.math.forkGalMatrix,matrix=params=>stage.math.forkGalLookMatrix(stage.math.forkGalLookNormalize(params))
  const expected=time=>M.multiply(matrix(jpTime(time)),matrix(jpTime(time).standIn)).map(v=>Math.round(v*1000)/1000).join(' ')
  assert.equal(stage.timeGrade({timeOfDay:'dusk',compensateBackground:false,time:{params:jpTime('dusk')}}),null,'identity (no compensation) is no grade')
  assert.notEqual(expected('dusk'),expected('night'))
  const before=OPENINGS.scenes['alternate:0'].timeOfDay;OPENINGS.scenes['alternate:0'].timeOfDay='dusk';t.after(()=>{OPENINGS.scenes['alternate:0'].timeOfDay=before})
  const snapshot={...await syntheticPack(),revision:'pack-r1'},f=await setup(t,{packs:[previewPack(snapshot)],extra:{timeGrade:stage.timeGrade}});let tree=f.tree
  const grades=node=>walk(node).filter(n=>n.type==='feColorMatrix').map(n=>n.props.values)
  // private fork (owner 2026-10 r5): the closed summary shows the first greeting (自动: ungraded); the dusk greeting's
  // picture is graded once it is chosen; the scene is edited in place (no dialog).
  assert.deepEqual(grades(openingSection(tree)),[],'the 自动 greeting in the summary is not graded')
  tree=await openOpenings(f,tree);tree=await pickGreeting(f,tree,'备选 1 · 自定义')
  assert.deepEqual(grades(openingScene(tree)),[expected('dusk')],'the dusk greeting is graded')
  tree=await pickGreeting(f,tree,'开场白')
  const dialog=()=>openingScene(tree)
  const pick=async label=>{button(dialog(),label).props.onClick();tree=await f.r.settle();const d=dialog();return {values:grades(d),pressed:walk(d).find(n=>n.type==='button'&&n.props['aria-pressed']===true&&text(n)===label),filtered:walk(d).filter(n=>n.props.style?.filter).map(n=>n.props.style.filter)}}
  assert.deepEqual(grades(dialog()),[],'自动 shows the base picture ungraded')
  let state=await pick('黄昏');assert.ok(state.pressed);assert.deepEqual(state.values,[expected('dusk')]);assert.deepEqual(state.filtered,['url(#ap-opening-grade-fixture-id)'])
  assert.equal(walk(dialog()).find(n=>n.type==='filter').props.colorInterpolationFilters,'sRGB','graded in sRGB like the stage DOM layer')
  state=await pick('夜晚');assert.deepEqual(state.values,[],'the authored night variant is not graded');assert.deepEqual(state.filtered,[])
  state=await pick('白天');assert.deepEqual(state.values,[])
  state=await pick('自动');assert.deepEqual(state.values,[])
  // No native OS control anywhere in the modal, including the open menus.
  const natives=()=>walk(dialog()).filter(n=>['select','option','optgroup'].includes(n.type)||n.type==='input'&&['range','radio'].includes(n.props.type))
  assert.deepEqual(natives(),[])
  for(const label of ['背景：Synthetic backgrounds','BGM：无','Synthetic figure 表情：平和' /* private fork: declaration label */,'添加人物']){
    const trigger=byLabel(dialog(),label);if(!trigger)continue
    assert.equal(trigger.props['aria-haspopup'],'menu',label);trigger.props.onClick();tree=await f.r.settle()
    assert.equal(byLabel(dialog(),label)?.props['aria-expanded'],true,label+' opens')
    assert.ok(walk(dialog()).some(n=>n.props.role==='menu'),label+' menu');assert.deepEqual(natives(),[],label+' menu is not native')
    byLabel(dialog(),label).props.onClick();tree=await f.r.settle()
  }
  // The background menu groups by pack name and writes the reference; 无 clears it (and its 时段).
  byLabel(dialog(),'背景：Synthetic backgrounds').props.onClick();tree=await f.r.settle()
  const menu=walk(dialog()).find(n=>n.props.role==='menu')
  assert.ok(walk(menu).some(n=>n.props.role==='group'&&n.props['aria-label']==='Synthetic pack'))
  assert.ok(walk(menu).some(n=>n.props.role==='menuitemradio'&&n.props['aria-checked']===true),'the current background is checked')
  assert.doesNotMatch(text(menu),/[0-9a-f]{8}-[0-9a-f]{4}-/,'no internal ids in the menu')
  walk(menu).find(n=>n.props.role==='menuitemradio'&&text(n)==='无').props.onClick();tree=await f.r.settle()
  assert.ok(byLabel(dialog(),'背景：无'));assert.equal(button(dialog(),'黄昏').props.disabled,true)
})

// private fork (stage panel r7, owner 2026-10): the sidebar tab reads 「舞台设置」 (「Tavern 舞台」 was cut off); the panel has no page
// title of its own (screen-reader only).
test('the stage tab is titled 舞台设置',async()=>{
  const main=await readFile(new URL('../tavern-plugin/src/client/main.js',import.meta.url),'utf8')
  assert.match(main,/id: "dsh-tavern:bubbles", title: "舞台设置"/)
  assert.doesNotMatch(main,/title: "Tavern 舞台"/)
})

// private fork (owner 2026-10): 自动生成选项 is a 基础设置 row (global candidateAutoGenerate through the injected
// preference hook), right after 舞台模式, in 基础 and 高级; one switch with its (?); a failed save is the row's ⚠.
test('private fork: 基础设置 has 自动生成选项 right after 舞台模式, driven by the shared preference hook',async t=>{
  const saved=[];let pref={enabled:false,loading:false,busy:false,error:''}
  const autoChoices=()=>({...pref,save:v=>saved.push(v)})
  const f=await setup(t,{extra:{autoChoices}})
  const basic=()=>walk(f.tree).filter(n=>n.type==='section').find(n=>text(n).startsWith('基础设置'))
  const names=()=>walk(basic()).filter(n=>String(n.props.className||'').split(' ').includes('ap-switch-name')).map(text)
  assert.deepEqual(names().slice(0,4).map(s=>s.replace(/ \?.*$/,'')),['对话气泡','配音','舞台模式','自动生成选项'])
  assert.ok(byLabel(basic(),'自动生成选项 说明'),'(?) beside the name')
  const control=byLabel(basic(),'自动生成选项')
  assert.equal(control.props.checked,false);assert.equal(control.props.disabled,false)
  control.props.onChange({target:{checked:true}})
  assert.deepEqual(saved,[true])
  assert.equal(f.calls.some(([m])=>m==='saveAssetEngineSettings'||m==='saveCardAssetBindings'),false,'not a card or engine setting')
  pref={...pref,enabled:true,error:'保存失败：x'};f.r.render(f.f.views.StagePage,f.props);f.tree=await f.r.settle()
  assert.equal(byLabel(basic(),'自动生成选项').props.checked,true,'in 基础 mode too')
  assert.ok(walk(basic()).some(n=>String(n.props.className||'').includes('ap-hint-mark')&&n.props['aria-label']==='保存失败：x'))
  const none=await setup(t);assert.ok(byLabel(none.tree,'自动生成选项') === undefined, 'no hook, no row')
})
