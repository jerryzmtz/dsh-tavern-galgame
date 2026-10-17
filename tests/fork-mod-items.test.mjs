import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {validateModManifest,validateModPack} from '../tavern-plugin/lib/domain/mods/manifest.js'
import {validateCardVariableBindings,variableTargetKey} from '../tavern-plugin/lib/domain/variable-bindings/index.js'
import {modReadBindings,projectModReadSlots} from '../tavern-plugin/lib/domain/mods/variable-slots.js'
import {modCatalogue} from '../tavern-plugin/lib/domain/mods/catalogue.js'
import {parseModDsl} from '../tavern-plugin/lib/domain/mods/dsl.js'
import {validateModCommand,registerModCommands} from '../tavern-plugin/lib/domain/mods/commands.js'
import directorCommands from '../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'
import {createModArchives} from '../tavern-plugin/lib/fork-mod-archives.js'
import {reduceAssetPackOperation} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {createBuiltinModRegistry} from '../tavern-plugin/lib/domain/mods/runtime.js'
import {createModRegistry} from '../tavern-plugin/lib/domain/mods/registry.js'
import {createModHostRuntime} from '../tavern-plugin/lib/fork-mod-runtime.js'
import {createModStageCorrections} from '../tavern-plugin/lib/domain/mods/stage-corrections.js'
import projection from '../tavern-plugin/src/client/fork-mod-projection.cjs'
import * as module from '../fork/mods/items/runtime.js'
import {itemCatalogue,selectItem,reconcileItems,inventoryContext} from '../fork/mods/items/logic.js'

const root=new URL('../fork/mods/items/',import.meta.url)
const manifest=validateModManifest(JSON.parse(await readFile(new URL('manifest.json',root))))
const packs=await Promise.all(manifest.defaultPacks.map(async name=>validateModPack(JSON.parse(await readFile(new URL(name,root))),manifest)))
const binding={source:'mvu',path:'/bag',fields:{id:'/id',name:'/name',count:'/count'}}
const options={binding},intent={action:'gain',name:'回复药',genre:'药品',force:false}
const packId='245445d4-8ee4-46cc-b57e-d2b56c3fc6ab',otherId='b57d1a7c-22d5-42b0-8193-e772f65fe8bb'
const ownRef=(id,pack=packId)=>({packId:pack,kind:'props',assetId:id})
function catalogueFixture() {
  const pack={id:packId,scope:'library',entries:[{id:'potion-art',ref:ownRef('potion-art'),kind:'props',name:'回复药',enabled:true,
    category:'medicine',extensions:{'dsh.items':{inventoryId:'stock-med-7'}},media:'a'.repeat(64),recall:{mode:'keyword',keywords:['药水'],synonyms:{药水:['补给药']}}}]}
  return {packs:[pack],recalled:[ownRef('potion-art')]}
}
const performance=(id,payload)=>({id,revision:0,kind:'dsh.items.item',payload})
const settlement=performances=>({settlementRevision:'r2',beforeRevision:'r1',afterRevision:'r2',bindings:{inventory:binding},before:{inventory:[{id:'stock-med-7',name:'库存中的不同名字',count:2}]},after:{inventory:[{id:'stock-med-7',name:'库存中的不同名字',count:6}]},performances})

test('release has builtin category images and consumes core props instead of installing private packs',async()=>{
  assert.deepEqual(packs,[]);assert.deepEqual(manifest.assetKinds,[]);
  assert.deepEqual(manifest.admission.entryKinds,['props']);
  assert.deepEqual(manifest.permissions.mainAssets,[{slot:'props',kinds:['props']}]);
  assert.equal(manifest.files.filter(row=>row.path.startsWith('categories/')).length,8);
  assert.equal(manifest.files.some(row=>row.path.startsWith('packs/')),false);
  const files=new Map(await Promise.all(manifest.files.map(async row=>[row.path,await readFile(new URL(row.path,root))])));
  const registry=createBuiltinModRegistry([{manifest,files,module}]);
  assert.equal(registry.manifest(manifest.id).id,'dsh.items');
  assert.equal(registry.manifest(manifest.id).name,'物品');
  const archives=createModArchives({root:fileURLToPath(new URL('../.tmp/items-archive/',import.meta.url)),library:createModRegistry(),builtins:registry,archiveIO:{}});
  assert.ok((await archives.inspectSource({kind:'files',files:new Map([...files,['manifest.json',Buffer.from(JSON.stringify(manifest))]])})).inspectionId);
});

test('one explicit native mod slot resolves field mapping without guessing or granting a broader read',()=>{
  const entries=[{target:{kind:'mods',modId:'dsh.items',slot:'inventory'},variable:binding}]
  validateCardVariableBindings({version:1,entries})
  assert.notEqual(variableTargetKey(entries[0].target),variableTargetKey({...entries[0].target,modId:'dsh.other'}))
  const raw={extensions:{dsh_tavern:{variableBindings:{version:1,entries}}}},bindings=modReadBindings(manifest,raw)
  assert.deepEqual(bindings,{inventory:binding})
  assert.deepEqual(projectModReadSlots(manifest,bindings,{mvu:{available:true,value:{bag:[{id:'k',name:'药',count:0,secret:true}],other:'private'}}}),{inventory:[{id:'k',name:'药',count:0}]})
  assert.deepEqual(modReadBindings(manifest,{extensions:{}}),{})
  assert.deepEqual(projectModReadSlots(manifest,{}, {mvu:{available:true,value:{bag:[]}}}),{})
})

test('catalogue, schema and DSL share exact names, explicit aliases and enabled-pack genre union before transaction admission',()=>{
  const snapshot=catalogueFixture(),compiled=module.configure({manifest,catalogue:snapshot,bindings:{inventory:binding}}).commands[0]
  assert.equal(registerModCommands([manifest],[{op:'item.play'},{dsl:{verb:'item'}}])[0].op,compiled.op)
  assert.equal(directorCommands.byName['item.play'].configured({dimensions:{},items:{enabled:true},modCommands:[compiled]}),true)
  assert.equal(directorCommands.byName['item.play'].configured({dimensions:{},items:{enabled:true}}),true)
  assert.equal(directorCommands.byName['item.play'].enabled({dimensions:{},items:{enabled:true},modCommands:[compiled]}),false)
  const command={...compiled,modId:manifest.id},params={...intent,name:'补给药'}
  assert.deepEqual(parseModDsl('item gain name="补给药" genre="药品"',[command]),{op:command.op,...params})
  assert.equal(parseModDsl('item show name="未登记 的物品" genre="药品" --force',[command]).force,true)
  assert.throws(()=>validateModCommand(command,{...params,name:'不存在'}),{code:'ITEM_UNKNOWN'})
  assert.throws(()=>parseModDsl('item gain name="回复药" genre="药品" count=5',[command]))
  assert.throws(()=>reduceAssetPackOperation({}, {op:command.op,...intent,name:'不存在'}, {modCommands:[command],actors:{},dimensions:{},catalogue:{rows:[],candidates:{}}}),{code:'ITEM_UNKNOWN'})
  assert.deepEqual(reduceAssetPackOperation({}, {op:command.op,...intent}, {modCommands:[command],actors:{},dimensions:{},catalogue:{rows:[],candidates:{}}}).state,{})
  assert.equal(compiled.params.properties.genre.enum.includes('钥匙'),true,'unrecalled utility genres remain valid')
  const off={...snapshot.packs[0],scope:'off'}
  assert.equal(itemCatalogue({packs:[off],recalled:snapshot.recalled}).genres.length,8,'Categories belong to the mod, not pack lamps')
  const unavailable=module.configure({manifest,catalogue:snapshot,bindings:{}}).commands[0]
  // private fork: presentation admission is independent of inventory.
  assert.throws(()=>validateModCommand(unavailable,intent),{code:'MOD_DEPENDENCY_MISSING'})
  validateModCommand(unavailable,{...intent,action:'show'})
})

test('icon resolution uses authorized core props and exact genre, never disabled entries or substring aliases',()=>{
  const snapshot=catalogueFixture(),local=snapshot.packs[0],global=structuredClone(local)
  global.id=otherId;global.scope='library';global.entries.at(-1).id='global-potion';global.entries.at(-1).ref=ownRef('global-potion',otherId);global.entries.at(-1).media='b'.repeat(64)
  const catalogue=itemCatalogue({packs:[global,local],recalled:[...snapshot.recalled,ownRef('global-potion',otherId)]})
  assert.equal(selectItem(catalogue,intent,options).iconRef.packId,packId)
  assert.throws(()=>selectItem(catalogue,{...intent,name:'回复'},options),{code:'ITEM_UNKNOWN'})
  local.entries.at(-1).enabled=false
  const noItem=itemCatalogue({packs:[local],recalled:snapshot.recalled})
  assert.throws(()=>selectItem(noItem,intent,options),{code:'ITEM_UNKNOWN'})
  assert.equal(selectItem(noItem,{...intent,force:true},options).iconRef.kind,'icon')
  local.entries.forEach(row=>row.enabled=false)
  assert.equal(selectItem(itemCatalogue({packs:[local]}),{...intent,force:true},options).iconRef.packId,'builtin')
  assert.equal(selectItem(catalogue,{...intent,action:'show'},{}).name,'回复药')
  assert.throws(()=>selectItem(catalogue,{...intent,force:true,genre:'未定义分类'},options),{code:'ITEM_GENRE_UNKNOWN'})
})

// private fork: MVU verifies recorded intentions without failing the turn.
test('receipt counts, duplicate/opposite/zero facts and show semantics never synthesize unmarked changes',()=>{
  const payload=selectItem(itemCatalogue(catalogueFixture()),intent,options)
  assert.equal(payload.count,undefined)
  const input=settlement([performance('first',payload),performance('duplicate',payload),performance('wrong',{...payload,action:'lose'}),performance('show',{...payload,action:'show'})])
  const result=reconcileItems(input)
  assert.deepEqual(result.map(row=>row.action),['replace','remove','remove','replace'])
  assert.equal(result[0].payload.count,4)
  assert.equal(result[3].payload.count,undefined)
  assert.deepEqual(reconcileItems({...input,performances:[]}),[])
  assert.equal(reconcileItems({...input,after:input.before})[0].action,'remove')
  assert.equal(reconcileItems({...input,bindings:{inventory:{...binding,path:'/other'}}})[0].payload.count,undefined)
  assert.equal(reconcileItems({...input,after:{inventory:[{id:'stock-med-7',name:'x',count:null}]}})[0].payload.count,undefined)
  assert.equal(reconcileItems({...input,bindings:{},performances:[performance('show',{...payload,action:'show'})]})[0].action,'replace')
})

test('S4 is off by default and bounded by names and bytes without altering catalogue legality',()=>{
  const rows=Array.from({length:30},(_,index)=>({id:String(index),name:'背包物品'+index,count:1}))
  assert.equal(inventoryContext(rows,binding),'')
  const text=inventoryContext(rows,binding,{enabled:true})
  assert.equal(JSON.parse(text).inventory.length,12);assert.ok(Buffer.byteLength(text)<=1024)
  assert.throws(()=>selectItem(itemCatalogue(catalogueFixture()),{...intent,name:rows[0].name},options),{code:'ITEM_UNKNOWN'})
})

test('registered item runtime places before settlement and reconciles through the real P3 derived engine',async t=>{
  const files=new Map(await Promise.all(manifest.files.map(async row=>[row.path,await readFile(new URL(row.path,root))])))
  const builtins=createBuiltinModRegistry([{manifest,files,module}]),library=createModRegistry({capabilities:['stage.place','stage.reviseAfterSettlement']})
  await library.install({manifest,packs,expectedRevision:library.snapshot().revision})
  await library.authorize({modId:manifest.id,allowed:true,expectedRevision:library.snapshot().revision})
  await library.setModScope({modId:manifest.id,scope:'global',expectedRevision:library.snapshot().revision})
  let store
  const stage=createModStageCorrections({read:async()=>store,update:async(_context,mutate)=>{const next=mutate(store);if(next)store=next}})
  const host=createModHostRuntime({library,builtins,sourceCurrent:()=>true,readText:async(_id,name)=>files.get(name).toString('utf8'),stagePort:stage})
  t.after(()=>host.dispose())
  const source={branchId:'branch',sourceKey:'source',generation:0,textVersion:'source'}
  const snapshot=await host.prepare({cardId:'card',gameId:'game',turn:1,source,authorityEpoch:1,catalogueRevision:'1',catalogues:{'dsh.items':catalogueFixture()},bindings:{'dsh.items':{inventory:binding}}})
  const result=await host.command(snapshot,{modId:manifest.id,commandId:'item',params:intent},{key:'0:0',at:2})
  assert.equal(result.ok,true)
  assert.equal(store.performances.length,1)
  assert.equal(projection.projectModPerformances(store)[0].payload.count,undefined)
  const context=snapshot.contexts[0],facts={...settlement([]),source,turn:1,status:'ok'}
  const original=structuredClone(store)
  await assert.rejects(stage.settlement(context,{...facts,source:{...source,generation:1}},()=>true,2),{code:'MOD_SOURCE_STALE'})
  assert.deepEqual(store,original,'A different generation cannot revise this source')
  await stage.settlement(context,facts,()=>true,2)
  const pending=await stage.pending(context)
  for(const task of host.settled(snapshot,pending))assert.equal((await task).ok,true)
  assert.equal(projection.projectModPerformances(store)[0].payload.count,4)
  assert.equal(store.performances[0].payload.count,undefined,'original intention is immutable')
  assert.equal(await stage.pending(context),null)
})


test('native card mapping RPC advertises declared mod slots and writes once under the existing card CAS',async()=>{
  const {createCardAssetBoundary}=await import('../tavern-plugin/lib/fork-card-asset-bindings.js')
  let workspace={raw:{extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[]}}}}},writes=0
  const api=createCardAssetBoundary({ctx:{get:()=>null},listCards:async()=>[{path:'card'}],readWorkspace:async()=>workspace,
    modManifests:async()=>[manifest],readVariableSources:async()=>({mvu:{available:true,value:{bag:[{id:'a',name:'药水',count:0}]}}}),
    updateCard:async(_path,_patch,_unused,ops)=>{workspace={raw:{extensions:{dsh_tavern:ops[0].value}}};writes++}})
  const before=await api.listVariableSlots({path:'card',sessionId:'session'}),slot=before.providers.find(row=>row.id==='mods').slots[0]
  assert.deepEqual(slot.target,{kind:'mods',modId:'dsh.items',slot:'inventory'})
  assert.equal(writes,0)
  const saved=await api.setVariable({path:'card',expectedRevision:before.revision,target:slot.target,variable:binding})
  assert.equal(writes,1)
  assert.equal((await api.listVariableSlots({path:'card',sessionId:'session'})).providers.find(row=>row.id==='mods').slots[0].value[0].count,0)
  await assert.rejects(api.clearVariable({path:'card',expectedRevision:before.revision,target:slot.target}),{code:'REVISION_CONFLICT'})
  assert.deepEqual(workspace.raw.extensions.dsh_tavern.assetBindings,{boundPackIds:[]})
  assert.equal(workspace.raw.extensions.dsh_tavern.modBindings,undefined,'mapping cannot turn on a mod')
  await api.clearVariable({path:'card',expectedRevision:saved.revision,target:slot.target});assert.equal(writes,2)
})

// private fork: uncertain settlement facts keep the original display.
test('ambiguous explicit aliases are rejected before placement, and unstable rename/owner facts are never guessed',()=>{
  const snapshot=catalogueFixture(),other=structuredClone(snapshot.packs[0].entries.at(-1))
  other.id='other-art';other.name='疗伤药';other.ref=ownRef(other.id);other.extensions['dsh.items'].inventoryId='another-stock'
  snapshot.packs[0].entries.push(other);snapshot.recalled.push(ownRef(other.id))
  const command=module.configure({manifest,catalogue:snapshot,bindings:{inventory:binding}}).commands[0]
  assert.throws(()=>validateModCommand(command,{...intent,name:'补给药'}),{code:'ITEM_AMBIGUOUS'})
  assert.throws(()=>selectItem(itemCatalogue(snapshot),{...intent,name:'补给药'},options),{code:'ITEM_AMBIGUOUS'})
  const payload={...selectItem(itemCatalogue(catalogueFixture()),intent,options),inventoryId:null,name:'old'}
  const input=settlement([performance('rename',payload)])
  input.before.inventory=[{name:'old',count:1}];input.after.inventory=[{name:'new',count:1}]
  assert.equal(reconcileItems(input)[0].payload.count,undefined)
  const mapped={...binding,fields:{...binding.fields,owner:'/owner'}}
  input.bindings.inventory=mapped;input.performances[0].payload.binding=JSON.stringify(mapped)
  input.before.inventory=[{id:'a',name:'old',count:1,owner:'A'},{id:'b',name:'other',count:1,owner:'B'}]
  input.after.inventory=[{id:'a',name:'old',count:2,owner:'A'},{id:'b',name:'other',count:1,owner:'B'}]
  assert.equal(reconcileItems(input)[0].payload.count,undefined)
})


test('resolved item media retains the full core ref and never private item identity',()=>{
  const view=itemCatalogue(catalogueFixture()),payload=selectItem(view,intent,options);
  assert.deepEqual(payload.ref,ownRef('potion-art'));assert.deepEqual(payload.iconRef,payload.ref);
  assert.equal('entryId' in payload.ref,false);assert.equal('modId' in payload.ref,false);
  const snapshot=catalogueFixture();snapshot.packs[0].entries[0].variants={default:'sealed',entries:[{id:'sealed',name:'封口',content:{media:'b'.repeat(64)}}]};
  delete snapshot.packs[0].entries[0].media;
  assert.deepEqual(selectItem(itemCatalogue(snapshot),intent,options).iconRef,payload.ref);
});

test('mod surface publishes initial text immediately and releases or rejects late media without replay',async()=>{
  const {default:{createModStageSurface}}=await import('../tavern-plugin/src/client/fork-mod-stage-surface.cjs')
  const {default:{forkItemsStagePresentation}}=await import('../fork/mods/items/presentation.cjs')
  const timers=new Map(),updates=[],revoked=[],requests=[];let id=0,created=0,resolve
  const ui=createModStageSurface({definitions:[forkItemsStagePresentation()],readMedia:args=>{requests.push(args);return new Promise(done=>{resolve=done})},
    createURL:()=>('blob:owned-'+(++created)),revokeURL:url=>revoked.push(url),onChange:rows=>updates.push(rows),clock:{setTimeout(fn){timers.set(++id,fn);return id},clearTimeout:id=>timers.delete(id)}})
  const value={id:'performance-a',kind:'dsh.items.item',source:{sourceKey:'source-a'},payload:{...intent,iconRef:ownRef('potion-art')}}
  const descriptor={kind:'mod-performance',performance:value},token={id:'token-a',source:{turn:1}}
  await ui.play(descriptor,token);assert.equal(requests.length,0)
  ui.reset(true);const pending=ui.play(descriptor,token)
  assert.equal(updates.at(-1)[0].performance.payload.count,undefined)
  assert.equal(updates.at(-1)[0].media.image,undefined)
  ui.reset(false);resolve({mime:'image/png',data:''});await pending
  assert.equal(created,0);assert.equal(updates.at(-1).length,0)
  ui.reset(true);const shown=ui.play(descriptor,{...token,id:'token-b'});resolve({mime:'image/png',data:''});await shown
  assert.equal(updates.at(-1)[0].media.image,'blob:owned-1')
  assert.deepEqual(requests[1],{turn:1,source:value.source,performanceId:value.id,ref:value.payload.iconRef,slot:'image'})
  timers.values().next().value();assert.deepEqual(revoked,['blob:owned-1']);assert.equal(updates.at(-1).length,0)
  ui.dispose();assert.equal(revoked.length,1);assert.equal(timers.size,0)
})

test('real item surface fits desktop and 375px and unmounts all owned image URLs',async()=>{
  const {chromium}=await import('playwright'),{mkdir}=await import('node:fs/promises')
  const names={react:['react','react.production.js'],'react-dom':['react-dom','react-dom.production.js'],'react-dom/client':['react-dom','react-dom-client.production.js'],scheduler:['scheduler','scheduler.production.js']}
  const modules=Object.fromEntries(await Promise.all(Object.entries(names).map(async([name,[owner,file]])=>[name,await readFile(new URL('cjs/'+file,new URL('.',import.meta.resolve(owner))),'utf8')])))
  const source=(await Promise.all(['../tavern-plugin/src/client/fork-mod-stage-surface.cjs','../tavern-plugin/src/client/fork-item-showcase.cjs','../fork/mods/items/presentation.cjs','../tavern-plugin/src/client/fork-mod-performance.js'].map(file=>readFile(new URL(file,import.meta.url),'utf8')))).join('\n')
  const css=(await Promise.all(['tavern.css','fork-theme.css'].map(file=>readFile(new URL('../tavern-plugin/lib/client-assets/'+file,import.meta.url),'utf8')))).join('\n')
  const image=await readFile(new URL('categories/medicine.png',root)),browser=await chromium.launch({headless:true,args:['--mute-audio']})
  try {
    for(const width of [1280,375]) {
      const page=await browser.newPage({viewport:{width,height:800}}),errors=[]
      page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort())
      await page.setContent('<style>'+css+' body{margin:0}.test-stage{position:relative;min-height:100vh}</style><main id="root" class="test-stage fork-gal-theme-scope" data-theme="classic"></main>')
      await page.evaluate(modules=>{const cache={},require=name=>{if(cache[name])return cache[name].exports;const value=cache[name]={exports:{}};new Function('module','exports','require',modules[name])(value,value.exports,require);return value.exports};window.React=require('react');window.ReactDOM={...require('react-dom'),...require('react-dom/client')};},modules)
      await page.evaluate(data=>{let created=0,released=0;const make=URL.createObjectURL.bind(URL),drop=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{created++;return make(blob)};URL.revokeObjectURL=url=>{released++;drop(url)};window.mediaStats=()=>({created,released});window.rpc=async()=>({mime:'image/png',data});},image.toString('base64'))
      await page.addScriptTag({content:source+'\nfunction App(){const surface=useForkModPerformances("offline",{live:true,skipping:false,overlay:false,sourceKey:"source-a",generation:0,assetRevision:"assets-a"});window.playItem=surface.play;window.cancelItems=surface.cancel;return surface.node;}window.surfaceRoot=ReactDOM.createRoot(document.getElementById("root"));ReactDOM.flushSync(()=>surfaceRoot.render(React.createElement(App)));'})
      await page.evaluate(async()=>{await playItem({kind:'mod-performance',performance:{id:'event-a',kind:'dsh.items.item',source:{sourceKey:'source-a'},payload:{action:'gain',name:'回复药',genre:'药品',count:4,iconRef:{modId:'dsh.items',packId:'pack',kind:'icon',entryId:'image'}}}},{id:'token-a',source:{turn:1}})})
      // private fork (item showcase B1): a floating item and its name, no card box.
      await page.locator('.fork-item-show img').waitFor()
      await page.locator('.fork-item-show img').evaluate(image=>image.decode())
      assert.match(await page.locator('.fork-item-show').textContent(),/回复药.*药品.*4/)
      const box=await page.locator('.fork-item-cap').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width+1)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      if(process.env.DSH_ITEMS_SCREENSHOTS){await mkdir(process.env.DSH_ITEMS_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.DSH_ITEMS_SCREENSHOTS+'/item-'+width+'.png'})}
      // Page navigation cancels the old surface without changing the hook's eligibility props.
      await page.evaluate(()=>ReactDOM.flushSync(()=>cancelItems({reason:'page-changed'})))
      assert.equal(await page.locator('.fork-item-show').count(),0)
      assert.deepEqual(await page.evaluate(()=>mediaStats()),{created:1,released:1})
      await page.evaluate(async()=>{await playItem({kind:'mod-performance',performance:{id:'event-b',kind:'dsh.items.item',source:{sourceKey:'source-a'},payload:{action:'show',name:'next page',genre:'misc',iconRef:{modId:'dsh.items',packId:'pack',kind:'icon',entryId:'image'}}}},{id:'token-b',source:{turn:1}})})
      await page.locator('.fork-item-show img').waitFor({timeout:2000})
      assert.match(await page.locator('.fork-item-show').textContent(),/next page/)
      await page.evaluate(()=>ReactDOM.flushSync(()=>surfaceRoot.unmount()))
      assert.deepEqual(await page.evaluate(()=>mediaStats()),{created:2,released:2});assert.deepEqual(errors,[])
      await page.close()
    }
  } finally {await browser.close()}
})

// private fork (item showcase B1, owner 2026-10): three tall figures fill the stage width; the floating item and its name
// keep clear of every face (also at the end of the 出示 zoom), the dim starts below the chins, and clicks pass through.
test('item showcase in front of three tall figures never covers a face',async()=>{
  const {chromium}=await import('playwright')
  const names={react:['react','react.production.js'],'react-dom':['react-dom','react-dom.production.js'],'react-dom/client':['react-dom','react-dom-client.production.js'],scheduler:['scheduler','scheduler.production.js']}
  const modules=Object.fromEntries(await Promise.all(Object.entries(names).map(async([name,[owner,file]])=>[name,await readFile(new URL('cjs/'+file,new URL('.',import.meta.resolve(owner))),'utf8')])))
  const source=(await Promise.all(['../tavern-plugin/src/client/fork-mod-stage-surface.cjs','../tavern-plugin/src/client/fork-item-showcase.cjs','../fork/mods/items/presentation.cjs','../tavern-plugin/src/client/fork-mod-performance.js'].map(file=>readFile(new URL(file,import.meta.url),'utf8')))).join('\n')
  const css=(await Promise.all(['tavern.css','fork-theme.css'].map(file=>readFile(new URL('../tavern-plugin/lib/client-assets/'+file,import.meta.url),'utf8')))).join('\n')
  const image=await readFile(new URL('categories/key.png',root)) // a tall icon (341×512) must still fit its square
  // Head/body boxes (stage %) of three real sprites at 155/157/165 cm, as the scene reports them through forkGalFigureSources.
  const cast=[{body:[-3.6,13.7,43.1,141.9],head:[7.8,14.8,11.7,23.5]},{body:[26.8,11.7,46.5,143.8],head:[44.7,14.7,9.6,26]},{body:[60.1,4.4,43.9,151.1],head:[77,5,9.4,24.5]}]
  const browser=await chromium.launch({headless:true,args:['--mute-audio']})
  try {
    const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[]
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort())
    await page.setContent('<style>'+css+' body{margin:0}</style><main class="fork-gal-stage" data-theme="classic"><div id="root"></div><div class="fork-gal-box" style="position:absolute;left:6%;right:6%;bottom:2%;height:26%"></div></main>')
    await page.evaluate(modules=>{const cache={},require=name=>{if(cache[name])return cache[name].exports;const value=cache[name]={exports:{}};new Function('module','exports','require',modules[name])(value,value.exports,require);return value.exports};window.React=require('react');window.ReactDOM={...require('react-dom'),...require('react-dom/client')};},modules)
    await page.evaluate(([data,cast])=>{window.rpc=async()=>({mime:'image/png',data});window.cast=cast;},[image.toString('base64'),cast])
    await page.addScriptTag({content:'const forkGalFigureSources=new WeakMap();\n'+source+'\nconst stage=document.querySelector(".fork-gal-stage"),px=(r,w,h)=>({x:r[0]*w/100,y:r[1]*h/100,width:r[2]*w/100,height:r[3]*h/100});'
      +'forkGalFigureSources.set(stage,()=>cast.map((f,i)=>({id:"f"+i,body:px(f.body,innerWidth,innerHeight),head:px(f.head,innerWidth,innerHeight)})));window.heads=()=>cast.map(f=>px(f.head,innerWidth,innerHeight));'
      +'function App(){const surface=useForkModPerformances("offline",{live:true,skipping:false,overlay:false,sourceKey:"s",generation:0,assetRevision:"a"});window.playItem=surface.play;window.cancelItems=surface.cancel;return surface.node&&React.cloneElement(surface.node,{accent:"#5e5d7b"});}'
      +'window.surfaceRoot=ReactDOM.createRoot(document.getElementById("root"));ReactDOM.flushSync(()=>surfaceRoot.render(React.createElement(App)));'})
    for(const action of ['gain','show']) {
      await page.evaluate(async action=>{cancelItems();await playItem({kind:'mod-performance',performance:{id:'e-'+action,kind:'dsh.items.item',source:{sourceKey:'s'},payload:{action,name:'珍珠奶茶',genre:'食物',count:action==='show'?undefined:2,iconRef:{modId:'dsh.items',packId:'p',kind:'item',entryId:'milk-tea'}}}},{id:'t-'+action,source:{turn:1}})},action)
      await page.locator('.fork-item-showcase:not(.is-measuring) .fork-item-show img').waitFor()
      await page.locator('.fork-item-show img').evaluate(image=>image.decode())
      const check=await page.evaluate(()=>{
        for(const a of document.getAnimations()){a.pause();a.currentTime=2450}
        const hit=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height,box=el=>{const r=el.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height}}
        const img=document.querySelector('.fork-item-show img'),r=img.getBoundingClientRect(),ar=img.naturalWidth/img.naturalHeight,w=Math.min(r.width,r.height*ar),h=w/ar
        const frame=img.parentElement.getBoundingClientRect(),inside=r.top>=frame.top-1&&r.bottom<=frame.bottom+1&&r.left>=frame.left-1&&r.right<=frame.right+1
        const drawn={x:r.left+(r.width-w)/2,y:r.top+(r.height-h)/2,width:w,height:h},lines=[...document.querySelectorAll('.fork-item-cap > *')].map(box),dim=document.querySelector('.fork-item-dim')
        const target=document.elementFromPoint(drawn.x+drawn.width/2,drawn.y+drawn.height/2)
        return {inside,dim:dim&&box(dim),heads:heads(),drawn,size:w,faces:heads().filter(face=>[drawn,...lines].some(r=>hit(r,face))).length,dimFaces:dim?heads().filter(face=>hit(box(dim),face)).length:-1,
          aboveBox:Math.max(drawn.y+drawn.height,...lines.map(r=>r.y+r.height))<=document.querySelector('.fork-gal-box').getBoundingClientRect().top,clickThrough:!target.closest('.fork-item-showcase')}
      })
      assert.equal(check.faces,0,action+': item or name over a face');assert.equal(check.dimFaces,0,action+': dim over a face '+JSON.stringify(check))
      assert.ok(check.inside && check.size>=60 && check.aboveBox && check.clickThrough,JSON.stringify(check))
    }
    assert.deepEqual(errors,[])
  } finally {await browser.close()}
})

// private fork (item showcase B1): pure placement — centre line, below faces, size steps, name above → below → beside.
test('item showcase placement keeps item and name off faces, the textbox and the chrome',async()=>{
  const {default:{forkItemShowcasePlace:place}}=await import('../tavern-plugin/src/client/fork-item-showcase.cjs')
  const hit=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height
  const W=1280,H=720,u=W/100,cap={width:160,height:52}
  const empty=place({width:W,height:H,boxTop:520,captions:[cap]})
  assert.equal(empty.size,17*u);assert.equal(empty.caption,'above');assert.equal(empty.items[0].x,W/2);assert.equal(empty.items[0].y,H*.4);assert.equal(empty.dim,null)
  const head={x:560,y:180,width:160,height:180},body={x:470,y:150,width:340,height:570}
  const one=place({width:W,height:H,boxTop:520,figures:[{head,body}],captions:[cap],show:true})
  const item=r=>({x:r.x-one.size*1.14/2,y:r.y-one.size*1.14/2-u,width:one.size*1.14,height:one.size*1.14+u})
  assert.ok(!hit(item(one.items[0]),head) && !hit(one.names[0],head),JSON.stringify(one))
  assert.ok(item(one.items[0]).y+item(one.items[0]).height<=520 && one.names[0].y+one.names[0].height<=520)
  assert.ok(one.dim && one.dim.y>=head.y+head.height && !one.forced,'the dim sits inside the halo below the face')
  // A cramped stage shrinks the item by steps and finally falls back to a forced minimum, never throwing.
  const cramped=place({width:W,height:H,boxTop:400,figures:[{head:{x:0,y:40,width:W,height:300},body:{x:0,y:0,width:W,height:H}}],captions:[cap]})
  assert.ok(cramped.forced && cramped.size===8*u)
  const two=place({width:W,height:H,boxTop:520,captions:[cap,{width:120,height:40,textOnly:true}]})
  assert.equal(two.items.length,2);assert.ok(['above','below'].includes(two.caption));assert.ok(two.items[0].x<two.items[1].x)
})

test('gain/lose require an inventory binding but show is immediate without one',async()=>{
  let placed;const host={settings:{get:async()=>({values:{}})},library:{snapshot:async()=>catalogueFixture()},stage:{place:async row=>(placed=row)}};
  for(const action of ['gain','lose'])await assert.rejects(module.command({params:{...intent,action}},host,{variableBindings:{}}),{code:'MOD_DEPENDENCY_MISSING'});
  assert.equal(placed,undefined);
  await module.command({params:{...intent,action:'show'}},host,{variableBindings:{}});
  assert.equal(placed.payload.action,'show');assert.equal(placed.pairing,undefined);assert.equal(placed.payload.count,undefined);
});

// private fork: verified contradiction removes the record, not the already watched event.
test('MVU no-change removes the recorded gain after initial display',()=>{
  const payload=selectItem(itemCatalogue(catalogueFixture()),intent,options)
  const input=settlement([performance('gain',payload)])
  input.after=input.before
  const result=reconcileItems(input)
  assert.equal(payload.count,undefined)
  assert.equal(result[0].action,'remove')
  assert.equal(result[0].reason,'no-change')
})

test('force:false show needs no inventory; an unrecalled name fails admission with an actionable force retry',async()=>{
  const snapshot=catalogueFixture(),pack=snapshot.packs[0],row=pack.entries[0];
  row.name='蛋糕';row.category='food';row.media=null;row.recall={mode:'keyword',keywords:['奶油蛋糕']};
  const compiled=module.configure({manifest,catalogue:snapshot,bindings:{}}).commands[0];
  const params={action:'show',name:'蛋糕',genre:'食物',force:false};
  validateModCommand(compiled,params);
  const placed=[];
  const host={settings:{get:async()=>({values:{}})},library:{snapshot:async()=>snapshot},stage:{place:async value=>{placed.push(value);return value;}}};
  await module.command({params},host,{});
  assert.equal(placed.length,1);assert.equal(placed[0].payload.name,'蛋糕');
  assert.equal(placed[0].payload.iconRef.kind,'icon','missing dedicated artwork uses a category icon, not a drop');
  assert.equal(placed[0].pairing,undefined,'display-only does not await inventory settlement');
  const unrecalled=module.configure({manifest,catalogue:{...snapshot,recalled:[]},bindings:{}}).commands[0];
  assert.throws(()=>validateModCommand(unrecalled,params),error=>error.code==='ITEM_UNKNOWN' && /force:true/.test(error.message) && /category icon/.test(error.message));
  const retry={...params,force:true};validateModCommand(unrecalled,retry);
  await module.command({params:retry},{...host,library:{snapshot:async()=>({...snapshot,recalled:[]})}},{});
  assert.equal(placed.length,2);assert.equal(placed[1].payload.name,'蛋糕');
});

test('P4 logical UI bands protect host input, regions, mobile layout and release bounded surfaces',async t=>{
  const {chromium}=await import('playwright')
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  await page.setContent('<div class="fork-gal-stage" id="stage"><button id="advance">Advance</button><div class="fork-cg-stage"></div><div class="fork-tc-layer"></div><button class="fork-gal-box" id="input">Input</button><div class="fork-gal-menu" hidden></div></div>')
  await page.addStyleTag({content:await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css',import.meta.url),'utf8')})
  await page.addStyleTag({content:'body{margin:0}#stage{position:relative;width:100vw;height:100vh}#advance{position:absolute;inset:0;width:100%;height:100%}#input{position:absolute;left:10px;bottom:10px;width:100px;height:40px}.fork-cg-stage{display:block}.fork-tc-layer{position:absolute;inset:0;pointer-events:none}.fork-mod-ui-layer button{position:absolute;top:60px;left:20px;width:80px;height:40px} [hidden]{display:none!important}'})
  await page.addScriptTag({content:await readFile(new URL('../tavern-plugin/src/client/fork-mod-stage-surface.cjs',import.meta.url),'utf8')})
  await page.evaluate(()=>{
    window.released=0;window.clicked=[]
    document.getElementById('advance').onclick=()=>clicked.push('advance')
    document.getElementById('input').onclick=()=>clicked.push('input')
    const render=({root,viewport})=>{window.viewport=viewport;const button=document.createElement('button');button.textContent='Region';button.dataset.modInput='';button.onclick=()=>clicked.push('region');root.append(button);return {dispose(){released++}}}
    const stage=document.getElementById('stage')
    window.layers=createModUiLayerHost({root:stage,renderers:{'dsh.a/view.js':render,'dsh.b/view.js':render}})
    window.declarations=['b','a'].map(id=>({modId:'dsh.'+id,id:'view',entry:'view.js',band:'audience',order:0,input:'regions',playback:'recorded',budget:{maxNodes:4,maxVisible:1}}))
    layers.sync(declarations,{})
  })
  for(const width of [1280,375]) {
    await page.setViewportSize({width,height:800})
    await page.evaluate(()=>layers.sync(declarations,{}))
    const state=await page.evaluate(()=>({order:[...document.querySelectorAll('.fork-mod-ui-layer')].map(n=>n.dataset.band),z:[...document.querySelectorAll('.fork-cg-stage,.fork-tc-layer,.fork-mod-ui-layer,#input')].map(n=>Number(getComputedStyle(n).zIndex)),width:document.documentElement.scrollWidth,safe:modStageViewport(document.getElementById('stage')).safeRegions}))
    assert.deepEqual(state.z,[3,4,6,5,5]);assert.equal(state.width,width);assert.ok(state.safe.length)
    await page.mouse.click(width-20,200);assert.equal(await page.evaluate(()=>clicked.at(-1)),'advance')
    await page.locator('#input').click();assert.equal(await page.evaluate(()=>clicked.at(-1)),'input')
    await page.mouse.click(40,80);assert.equal(await page.evaluate(()=>clicked.at(-1)),'region')
    await page.locator('#input').focus();await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>clicked.at(-1)),'input')
  }
  await page.evaluate(()=>layers.sync([declarations[0]],{}));assert.equal(await page.evaluate(()=>released),1)
  await page.evaluate(()=>layers.dispose());assert.equal(await page.locator('.fork-mod-ui-layer').count(),0);assert.equal(await page.evaluate(()=>released),2)
})


test('item corrections never replay a viewed card or make an unviewed card wait for settlement',async()=>{
  const {default:runtime}=await import('../tavern-plugin/src/client/fork-stage-runtime.cjs');
  const source={sessionId:'s',authorityEpoch:0,branchId:'b',turn:2,sourceKey:'body',generation:0};
  const pages=[1,2,3].map(para=>({anchor:{paragraphId:'p'+para,para,offset:0}})),text={revision:1,streaming:false,hasReadableText:true,pages};
  const payload=selectItem(itemCatalogue(catalogueFixture()),intent,options);
  const first={id:'first',modId:manifest.id,at:2,kind:'dsh.items.item',revision:0,payload},second={...first,id:'second',at:3};
  let state=runtime.createStageRuntimeState(),effects=[];
  const send=event=>{({state,effects}=runtime.reduceStageRuntime(state,event));return effects};
  const snapshot=(revision,rows)=>send({type:'DIRECTOR_SNAPSHOT',source,envelope:{phase:'done',revision,generation:0,bindingKey:'binding',prefixRevision:1,through:3,complete:true,baseline:{},entries:[],modCorrectionRevision:revision,modPerformances:rows}});
  send({type:'SEND',source,text});snapshot(1,[first,second]);send({type:'PAGE',index:1});
  const shot=effects.find(row=>row.type==='prepare-one-shot');assert.ok(shot,'Unsettled gain plays at its page');
  send({type:'ONE_SHOT_READY',token:shot.token});assert.ok(effects.some(row=>row.type==='play-one-shot'));
  snapshot(2,[{...first,revision:1,payload:{...payload,count:4}},second]);
  assert.equal(effects.some(row=>row.type==='prepare-one-shot'),false,'A corrected viewed card is not replayed');
  send({type:'PAGE',index:2});assert.equal(effects.find(row=>row.type==='prepare-one-shot').descriptor.performance.id,'second');
  assert.equal(effects.find(row=>row.type==='prepare-one-shot').descriptor.performance.payload.count,undefined,'The unviewed card does not wait for a future correction');
});


test('generic dock yields one themed 16:9 stage and restores it at mobile width',async t=>{
  const {chromium}=await import('playwright')
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  await page.setContent('<div id="frame" style="position:relative;width:100vw;height:100vh"><div id="stage" data-theme="magical" data-fk-context="stage-magical" style="position:absolute;inset:0"></div></div>')
  await page.addStyleTag({content:'body{margin:0}'})
  await page.addScriptTag({content:await readFile(new URL('../tavern-plugin/src/client/fork-mod-stage-surface.cjs',import.meta.url),'utf8')})
  const wide=await page.evaluate(()=>{
    window.dock=createModStageDock(document.getElementById('stage'))
    const slots=dock.request('a',{side:'right'}),rect=document.getElementById('stage').getBoundingClientRect()
    return {ratio:rect.width/rect.height,below:!!slots.below,theme:slots.column.dataset.theme,other:dock.request('b',{side:'right'}),overflow:document.documentElement.scrollWidth}
  })
  assert.ok(Math.abs(wide.ratio-16/9)<0.001);assert.equal(wide.below,true);assert.equal(wide.theme,'magical');assert.equal(wide.other,null);assert.equal(wide.overflow,1280)
  await page.setViewportSize({width:375,height:800})
  const narrow=await page.evaluate(()=>({slots:dock.request('a',{side:'right'}),count:document.querySelectorAll('.fork-mod-dock').length,width:document.getElementById('stage').getBoundingClientRect().width}))
  assert.equal(narrow.slots,null);assert.equal(narrow.count,0);assert.equal(narrow.width,375)
  await page.setViewportSize({width:1280,height:800})
  await page.evaluate(()=>{dock.request('b',{side:'right'});dock.dispose()})
  assert.equal(await page.locator('.fork-mod-dock').count(),0)
})
