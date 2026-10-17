// private fork: P4 owns explicit background/time selection. Legacy category stand-ins are removed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import vm from 'node:vm'
import {projectBackgroundTime,stageTimeLook,CORE_TIME_PARAMS} from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-time.js'
import {assetContent,assetContentMedia,assetDocument} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variant-content.js'
import {selectAssetVariant,variantTarget,assetVariantCandidate,VARIANT_SWITCH_SCHEMA} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variants.js'
import {validateAsset,validatePackManifest} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
import {createPackSceneLayers} from '../tavern-plugin/src/client/fork-pack-playback.cjs'
import {isMetadataEdit} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/metadata-edit.js'
import {sealPack,verifyBytes,inspectPackScripts,jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {copyPackItems} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/copy-items.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {syntheticPack,PACK_ID} from './fixtures/asset-packs/pack.mjs'

const scene = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const ctx = {}
vm.runInNewContext(scene.slice(scene.indexOf('// ---------- Scene helpers'), scene.indexOf('// ---------- Scene runtime')), ctx)

test('reserved ids select time art; absent keys and null select the sole default without guessing names', () => {
  const background={kind:'backgrounds',variants:{default:'base',entries:[{id:'base',name:'夜晚',content:{media:'base'}},{id:'dusk',name:'夕照',content:{media:'sunset'}},{id:'night',name:'星空',content:{media:'moon'}}]}}
  for(const [time,media] of [['dusk','sunset'],['night','moon']])assert.deepEqual(projectBackgroundTime(background,time),{media,variant:time,timeMatched:true,compensateBackground:false,diagnostics:[]})
  for(const time of ['day',null])assert.deepEqual(projectBackgroundTime(background,time),{media:'base',variant:'base',timeMatched:false,compensateBackground:true,diagnostics:[]})
  assert.equal(projectBackgroundTime({kind:'backgrounds',media:'plain'},'night').media,'plain')
  assert.throws(()=>projectBackgroundTime(background,'rain'))
})
test('same-scene image time changes use a 2500 ms crossfade even while skipping, replay snapshots still cut', () => {
  const desc = { background: { scene: 'Room' }, timeFadeMs: 2500, skipping: true }
  assert.equal(ctx.forkGalBackgroundTransition('cut', desc, { scene: 'Room' }).duration, 2500)
  assert.equal(ctx.forkGalBackgroundTransition('cut', desc, { scene: 'Room' }).kind, 'fade')
  assert.equal(ctx.forkGalBackgroundTransition('cut', { ...desc, snap: true }, { scene: 'Room' }).duration, 0)
  assert.notEqual(ctx.forkGalBackgroundTransition('fade', desc, { scene: 'Other' }).duration, 2500)
})

const base=kind=>({kind,id:'asset-1',name:'展示名称',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:''})
const table=content=>({default:'opaque-a',entries:[{id:'opaque-a',name:'原版',content},{id:'opaque-b',name:'夜景',content:{...content}}]})
test('flat content validation rejects mixed identity, legacy formats and image/audio closure mistakes',async()=>{
  const pack=await syntheticPack(),image=Object.keys(pack.manifest.blobs).find(hash=>pack.manifest.blobs[hash].mime==='image/png'),audio=pack.manifest.assets.find(a=>a.kind==='music').media
  pack.manifest.assets=[]
  for(const kind of ['backgrounds','cg','props','music','sfx','ambience','looks','directions']){
    const content=kind==='looks'?{layer:'mood',params:{texture:image}}:kind==='directions'?{text:'A scene direction'}:{media:['music','sfx','ambience'].includes(kind)?audio:image}
    const asset={...base(kind),variants:table(content)};validateAsset(asset);pack.manifest.assets.push(asset)
  }
  validatePackManifest(pack.manifest)
  assert.deepEqual(assetContentMedia(pack.manifest.assets[0]),[{hash:image,type:'image/'}])
  for(const mutate of [a=>a.media=image,a=>a.variants.default='missing',a=>a.variants.entries[0].content.kind='music',a=>a.variants.entries[0].content.recall={},a=>a.variants.entries[0].content.time='night']){
    const asset=structuredClone(pack.manifest.assets[0]);mutate(asset);assert.throws(()=>validateAsset(asset))
  }
  for(const [kind,media] of [['props',audio],['music',image],['backgrounds',audio],['cg',audio]]){
    const bad=structuredClone(pack.manifest);bad.assets=[{...base(kind),variants:table({media})}];assert.throws(()=>validatePackManifest(bad),{code:'MISSING_DEPENDENCY'})
  }
  for(const asset of [{...base('backgrounds'),media:image,variants:{night:image}},{...base('cg'),defaultVariant:'base',variants:[{key:'base',label:'Base',media:image}]},{...base('looks'),layer:'time',timeOfDay:'day',params:{}}])assert.throws(()=>validateAsset(asset))
  validateAsset({...base('props'),media:null,pendingMedia:true});assert.throws(()=>validateAsset({...base('props'),media:null}))
  const target={id:'33333333-3333-4333-8333-333333333333',assets:[],blobs:{},bundles:{},files:[]},files=new Map()
  copyPackItems(pack,[{kind:'props',id:'asset-1'},{kind:'music',id:'asset-1'}],target,files,new Set())
  assert.equal(target.assets.length,2);assert.equal([...files.keys()].filter(name=>name.startsWith('media/')).length,2)
  assert.equal(files.get('media/'+image+'.png'),pack.files.get('media/'+image+'.png'))
})
test('stable ids, explicit defaults and multi-active refs do not infer a name or emit a playback event',()=>{
  const asset={...base('sfx'),variants:table({media:'a'.repeat(64)})},before=structuredClone(asset)
  assert.equal(selectAssetVariant(asset).id,'opaque-a');assert.equal(selectAssetVariant(asset,'opaque-b').name,'夜景')
  assert.throws(()=>selectAssetVariant(asset,'夜景'),{code:'REF_UNAVAILABLE'})
  assert.throws(()=>selectAssetVariant({...base('sfx'),media:'a'.repeat(64)},'opaque-a'),{code:'REF_UNAVAILABLE'})
  const a={packId:PACK_ID,kind:'ambience',assetId:'first'},b={...a,assetId:'second'}
  assert.deepEqual(variantTarget([a]),a);assert.deepEqual(variantTarget([a,b],b),b)
  assert.throws(()=>variantTarget([a,b]),{code:'REF_UNAVAILABLE'});assert.throws(()=>variantTarget([]),{code:'REF_UNAVAILABLE'})
  assert.throws(()=>variantTarget([a],b),{code:'REF_UNAVAILABLE'})
  assert.equal(assetContent(asset,'opaque-b').media,'a'.repeat(64));assert.deepEqual(asset,before)
  const manifest={assets:[asset]},next=structuredClone(manifest);next.assets[0].variants.default='opaque-b';next.assets[0].variants.entries[0].name='异名'
  assert.equal(isMetadataEdit({manifest,figures:{}},next,{}),true)
  next.assets[0].variants.entries[0].content.media='b'.repeat(64);assert.equal(isMetadataEdit({manifest,figures:{}},next,{}),false)
})
test('core Japanese dusk/night parameters grade figures and compensate only unmatched backgrounds',async()=>{
  const looks=await readFile(new URL('../tavern-plugin/src/client/fork-gal-looks.js',import.meta.url),'utf8')
  const light=await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-light.cjs',import.meta.url),'utf8')
  const math={};vm.runInNewContext(light+scene.slice(scene.indexOf('// ---------- Scene helpers'),scene.indexOf('// ---------- Scene runtime'))+looks.slice(looks.indexOf('// ---------- Look helpers'),looks.indexOf('// ---------- Look runtime'))+';Object.assign(this,{forkGalMatrix});',math)
  const layers=createPackSceneLayers({normalize:math.forkGalLookNormalize,matrix:math.forkGalLookMatrix,extras:math.forkGalLookExtras,compose:math.forkGalLookCompose,multiply:math.forkGalMatrix.multiply,identity:math.forkGalMatrix.identity})
  const plain=value=>JSON.parse(JSON.stringify(value)),neutral=plain(math.forkGalMatrix.identity())
  assert.deepEqual(CORE_TIME_PARAMS.dusk.gain,[1,0.86,0.72]);assert.deepEqual(CORE_TIME_PARAMS.night.standIn.gain,[0.48,0.54,0.74])
  for(const timeOfDay of ['day','dusk','night',null])for(const compensateBackground of [false,true]){
    const projected=layers({timeOfDay,time:stageTimeLook(timeOfDay),compensateBackground})
    if(timeOfDay==='day'||timeOfDay===null){assert.deepEqual(plain(projected.figureGrade),neutral);assert.deepEqual(plain(projected.backgroundGrade),neutral)}
    else {assert.notDeepEqual(plain(projected.figureGrade),neutral);if(compensateBackground)assert.notDeepEqual(plain(projected.backgroundGrade),neutral);else assert.deepEqual(plain(projected.backgroundGrade),neutral)}
  }
})
test('candidate bytes only grow for recalled tables; static switch grammar has no per-turn enum',t=>{
  const bytes=value=>Buffer.byteLength(JSON.stringify(value)),plain=base('backgrounds'),rich={...plain,variants:table({media:'a'.repeat(64)})}
  const project=entries=>entries.map(({variants,...entry})=>({...entry,...(variants?{variants:assetVariantCandidate({variants})}:{})}))
  const before=bytes(project([plain])),after=bytes(project([rich])),empty=bytes(project([])),schema=bytes(VARIANT_SWITCH_SCHEMA)
  t.diagnostic(JSON.stringify({noVariants:{before,after:before,delta:0},recalledVariants:{before,after,delta:after-before},unrecalled:{before:empty,after:empty,delta:0},staticSwitchSchemaBytes:schema}))
  assert.equal(assetVariantCandidate(plain),undefined);assert.equal(JSON.stringify(VARIANT_SWITCH_SCHEMA).includes('opaque-a'),false)
  assert.equal(JSON.stringify(project([rich])).includes('a'.repeat(64)),false)
})

test('variant editor uses names, preserves ids/default and never autoplays on desktop and mobile',async t=>{
  const {chromium}=await import('playwright'),{browserReactScript}=await import('./fixtures/browser-react.mjs'),{stageSource}=await import('./harness/card-centric-stage.mjs'),{forkThemeCss}=await import('./helpers/fork-theme-css.mjs')
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  let {source}=await stageSource()
  source=await readFile(new URL('../tavern-plugin/src/client/fork-cg-consumer.cjs',import.meta.url),'utf8')+'\n'+source
  const cg=await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-cg-ui.js',import.meta.url),'utf8'),table=await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variant-table.cjs',import.meta.url),'utf8')
  source=source.replace('// @include fork-asset-pack-cg-ui.js',()=>cg.replace('// @include-protocol asset-variant-table.cjs',()=>table))
  for(const width of [1280,375])for(const kind of ['props','backgrounds','sfx']){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.setContent('<div id="app" class="ap-ui"></div>');await page.addStyleTag({content:await forkThemeCss()})
    await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM=modules["react-dom/client"];\n'+source+
      '\nconst h=React.createElement,views=createForkAssetPackUI(React),root=ReactDOM.createRoot(document.getElementById("app"));\n'+
      'let value='+JSON.stringify({...base(kind),variants:tableFixture()})+';window.readAsset=()=>value;window.played=0;\n'+
      'const audio={state:null,stop(){},toggle(){window.played++}},binding={previewMedia:async()=>({url:"data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22/%3E",release(){}})};'+
      'function render(){root.render(h(views.EntryDetail,{binding,pack:{manifest:{id:"'+PACK_ID+'",name:"Offline",assets:[value]}},asset:value,audio,commit:async(k,id,update)=>{value=update(value);render();}}));}render();'})
    await page.getByRole('button',{name:'添加变体',exact:true}).waitFor()
    assert.equal(await page.getByText('opaque-a',{exact:true}).count(),0)
    await page.getByRole('button',{name:'添加变体',exact:true}).click()
    await page.waitForFunction(()=>readAsset().variants.entries.length===3)
    const current=await page.evaluate(()=>readAsset());assert.equal(current.variants.default,'opaque-a');assert.deepEqual(current.variants.entries.slice(0,2).map(row=>row.id),['opaque-a','opaque-b'])
    await page.getByRole('button',{name:'预览：新变体',exact:true}).press('ArrowDown')
    await page.getByRole('menuitemradio',{name:'星空',exact:true}).click()
    assert.deepEqual(await page.evaluate(()=>readAsset()),current)
    await page.getByRole('button',{name:'默认：原版',exact:true}).click()
    await page.getByRole('menuitemradio',{name:'星空',exact:true}).click()
    await page.waitForFunction(()=>readAsset().variants.default==='opaque-b')
    const name=page.getByRole('textbox',{name:'名称',exact:true}).last();await name.fill('异名');await name.press('Enter')
    await page.waitForFunction(()=>readAsset().variants.entries[1].name==='异名')
    assert.equal(await page.evaluate(()=>readAsset().variants.entries[1].id),'opaque-b')
    assert.equal(await page.evaluate(()=>played),0)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+' horizontal fit')
    assert.deepEqual(errors,[]);await page.close()
  }
  for(const variants of [tableFixture(),null]){
    const page=await browser.newPage({viewport:{width:375,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.setContent('<div id="app" class="ap-ui"></div>');await page.addStyleTag({content:await forkThemeCss()})
    const initial={...base('cg'),...(variants?{variants}:{media:'a'.repeat(64),description:'Original action'})}
    await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM=modules["react-dom/client"];\n'+source.replace('return {App,Home,','return {CgEntryEditor,App,Home,')+
      '\nconst h=React.createElement,views=createForkAssetPackUI(React),root=ReactDOM.createRoot(document.getElementById("app"));\n'+
      'let value='+JSON.stringify(initial)+';window.readAsset=()=>value;window.saved=0;\n'+
      'const binding={previewMedia:async()=>({url:"data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22/%3E",release(){}})};'+
      'function render(){root.render(h(views.CgEntryEditor,{binding,pack:{manifest:{id:"'+PACK_ID+'",assets:[value],blobs:{}},revision:"r"},asset:value,save:async next=>{value=next;window.saved++;render();return {snapshot:{revision:"next"}};}}));}render();'})
    const name=page.getByRole('textbox',{name:'差分名称',exact:true});await name.waitFor()
    assert.equal(await page.getByRole('button',{name:'保存',exact:true}).count(),0)
    await name.fill('新的名称');await name.press('Enter');await page.getByRole('button',{name:'保存',exact:true}).click()
    await page.waitForFunction(()=>saved===1)
    const result=await page.evaluate(()=>readAsset());validateAsset(result)
    assert.equal(result.variants.entries[0].id,variants?'opaque-a':'base');assert.equal(result.variants.entries[0].name,'新的名称')
    assert.equal(Object.hasOwn(result,'media'),false);assert.deepEqual(errors,[]);await page.close()
  }
  function tableFixture(){return {default:'opaque-a',entries:[{id:'opaque-a',name:'原版',content:{media:'a'.repeat(64)}},{id:'opaque-b',name:'星空',content:{media:'b'.repeat(64)}}]}}
})

test('bundle variants retain every document through import preview/read-back and report nondefault widget variable authority',async t=>{
  const pack=await syntheticPack(),widget=pack.manifest.assets.find(asset=>asset.kind==='widgets')
  pack.manifest.assets=[widget]
  const document=JSON.parse(pack.files.get('bundles/widget/widget.json'))
  document.variables={reads:{balance:{source:'mvu',path:'/balance'}}}
  pack.files.set('bundles/second/widget.json',jsonBytes(document));pack.files.set('bundles/second/index.html',Buffer.from('<script>void 0</script>'))
  pack.manifest.bundles.second={...pack.manifest.bundles.widget}
  widget.variants={default:'first',entries:[{id:'first',name:'原版',content:{bundleKey:widget.bundleKey,entry:widget.entry}},{id:'other',name:'扩展',content:{bundleKey:'second',entry:'widget.json'}}]}
  delete widget.bundleKey;delete widget.entry
  await sealPack(pack.manifest,pack.files)
  const verified=await verifyBytes(pack.manifest,pack.files)
  assert.equal(verified.widgets.clock.variables,undefined)
  assert.deepEqual(assetDocument(verified,widget,'other').variables,document.variables)
  const risk=inspectPackScripts(verified)
  assert.ok(risk.some(row=>row.widgetId==='clock'&&row.path==='bundles/second/index.html'))
  assert.ok(risk.some(row=>row.variables?.reads[0].path==='/balance'))
  await mkdir(new URL('../.tmp/',import.meta.url),{recursive:true})
  const root=await mkdtemp(new URL('../.tmp/p5-variants-',import.meta.url)),service=createAssetPackService({assetRoot:root+'/assets'})
  t.after(async()=>{await service.dispose();await rm(root,{recursive:true})})
  const zip=root+'/source.zip'
  await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
  const preview=await service.inspectImport({bytes:await readFile(zip)})
  assert.deepEqual(preview.incoming.variantDocuments,verified.variantDocuments)
  await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'install',acceptScriptRisk:true})
  const snapshot=await service.getPackSnapshot({packId:pack.manifest.id})
  assert.deepEqual(snapshot.variantDocuments,preview.incoming.variantDocuments)
  widget.variants.default='other'
  assert.deepEqual(assetDocument(verified,widget).variables,document.variables)
})


test('production import names pre-P5 fields and requests a current re-export without conversion',async t=>{
  const {tmpdir}=await import('node:os'),{join}=await import('node:path')
  const root=await mkdtemp(join(tmpdir(),'pre-p5-import-')),service=createAssetPackService({assetRoot:join(root,'library')})
  t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true})})
  for(const [index,legacy] of [{baseTime:'day'},{variants:{night:'a'.repeat(64)}},{kind:'cg',defaultVariant:'base',variants:[{key:'base',label:'Original',media:'a'.repeat(64)}]}].entries()) {
    const pack=await syntheticPack()
    Object.assign(pack.manifest.assets[0],legacy)
    await sealPack(pack.manifest,pack.files)
    const zip=join(root,index+'.zip')
    await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
    await assert.rejects(service.inspectImport({bytes:await readFile(zip)}),error=>error.code==='PRE_P5_FORMAT' && error.path==='$.assets[0]' && /pre-P5/.test(error.message) && /DSH Tavern/.test(error.message))
  }
  assert.deepEqual(await service.listPacks(),[])
})
