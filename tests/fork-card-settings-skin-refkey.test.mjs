// private fork: regression for the 大肥鱼 card settings crash (`ReferenceError: refKey is not defined`, live b1390fb0).
// StageDefaultSkin compared pack skin refs with a `refKey` helper that only existed inside another included module's
// function scope. A card that binds a pack with an enabled skin (canonical figure ids, voice v4 figure bindings) and
// has no string default skin reached that comparison on first render. Synthetic data only; no live profile is read.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {syntheticPack,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {stageSource} from './harness/card-centric-stage.mjs'

const {source,picker}=await stageSource()
const clone=v=>JSON.parse(JSON.stringify(v))
const SKIN={packId:PACK_ID,kind:'skins',assetId:'tide'}

async function dafeiyuPack(){
  const pack=await syntheticPack()
  // private fork: voice v4 keeps the figure binding as a library reference, never an inline preset.
  assert.ok(pack.figures[FIGURE_ID].voice?.voice,'fixture figure carries a voice v4 library binding')
  pack.manifest.assets.push({kind:'skins',id:'tide',name:'Tide',recall:{mode:'keyword',keywords:['tide']},directorNote:'Sea.',bundleKey:'tide',entry:'skin.json'})
  return {...pack,skins:{tide:{id:'tide',label:'潮汐',directorNote:'海边。'}},revision:'pack-r1'}
}

async function render(t,extension){
  const r=assetRenderer();t.after(()=>r.dispose())
  const pack=await dafeiyuPack(),state={extension,revision:1}
  const reply=()=>({path:'cards/dafeiyu.json',revision:'card-r'+state.revision,extension:clone(state.extension),effectiveStage:{}})
  const binding={download(){},globalEnabledPackIds:[],
    service:{apiVersion:2,capabilities:['packs','figures'],subscribe:()=>()=>{},listPackSummaries:async()=>[pack],getPackSnapshot:async()=>pack},
    rpc:async method=>{
      if(method==='getCardAssetBindings')return reply()
      if(method==='getAssetEngineSettings')return {values:defaultAssetEngineSettings(),revision:'e1',writable:true}
      if(method==='getAssetVoiceServices')return {services:[]}
      if(method==='getCardOpeningScenes')return {lead:null,greetings:[],scenes:{}}
      if(method==='getAssetPackDependencies')return {available:true,count:1,cards:[{path:'cards/dafeiyu.json'}]}
      throw new Error(method)}}
  const storage=new Map(),session=new Map()
  const context={TextEncoder,setTimeout,clearTimeout,setInterval,clearInterval,Date,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k)},
    document:{activeElement:null,addEventListener(){},removeEventListener(){}}}
  vm.runInNewContext(source+';this.create=createForkAssetPackUI;',context)
  context.React=r.React;vm.runInNewContext(picker,context)
  const views=context.create(r.React,{VoicePicker:context.ForkBubbleLibraryPicker,AvatarImage:p=>r.React.createElement('img',p),
    emotions:{moods:[],palette:['#111111'],max:8,upsert:list=>list}})
  const errors=[],onError=console.error;console.error=(...a)=>{errors.push(a.map(String).join(' '));};t.after(()=>{console.error=onError})
  r.render(views.StagePage,{binding,ready:true,sessionId:'s',path:'cards/dafeiyu.json',cardName:'大肥鱼',
    nav:{openTab:async()=>{},openLibrary:async()=>{}},renderGlobal:()=>'GLOBAL',renderDebug:()=>'DEBUG',onEngine(){}})
  // private fork (owner 2026-10 r5): the skin is a field of 开场设置, which opens in place from its head.
  const toggle=walk(await r.settle()).find(n=>n.type==='button'&&n.props.className==='ap-opening-toggle');toggle.props.onClick()
  return {tree:await r.settle(),errors,r}
}

// 大肥鱼-like card: canonical (non-display) figure ids, figures bound by pack/figure id, stage on, no default skin.
const card=stage=>({schemaVersion:1,
  characters:{f_dafeiyu:{aliases:['大肥鱼','dafeiyu'],name:'大肥鱼',speakerNames:['大肥鱼'],appearance:'live2d'},f_me:{aliases:['me'],name:'我',speakerNames:['我'],appearance:'avatar'}},
  assetBindings:{boundPackIds:[PACK_ID],characters:{f_dafeiyu:{figure:{packId:PACK_ID,figureId:FIGURE_ID}},f_me:{figure:null}}},
  stage:{...stage}})

// private fork (owner 2026-10 r2): 默认舞台皮肤 is the CONFIG-style select — a trigger naming the chosen skin, its menu every
// skin as a menuitemradio (each with a mini preview).
const skinTrigger=tree=>walk(tree).find(n=>n.type==='button'&&n.props.className==='ap-skin-trigger')
const options=tree=>walk(tree).filter(n=>n.props.role==='menuitemradio'&&/ap-skin-option/.test(n.props.className||''))
const skinName=option=>text(walk(option).find(n=>n.props.className==='ap-skin-name'))

for(const [label,stage,checked] of [
  ['no default skin',{},'经典'],
  ['a built-in default skin','magical','魔法少女'],
  ['a pack skin as default',SKIN,'潮汐']]){
  test(`private fork: card settings page renders pack skins with ${label}`,async t=>{
    const {tree,errors,r}=await render(t,card(typeof stage==='string'||stage.packId?{defaultSkin:stage}:stage))
    assert.deepEqual(errors.filter(e=>/refKey|ReferenceError|is not defined/.test(e)),[])
    const trigger=skinTrigger(tree);assert.ok(trigger,'the default skin section rendered')
    assert.equal(trigger.props['aria-label'],'默认舞台皮肤：'+checked,'the trigger names the configured skin')
    trigger.props.onClick()
    const list=options(await r.settle());assert.ok(list.some(n=>skinName(n)==='潮汐'),'the bound pack skin is offered')
    assert.ok(list.every(n=>walk(n).some(c=>/fork-gal-config-theme-art/.test(c.props.className||''))),'every option has a mini preview')
    const on=list.filter(n=>n.props['aria-checked']===true).map(skinName)
    assert.deepEqual(on,[checked],'exactly the configured skin is checked')
  })
}
