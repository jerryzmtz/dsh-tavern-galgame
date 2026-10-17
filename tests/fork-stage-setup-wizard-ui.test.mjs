// private fork (stage setup wizard, owner 2026-10-15; v3 2026-10-16): 舞台设置 › 设置向导 against docs/fork/stage-setup-wizard-contract.md —
// the auto-open conditions and the v3 flow (挑选素材 with search → merge with the status CAS → 自定义角色: the suggested names
// and the card pack's figures, each opening one character page → 开场画面 one greeting at a time), synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {syntheticPack,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {stageSource} from './harness/card-centric-stage.mjs'

const {source,picker}=await stageSource()
const OWN='55555555-5555-4555-8555-555555555555',COPY='66666666-6666-4666-8666-666666666666',BLANK='77777777-7777-4777-8777-777777777777'
const clone=v=>JSON.parse(JSON.stringify(v))
const button=(tree,label)=>walk(tree).find(n=>n.type==='button'&&text(n)===label)
const byLabel=(tree,label)=>walk(tree).find(n=>n.props['aria-label']===label)
const wizard=tree=>walk(tree).find(n=>n.props.role==='region'&&n.props['aria-label']==='设置向导')
const step=tree=>walk(byLabel(tree,'设置步骤')).find(n=>n.props['aria-selected']===true)?.props['data-step']
const heading=tree=>text(walk(wizard(tree)).find(n=>n.type==='h2'||n.type==='h3')||{children:[]})

async function setup(t,{bound=[],stageOn=true,conflict=false,removeFails=false,greetings=[],candidates=[{name:'小红',sources:['card']},{name:'小明',sources:['worldbook']}]}={}){
  const r=assetRenderer();t.after(()=>r.dispose())
  const storage=new Map(),observers=[],context={TextEncoder,getComputedStyle:()=>({columnGap:'6px'}),
    ResizeObserver:class{constructor(fn){this.fn=fn}observe(el){observers.push({fn:this.fn,el})}disconnect(){}},setTimeout,clearTimeout,setInterval,clearInterval,Date,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{activeElement:null,addEventListener(){},removeEventListener(){}}}
  vm.runInNewContext(source+';this.create=createForkAssetPackUI;',context)
  context.React=r.React;vm.runInNewContext(picker,context)
  const views=context.create(r.React,{VoicePicker:context.ForkBubbleLibraryPicker,AvatarImage:p=>r.React.createElement('img',p),emotions:{moods:[],max:8,upsert:list=>list}})
  const base=await syntheticPack(),packs=[{...base,revision:'pack-r1'}]
  const card={extension:{schemaVersion:1,assetBindings:{boundPackIds:[...bound]},stage:{}},revision:1}
  const engine={values:{...defaultAssetEngineSettings(),stageToggles:{...defaultAssetEngineSettings().stageToggles,stage:stageOn}},revision:'e1',writable:true}
  let wizardPack=null,library=1
  const calls=[],own=()=>packs.find(p=>p.manifest.id===OWN)
  const status=()=>({path:'cards/c.json',cardId:'card-1',cardRevision:'card-r'+card.revision,libraryRevision:'lib-'+library,boundPackIds:clone(card.extension.assetBindings.boundPackIds),
    hasBoundPacks:card.extension.assetBindings.boundPackIds.length>0,hasAssets:true,wizardPack,shouldAutoOpen:card.extension.assetBindings.boundPackIds.length===0})
  const write=pack=>{pack.revision+='x';library++;return {snapshot:clone(pack)}}
  const service={apiVersion:2,capabilities:['packs','figures','stage-setup-v1'],subscribe:()=>()=>{},
    listPackSummaries:async()=>clone(packs),getPackSnapshot:async({packId})=>clone(packs.find(p=>p.manifest.id===packId)),
    getStageSetupStatus:async a=>{calls.push(['getStageSetupStatus',clone(a)]);return status()},
    // The card pack is made once; a picked figure is copied under a new id with its name and aliases unchanged (the contract).
    mergeStageSetupPack:async a=>{calls.push(['mergeStageSetupPack',clone(a)])
      if(conflict)throw Object.assign(new Error('REVISION_CONFLICT'),{code:'REVISION_CONFLICT'})
      assert.equal(a.expectedCardRevision,'card-r'+card.revision);assert.equal(a.expectedLibraryRevision,'lib-'+library)
      if(!own()){const pack=structuredClone(base);pack.manifest={...pack.manifest,id:OWN,name:'Card · 本卡素材包',figures:[],assets:[]};pack.figures={};pack.revision='own-1';packs.push(pack)
        wizardPack={packId:OWN,name:pack.manifest.name,revision:'own-1'};card.extension.assetBindings.boundPackIds.push(OWN);card.revision++}
      const copied=[]
      for(const {itemRefs} of a.selections)for(const ref of itemRefs.filter(ref=>ref.kind==='figures')){
        own().figures[COPY]={...structuredClone(base.figures[ref.id]),id:COPY};own().manifest.figures.push(COPY);copied.push({sourcePackId:PACK_ID,kind:'figures',fromId:ref.id,toId:COPY})}
      write(own());return {...status(),copied}},
    patchFigure:async a=>{calls.push(['patchFigure',clone(a)]);const pack=packs.find(p=>p.manifest.id===a.packId);pack.figures[a.figureId]={...pack.figures[a.figureId],...a.patch};return write(pack)},
    createFigure:async a=>{calls.push(['createFigure',clone(a)]);const pack=packs.find(p=>p.manifest.id===a.packId);pack.figures[BLANK]={...a.figure,id:BLANK};pack.manifest.figures.push(BLANK);return {...write(pack),figureId:BLANK}},
    removeFigure:async a=>{calls.push(['removeFigure',clone(a)]);if(removeFails)throw Object.assign(new Error('INVALID_ASSET_PACK'),{code:'INVALID_ASSET_PACK'});const pack=packs.find(p=>p.manifest.id===a.packId);delete pack.figures[a.figureId];pack.manifest.figures=pack.manifest.figures.filter(id=>id!==a.figureId);return write(pack)}}
  const binding={download(){},globalEnabledPackIds:[],service,
    rpc:async(method,args)=>{calls.push([method,clone(args||{})])
      if(method==='getCardAssetBindings')return {path:'cards/c.json',cardId:'card-1',revision:'card-r'+card.revision,extension:clone(card.extension),effectiveStage:{}}
      if(method==='getAssetEngineSettings')return clone(engine)
      if(method==='getAssetVoiceServices')return {services:[]}
      if(method==='detectStageSetupCharacters')return {path:'cards/c.json',revision:'w',candidates:clone(candidates)}
      if(method==='getCardOpeningScenes')return {lead:null,greetings:clone(greetings),scenes:{}}
      throw new Error(method)}}
  const props={binding,ready:true,sessionId:'s',path:'cards/c.json',cardName:'Card',nav:{openTab:async()=>{},openLibrary:async()=>{}},onEngine(){}}
  r.render(views.StagePage,props)
  return {r,views,props,calls,packs,observers,tree:await r.settle()}
}

test('the wizard opens by itself only for an unbound card while 舞台模式 is on, once per entry; 设置向导 reopens it',async t=>{
  const off=await setup(t,{stageOn:false})
  assert.ok(!wizard(off.tree), '舞台模式 off: no suggestion is read');assert.equal(off.calls.some(([m])=>m==='getStageSetupStatus'),false)
  const bound=await setup(t,{bound:[PACK_ID]})
  assert.ok(!wizard(bound.tree), 'a card that binds a pack is not interrupted')
  assert.ok(button(bound.tree,'设置向导'),'the permanent entry sits in the page head')
  button(bound.tree,'设置向导').props.onClick();assert.ok(wizard(await bound.r.settle()))
  const f=await setup(t)
  assert.equal(f.calls.filter(([m,a])=>m==='getStageSetupStatus'&&a.autoOpened===true).length,1,'records the auto-open before any completion');
  assert.ok(wizard(f.tree),'unbound card + 舞台模式 on: the wizard opens');assert.equal(step(f.tree),'packs')
  byLabel(f.tree,'返回舞台设置').props.onClick();let tree=await f.r.settle()
  assert.ok(!wizard(tree), '‹ goes back to 舞台设置')
  f.r.render(f.views.StagePage,{...f.props,key:'reopened'});tree=await f.r.settle()
  assert.ok(!wizard(tree), 'reopening the panel for the same card does not ask again')
})

const input=(tree,label)=>walk(tree).find(n=>n.type==='input'&&n.props['aria-label']===label)
const options=tree=>walk(tree).filter(n=>n.props.role==='option'&&String(n.props.className).includes('is-picking'))

test('挑选素材: one compact browser with the 素材库 search (name / alias, every kind while typing); the picks merge with the status CAS',async t=>{
  const f=await setup(t);let tree=f.tree
  assert.deepEqual(walk(byLabel(tree,'设置步骤')).filter(n=>n.props.role==='tab').map(text),['1 挑选素材','2 自定义角色','3 开场画面'])
  assert.ok(!button(tree,'上一步'),'nothing to go back to on the first step');assert.ok(!button(tree,'跳过'),'no 跳过: 下一步 moves on without picks')
  assert.ok(button(tree,'下一步'))
  assert.ok(byLabel(tree,'全选 Synthetic pack'),'each pack has a quiet head with its round check')
  assert.ok(byLabel(tree,'素材包设置 Synthetic pack'),'and a way to its full pack page')
  // The search reads aliases (the figure's 「Speaker」) across every kind; a miss is one phrase.
  input(tree,'搜索素材').props.onChange({target:{value:'speaker'}});tree=await f.r.settle()
  assert.deepEqual(options(tree).map(text),['Synthetic figure'])
  input(tree,'搜索素材').props.onChange({target:{value:'synthetic b'}});tree=await f.r.settle()
  assert.deepEqual(options(tree).map(text),['Synthetic backgrounds','Synthetic backgrounds'],'names match across kinds while typing')
  input(tree,'搜索素材').props.onChange({target:{value:'zzz'}});tree=await f.r.settle()
  assert.equal(options(tree).length,0);assert.match(text(tree),/没有符合条件的素材/)
  input(tree,'搜索素材').props.onChange({target:{value:'speaker'}});tree=await f.r.settle()
  options(tree)[0].props.onClick();tree=await f.r.settle()
  assert.equal(options(tree)[0].props['aria-selected'],true);assert.match(text(tree),/已选\s+1/)
  await button(tree,'创建本卡素材包').props.onClick();tree=await f.r.settle()
  assert.deepEqual(f.calls.filter(([m])=>m==='mergeStageSetupPack').map(([,a])=>a),
    [{path:'cards/c.json',expectedCardRevision:'card-r1',expectedLibraryRevision:'lib-1',selections:[{packId:PACK_ID,itemRefs:[{kind:'figures',id:FIGURE_ID}]}]}])
  assert.equal(step(tree),'cast');assert.match(text(tree),/已创建「Card · 本卡素材包」/)
  // A conflict keeps the picks on the step.
  const g=await setup(t,{conflict:true});tree=g.tree
  options(tree)[0].props.onClick();tree=await g.r.settle()
  await button(tree,'创建本卡素材包').props.onClick();tree=await g.r.settle()
  assert.equal(step(tree),'packs','a failed merge stays on the step')
  assert.ok(walk(tree).some(n=>n.props.role==='alert'&&/卡片或素材刚刚被改过，请重新载入后再试。/.test(text(n))))
  assert.match(text(tree),/已选\s+1/,'the picks are kept')
  walk(byLabel(tree,'设置步骤')).find(n=>n.props['data-step']==='cast').props.onClick();tree=await g.r.settle()
  assert.equal(step(tree),'cast','the step bar moves on without writing');assert.equal(g.calls.filter(([m])=>m==='mergeStageSetupPack').length,1)
})

const strip=tree=>byLabel(tree,'卡里的角色'),chips=tree=>walk(strip(tree)).filter(n=>n.type==='button'&&String(n.props.className).includes('ap-wizard-name'))
const moreChip=tree=>walk(strip(tree)).find(n=>n.type==='button'&&n.props['data-more'])
// A fake strip for the row measurement: chips 60px wide with the 6px gap wrap at `width`; the 更多 chip is 50px. The
// measuring render lays out every chip, so the boxes follow the name count.
const fakeStrip=(count,width)=>{const el={clientWidth:width,getBoundingClientRect:()=>({left:0}),get children(){
  const per=Math.max(1,Math.floor((el.clientWidth+6)/66))
  return [...Array.from({length:count},(_,i)=>({dataset:{},getBoundingClientRect:()=>({left:(i%per)*66,right:(i%per)*66+60})})),{dataset:{more:'true'},getBoundingClientRect:()=>({width:50})}]}};return el}
const chip=(tree,name)=>chips(tree).find(n=>text(n)===name)
const toCast=async(f,tree)=>{walk(byLabel(tree,'设置步骤')).find(n=>n.props['data-step']==='cast').props.onClick();return f.r.settle()}

test('自定义角色: suggested names are a capped strip in the host\'s order, never the card title or a name a card-pack figure answers to',async t=>{
  // A worldbook-heavy card: 30 detected names (the 全职高手 case) must never become 30 rows; the title and a name already
  // on a card-pack figure (its alias 「Speaker」) are left out.
  const many=Array.from({length:30},(_,i)=>({name:'角色'+(i+1),sources:['worldbook']}))
  const f=await setup(t,{candidates:[{name:'Card',sources:['card','character']},{name:'小红',sources:['character']},{name:'Speaker',sources:['worldbook']},...many]});let tree=f.tree
  options(tree).find(n=>text(n)==='Synthetic figure').props.onClick();tree=await f.r.settle()
  await button(tree,'创建本卡素材包').props.onClick();tree=await f.r.settle()
  assert.ok(!/本卡素材包里还没有人物|上一步复制来的人物/.test(text(wizard(tree))),'no instruction paragraph')
  // Unmeasured, every chip is laid out with an invisible 更多 to measure; the strip then keeps two rows (12 chips a row at
  // 800px), the last one short of the 更多 chip.
  assert.equal(chips(tree).length,31);assert.equal(moreChip(tree).props['aria-hidden'],true,'the measuring 更多 is not announced')
  const el=fakeStrip(31,800);strip(tree).props.ref(el);tree=await f.r.settle()
  assert.equal(chips(tree).length,23,'two rows, room for 更多 at the end of the second');assert.deepEqual(chips(tree).slice(0,2).map(text),['小红','角色1'],'in the host\'s order')
  assert.equal(text(moreChip(tree)),'更多');assert.equal(moreChip(tree).props['aria-expanded'],false);assert.equal(moreChip(tree).props['aria-hidden'],undefined)
  assert.ok(!chip(tree,'Card'),'never the card\'s own title');assert.ok(!chip(tree,'Speaker'),'never a name a card-pack figure answers to')
  // A narrow strip (≤ 480px) keeps three rows: 6 chips a row at 400px, 17 shown; the observer measures again on resize.
  el.clientWidth=400;f.observers.at(-1).fn([{contentRect:{width:400}}]);tree=await f.r.settle()
  assert.equal(chips(tree).length,17,'three rows on a narrow strip')
  f.observers.at(-1).fn([{contentRect:{width:400}}]);tree=await f.r.settle();assert.equal(chips(tree).length,17,'the same width does not measure again')
  moreChip(tree).props.onClick();tree=await f.r.settle()
  assert.equal(chips(tree).length,31,'「更多」 shows them all');assert.equal(text(moreChip(tree)),'收起');assert.equal(moreChip(tree).props['aria-expanded'],true)
  moreChip(tree).props.onClick();tree=await f.r.settle();assert.equal(chips(tree).length,17,'「收起」 folds them back')
  // Everything fits: no 更多 at all.
  el.clientWidth=1600;f.observers.at(-1).fn([{contentRect:{width:1600}}]);tree=await f.r.settle()
  assert.equal(chips(tree).length,31);assert.ok(!moreChip(tree),'no 更多 when every name fits in two rows')
  const people=walk(byLabel(tree,'本卡人物')).filter(n=>n.type==='button')
  assert.deepEqual(people.map(n=>n.props['aria-label']||text(n)),['Synthetic figure','添加角色'],'one face tile per card-pack figure, then the dashed ＋')
  // Empty card pack: only the dashed ＋ — no sentence, no buttons.
  const g=await setup(t);tree=await toCast(g,g.tree)
  assert.deepEqual(walk(byLabel(tree,'本卡人物')).filter(n=>n.type==='button').map(n=>n.props['aria-label']),['添加角色'])
  assert.ok(!/本卡素材包里还没有人物/.test(text(tree)));assert.ok(!button(tree,'新建角色'));assert.ok(!button(tree,'回到第 1 步挑人物'))
})

test('a suggested name opens its character page: an existing figure takes the name and 触发词, or a blank one starts there',async t=>{
  // A card-pack figure: the page's name and 触发词 bind to it (one patchFigure; no rename / new menu).
  const f=await setup(t);let tree=f.tree
  options(tree).find(n=>text(n)==='Synthetic figure').props.onClick();tree=await f.r.settle()
  await button(tree,'创建本卡素材包').props.onClick();tree=await f.r.settle()
  chip(tree,'小红').props.onClick();tree=await f.r.settle()
  assert.equal(heading(tree),'小红','the name opens its own page');assert.ok(!walk(tree).some(n=>n.props.role==='menuitem'))
  assert.ok(byLabel(tree,'名称'));assert.ok(walk(tree).some(n=>/触发词/.test(text(n))));assert.ok(walk(tree).some(n=>/声音/.test(text(n))))
  const pick=(tree,group,name)=>walk(byLabel(tree,group)).find(n=>n.props.role==='option'&&text(n)===name)
  await pick(tree,'本卡素材包','Synthetic figure').props.onClick();tree=await f.r.settle()
  assert.deepEqual(f.calls.filter(([m])=>m==='patchFigure').map(([,a])=>[a.packId,a.figureId,a.patch]),[[OWN,COPY,{name:'小红',aliases:['actor']}]],
    'it becomes this character: the old visible 触发词 go, the hidden actor code stays')
  byLabel(tree,'返回设置向导').props.onClick();tree=await f.r.settle()
  assert.equal(step(tree),'cast');assert.ok(!chip(tree,'小红'),'a name a figure answers to leaves the strip')
  // A library figure that answers to the name: its face is on the chip, it leads the page and is copied in on a click.
  const g=await setup(t,{candidates:[{name:'Speaker',sources:['worldbook']}]});tree=await toCast(g,g.tree)
  assert.equal(chip(tree,'Speaker').props['data-face'],true,'the chip wears the library figure\'s face')
  chip(tree,'Speaker').props.onClick();tree=await g.r.settle()
  assert.equal(walk(tree).filter(n=>n.props.className==='ap-person-group-name').map(text)[0],'同名人物','the same-name figure comes first')
  await pick(tree,'同名人物','Synthetic figure').props.onClick();tree=await g.r.settle()
  assert.deepEqual(g.calls.filter(([m])=>m==='mergeStageSetupPack').map(([,a])=>a.selections),[[{packId:PACK_ID,itemRefs:[{kind:'figures',id:FIGURE_ID}]}]],'one merge makes the card pack with the copy')
  assert.equal(g.calls.filter(([m])=>m==='patchFigure').length,0,'a figure that already answers to the name keeps its name and 触发词')
  assert.equal(heading(tree),'Synthetic figure')
  assert.equal(pick(tree,'同名人物','Synthetic figure').props['aria-selected'],true,'the clicked library figure carries the ✓')
  assert.ok(!byLabel(tree,'本卡素材包'),'its copy is not offered again')
  // Blank: the dashed ＋ opens an empty page; 新建角色 creates the figure under the typed name.
  const k=await setup(t);tree=await toCast(k,k.tree)
  byLabel(tree,'添加角色').props.onClick();tree=await k.r.settle()
  assert.equal(heading(tree),'新角色')
  input(tree,'名称').props.onChange({target:{value:'小明'}});tree=await k.r.settle();await input(tree,'名称').props.onBlur();tree=await k.r.settle()
  await button(tree,'新建角色').props.onClick();tree=await k.r.settle()
  assert.deepEqual(k.calls.filter(([m])=>m==='createFigure').map(([,a])=>[a.packId,a.figure.name]),[[OWN,'小明']])
  assert.equal(step(tree),'cast','新建角色 returns to the step')
  // The blank figure (no face yet) still offers the existing figures: a pick replaces it under its name.
  walk(byLabel(tree,'本卡人物')).find(n=>n.type==='button'&&text(n)==='小明').props.onClick();tree=await k.r.settle()
  assert.equal(heading(tree),'小明');assert.ok(!byLabel(tree,'本卡素材包'),'the blank itself is not offered')
  await pick(tree,'Synthetic pack','Synthetic figure').props.onClick();tree=await k.r.settle()
  assert.deepEqual(k.calls.filter(([m])=>['removeFigure','mergeStageSetupPack','patchFigure'].includes(m)).map(([m,a])=>[m,a.figureId||a.selections.length,a.patch]),
    [['mergeStageSetupPack',0,undefined],['removeFigure',BLANK,undefined],['mergeStageSetupPack',1,undefined],['patchFigure',COPY,{name:'小明',aliases:['actor']}]])
  assert.equal(heading(tree),'小明');assert.equal(pick(tree,'Synthetic pack','Synthetic figure').props['aria-selected'],true)
  // A figure the host will not remove stops the change: the pick stays, the page says why.
  const m=await setup(t,{removeFails:true});tree=await toCast(m,m.tree)
  byLabel(tree,'添加角色').props.onClick();tree=await m.r.settle()
  input(tree,'名称').props.onChange({target:{value:'小明'}});tree=await m.r.settle();await input(tree,'名称').props.onBlur();tree=await m.r.settle()
  await button(tree,'新建角色').props.onClick();tree=await m.r.settle()
  walk(byLabel(tree,'本卡人物')).find(n=>n.type==='button'&&text(n)==='小明').props.onClick();tree=await m.r.settle()
  await pick(tree,'Synthetic pack','Synthetic figure').props.onClick();tree=await m.r.settle()
  assert.equal(m.calls.filter(([m])=>m==='mergeStageSetupPack').length,1,'nothing is copied in');assert.equal(heading(tree),'小明')
  assert.ok(walk(tree).some(n=>n.props.role==='alert'&&/没能从本卡素材包撤下「小明」/.test(text(n))))
  assert.equal(pick(tree,'Synthetic pack','Synthetic figure').props['aria-selected'],false)
})

test('开场画面 walks every greeting with the 开场设置 section; 完成 is always there',async t=>{
  const f=await setup(t,{bound:[PACK_ID],greetings:[{id:'primary',key:'g0',preview:'早上好'},{id:'alternate:1',key:'g1',preview:'晚上好'},{id:'alternate:2',key:'g2',preview:'午安'}]})
  button(f.tree,'设置向导').props.onClick();let tree=await f.r.settle()
  walk(byLabel(tree,'设置步骤')).find(n=>n.props['data-step']==='opening').props.onClick();await f.r.settle();tree=await f.r.settle()
  const at=()=>[byLabel(tree,'开场白：'+['开场白','备选 1','备选 2'].find(l=>byLabel(tree,'开场白：'+l)))?.props['aria-label'],text(walk(tree).find(n=>n.props.className==='ap-section-meta'&&/\//.test(text(n)))||{children:[]})]
  assert.deepEqual(at(),['开场白：开场白','1 / 3']);assert.ok(byLabel(tree,'开场画面 · 开场白'))
  assert.match(text(tree),/编辑开场白/,'the picker edits a greeting rather than changing the chat opening')
  assert.match(text(tree),/出场人物/,'the explicit stage cast is distinct from lead metadata')
  assert.ok(button(tree,'完成'),'完成 beside 下一段开场白 while greetings remain')
  button(tree,'下一段开场白').props.onClick();tree=await f.r.settle()
  assert.deepEqual(at(),['开场白：备选 1','2 / 3']);assert.ok(byLabel(tree,'开场画面 · 备选 1'))
  button(tree,'上一步').props.onClick();tree=await f.r.settle()
  assert.deepEqual(at(),['开场白：开场白','1 / 3'],'上一步 walks back through the greetings first')
  button(tree,'下一段开场白').props.onClick();tree=await f.r.settle();button(tree,'下一段开场白').props.onClick();tree=await f.r.settle()
  assert.deepEqual(at(),['开场白：备选 2','3 / 3']);assert.ok(!button(tree,'下一段开场白'))
  button(tree,'完成').props.onClick();tree=await f.r.settle()
  assert.ok(!wizard(tree), '完成 returns to 舞台设置')
  // Nothing configured, greetings left: 完成 still closes the wizard.
  button(tree,'设置向导').props.onClick();tree=await f.r.settle()
  walk(byLabel(tree,'设置步骤')).find(n=>n.props['data-step']==='opening').props.onClick();await f.r.settle();tree=await f.r.settle()
  button(tree,'完成').props.onClick();tree=await f.r.settle();assert.ok(!wizard(tree))
})

test('entering 舞台模式 on an unbound card opens 舞台设置 straight on the wizard, once per card',async t=>{
  const f=await setup(t,{stageOn:false});let tree=f.tree
  assert.ok(!wizard(tree))
  const enter=(path='cards/c.json',stageOn=true)=>{let opened=0;const result=f.views.stageSetup.enter({service:f.props.binding.service,path,stageOn,open:async()=>{opened++;}});return {result,opened:()=>opened};}
  assert.equal(enter('cards/c.json',false).result,null,'stage mode off: the stage just opens')
  const first=enter()
  assert.equal(await first.result,true,'the stage does not open; the panel does');assert.equal(first.opened(),1)
  tree=await f.r.settle();assert.ok(wizard(tree));assert.equal(step(tree),'packs')
  assert.equal(enter().result,null,'the second entry on the same card goes straight to the stage')
  const bound=await setup(t,{bound:[PACK_ID],stageOn:false})
  const other=bound.views.stageSetup.enter({service:bound.props.binding.service,path:'cards/c.json',stageOn:true,open:async()=>{throw new Error('must not open')}})
  assert.equal(await other,false,'a card that binds a pack enters the stage');assert.ok(!wizard(await bound.r.settle()))
})

test('挑选素材: a thumbnail opens the large view — 人物 in the default outfit\'s calm 立绘 with outfits and 差分, a picture whole; 选择 toggles the row\'s pick, ←→ step through the list',async t=>{
  const f=await setup(t),media=[];let tree=f.tree
  f.props.binding.previewMedia=async({hash})=>{media.push(hash);return {url:'media:'+hash,release(){}}}
  const school=(await syntheticPack()).figures[FIGURE_ID].outfits[0],calm=school.sprite.assets['assets/stage.png']
  const leads=tree=>walk(tree).filter(n=>n.type==='button'&&n.props.className==='ap-item-lead')
  const sheet=tree=>walk(tree).find(n=>n.props.role==='dialog'&&String(n.props.className).includes('ap-entry-preview'))
  const srcs=node=>walk(node).filter(n=>n.type==='img').map(n=>n.props.src)
  const keys=(tree,key)=>sheet(tree).props.onKeyDown({key,preventDefault(){},stopPropagation(){}})
  assert.deepEqual(leads(tree).map(n=>n.props['aria-label']),['查看大图 Synthetic figure'],'only the thumbnail opens it')
  assert.ok(!sheet(tree));assert.equal(media.length,0,'nothing large is loaded before it opens')
  let stopped=false;leads(tree)[0].props.onClick({stopPropagation(){stopped=true}});tree=await f.r.settle()
  assert.ok(stopped,'a press on the thumbnail never reaches the row');assert.equal(options(tree)[0].props['aria-selected'],false)
  let d=sheet(tree);assert.equal(d.props['aria-label'],'Synthetic figure');assert.match(text(d),/Synthetic pack/)
  assert.ok(srcs(d).includes('media:'+calm),'the default outfit\'s calm 立绘, full size')
  const outfits=()=>walk(byLabel(sheet(tree),'服装')).filter(n=>n.type==='button')
  assert.deepEqual(outfits().map(text),['School','Casual']);assert.equal(outfits()[0].props['aria-pressed'],true)
  // A 差分 without its own 立绘 state shows its avatar.
  walk(byLabel(sheet(tree),'差分')).find(n=>n.props['aria-label']==='喜悦').props.onClick();tree=await f.r.settle()
  assert.ok(srcs(sheet(tree)).includes('media:'+school.avatars.joy))
  outfits()[1].props.onClick();tree=await f.r.settle()
  assert.equal(outfits()[1].props['aria-pressed'],true,'another outfit');assert.equal(walk(byLabel(sheet(tree),'差分')).length,0,'one face: no 差分 strip')
  button(sheet(tree),'选择').props.onClick();tree=await f.r.settle()
  assert.equal(options(tree)[0].props['aria-selected'],true,'选择 is the row\'s pick');assert.match(text(tree),/已选\s+1/)
  button(sheet(tree),'取消选择').props.onClick();tree=await f.r.settle();assert.equal(options(tree)[0].props['aria-selected'],false)
  byLabel(sheet(tree),'关闭').props.onClick();tree=await f.r.settle();assert.ok(!sheet(tree))
  // The list while searching holds the figure and the background with a picture (audio and pictureless entries are skipped).
  input(tree,'搜索素材').props.onChange({target:{value:'synthetic'}});tree=await f.r.settle()
  assert.equal(leads(tree).length,2)
  leads(tree)[0].props.onClick({stopPropagation(){}});tree=await f.r.settle()
  keys(tree,'ArrowRight');tree=await f.r.settle()
  d=sheet(tree);assert.equal(d.props['aria-label'],'Synthetic backgrounds');assert.ok(!byLabel(d,'服装'),'a picture has no side facts')
  const bg=(await syntheticPack()).manifest.assets.find(a=>a.id==='classroom').variants.entries[0].content.media
  assert.ok(srcs(d).includes('media:'+bg),'the background whole')
  keys(tree,'ArrowRight');tree=await f.r.settle();assert.equal(sheet(tree).props['aria-label'],'Synthetic figure','the list wraps')
  byLabel(sheet(tree),'上一个').props.onClick();tree=await f.r.settle();assert.equal(sheet(tree).props['aria-label'],'Synthetic backgrounds')
})
test('P4 completion returns to expanded basic settings with global switches; back is not completion',async t=>{
  const f=await setup(t);let tree=f.tree
  byLabel(tree,'返回舞台设置').props.onClick();tree=await f.r.settle()
  const basic=()=>walk(tree).find(n=>n.type==='button'&&n.props.className==='ap-section-toggle'&&text(n).startsWith('基础设置'))
  basic().props.onClick();tree=await f.r.settle();assert.equal(basic().props['aria-expanded'],false)
  button(tree,'设置向导').props.onClick();tree=await f.r.settle()
  byLabel(tree,'返回舞台设置').props.onClick();tree=await f.r.settle();assert.equal(basic().props['aria-expanded'],false,'back preserves the prior fold')
  button(tree,'设置向导').props.onClick();tree=await f.r.settle()
  walk(byLabel(tree,'设置步骤')).find(n=>n.props['data-step']==='opening').props.onClick();tree=await f.r.settle()
  await button(tree,'完成').props.onClick();tree=await f.r.settle()
  assert.ok(!wizard(tree));assert.equal(basic().props['aria-expanded'],true)
  for(const label of ['BGM','音效','环境音','舞台模式'])assert.ok(byLabel(tree,label),label+' is available after completion')
})
