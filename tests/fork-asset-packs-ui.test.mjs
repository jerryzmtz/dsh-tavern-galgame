import {validateFigureClosure} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure.js'
import {importFigureVariants} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/import-figure-variants.js' // private fork
// private fork (rename-mod, owner 2026-10): the user-facing widget term is 模组 (display text only; ids stay widgets).
// private fork: sprite/avatar variant labels use the owner term chafen.
// private fork: expand the shared emotion dependency in isolated client fragments.
import {withSpriteEmotionSource} from './helpers/sprite-emotion-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {webcrypto,createHash} from 'node:crypto'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'
import {syntheticPack,cardExtension,PACK_ID,FIGURE_ID,OTHER_PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {searchPackFigures} from '../tavern-plugin/lib/domain/figure-search.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
const variantTableSource=await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variant-table.cjs',import.meta.url),'utf8')
let source=await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-ui.js',import.meta.url),'utf8')
// private fork: production shared colour contract.
source=source.split('// @include-shared figure-auto-color.cjs').join(await readFile(new URL('../tavern-plugin/shared/figure-auto-color.cjs',import.meta.url),'utf8'));
source=source.split('// @include-shared asset-image-publication.cjs').join(await readFile(new URL('../tavern-plugin/shared/asset-image-publication.cjs',import.meta.url),'utf8'));
// private fork: UI and transcript evaluate the same pure avatar resolver.
source=source.split('// @include-protocol director-commands.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs',import.meta.url),'utf8'));
source=source.split('// @include-domain pack-avatar.cjs').join(withSpriteEmotionSource(await readFile(new URL('../tavern-plugin/lib/domain/pack-avatar.cjs',import.meta.url),'utf8')));
// private fork (voice v4 P1): the figure voice page is its own included module.
for(const name of ['figure','spine','import','voice','card','opening','character','engine','entry','gen','catalogue','setup','cg'])source=source.split('// @include fork-asset-pack-'+name+'-ui.js').join(await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-'+name+'-ui.js',import.meta.url),'utf8'))
source=source.replace('// @include-protocol asset-variant-table.cjs',()=>variantTableSource)
// private fork (D05): the CG editor's composition reads the stage's CG geometry (same bundle scope in main.js).
source=await readFile(new URL('../tavern-plugin/src/client/fork-cg-consumer.cjs',import.meta.url),'utf8')+'\n'+source

// private fork: the shared ForkSpinner is bundled before the asset views (main.js).
// private fork: new settings controls use the same production declaration validator.
for(const name of ['fork-widget-contracts.cjs','fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js'] /* private fork: mod library lives inside the pack UI closure */){const included=await readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8');source=source.replace('// @include '+name,()=>included)}
source=forkSpinnerSource+'\n'+source
const bubbleSource=await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js',import.meta.url),'utf8');
const pickerSource=bubbleSource.slice(bubbleSource.indexOf('function ForkBubbleLibraryPicker'),bubbleSource.indexOf('// Portrait chip:'));
const bindingSource=await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-binding.js',import.meta.url),'utf8')
// private fork (outfit polish): a dialog's 删除 / 取消, not a selected item's quiet text action of the same name (reached by aria-label).
// private fork (figure select): the topmost dialog's button first (a confirm's 删除 over the delete mode's 删除 pill).
const button=(tree,label)=>{const match=n=>n.type==='button'&&text(n)===label;for(const d of walk(tree).filter(n=>n.props.role==='dialog').reverse()){const hit=walk(d).find(match);if(hit)return hit}return walk(tree).find(match)}
class FakeAudio{static playing=[];constructor(url){this.url=url;this.volume=1;}async play(){FakeAudio.playing.push(this)}pause(){FakeAudio.playing=FakeAudio.playing.filter(a=>a!==this)}}
// private fork: a field with a 「?」 is a div.ap-field; private fork (inline-field sweep): or a ForkInlineField / ForkInlineRow (the ? button must not sit inside the <label>).
const field=(tree,label)=>walk(walk(tree).find(n=>(n.type==='label'||n.props.className==='ap-field'||/^ap-form-row( |$)|(^| )fork-inline-field( |$)/.test(n.props.className||''))&&text(n).startsWith(label))).find(n=>['input','select','textarea'].includes(n.type))
// private fork (owner 2026-10 library toolbar): the kind filter is a menu button on the search row (filter icon + chosen kind).
async function pickKind(f,tree,label){walk(tree).find(n=>String(n.props['aria-label']||'').startsWith('按种类筛选：')).props.onClick();tree=await f.r.settle();walk(tree).find(n=>n.props.role==='menuitemradio'&&/ap-kind-option/.test(n.props.className||'')&&text(n)===label).props.onClick();return f.r.settle()}
async function fixture(t,screen,extra={}){
  const r=assetRenderer();t.after(()=>r.dispose());
  const storage=new Map(),context={React:r.React,crypto:webcrypto,TextEncoder,AbortController,Audio:FakeAudio,forkForeground:{media:node=>node},// private fork: the bundle's foreground gate (fork-foreground.js)
    setTimeout,clearTimeout,setInterval,clearInterval,document:{activeElement:null,addEventListener(){},removeEventListener(){}},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))}},calls=[],listeners=new Set();vm.runInNewContext(source+';this.views=createForkAssetPackUI;',context)
  const pack=await syntheticPack(),snapshot={...pack,revision:'pack-r1',installedAt:1000,updatedAt:2000},engine={values:defaultAssetEngineSettings(),revision:'engine-r1',writable:true},card={extension:cardExtension(),revision:'card-r1'}
  const binding={service:{apiVersion:2,capabilities:['packs','figures'],listPackSummaries:async()=>[snapshot],getPackSnapshot:async()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    patchPack:async args=>{calls.push(['patchPack',args]);return {snapshot}},patchFigure:async args=>{calls.push(['patchFigure',args]);return {snapshot}}},
    rpc:async(method,args)=>{calls.push([method,args]);if(method==='getAssetVoiceServices')return {services:[{id:'local',kind:'reference-api',capabilities:{voiceKinds:['reference'],paid:false}}]};if(method==='getAssetPackDependencies')return {available:true,count:2};if(method==='getCardAssetBindings')return card;if(method==='saveCardAssetBindings'){card.extension={...card.extension,...args.patch};return card}if(method==='getAssetEngineSettings'||method==='saveAssetEngineSettings')return engine;throw new Error(method)},download:()=>{},...extra}
  context.React=r.React;vm.runInNewContext(pickerSource,context);
  const views=context.views(r.React,{VoicePicker:context.ForkBubbleLibraryPicker,AvatarImage:props=>r.React.createElement('img',{...props,'data-avatar-crop':JSON.stringify(props.crop)})}),props={binding,path:'card.json',ready:true,cardName:'Card',packId:PACK_ID,snapshot,figure:pack.figures[FIGURE_ID],asset:pack.manifest.assets[0],onSaved:()=>{},onBack:()=>{},onPack:()=>{}}
  r.render(views[screen],props)
  return {r,views,props,binding,calls,listeners,snapshot,context,tree:await r.settle()}
}

test('inactive factory mounts no screens or data consumers until explicitly enabled',async t=>{
  const f=await fixture(t,'App');assert.equal(f.tree,null);assert.deepEqual(f.calls,[]);assert.equal(f.listeners.size,0)
  // private fork (owner 2026-10): the library heading is 「舞台素材」 (was 素材库; upstream keeps 「剧本与素材库」).
  f.r.render(f.views.App,{binding:f.binding,enabled:true});const tree=await f.r.settle();assert.match(text(tree),/舞台素材/);assert.equal(f.listeners.size,1)
  f.r.dispose();assert.equal(f.listeners.size,0)
})
// private fork: 素材库 manages packs only; 当前卡片 moved to the Tavern 舞台 tab (CardPanel).
// private fork (owner 2026-10 r4): without an open chat the library never reads a card; with one it only reads that card's
// bindings for the pack state (no card view, no card editor).
test('library app has no card view switch and reads card bindings only for the open chat',async t=>{
  const f=await fixture(t,'App');f.r.render(f.views.App,{binding:f.binding,enabled:true});let tree=await f.r.settle()
  assert.doesNotMatch(text(tree),/当前卡片|绑定素材包/);assert.equal(walk(tree).some(n=>n.props['aria-label']==='素材库视图'),false)
  // private fork: the library header is just the title (no subtitle pointing at the stage tab).
  assert.doesNotMatch(text(tree),/Tavern 舞台|本卡绑定/);assert.ok(walk(tree).some(n=>n.props['aria-label']==='获取素材包'));assert.equal(f.calls.some(([m])=>m==='getCardAssetBindings'),false) // private fork (library header): one 获取素材包 button
  f.r.render(f.views.App,{binding:f.binding,enabled:true,sessionId:'s',cardPath:'card.json'});tree=await f.r.settle();tree=await f.r.settle()
  assert.equal(f.calls.find(([m])=>m==='getCardAssetBindings')[1].path,'card.json');assert.doesNotMatch(text(tree),/当前卡片|绑定素材包/)
})
// private fork: 舞台设置 is one card page (docs/fork/card-centric-ux.md §五): auto-saved; (owner 2026-10, option A) no 基础 / 高级 switch.
test('stage panel is one auto-saved card page without a basic/advanced switch',async t=>{
  const f=await fixture(t,'App');f.r.render(f.views.StagePanel,{binding:f.binding,cardPath:'cards/Madoka.png'});let tree=await f.r.settle()
  // private fork: no card-name subtitle under the heading; the open card is already obvious.
  assert.match(text(tree),/舞台设置/);assert.doesNotMatch(text(tree),/Madoka/);assert.match(text(tree),/素材包 \d+/);assert.match(text(tree),/人物/);assert.ok(button(tree,'保存') === undefined, 'no save bar')
  assert.equal(f.calls.find(([m])=>m==='getCardAssetBindings')[1].path,'cards/Madoka.png');assert.doesNotMatch(text(tree),/自定义差分|本卡读音词典/)
  assert.equal(walk(tree).some(n=>n.props['aria-label']==='显示模式'||n.type==='button'&&['基础','高级'].includes(text(n))),false,'no 基础 / 高级 switch');for(const title of ['基础设置','模组','开场设置','舞台模式'])assert.match(text(tree),new RegExp(title));assert.doesNotMatch(text(tree),/舞台引擎/,'private fork (stage mode entry): no 舞台引擎 row');assert.doesNotMatch(text(tree),/读音词典/,'the dictionary is global (配音 page)') // private fork (r5): 开场设置; (r7): 读音词典; (pack section merge): 导入导出 is part of 素材包; (settings polish): 舞台模型 › is the 基础设置 row to 引擎设置; (engine row): renamed 舞台引擎
  assert.doesNotMatch(text(tree),/全局设置/) // private fork (engine ui r2): no 全局设置 section
  assert.doesNotMatch(text(tree),/导入导出|当前素材包/) // private fork (pack section merge)
  assert.doesNotMatch(text(tree),/导演指令/) // private fork (prompt view complete): 导演指令 is a row of 提示词 (shown with the host prompts adapter), no section of its own
  // private fork (settings-polish r4): without the host prompts adapter 「提示词」 is left out, never 「提示词视图不可用」.
  assert.doesNotMatch(text(tree),/提示词视图不可用/)
  f.r.render(f.views.StagePanel,{binding:f.binding,loading:true,cardPath:'x'});tree=await f.r.settle();assert.match(text(tree),/正在载入/)
  f.r.render(f.views.StagePanel,{binding:f.binding});tree=await f.r.settle();assert.match(text(tree),/未打开人物卡/)
  f.r.render(f.views.StagePanel,{binding:{rpc:f.binding.rpc},cardPath:'card.json'});tree=await f.r.settle();assert.match(text(tree),/素材插件不可用/)
})
// private fork (packs-v3, proposal §9.2): 素材库 is one list of shared pack rows — title · 「N 张卡」 · count of the selected
// kind (全部 = total) · state pill (关闭 / 全局启用). No thumbnails, no UUID, no owner chip, no ID tooltips.
// private fork (owner 2026-10 v3.1 r2): no count cells (数量 is only a sort) and only this card's view of the state —
// without a card a pack that is not global is 关闭 (no 「按卡使用」).
test('library home lists shared pack rows: state pill only, no counts; no ids or owner chip',async t=>{
  const global=[PACK_ID]
  const f=await fixture(t,'Home',{settings:{},setGlobalEnabled:async(id,on)=>{f.calls.push(['global',id,on]);on?global.push(id):global.splice(global.indexOf(id),1)},
    rpc:async()=>({available:true,count:1,cards:[{path:'cards/a.json',name:'A'}]})})
  Object.defineProperty(f.binding,'globalEnabledPackIds',{get:()=>[...global]});f.r.render(f.views.Home,{...f.props,key:'g'})
  let tree=await f.r.settle();const pack=f.snapshot.manifest,name=pack.name
  assert.ok(byLabel(tree,'获取素材包'));assert.ok(byLabel(tree,'新建素材包'));assert.ok(byLabel(tree,'搜索素材包')) // private fork (library header): one 获取素材包 button
  assert.ok(byLabel(tree,'导入素材包') === undefined);assert.ok(byLabel(tree,'浏览素材目录') === undefined) // private fork (library header): the upload and book icons are merged
  // private fork (owner 2026-10 library toolbar): search, the kind filter and the sort share one toolbar line.
  const toolbar=walk(tree).find(n=>n.props.className==='ap-pack-toolbar');assert.ok(walk(toolbar).some(n=>n.props['aria-label']==='按种类筛选：全部'));assert.ok(walk(toolbar).some(n=>n.props['aria-label']==='排序：名称'))
  assert.equal(walk(tree).some(n=>/ap-kind-row|ap-kind-tabs\b/.test(n.props.className||'')),false,'no line of kind chips')
  assert.equal(walk(tree).some(n=>n.type==='img'||n.type==='code'||String(n.props.className||'').includes('ap-thumb')),false,'no thumbnails or UUID lines')
  assert.equal(walk(tree).some(n=>n.props.title===PACK_ID||n.props.className==='ap-owner-chip'),false);assert.doesNotMatch(text(tree),/本卡|修改此包会影响/)
  const row=()=>walk(tree).find(n=>n.type==='li'&&n.props.className==='ap-pack-row is-openable'),noCounts=()=>assert.equal(walk(row()).some(n=>/ap-pack-count|ap-pack-cards/.test(n.props.className||'')),false,'no count cells')
  noCounts();assert.doesNotMatch(text(row()),/张卡|项/)
  assert.ok(walk(tree).find(n=>n.props.className==='ap-pack-group-head') === undefined, 'no group heads')
  assert.ok(byLabel(tree,'排序：名称'),'the sort icon beside the kind tabs')
  byLabel(tree,'按种类筛选：全部').props.onClick();tree=await f.r.settle() // private fork (library toolbar): a menu of kinds with icons
  const tabs=walk(tree).filter(n=>n.props.role==='menuitemradio'&&/ap-kind-option/.test(n.props.className||''))
  assert.ok(tabs.slice(1).every(n=>walk(n).some(c=>c.props.className==='ap-kind-icon')),'each kind has its icon');assert.equal(tabs[0].props['aria-checked'],true)
  assert.deepEqual(tabs.map(text),['全部','人物','背景','音乐','音效','环境音','滤镜','模组']) // private fork (owner r3: 模组)
  tabs.find(n=>text(n)==='背景').props.onClick();tree=await f.r.settle();noCounts()
  const chosen=byLabel(tree,'按种类筛选：背景');assert.equal(text(chosen),'背景','the chosen kind is named on the button');assert.equal(chosen.props['data-on'],'backgrounds')
  tree=await pickKind(f,tree,'全部')
  // private fork (owner 2026-10 v3.1): short state labels (全局 / 本卡).
  const pill=byLabel(tree,name+'：全局，更改');assert.equal(pill.props['data-state'],'global');pill.props.onClick();tree=await f.r.settle()
  // private fork (owner 2026-10 v3.1 r2): without a card, 「off」 is 「关闭」 even when other cards use the pack.
  const items=walk(tree).filter(n=>n.props.role==='menuitemradio');assert.deepEqual(items.map(n=>text(n).replace(/\s+/g,'')),['全局','关闭'],'no card state without a card; private fork (owner 2026-10 global-first): 全局 first')
  items.find(n=>n.props['data-state']==='off').props.onClick();tree=await f.r.settle();tree=await f.r.settle()
  assert.deepEqual(f.calls.filter(([m])=>m==='global'),[['global',PACK_ID,false]]);assert.equal(f.calls.some(([m])=>m==='saveCardAssetBindings'),false)
  assert.equal(walk(tree).some(n=>n.props.role==='dialog'),false,'no confirmation, no undo');assert.equal(byLabel(tree,name+'：关闭，更改').props['data-state'],'off');assert.doesNotMatch(text(tree),/按卡使用/)
  byLabel(tree,'搜索素材包').props.onChange({target:{value:'zzz'}});tree=await f.r.settle();assert.match(text(tree),/没有符合条件的素材包/)
  f.r.dispose();assert.equal(f.listeners.size,0)
})
// private fork (owner 2026-10 v3.1, UI comment 11): one flat list without group heads; 全局 first, rows frozen until reload.
test('library lists 全局 first and keeps rows in place until reload',async t=>{
  const other={...(await syntheticPack()),revision:'o1'};other.manifest={...other.manifest,id:OTHER_PACK_ID,name:'Other pack'};const global=[OTHER_PACK_ID]
  const f=await fixture(t,'Home',{setGlobalEnabled:async(id,on)=>{on?global.push(id):global.splice(global.indexOf(id),1)}})
  Object.defineProperty(f.binding,'globalEnabledPackIds',{get:()=>[...global]});f.binding.service.listPackSummaries=async()=>[f.snapshot,other];f.r.render(f.views.Home,{...f.props,binding:f.binding,key:'two'});let tree=await f.r.settle()
  const order=()=>walk(tree).filter(n=>n.props.className==='ap-pack-name').map(text)
  assert.equal(walk(tree).some(n=>/ap-pack-group/.test(n.props.className||'')),false,'no groups')
  assert.deepEqual(order(),['Other pack','Synthetic pack'])
  byLabel(tree,'Synthetic pack：关闭，更改').props.onClick();tree=await f.r.settle();walk(tree).find(n=>n.props.role==='menuitemradio'&&n.props['data-state']==='global').props.onClick();tree=await f.r.settle();tree=await f.r.settle()
  assert.deepEqual(order(),['Other pack','Synthetic pack'],'frozen until reload');assert.ok(byLabel(tree,'Synthetic pack：全局，更改'))
})
// private fork (owner 2026-10 r4): with a chat open the pill shows / changes the open card's state.
// private fork (owner 2026-10 v3.1, UI comment 11): whatever the sort, 全局 → 本卡 → 关闭; the sort (名称 by default, 数量, or 时间)
// orders each band; every kind tab the same; rows stay in place until reload.
test('library with an open card orders 全局, 本卡, 关闭 and sorts inside each band',async t=>{
  const mk=async(id,name,empty)=>{const p={...(await syntheticPack()),revision:id,installedAt:1000,updatedAt:1000};p.manifest={...p.manifest,id,name,...(empty?{assets:p.manifest.assets.slice(2)}:{})};return p}
  const third='44444444-4444-4444-8444-444444444444',fourth='55555555-5555-4555-8555-555555555555',global=[fourth]
  const f=await fixture(t,'Home',{setGlobalEnabled:async(id,on)=>{on?global.push(id):global.splice(global.indexOf(id),1)}})
  Object.defineProperty(f.binding,'globalEnabledPackIds',{get:()=>[...global]})
  const packs=[await mk(third,'Third'),await mk(fourth,'Fourth'),f.snapshot,await mk(OTHER_PACK_ID,'Other pack',true)];f.binding.service.listPackSummaries=async()=>packs
  f.r.render(f.views.Home,{binding:f.binding,sessionId:'s',cardPath:'card.json',key:'card'});let tree=await f.r.settle();tree=await f.r.settle()
  const order=()=>walk(tree).filter(n=>n.props.className==='ap-pack-name').map(text)
  assert.deepEqual(order(),['Fourth','Other pack','Synthetic pack','Third'])
  const pill=byLabel(tree,'Synthetic pack：本卡，更改');assert.equal(pill.props['data-state'],'card');assert.ok(byLabel(tree,'Third：关闭，更改'))
  byLabel(tree,'Third：关闭，更改').props.onClick();tree=await f.r.settle()
  // private fork (owner 2026-10 global-first): the state menu lists 全局, 本卡, 关闭.
  assert.deepEqual(walk(tree).filter(n=>n.props.role==='menuitemradio').map(n=>n.props['data-state']),['global','card','off'])
  walk(tree).find(n=>n.props.role==='menuitemradio'&&n.props['data-state']==='card').props.onClick();tree=await f.r.settle();tree=await f.r.settle()
  const save=f.calls.find(([m])=>m==='saveCardAssetBindings');assert.equal(save[1].path,'card.json');assert.ok(save[1].patch.assetBindings.boundPackIds.includes(third))
  assert.deepEqual(order(),['Fourth','Other pack','Synthetic pack','Third'],'rows stay in place until reload');assert.ok(byLabel(tree,'Third：本卡，更改'))
  tree=await pickKind(f,tree,'背景')
  assert.deepEqual(order(),['Fourth','Synthetic pack','Third'],'the same bands in a kind tab (Other pack has no 背景)')
  tree=await pickKind(f,tree,'全部')
  byLabel(tree,'排序：名称').props.onClick();tree=await f.r.settle()
  const sorts=walk(tree).filter(n=>n.props.role==='menuitemradio');assert.deepEqual(sorts.map(text),['按名称','按数量','按时间'])
  sorts[1].props.onClick();tree=await f.r.settle()
  assert.deepEqual(order(),['Fourth','Synthetic pack','Other pack','Third'],'数量 inside the 本卡 band, bands kept');assert.ok(byLabel(tree,'排序：数量'))
  // private fork: newest first within frozen bands, ties by name, remembered across remounts.
  packs[0].updatedAt=9000;packs[1].updatedAt=1
  byLabel(tree,'排序：数量').props.onClick();tree=await f.r.settle()
  walk(tree).find(n=>n.props.role==='menuitemradio'&&text(n)==='按时间').props.onClick();tree=await f.r.settle()
  assert.deepEqual(order(),['Fourth','Synthetic pack','Other pack','Third'],'time never outranks state bands')
  assert.equal(f.context.localStorage.getItem('dsh-tavern:pack-sort'),'time')
  f.r.render(f.views.Home,{binding:f.binding,sessionId:'s',cardPath:'card.json',key:'time-remount'});tree=await f.r.settle();tree=await f.r.settle()
  assert.ok(byLabel(tree,'排序：时间'));assert.deepEqual(order(),['Fourth','Third','Synthetic pack','Other pack'])
  packs[0].updatedAt=2000
  byLabel(tree,'搜索素材包').props.onChange({target:{value:'pack'}});tree=await f.r.settle()
  assert.deepEqual(order(),['Synthetic pack','Other pack'],'search preserves time ordering')
  byLabel(tree,'搜索素材包').props.onChange({target:{value:''}});tree=await f.r.settle()
  assert.deepEqual(order(),['Fourth','Synthetic pack','Third','Other pack'],'equal times break by name')
  tree=await pickKind(f,tree,'背景')
  assert.deepEqual(order(),['Fourth','Synthetic pack','Third'],'time sort also applies to kind tabs')
})
test('the plus icon opens an inline new-pack row; Enter creates the pack and opens it',async t=>{
  const opened=[],created={manifest:{id:OTHER_PACK_ID,name:'新包',assets:[],figures:[]},revision:'n1'}
  const f=await fixture(t,'Home');f.binding.service.createPack=async a=>{f.calls.push(['createPack',a]);return {snapshot:created}}
  f.r.render(f.views.Home,{...f.props,onOpen:o=>opened.push(o)});let tree=await f.r.settle()
  byLabel(tree,'新建素材包').props.onClick();tree=await f.r.settle();assert.equal(byLabel(tree,'新建素材包').props.disabled,true)
  const input=()=>byLabel(tree,'新素材包名称');input().props.onKeyDown({key:'Enter',preventDefault(){}});assert.equal(f.calls.some(([m])=>m==='createPack'),false,'empty name does nothing')
  input().props.onChange({target:{value:' 新包 '}});tree=await f.r.settle();input().props.onKeyDown({key:'Enter',preventDefault(){}});tree=await f.r.settle();tree=await f.r.settle()
  assert.deepEqual(clone(f.calls.find(([m])=>m==='createPack')[1]),{name:'新包',expectedRevision:null});assert.deepEqual(clone(opened),[{packId:OTHER_PACK_ID}]);assert.ok(byLabel(tree,'新素材包名称') === undefined)
  byLabel(tree,'新建素材包').props.onClick();tree=await f.r.settle();input().props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});tree=await f.r.settle();assert.ok(byLabel(tree,'新素材包名称') === undefined)
})
test('library app has no basic/advanced switch; a deep link opens the pack modal',async t=>{
  const f=await fixture(t,'App');let take={packId:PACK_ID,kind:'music'};const nav={take:()=>{const v=take;take=null;return v},subscribe:()=>()=>{}}
  f.r.render(f.views.App,{binding:f.binding,enabled:true,nav});let tree=await f.r.settle();tree=await f.r.settle()
  assert.ok(button(tree,'基础') === undefined);assert.ok(button(tree,'高级') === undefined);assert.equal(walk(tree).some(n=>n.props['aria-label']==='显示模式'),false)
  assert.ok(byLabel(tree,'新建素材包'),'creator tools are always shown')
  const dialog=walk(tree).find(n=>n.props.role==='dialog');assert.ok(dialog);assert.match(text(walk(dialog).find(n=>n.props.role==='tab'&&n.props['aria-selected'])),/^音乐/)
  byLabel(dialog,'关闭').props.onClick();tree=await f.r.settle();assert.equal(walk(tree).some(n=>n.props.role==='dialog'),false)
})
// private fork (packs-v3): live acceptance found the pack modal opened from the bottom dock clipped by it (the dock is
// translated with contain: layout, so it is the containing block of position: fixed). Dialogs and panel menus mount in
// the top-level layer: a portal into <body> wrapped in .ap-ui.ap-layer, never inside the panel's own boxes.
test('the pack modal and a row state menu mount in the top-level layer (portal into body), not inside the panel',async t=>{
  const f=await fixture(t,'App'),body={nodeName:'BODY'};f.context.document.body=body
  f.context.ReactDOM={createPortal:(node,container)=>f.r.React.createElement('ap-portal',{container},node)}
  let take={packId:PACK_ID};const nav={take:()=>{const v=take;take=null;return v},subscribe:()=>()=>{}}
  f.r.render(f.views.App,{binding:f.binding,enabled:true,nav});let tree=await settle(f)
  const portals=()=>walk(tree).filter(n=>n.type==='ap-portal'),inLayer=n=>portals().some(p=>p.props.container===body&&p.children[0]?.props.className==='ap-ui ap-layer'&&walk(p).includes(n))
  const dialogs=walk(tree).filter(n=>n.props.role==='dialog');assert.equal(dialogs.length,1);assert.match(dialogs[0].props.className,/ap-pack-modal/)
  assert.equal(inLayer(dialogs[0]),true,'the pack modal is portaled into body');assert.equal(inLayer(walk(tree).find(n=>n.props.className==='ap-modal-scrim')),true)
  byLabel(dialogs[0],'关闭').props.onClick();tree=await settle(f);assert.equal(portals().length,0)
  const name=f.snapshot.manifest.name;byLabel(tree,name+'：关闭，更改').props.onClick();tree=await settle(f)
  const menu=walk(tree).find(n=>n.props.role==='menu'&&n.props['aria-label']===name+' 使用状态');assert.ok(menu);assert.match(menu.props.className,/is-floating/)
  assert.equal(inLayer(menu),true,'the row state menu floats in the top layer');assert.deepEqual(walk(menu).filter(n=>n.props.role==='menuitemradio').map(n=>n.props['data-state']),['global','off'],'private fork (owner 2026-10 global-first): 全局 before 关闭')
  // Without a DOM portal (no ReactDOM.createPortal) everything still renders in place.
  delete f.context.ReactDOM;byLabel(tree,name+'：关闭，更改').props.onClick();tree=await settle(f);byLabel(tree,'打开 '+name).props.onClick();tree=await settle(f)
  assert.equal(portals().length,0);assert.equal(walk(tree).filter(n=>n.props.role==='dialog').length,1)
})
test('the top-level layer adds no box; confirmations stack above the pack modal and menus above both',async()=>{
  const css=await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css',import.meta.url),'utf8'),z=re=>Number(css.match(re)?.[1])
  assert.match(css,/\.ap-ui\.ap-layer \{ display: contents;/);assert.match(css,/\.ap-modal-scrim \{ position: fixed; inset: 0; z-index: 10000;/)
  assert.ok(z(/\.ap-modal-scrim:has\(> \.ap-confirm\) \{ z-index: (\d+)/)>10000);assert.ok(z(/\.ap-layer \.ap-popover\.is-floating \{ position: fixed; z-index: (\d+)/)>z(/\.ap-modal-scrim:has\(> \.ap-confirm\) \{ z-index: (\d+)/))
  assert.ok(10000>z(/\.fork-dialog-backdrop \{[^}]*z-index: (\d+)/),'above the host dialogs')
})
test('broken pack is reported without hiding healthy packs or crashing card bindings',async t=>{
  for(const screen of ['Home','StagePage']) {
    const f=await fixture(t,screen)
    f.binding.service.listPackSummaries=async()=>[f.snapshot,{packId:OTHER_PACK_ID,error:{code:'INVALID_MANIFEST',message:'Broken manifest'}}]
    f.r.render(f.views[screen],{...f.props,binding:{...f.binding}})
    const tree=await f.r.settle()
    assert.match(text(tree),new RegExp(f.snapshot.manifest.name))
    assert.match(text(tree),screen==='Home'?/Broken manifest/:/未安装/) // private fork: missing rows identify the pack and offer removal.
  }
})
const byLabel=(tree,label)=>walk(tree).find(n=>n.props['aria-label']===label)
// private fork: emulate one atomic file/owner publication, including cross-realm Map updates.
function applyAtomicPatch(snapshot,args){
  const next={...snapshot,manifest:{...snapshot.manifest,...clone(args.patch)},figures:{...snapshot.figures},sprites:{...snapshot.sprites}};
  for(const [file,bytes] of args.fileUpdates||[]){
    if(file.startsWith('figures/'))next.figures[file.slice(8,-5)]=JSON.parse(Buffer.from(bytes));
    else {const key=Object.keys(next.manifest.sprites||{}).find(key=>next.manifest.sprites[key]===file);if(key)next.sprites[key]=JSON.parse(Buffer.from(bytes));}
  }
  return next;
}
function chainedPatch(f){let revision=1,current=f.snapshot;f.binding.service.patchPack=async args=>{f.calls.push(['patchPack',args]);assert.equal(args.expectedRevision,'pack-r'+revision);current={...applyAtomicPatch(current,args),revision:'pack-r'+(++revision)};return {snapshot:current}}}
// private fork (packs-v3, proposal §9): the shared two-column pack modal replaces the drill-in PackDetail, the inline
// entry table and FigureEditor. Helpers: render it alone with a list of packs (copy targets).
const NEW_PACK_ID='44444444-4444-4444-8444-444444444444'
async function modal(t,extra={},props={}){
  const f=await fixture(t,'App',extra),closed=[],opened=[]
  const views=props.viewOptions?f.context.views(f.r.React,props.viewOptions):f.views
  f.render=(more={})=>f.r.render(views.PackModal,{binding:f.binding,packId:PACK_ID,packs:[f.snapshot,...(props.others||[])],onClose:c=>closed.push(c),onOpenPack:id=>opened.push(id),onPacksChanged:()=>f.calls.push(['packsChanged']),...props,...more})
  f.render();f.tree=await f.r.settle();return Object.assign(f,{closed,opened})
}
// private fork (pack-kind-tabs): the kinds are one underline tab strip (role=tab, aria-selected), not chips.
const chips=tree=>walk(tree).filter(n=>n.props.role==='tab'&&n.props['data-kind'])
const chip=(tree,label)=>chips(tree).find(n=>text(n).trim()===label) // private fork (figure-editor r6): tabs carry no counts
const options=tree=>walk(tree).filter(n=>n.props.role==='option')
const radio=(tree,label)=>walk(tree).find(n=>n.props.role==='radio'&&text(n).replace(/\s+/g,' ').trim()===label)
// private fork (UI standard phase 2): 触发策略 / 状态 rows are the one LampMenu — a 「● 绿灯 ⌄」 trigger that opens menuitemradio items.
const lampButton=(tree,label)=>walk(tree).find(n=>n.type==='button'&&(n.props['aria-label']||'').startsWith(label+'：'))
const lampItems=async(f,tree,label)=>{lampButton(tree,label).props.onClick();tree=await f.r.settle();return {tree,item:word=>walk(tree).find(n=>n.props.role==='menuitemradio'&&text(n).trim()===word)}}
async function settle(f,n=2){let tree;for(let i=0;i<n;i++)tree=await f.r.settle();return tree}
// private fork (figure-editor r7): an outfit's lamp is its tile's dot — a button that opens 蓝灯 / 绿灯 / 关闭.
const outfitLampButton=(tree,outfit)=>walk(tree).find(n=>n.type==='button'&&(n.props['aria-label']||'').startsWith('服装「'+outfit+'」的灯：'))
async function pickOutfitLamp(f,tree,outfit,mode,rounds){outfitLampButton(tree,outfit).props.onClick();tree=await f.r.settle();walk(tree).find(n=>n.props.role==='menuitemradio'&&n.props['data-mode']===mode).props.onClick();return settle(f,rounds)}
async function commitInput(f,tree,label,value){byLabel(tree,label).props.onChange({target:{value}});tree=await f.r.settle();await byLabel(tree,label).props.onBlur();return settle(f)}
const clone=v=>JSON.parse(JSON.stringify(v))
// private fork: CG edits stay in one media-closed CAS draft, never the generic top-level-media form.
test('CG shared editor saves ordered variants and files once, refuses conflict without an automatic merge',async t=>{
  const f=await modal(t,{}, {viewOptions:{prepareImage:async()=>({bytes:new Uint8Array([1,2,3]),descriptor:{ext:'png',mime:'image/png',size:3}})}})
  f.context.crypto=(await import('node:crypto')).webcrypto
  const asset={kind:'cg',id:'rice',name:'Rice',enabled:true,directorNote:'',recall:{mode:'keyword',keywords:[]},variants:{default:'base',entries:[{id:'base',name:'Base',content:{description:'Eating',media:f.snapshot.manifest.assets[0].variants.entries[0].content.media}}]}}
  f.snapshot.manifest.assets.push(asset);f.render({key:'cg',initial:{kind:'cg'}});let tree=await settle(f)
  // private fork (cg-editor redesign): 差分 tiles with a ⋯ menu, no row of 前移 / 后移 / 设为默认 / 删除差分 buttons,
  // no wall of every installed figure and no 「清空图中人物」; nothing to save until something changes.
  assert.match(text(tree),/差分名称/);assert.doesNotMatch(text(tree),/清空图中人物|前移/);assert.ok(button(tree,'替换图片') === undefined);assert.ok(button(tree,'保存') === undefined)
  assert.equal(walk(tree).some(n=>n.type==='fieldset'),false);assert.equal(walk(tree).some(n=>n.props.role==='menuitemcheckbox'),false,'the figure picker is closed')
  byLabel(tree,'差分「Base」操作').props.onClick();tree=await settle(f)
  const menuItem=label=>walk(tree).find(n=>/^menuitem/.test(n.props.role||'')&&text(n)===label)
  assert.equal(menuItem('删除差分').props.disabled,true);assert.equal(menuItem('设为默认').props['aria-checked'],true);assert.equal(menuItem('前移').props.disabled,true)
  byLabel(tree,'差分「Base」操作').props.onClick();tree=await settle(f)
  field(tree,'差分名称').props.onChange({target:{value:'Changed'}});tree=await settle(f)
  field(tree,'差分名称').props.onBlur();tree=await settle(f) // private fork (inline-field sweep): inline fields commit on Enter / blur
  assert.ok(button(tree,'保存'),'a change shows the save bar')
  // private fork (D05): composition is edited on the preview (the frame), not by number sliders; 「完整图」 is the built-in view.
  byLabel(tree,'添加焦点').props.onClick();tree=await settle(f)
  assert.equal(walk(tree).some(n=>n.type==='input'&&['number','range','checkbox'].includes(n.props.type)),false)
  // private fork (entry cleanup, owner 2026-10): 优先级 is gone from the CG editor.
  assert.equal(walk(tree).some(n=>n.props.role==='slider'&&['优先级','水平中心','垂直中心','放大倍率'].includes(n.props['aria-label'])),false)
  assert.ok(button(tree,'完整图'))
  walk(tree).find(n=>n.props.className==='ap-cg-hero').props.onLoad({target:{naturalWidth:1600,naturalHeight:900}});tree=await settle(f)
  const frame=()=>walk(tree).find(n=>n.props.role==='slider'&&n.props['aria-roledescription']==='取景框')
  assert.ok(frame(),'the open focus is a frame on the preview');assert.ok(walk(tree).some(n=>n.props.className==='ap-cg-safe'),'the dialogue box is drawn')
  const key=(k,extra={})=>frame().props.onKeyDown({key:k,preventDefault(){},stopPropagation(){},...extra})
  key('ArrowRight',{shiftKey:true});tree=await settle(f)
  assert.match(frame().props['aria-valuetext'],/水平 55%/)
  // The frame cannot pass the picture's edge: x stops where the 1.5× view reaches the right side (1 − 1/3).
  for(let i=0;i<10;i++){key('ArrowRight',{shiftKey:true});tree=await settle(f)}
  assert.match(frame().props['aria-valuetext'],/水平 67%/)
  key('PageUp');tree=await settle(f);assert.match(frame().props['aria-valuetext'],/1\.60 倍/)
  assert.ok(byLabel(tree,'构图名称'));assert.doesNotMatch(text(tree),/\bzoom\b/)
  // 预览动效: one toggle on the preview; nothing is written, no session RPC.
  byLabel(tree,'预览动效').props.onClick();tree=await settle(f)
  assert.ok(walk(tree).some(n=>n.props.className==='ap-cg-play'),'the motion surface replaces the composition');assert.ok(byLabel(tree,'结束预览'))
  assert.equal(walk(tree).some(n=>n.props.className==='ap-cg-compose'),false)
  byLabel(tree,'结束预览').props.onClick();tree=await settle(f);byLabel(tree,'预览动效').props.onClick();tree=await settle(f) // exiting → a second press ends at once
  assert.ok(walk(tree).some(n=>n.props.className==='ap-cg-compose'));assert.equal(f.calls.some(([m])=>m!=='patchPack'&&/cg|Cg/.test(m)),false)
  // private fork: removed CG figure section, not composition focus.
  assert.ok(byLabel(tree,'添加图中人物') === undefined);assert.doesNotMatch(text(tree),/图中人物/);
  // private fork (skin ui, owner 2026-10): CG 详情 is the inline multi-line field of the audio editors, filling the draft.
  assert.ok(walk(tree).some(n=>n.props.className==='fork-inline-field ap-note-field'&&n.props['data-multiline']),'详情 is a ForkInlineField multiline')
  assert.ok(!walk(tree).some(n=>n.props.className==='ap-counter'),'no character counter')
  field(tree,'详情').props.onChange({target:{value:'Lunch on the roof'}});tree=await settle(f);field(tree,'详情').props.onBlur();tree=await settle(f)
  assert.ok(byLabel(tree,'添加差分'),'the dashed ＋ tile');const upload=byLabel(tree,'选择差分图片')
  upload.props.onChange({target:{files:[{name:'Turn.png'}],value:'fake'}});tree=await settle(f,4)
  assert.equal(f.calls.filter(([m])=>m==='patchPack').length,0,'upload is local draft only')
  await button(tree,'保存').props.onClick();tree=await settle(f)
  const request=f.calls.find(([m])=>m==='patchPack')[1],saved=request.patch.assets.find(a=>a.kind==='cg')
  assert.equal(saved.variants.entries.length,2);assert.equal(saved.variants.entries[0].id,'base');assert.equal(saved.variants.entries[0].name,'Changed')
  assert.equal(JSON.stringify(saved.recall),JSON.stringify({mode:'keyword',keywords:[]}));assert.deepEqual([saved.variants.entries[0].content.focusHints[0].x,saved.variants.entries[0].content.focusHints[0].zoom],[0.667,1.6]) // private fork: no priority; D05: settled at the edge
  assert.equal(Object.hasOwn(saved,'depicts'),false);assert.equal(saved.variants.default,'base') // private fork
  assert.equal(saved.directorNote,'Lunch on the roof') // private fork (skin ui)
  assert.equal(saved.media,undefined);assert.equal(request.fileUpdates.size,1);assert.ok(request.patch.blobs[saved.variants.entries[1].content.media])
  f.binding.service.patchPack=async args=>{f.calls.push(['conflict',args]);throw Object.assign(new Error('changed'),{code:'REVISION_CONFLICT'})}
  await button(tree,'保存').props.onClick();tree=await settle(f)
  assert.equal(f.calls.filter(([m])=>m==='conflict').length,1);assert.match(text(tree),/重新载入/)
  assert.equal(f.calls.some(([m])=>m==='ackCgPlayed'),false)
})

test('pack modal: present kinds as tabs (人物 first), rows on the left, the first item selected on the right',async t=>{
  const f=await modal(t)
  assert.deepEqual(chips(f.tree).map(n=>text(n).replace(/\s+/g,' ').trim()),['人物','背景','音乐','音效','环境音','滤镜','模组']) // private fork (owner r3: 模组; r6: no counts)
  assert.equal(chip(f.tree,'人物').props['aria-selected'],true,'first non-empty kind')
  // private fork (owner 2026-10 v3.1, UI comment 4): a figure row is name + outfit count; no 「Live2D」 mark.
  const row=options(f.tree)[0];assert.match(text(row),/Synthetic figure/);assert.doesNotMatch(text(row),/\d$/,'r6: no outfit count');/* private fork */assert.doesNotMatch(text(row),/Live2D/);assert.equal(row.props['aria-selected'],true)
  assert.equal(byLabel(f.tree,'人物名称').props.value,'Synthetic figure')
  chip(f.tree,'背景').props.onClick();const tree=await f.r.settle()
  assert.equal(options(tree).length,2);assert.equal(walk(options(tree)[0]).some(n=>/ap-item-thumb/.test(n.props.className||'')),true,'background rows carry a thumbnail')
  assert.doesNotMatch(text(tree),/条目 ID|backgrounds\/classroom/,'no internal IDs');assert.equal(walk(tree).some(n=>n.type==='code'),false)
  assert.ok(button(tree,'保存') === undefined);assert.ok(button(tree,'取消') === undefined, 'autosave, no save/cancel pair')
})
// private fork (pack-kind-tabs): one tab strip instead of a pill wall. Roving tabindex; ← → Home End walk the present kinds
// (wrapping); each tab names its count for screen readers. Without layout (no ResizeObserver) nothing overflows and
// 「更多」 stays idle; the overflow itself is measured in Chromium (tests/harness/pack-kind-tabs.mjs).
test('pack modal kind tabs: tablist with roving focus, arrow keys switch kinds, 更多 idle when all fit',async t=>{
  const f=await modal(t);let tree=f.tree
  assert.equal(walk(tree).find(n=>n.props.role==='tablist').props['aria-label'],'素材分类')
  assert.deepEqual(chips(tree).map(n=>[n.props['aria-label'],n.props.tabIndex]),[['人物',0],['背景',-1],['音乐',-1],['音效',-1],['环境音',-1],['滤镜',-1],['模组',-1]]) // private fork (figure-editor r6): names only
  const key=async k=>{walk(tree).find(n=>n.props.role==='tablist').props.onKeyDown({key:k,preventDefault(){}});tree=await f.r.settle();return chips(tree).find(n=>n.props['aria-selected']).props['data-kind']}
  assert.equal(await key('ArrowRight'),'backgrounds');assert.equal(options(tree).length,2)
  assert.equal(await key('ArrowLeft'),'figures');assert.equal(await key('ArrowLeft'),'widgets','wraps around');assert.equal(await key('Home'),'figures');assert.equal(await key('End'),'widgets');assert.equal(await key('x'),'widgets')
  assert.equal(chips(tree).find(n=>n.props['aria-selected']).props.tabIndex,0);assert.equal(chips(tree).some(n=>n.props['data-overflow']),false)
  assert.match(walk(tree).find(n=>/ap-kind-more-anchor/.test(n.props.className||'')).props.className,/is-idle/);assert.equal(walk(tree).find(n=>n.props.className==='ap-kind-more').props.tabIndex,-1)
})
// private fork (UI standard tabs, owner 2026-10): a pack with one kind (e.g. an item pack's lone 「物品」) shows no tab row and
// no divider; the list tools start right under the header.
test('pack modal with a single kind renders no tab row',async t=>{
  const pack=await syntheticPack(),single={...pack,revision:'pack-r1',installedAt:1000,updatedAt:2000,manifest:{...pack.manifest,figures:[],assets:pack.manifest.assets.filter(a=>a.kind==='backgrounds')}}
  const service={apiVersion:2,capabilities:['packs','figures'],listPackSummaries:async()=>[single],getPackSnapshot:async()=>single,subscribe:()=>()=>{},patchPack:async()=>({snapshot:single}),patchFigure:async()=>({snapshot:single})}
  const f=await modal(t,{service},{packs:[single]});const tree=f.tree
  assert.ok(options(tree).length>0,'the single kind\'s list renders')
  assert.equal(walk(tree).some(n=>n.props.role==='tablist'||n.props.className==='ap-pack-kinds'),false,'no tab row, no divider')
  assert.ok(walk(tree).some(n=>n.props.className==='ap-pack-tools'),'tools under the header')
})
// private fork (figure-editor r4, owner 2026-10): the pack's 全局 / 本卡 / 关闭 is set in the library list; the pack modal head
// shows only ⋯ and ×, even with a scope.
test('pack modal head: no state pill, ⋯ with export / copy / delete, close; delete keeps its impact confirmation',async t=>{
  const scope={type:'global',ctx:null,options:()=>['global','off'],stateOf:()=>'global',users:()=>[],pending:{},set:()=>{},error:''}
  const f=await modal(t,{},{scope});let tree=f.tree,name=f.snapshot.manifest.name
  assert.equal(walk(tree).some(n=>n.props.className==='ap-state-tag'),false) // private fork (UI standard chips);assert.equal(byLabel(tree,name+'：全局，更改'),undefined)
  assert.equal(f.calls.some(([m])=>m==='getAssetPackDependencies'),false,'the head scans no cards')
  byLabel(tree,'更多操作 '+name).props.onClick();tree=await f.r.settle()
  assert.deepEqual(walk(tree).filter(n=>n.props.role==='menuitem').map(text),['导出','复制','删除'])
  walk(tree).find(n=>n.props.role==='menuitem'&&text(n)==='删除').props.onClick();tree=await settle(f)
  // private fork (r2): the consequence in plain words, no card count.
  const dialog=walk(tree).filter(n=>n.props.role==='dialog').at(-1);assert.match(text(dialog),/有卡正在用它。删除后，用到它的卡会少掉里面的素材/);assert.doesNotMatch(text(dialog),/\d+ 张卡/);assert.equal(f.calls.some(([m])=>m==='removePack'),false)
  byLabel(tree,'关闭').props.onClick();assert.deepEqual(f.closed,[false])
  const g=await modal(t,{rpc:async()=>({available:false,count:null})});byLabel(g.tree,'更多操作 '+name).props.onClick();tree=await g.r.settle()
  walk(tree).find(n=>n.props.role==='menuitem'&&text(n)==='删除').props.onClick();tree=await settle(g);const body=text(walk(tree).filter(n=>n.props.role==='dialog').at(-1));assert.match(body,/用到它的卡会少掉里面的素材/);assert.doesNotMatch(body,/未知|\d+ 张卡/)
})
// private fork: export warnings come from the same frozen service result as the ZIP, not a second client scan.
test('whole-pack export names external widget defaults without IDs and downloads only after acknowledgement',async t=>{
  let downloads=0;const f=await modal(t,{download:()=>downloads++});f.binding.service.exportPack=async()=>({filename:'fixture.zip',warnings:[{code:'external-widget-default',ref:{packId:OTHER_PACK_ID,kind:'backgrounds',assetId:'private-id'},widgetName:'Phone',settingLabel:'壁纸',packName:'Paper pack',assetName:'Blue paper'}]});
  byLabel(f.tree,'更多操作 '+f.snapshot.manifest.name).props.onClick();let tree=await f.r.settle();await walk(tree).find(n=>n.props.role==='menuitem'&&text(n)==='导出').props.onClick();tree=await settle(f);
  assert.equal(downloads,0);const dialog=walk(tree).filter(n=>n.props.role==='dialog').at(-1);assert.match(text(dialog),/Phone.*壁纸.*Paper pack.*Blue paper/);assert.doesNotMatch(text(dialog),/private-id|33333333|external-widget-default/);await button(dialog,'仍然导出').props.onClick();await settle(f);assert.equal(downloads,1);
})
test('entry detail autosaves the switch, recall and name, chaining revisions',async t=>{
  const f=await modal(t);chainedPatch(f);chip(f.tree,'背景').props.onClick();let tree=await f.r.settle()
  // private fork (enable audit, owner 2026-10): no separate 启用 switch — 触发策略 is 蓝灯 / 绿灯 / 关闭 (关闭 = enabled: false).
  assert.equal(walk(tree).some(n=>n.props?.['aria-label']==='启用 Synthetic backgrounds'),false)
  const lamp=await lampItems(f,tree,'触发策略');tree=lamp.tree // private fork (UI standard phase 2): the LampMenu
  await Promise.all([lamp.item('关闭').props.onClick(),lamp.item('蓝灯').props.onClick()]);tree=await settle(f,3)
  const writes=f.calls.filter(([m])=>m==='patchPack').map(([,a])=>a);assert.equal(writes.length,2)
  assert.equal(writes[0].patch.assets[0].enabled,false);assert.equal(writes[1].patch.assets[0].enabled,true,'蓝灯 turns it back on');assert.equal(writes[1].patch.assets[0].recall.mode,'constant')
  assert.equal(lampButton(tree,'触发策略').props['data-mode'],'constant')
  tree=await commitInput(f,tree,'名称','Classroom after school')
  assert.equal(f.calls.filter(([m])=>m==='patchPack').at(-1)[1].patch.assets[0].name,'Classroom after school')
  tree=await commitInput(f,tree,'名称','  ');assert.match(text(tree),/名称不能为空/);assert.equal(f.calls.filter(([m])=>m==='patchPack').length,3)
})
test('trigger chips add comma-separated words, prune synonyms on removal; the note saves on blur',async t=>{
  const f=await modal(t);chainedPatch(f);chip(f.tree,'背景').props.onClick();let tree=await f.r.settle()
  const add=async value=>{byLabel(tree,'添加触发词').props.onChange({target:{value}});tree=await f.r.settle();byLabel(tree,'添加触发词').props.onKeyDown({key:'Enter',preventDefault(){}});tree=await settle(f)}
  await add('教室, 课间,classroom, 教室');let asset=f.calls.filter(([m])=>m==='patchPack').at(-1)[1].patch.assets[0]
  assert.deepEqual(Array.from(asset.recall.keywords),['synthetic','教室','课间','classroom']);assert.deepEqual(clone(asset.recall.synonyms),{synthetic:['fixture']})
  byLabel(tree,'删除触发词 synthetic').props.onClick();tree=await settle(f);asset=f.calls.filter(([m])=>m==='patchPack').at(-1)[1].patch.assets[0]
  assert.deepEqual(Array.from(asset.recall.keywords),['教室','课间','classroom']);assert.equal(asset.recall.synonyms,undefined)
  const before=f.calls.length;await add('a');assert.match(text(tree),/「a」需为 2–40 字/);assert.equal(f.calls.length,before,'invalid words are not written')
  tree=await commitInput(f,tree,'详情','Quiet classroom after lessons');asset=f.calls.filter(([m])=>m==='patchPack').at(-1)[1].patch.assets[0]
  assert.equal(asset.directorNote,'Quiet classroom after lessons');assert.equal(asset.variants.default,'day','other fields survive') /* private fork: no background preset */
  // private fork (audio editor): 详情 is an inline multi-line field — no textarea grip / underline row, no 300 counter.
  assert.ok(!walk(tree).some(n=>n.props.className==='ap-counter'),'no character counter')
  assert.ok(walk(tree).some(n=>n.props.className==='fork-inline-field ap-note-field'&&n.props['data-multiline']),'详情 is a ForkInlineField multiline')
  assert.deepEqual(f.views.splitKeywords('a ,b，c,, a').length,3)
})
// private fork (skin ui, owner 2026-10): a standalone 舞台皮肤 entry previews itself (text box, nameplate and a sample line in the
// skin's colours and fonts), the list thumbnail is the same box; no 状态, ⋯ › 删除. 分类 reads as 标签 everywhere.
test('舞台皮肤 entry shows a live sample of the skin, has no 状态 and deletes via ⋯; 分类 reads as 标签',async t=>{
  const f=await modal(t)
  f.snapshot.manifest.assets.push({kind:'skins',id:'paper',name:'Paper',recall:{mode:'keyword',keywords:[]},directorNote:'',bundleKey:'paper',entry:'skin.json'})
  f.snapshot.manifest.bundles={...f.snapshot.manifest.bundles,paper:{kind:'skin',entry:'skin.json',contentHash:'0'.repeat(64)}};f.snapshot.manifest.files=[...f.snapshot.manifest.files,{path:'bundles/paper/skin.json',size:2,sha256:'0'.repeat(64)}]
  f.snapshot.skins={paper:{schema:'dsh.skin/1',id:'paper',label:'Paper',textbox:{paint:{bg:'#101018',fg:'#f5f2fa',accent:'#e8d8a8',border:'#5a5470'},shape:{radius:8,borderWidth:2}},
    nameplate:{shape:'tag',paint:{bg:'#e8d8a8',fg:'#101018'}},font:{body:'wenkai-screen',name:'wenkai-screen'},textStyle:{emphasis:'#e8d8a8'},textFx:{reveal:'type'}}}
  f.render({key:'skins',initial:{kind:'skins'}});let tree=await settle(f)
  const sample=byLabel(tree,'Paper 预览');assert.ok(sample,'hero sample');assert.match(sample.props.className,/ap-skin-sample/)
  assert.match(text(sample),/？？？/);assert.match(text(sample),/什么事/)
  const box=walk(sample).find(n=>n.props.className==='ap-skin-sample-box');assert.equal(box.props.style.background,'#101018');assert.equal(box.props.style.color,'#f5f2fa');assert.equal(box.props.style.border,'2px solid #5a5470')
  const plate=walk(sample).find(n=>n.props.className==='ap-skin-sample-plate');assert.equal(plate.props['data-shape'],'tag');assert.equal(plate.props.style.background,'#e8d8a8')
  assert.equal(walk(sample).find(n=>n.type==='em').props.style.color,'#e8d8a8')
  assert.ok(walk(tree).some(n=>/ap-skin-sample is-compact/.test(n.props.className||'')),'list thumbnail');assert.ok(!walk(tree).some(n=>n.props.className==='ap-hero-glyph'))
  // private fork (skin ui): a standalone skin has no 状态 (no 启用 / 关闭, no list dot); ⋯ › 删除 removes the entry and its bundle in one write.
  assert.equal(radio(tree,'启用'),undefined);assert.ok(!walk(tree).some(n=>n.props.className==='ap-item-lamp'))
  byLabel(tree,'更多操作 Paper').props.onClick();tree=await settle(f);walk(tree).find(n=>n.type==='button'&&text(n)==='删除').props.onClick();tree=await settle(f)
  assert.match(text(tree),/删除舞台皮肤「Paper」？/);walk(tree).filter(n=>n.type==='button'&&text(n)==='删除').at(-1).props.onClick();tree=await settle(f,4)
  const removed=f.calls.filter(([m])=>m==='patchPack').at(-1)[1];assert.equal(removed.patch.assets.some(a=>a.kind==='skins'),false);assert.equal(removed.patch.bundles.paper,undefined);assert.deepEqual([...removed.fileUpdates].map(([p,v])=>[p,v]),[['bundles/paper/skin.json',null]])
  assert.match(text(tree),/标签/);assert.doesNotMatch(text(tree),/分类/);assert.ok(byLabel(tree,'标签 说明'))
})
// private fork (entry cleanup, owner 2026-10): an 物品 previews its own picture (not the glyph tile) and its note reads 备注 (it is
// never sent to the director); no entry editor has 优先级; each list row's lamp dot is a quick 蓝灯 / 绿灯 / 关闭 menu that writes
// that entry alone and never selects the row.
test('entry cleanup: core props hero picture and director detail, no priority, the list lamp dot is a menu',async t=>{
  const f=await modal(t);chainedPatch(f)
  const media=f.snapshot.manifest.assets.find(a=>a.kind==='backgrounds').variants.entries[0].content.media
  f.snapshot.manifest.assets.push({kind:'props',id:'wallet',name:'钱包',enabled:true,recall:{mode:'keyword',keywords:[]},directorNote:'',media},{kind:'props',id:'keys',name:'钥匙',enabled:true,recall:{mode:'keyword',keywords:[]},directorNote:'',media})
  f.render({key:'props',initial:{kind:'props'}});let tree=await settle(f)
  const hero=walk(tree).find(n=>n.props.className==='ap-hero ap-item-hero');assert.ok(hero,'the item picture is the hero');assert.ok(!walk(tree).some(n=>n.props.className==='ap-hero-glyph'))
  assert.ok(byLabel(tree,'详情'));assert.ok(byLabel(tree,'备注') === undefined);assert.doesNotMatch(text(tree),/优先级/)
  assert.equal(options(tree)[0].props['aria-selected'],true)
  const lamp=byLabel(tree,'钥匙 的触发策略：绿灯，更改');assert.ok(lamp);assert.equal(lamp.props['aria-haspopup'],'menu');assert.equal(lamp.props['data-mode'],'keyword')
  let stopped=false;walk(tree).find(n=>n.props.className==='ap-item-lamp-anchor'&&walk(n).includes(lamp)).props.onClick({stopPropagation:()=>{stopped=true}});assert.ok(stopped,'a lamp click never reaches the row')
  lamp.props.onClick();tree=await f.r.settle()
  const menu=walk(tree).filter(n=>n.props.role==='menuitemradio'&&/ap-lamp-opt/.test(n.props.className||''));assert.deepEqual(menu.map(n=>text(n).trim()),['蓝灯','绿灯','关闭'])
  menu.find(n=>n.props['data-mode']==='constant').props.onClick();tree=await settle(f,4)
  const saved=f.calls.filter(([m])=>m==='patchPack').at(-1)[1].patch.assets
  assert.equal(saved.find(a=>a.id==='keys').recall.mode,'constant');assert.equal(saved.find(a=>a.id==='wallet').recall.mode,'keyword')
  assert.equal(byLabel(tree,'钥匙 的触发策略：蓝灯，更改').props['data-mode'],'constant');assert.equal(options(tree)[0].props['aria-selected'],true,'the open entry stays selected')
  byLabel(tree,'钥匙 的触发策略：蓝灯，更改').props.onClick();tree=await f.r.settle()
  walk(tree).find(n=>n.props.role==='menuitemradio'&&n.props['data-mode']==='off').props.onClick();tree=await settle(f,4)
  assert.equal(f.calls.filter(([m])=>m==='patchPack').at(-1)[1].patch.assets.find(a=>a.id==='keys').enabled,false)
  f.render({key:'bg',initial:{kind:'backgrounds'}});tree=await settle(f);assert.doesNotMatch(text(tree),/优先级/)
})
// private fork (direction styles, owner 2026-10): 演出风格 entries. 「添加文件 › 演出风格」 / the dashed ＋ (no label) open a draft that
// writes nothing; its text adds the entry (启用, constant recall, no note); 状态 is 启用 / 关闭; the text keeps line breaks and
// must not be empty; ⋯ › 删除 confirms first.
test('演出风格: a draft adds the entry with its text; 启用 / 关闭, the text and 删除 save through patchPack',async t=>{
  const f=await modal(t);chainedPatch(f);let tree=f.tree
  const patches=()=>f.calls.filter(([m])=>m==='patchPack').map(([,a])=>a),style=()=>patches().at(-1).patch.assets.filter(a=>a.kind==='directions')
  assert.equal(chip(tree,'演出风格'),undefined,'no tab while the pack has none')
  byLabel(tree,'添加文件').props.onClick();tree=await f.r.settle()
  walk(tree).find(n=>n.props.role==='menuitem'&&text(n)==='演出风格').props.onClick();tree=await settle(f)
  assert.equal(chip(tree,'演出风格').props['aria-selected'],true)
  const add=byLabel(tree,'新建演出风格');assert.equal(text(add).trim(),'','the ＋ has no label');assert.equal(add.props['aria-pressed'],true)
  assert.equal(byLabel(tree,'名称').props.value,'新演出风格');assert.ok(byLabel(tree,'触发词') === undefined);assert.ok(byLabel(tree,'详情') === undefined)
  assert.equal(patches().length,0,'a draft writes nothing')
  const type=async value=>{byLabel(tree,'正文').props.onChange({target:{value}});tree=await f.r.settle();byLabel(tree,'正文').props.onBlur();tree=await settle(f,3)}
  await type('进结界时震屏一次。\r\n其余时候少动。')
  assert.equal(patches().length,1);const [made]=clone(style())
  assert.match(made.id,/^[a-z0-9]+$/);assert.deepEqual({...made,id:undefined},{kind:'directions',id:undefined,name:'新演出风格',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',text:'进结界时震屏一次。\n其余时候少动。'})
  assert.equal(options(tree).length,1);assert.equal(options(tree)[0].props['aria-selected'],true);assert.equal(byLabel(tree,'新建演出风格').props['aria-pressed'],false)
  // private fork (UI standard phase 2): 状态 is the LampMenu with 启用 / 关闭.
  const lamp=await lampItems(f,tree,'状态');tree=lamp.tree
  assert.equal(lamp.item('启用').props['aria-checked'],true);assert.equal(lamp.item('蓝灯'),undefined,'启用 / 关闭, no lamp')
  lamp.item('关闭').props.onClick();tree=await settle(f,3)
  assert.equal(style()[0].enabled,false);assert.equal(style()[0].recall.mode,'constant')
  // Shift+Enter starts a line (not a save); an empty text is refused in place.
  let prevented=false;byLabel(tree,'正文').props.onKeyDown({key:'Enter',shiftKey:true,preventDefault(){prevented=true},currentTarget:{}});assert.equal(prevented,false)
  await type('   ');assert.match(text(tree),/请填写正文/);assert.equal(patches().length,2)
  byLabel(tree,'更多操作 新演出风格').props.onClick();tree=await f.r.settle()
  walk(tree).find(n=>n.props.role==='menuitem'&&text(n)==='删除').props.onClick();tree=await settle(f)
  assert.equal(patches().length,2,'nothing removed before the confirmation')
  const dialog=walk(tree).filter(n=>n.props.role==='dialog').at(-1);assert.match(text(dialog),/删除演出风格「新演出风格」/)
  await button(dialog,'删除').props.onClick();tree=await settle(f,3)
  assert.equal(patches().length,3);assert.equal(style().length,0)
})
test('a CAS conflict shows how to recover and keeps the draft',async t=>{
  const f=await modal(t);f.binding.service.patchPack=async()=>{throw Object.assign(new Error('conflict'),{code:'REVISION_CONFLICT'})}
  chip(f.tree,'背景').props.onClick();let tree=await f.r.settle()
  tree=await commitInput(f,tree,'详情','Unsaved draft');assert.match(text(tree),/内容已被修改，请重新载入/);assert.equal(byLabel(tree,'详情').props.value,'Unsaved draft')
})
test('backgrounds show time variants in the hero; audio plays one at a time and stops on kind switch and close',async t=>{
  const f=await modal(t,{previewMedia:async({hash})=>({url:'/lease/'+hash,release:()=>f.calls.push(['release',hash])})})
  chip(f.tree,'背景').props.onClick();let tree=await f.r.settle()
  byLabel(tree,'预览：Day').props.onClick();tree=await f.r.settle()
  const variants=walk(tree).filter(n=>n.props.role==='menuitemradio');assert.deepEqual(variants.map(n=>text(n)),['Day','Dusk','Night'])
  variants.find(n=>text(n)==='Night').props.onClick();tree=await f.r.settle();assert.ok(byLabel(tree,'预览：Night'))
  chip(tree,'音乐').props.onClick();tree=await f.r.settle()
  await byLabel(tree,'试听 Synthetic music').props.onClick();tree=await f.r.settle()
  assert.equal(FakeAudio.playing.length,1);assert.equal(byLabel(tree,'停止试听 Synthetic music').props['aria-pressed'],true)
  assert.ok(walk(tree).some(n=>n.props.role==='progressbar'),'the music player shows progress')
  // private fork (entry name once, owner 2026-10): the name shows once — the pane's name heading leads, above a title-less player card.
  {const pane=walk(tree).find(n=>n.props.className==='ap-detail-pane'),kids=pane.children.filter(c=>c&&typeof c==='object')
    const at=cls=>kids.findIndex(c=>String(c.props.className||'').split(' ').includes(cls)),player=kids[at('ap-player')]
    assert.ok(at('ap-detail-title')>=0&&at('ap-detail-title')<at('ap-player'),'the name heading sits above the player')
    assert.ok(!text(player).includes('Synthetic music')&&!walk(player).some(n=>n.type==='strong'),'the player card has no title of its own')}
  // private fork (audio editor): music has the same in-card 音量; the old 用途 reads as 备注.
  assert.ok(walk(walk(tree).find(n=>n.props.className==='ap-player-volume')).some(n=>n.props.role==='slider'&&n.props['aria-label']==='音量'),'music volume in the player card')
  assert.ok(byLabel(tree,'备注'));assert.ok(byLabel(tree,'用途') === undefined)
  chip(tree,'音效').props.onClick();tree=await f.r.settle()
  assert.equal(FakeAudio.playing.length,0,'switching kind stops preview');assert.ok(f.calls.some(([m])=>m==='release'))
  await byLabel(tree,'试听 Synthetic sfx').props.onClick();tree=await f.r.settle();assert.equal(FakeAudio.playing.length,1)
  // private fork (audio editor): 音量 lives in the player card, not a separate row; the preview follows it.
  const volume=walk(tree).find(n=>n.props.className==='ap-player-volume');assert.ok(walk(volume).some(n=>n.props.role==='slider'&&n.props['aria-label']==='音量'),'styled volume slider in the player card')
  assert.ok(!walk(tree).some(n=>n.props.className==='fork-inline-field'&&/^音量/.test(text(n))),'no full-width 音量 row')
  const slider=walk(volume).find(n=>n.props.role==='slider');slider.props.onKeyDown({key:'ArrowLeft',preventDefault(){}});tree=await settle(f)
  assert.ok(Math.abs(FakeAudio.playing[0].volume-(slider.props['aria-valuenow']/100-.05))<.001,'the preview plays at the entry volume')
  f.r.dispose();assert.equal(FakeAudio.playing.length,0,'closing the pack stops preview')
})
test('the entry filter is a styled menu; no native select or range anywhere in the modal',async t=>{
  const f=await modal(t);let tree=f.tree
  // private fork: figure-owned default appearance is the one native select; entry filters stay styled.
  const natives=tree=>walk(tree).filter(n=>n.type==='select'&&n.props['aria-label']!=='默认外观'||n.props.type==='range'||n.props.type==='radio')
  for(const kind of ['人物','背景','音乐','音效','环境音','滤镜','模组']){chip(tree,kind).props.onClick();tree=await f.r.settle();assert.deepEqual(natives(tree),[],kind)}
  chip(tree,'背景').props.onClick();tree=await f.r.settle()
  byLabel(tree,'筛选条目').props.onClick();tree=await f.r.settle()
  const items=walk(tree).filter(n=>n.props.role==='menuitemradio');assert.deepEqual(items.map(n=>text(n).trim()),['全部','已启用','已停用','蓝灯','绿灯'])
  items.find(n=>text(n).trim()==='蓝灯').props.onClick();tree=await f.r.settle();assert.match(text(tree),/没有符合条件的条目/)
})
// private fork: v3 figure data has structured fields, never a raw JSON escape hatch.
test('figure detail: autosaved height, outfit recall and keywords through patchFigure; no raw editor',async t=>{
  const f=await modal(t);let tree=f.tree
  f.binding.service.patchFigure=async args=>{f.calls.push(['patchFigure',args]);return {snapshot:f.snapshot}}
  assert.deepEqual(walk(tree).filter(n=>n.props.role==='radio'&&n.props.className==='ap-outfit-face').map(n=>text(walk(n).find(m=>m.props.className==='ap-outfit-name'))),['School','Casual']) // private fork (outfit polish): names (the 默认 badge is on the tile)
  assert.deepEqual(walk(tree).filter(n=>n.props.className==='ap-outfit-face').map(n=>[n.props['data-default']===true,walk(n).filter(m=>m.props.className==='ap-tile-badge').map(text).join()]),[[false,''],[false,'']]) // private fork (figure select): no 「默认」 on outfit tiles (开场 picks the opening outfit)
  assert.equal(walk(tree).some(n=>n.props.className==='ap-raw'),false,'raw editor removed')
  tree=await commitInput(f,tree,'身高','170');let args=f.calls.find(([m])=>m==='patchFigure')[1]
  assert.equal(args.expectedRevision,'pack-r1');assert.equal(args.figureId,FIGURE_ID);assert.deepEqual(clone(args.patch),{heightCm:170})
  tree=await pickOutfitLamp(f,tree,'School','keyword') // private fork (figure-editor r7): each tile's lamp dot opens 蓝灯 / 绿灯 / 关闭
  args=f.calls.filter(([m])=>m==='patchFigure').at(-1)[1]
  assert.equal(args.patch.outfits[0].recall.mode,'keyword');assert.equal(JSON.stringify(args.patch.outfits[0].sprite),JSON.stringify(f.snapshot.figures[FIGURE_ID].outfits[0].sprite))
  byLabel(tree,'添加服装触发词').props.onChange({target:{value:'校服, 制服'}});tree=await f.r.settle();byLabel(tree,'添加服装触发词').props.onKeyDown({key:'Enter',preventDefault(){}});tree=await settle(f)
  args=f.calls.filter(([m])=>m==='patchFigure').at(-1)[1];assert.deepEqual(Array.from(args.patch.outfits[0].recall.keywords),['校服','制服'])
  assert.equal(f.calls.some(([m])=>m==='saveCardAssetBindings'),false,'pack metadata only, never the card')
  assert.ok(walk(tree).find(n=>n.props['aria-label']?.startsWith('形象色：')));assert.ok(byLabel(tree,'服装操作')) // private fork (r6): the inline value names its colour; (figure select) the 服装 heading's ⋯
  // private fork (owner 2026-10 r2): no repeated outfit title under the grid; renaming opens from the ⋯ menu.
  assert.equal(byLabel(tree,'服装名称').props.value,'School');assert.ok(byLabel(tree,'服装触发策略') === undefined) // private fork (figure-editor r7): no heading lamp switch; (outfit polish) 服装名 is an inline row of the selected outfit
  assert.equal(walk(tree).filter(n=>n.props['aria-haspopup']==='menu'&&/^服装「.+」的灯：/.test(n.props['aria-label']||'')).length,2,'one lamp button per outfit tile') // private fork (r7)
  // private fork (owner 2026-10 v3.1 r2 / figure-editor r7): the selected outfit's 触发词 are one inline row under the tiles (no
  // accent-bar panel); adding is the grid's dashed ＋ tile (no header pill); the keyword field is a ＋ chip without placeholder text.
  const settings=byLabel(tree,'所选服装设置');assert.match(settings.props.className,/ap-outfit-props/);assert.doesNotMatch(settings.props.className,/ap-selection-detail/)
  assert.deepEqual(walk(settings).filter(n=>n.props.className==='fork-inline-label-text').map(text),['服装名','使用情景','触发词']) // private fork (r7; outfit usage: 使用情景 before 触发词; outfit polish: 服装名 first)
  const outfitHead=walk(tree).find(n=>n.type==='h4'&&/ap-outfit-head/.test(n.props.className||''));assert.ok(byLabel(outfitHead,'服装触发策略') === undefined);assert.ok(byLabel(outfitHead,'服装操作')) // private fork (r7; figure select: the heading row ends with its ⋯)
  // private fork (outfit polish; gen-ui r12 U1: only 差分 tiles open their own menu, by click or right click)
  assert.equal(walk(tree).some(n=>n.props.className==='ap-tile-more'||n.props.onContextMenu&&n.props.className!=='ap-face'),false,'outfit tiles carry no ⋯ or right-click menu')
  assert.equal(walk(tree).some(n=>/ap-detail-action/.test(n.props.className||'')),false,'no action line under the outfit block') // private fork (figure select)
  assert.equal(byLabel(tree,'添加服装').props.className,'ap-outfit-add');assert.equal(text(byLabel(tree,'添加服装')).trim(),'');assert.equal(walk(tree).some(n=>n.type==='button'&&text(n).includes('添加服装')),false)
  assert.equal(byLabel(tree,'添加服装触发词').props.placeholder,undefined)
  tree=await commitInput(f,tree,'服装名称','Uniform');assert.equal(f.calls.filter(([m])=>m==='patchFigure').at(-1)[1].patch.outfits[0].label,'Uniform')
  // private fork (character v3, owner 2026-10): no per-outfit 服装启用 switch, 静态立绘 chip or 高级 summary.
  assert.ok(byLabel(tree,'服装启用') === undefined);assert.doesNotMatch(text(tree),/静态立绘|高级|服装差分映射/)
  assert.equal(walk(tree).some(n=>n.type==='select'&&n.props['aria-label']!=='默认外观'||n.props.className==='ap-raw'||n.props.className==='ap-advanced-head'),false)
  assert.doesNotMatch(text(tree),/角色窗口|声音描述|资源映射/)
})
test('figure recall rebases once on fresh CAS, preserving other external outfit changes',async t=>{
  const f=await modal(t),fresh=clone(f.snapshot)
  fresh.revision='external';fresh.figures[FIGURE_ID].outfits[1].label='Externally renamed'
  let calls=0,reads=0
  f.binding.service.getPackSnapshot=async()=>{reads++;return fresh}
  f.binding.service.patchFigure=async args=>{
    f.calls.push(['patchFigure',args]);calls++
    if(calls===1)throw Object.assign(new Error('Pack revision changed'),{code:'REVISION_CONFLICT'})
    assert.equal(args.expectedRevision,'external')
    assert.equal(args.patch.outfits[1].label,'Externally renamed')
    const snapshot=clone(fresh);snapshot.revision='saved';snapshot.figures[FIGURE_ID]={...snapshot.figures[FIGURE_ID],...clone(args.patch)};return {snapshot}
  }
  const tree=await pickOutfitLamp(f,f.tree,'School','keyword',4) // private fork (figure-editor r7): the tile's lamp menu
  assert.equal(calls,2);assert.equal(reads,1)
  assert.equal(outfitLampButton(tree,'School').props['data-mode'],'keyword') // private fork (r7)
  assert.equal(walk(tree).some(n=>n.props.role==='alert'),false)
})
for(const kind of ['conflict','timeout','validation'])test('figure save failure surfaces a warning chip: '+kind,async t=>{
  const f=await modal(t);let calls=0
  f.binding.service.patchFigure=async()=>{calls++;throw kind==='conflict'?Object.assign(new Error('changed'),{code:'REVISION_CONFLICT'}):kind==='timeout'?Object.assign(new Error('aborted'),{name:'AbortError'}):new Error('Invalid recall')}
  byLabel(f.tree,'添加服装触发词').props.onChange({target:{value:'uniform'}})
  let tree=await settle(f);byLabel(tree,'添加服装触发词').props.onKeyDown({key:'Enter',preventDefault(){}});tree=await settle(f,4)
  const alert=walk(tree).find(n=>n.props.role==='alert'&&/ap-hint-chip/.test(n.props.className||''))
  assert.ok(alert);assert.match(text(alert),/\u26a0/)
  assert.match(text(alert),kind==='conflict'?/重新载入/:kind==='timeout'?/保存超时.*结果尚未确认/:/Invalid recall/)
  assert.equal(calls,kind==='conflict'?2:1,'never retry an uncertain timeout or invalid input')
})

test('a Live2D outfit previews the live model with the view controls on',async t=>{
  const f=await fixture(t,'App'),kit={Preview:p=>({type:'live2d-preview',props:{...p},children:[]}),snapshots:{peek:()=>({}),request:async(source,names)=>Object.fromEntries(names.map(n=>[n,'data:image/webp;base64,'+n]))}}
  f.binding.service.leaseBundle=async()=>({ticket:'t',url:'/m.model3.json'});f.binding.service.releaseLease=()=>{}
  const views=f.context.views(f.r.React,{live2d:kit});f.r.render(views.PackModal,{binding:f.binding,packId:PACK_ID,packs:[f.snapshot],onClose(){}});let tree=await f.r.settle()
  walk(tree).find(n=>n.props.className==='ap-outfit-face'&&text(n).trim()==='Casual').props.onClick();tree=await settle(f,3)
  const preview=walk(tree).find(n=>n.type==='live2d-preview');assert.ok(preview);assert.equal(preview.props.interactive,true);assert.equal(preview.props.source.identity,JSON.stringify([PACK_ID,'casual',f.snapshot.manifest.bundles.casual.contentHash,null]))
})
test('multi-select copies any kind through copyItems: an existing pack (CAS) or a new one, then offers to open it',async t=>{
  const other={...clone({manifest:{...(await syntheticPack()).manifest}}),figures:{},sprites:{},revision:'other-r1'};other.manifest.id=OTHER_PACK_ID;other.manifest.name='Other pack'
  const f=await modal(t,{},{others:[other]})
  f.binding.service.copyItems=async a=>{f.calls.push(['copyItems',clone(a)]);return {packId:a.target.packId||NEW_PACK_ID,revision:'x',copied:[]}}
  chip(f.tree,'背景').props.onClick();let tree=await f.r.settle()
  byLabel(tree,'多选').props.onClick();tree=await f.r.settle();assert.equal(byLabel(tree,'多选').props['aria-pressed'],true)
  for(const row of options(tree))row.props.onClick();tree=await f.r.settle()
  assert.match(text(walk(tree).find(n=>n.props.className==='ap-select-bar')),/已选\s*2/)
  button(tree,'复制到…').props.onClick();tree=await f.r.settle()
  assert.deepEqual(walk(tree).filter(n=>n.props.role==='menuitem').map(n=>text(n).trim()),['新建素材包','Other pack'],'新建 first, never the source pack')
  walk(tree).find(n=>n.props.role==='menuitem'&&text(n)==='Other pack').props.onClick();tree=await settle(f)
  assert.deepEqual(f.calls.find(([m])=>m==='copyItems')[1],{sourcePackId:PACK_ID,itemRefs:[{kind:'backgrounds',id:'classroom'},{kind:'backgrounds',id:'pending'}],target:{packId:OTHER_PACK_ID,expectedRevision:'other-r1'}})
  assert.match(text(tree),/已复制 2 项到「Other pack」/);assert.equal(walk(tree).some(n=>n.props.className==='ap-select-bar'),false,'select mode ends')
  button(tree,'打开').props.onClick();assert.deepEqual(f.opened,[OTHER_PACK_ID])
  chip(tree,'人物').props.onClick();tree=await f.r.settle();byLabel(tree,'多选').props.onClick();tree=await f.r.settle();button(tree,'全选').props.onClick();tree=await f.r.settle()
  button(tree,'复制到…').props.onClick();tree=await f.r.settle();walk(tree).find(n=>n.props.role==='menuitem'&&text(n).trim()==='新建素材包').props.onClick();tree=await f.r.settle()
  byLabel(tree,'新素材包名称').props.onChange({target:{value:'Neuro 自制'}});tree=await f.r.settle();button(tree,'创建并复制').props.onClick();tree=await settle(f)
  assert.deepEqual(f.calls.filter(([m])=>m==='copyItems')[1][1],{sourcePackId:PACK_ID,itemRefs:[{kind:'figures',id:FIGURE_ID}],target:{newPackName:'Neuro 自制'}})
  assert.equal(f.calls.some(([m])=>m==='createPack'),false,'the new pack is created by the same copy publication')
})
test('添加文件: audio stages blobs; each new figure publishes image and owners in one CAS',async t=>{
  const images=[],prepared={bytes:new Uint8Array([1]),descriptor:{ext:'png',mime:'image/png',size:1},width:600,height:1200,warnings:[],autoColor:'#78283c'}
  const f=await modal(t,{},{viewOptions:{prepareImage:async(file,kind)=>{images.push(kind);return prepared}}});chainedPatch(f);let tree=f.tree,blobs=0
  f.binding.service.putBlob=async a=>{f.calls.push(['putBlob',a]);return {snapshot:{...f.snapshot,revision:'pack-r1'},hash:String(++blobs).repeat(64).slice(0,64)}}
  f.binding.service.createSimpleSprite=async a=>{f.calls.push(['createSimpleSprite',a]);return {snapshot:{...f.snapshot,revision:'pack-r1'},sprite:{manifestKey:a.spriteKey,assets:{}}}}
  f.binding.service.createFigure=async a=>{f.calls.push(['createFigure',a]);return {snapshot:{...f.snapshot,revision:'pack-r1'},figureId:'66666666-6666-4666-8666-666666666666'}}
  const mp3=new Uint8Array([0x49,0x44,0x33,4,0,0,0,0,0,0,0,0,0xff,0xfb]),file=(name,bytes)=>({name,arrayBuffer:async()=>bytes.buffer})
  const add=async(label,files)=>{byLabel(tree,'添加文件').props.onClick();tree=await f.r.settle();await byLabel(tree,label).props.onChange({target:{files,value:'x'}});tree=await settle(f,4)}
  await add('添加音乐',[file('雨夜.mp3',mp3),file('晴天.mp3',mp3)])
  const blobsSent=f.calls.filter(([m])=>m==='putBlob').map(([,a])=>a);assert.equal(blobsSent.length,2);assert.deepEqual(clone(blobsSent[0].descriptor),{ext:'mp3',mime:'audio/mpeg',size:14})
  const patch=f.calls.filter(([m])=>m==='patchPack');assert.equal(patch.length,1,'one manifest write for all new entries')
  const added=clone(patch[0][1].patch.assets.slice(-2));assert.deepEqual(added.map(a=>[a.kind,a.name,a.enabled,a.media]),[['music','雨夜',true,'1'.repeat(64)],['music','晴天',true,'2'.repeat(64)]])
  for(const a of added){assert.match(a.id,/^[a-z0-9][a-z0-9_-]{0,63}$/);assert.deepEqual(clone(a.recall),{mode:'keyword',keywords:[]});assert.equal(a.directorNote,'')}
  assert.match(text(tree),/已添加 2 项/);assert.equal(chip(tree,'音乐').props['aria-selected'],true)
  await add('添加音乐',[file('bad.mp3',new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12]))]);assert.match(text(tree),/请选择 MP3、OGG、WAV、M4A 或 FLAC 音频/)
  await add('添加人物',[file('新角色.png',new Uint8Array([1]))])
  assert.deepEqual(images,['sprite']);const atomic=f.calls.filter(([m])=>m==='patchPack').at(-1)[1],files=[...atomic.fileUpdates];
  const figure=JSON.parse(Buffer.from(files.find(([name])=>name.startsWith('figures/'))[1])),sprite=JSON.parse(Buffer.from(files.find(([name])=>name.startsWith('sprites/'))[1]));
  const hash=createHash('sha256').update(prepared.bytes).digest('hex');
  assert.equal(figure.name,'新角色');assert.equal(figure.autoColor,'#78283c');assert.equal(figure.outfits[0].sprite.assets[sprite.emotions.calm.stage.src],hash);
  assert.deepEqual(figure.emotions,[{id:'calm'}]);assert.equal(Object.hasOwn(figure.outfits[0],'emotions'),false);
  // Exercise the host's closure validator, not only the permissive UI service mock.
  const spriteKey=figure.outfits[0].sprite.manifestKey;
  assert.doesNotThrow(()=>validateFigureClosure({figures:[figure.id],sprites:{[spriteKey]:atomic.patch.sprites[spriteKey]},blobs:{[hash]:clone(atomic.patch.blobs[hash])},assets:[]},{[figure.id]:figure},{[spriteKey]:sprite}));
  assert.equal(files.filter(([name])=>name.startsWith('media/')).length,1);assert.equal(atomic.expectedRevision,'pack-r2');
  assert.equal(f.calls.filter(([m])=>m==='putBlob').length,2,'images never stage an unowned blob');assert.equal(f.calls.some(([m])=>['createSimpleSprite','createFigure'].includes(m)),false);
  assert.equal(f.calls.some(([m])=>m==='saveCardAssetBindings'),false)
  f.binding.service.patchPack=async()=>{throw Object.assign(new Error('MISSING_DEPENDENCY'),{code:'MISSING_DEPENDENCY'})};
  await add('添加人物',[file('incomplete.png',new Uint8Array([1]))]);
  assert.match(text(tree),/素材引用不完整.*补齐.*重试/);assert.doesNotMatch(text(tree),/MISSING_DEPENDENCY/);
})
test('an empty pack offers 添加文件 in the middle',async t=>{
  const empty={manifest:{id:NEW_PACK_ID,name:'空包',assets:[],figures:[],sprites:{},bundles:{},blobs:{}},figures:{},sprites:{},revision:'e1'}
  const f=await modal(t,{},{packId:NEW_PACK_ID});f.binding.service.getPackSnapshot=async()=>empty;f.render({key:'empty'});const tree=await settle(f)
  assert.match(text(walk(tree).find(n=>n.props.className==='ap-pack-empty')),/还没有内容\s+添加文件/)
})
// private fork (global only, owner 2026-10, AGENTS rule 15): 可用演出 on 舞台引擎 is the one director command setting (no card
// chips). One row per group (全部 / 部分 n/m / 全部关闭) unfolding to its chips, CG included (18 commands); a chip saves the
// global `dimensions` at once and 「保存」 never re-sends them. No 对话主题 / 导入主题 (the look is a 素材库 舞台皮肤) and no
// 「更多」 fold in 智能判断 (门槛 / 每类上限 / 超时 / 附加说明 always shown).
test('private fork: engine page owns 可用演出 (global only); no 对话主题 or 更多; 保存 never sends dimensions',async t=>{
  const values=defaultAssetEngineSettings();values.dialogueThemes=[{format:'dsh-dialogue-theme',schemaVersion:1,id:'sakura',name:'樱花信笺'}]
  values.dimensions={...values.dimensions,weather:false,dof:false,camera:false,'camera.close':false}
  const engine={values,revision:'engine-r1',writable:true},saves=[]
  const f=await fixture(t,'EnginePage',{rpc:async(method,args)=>{if(method==='getAssetEngineSettings')return engine;if(method==='getAssetVoiceServices')return {services:[]};if(method==='getTavernSettings')return {modelCatalog:[]};if(method==='saveAssetEngineSettings'){saves.push(args);return engine}throw new Error(method)}})
  let tree=f.tree
  const titles=walk(tree).filter(n=>n.props.className==='ap-section-title').map(n=>text(n))
  assert.deepEqual(titles,['导演模型','判断模型','可用演出','每轮上限']) // private fork (judge key, owner 2026-10): 智能判断 → 判断模型
  assert.ok(walk(tree).filter(n=>n.props.className==='ap-section-meta').some(n=>text(n)==='14 / 18'),'14 of 18 on')
  const toggles=walk(tree).filter(n=>n.type==='button'&&n.props.className==='ap-engine-group-toggle')
  assert.deepEqual(toggles.map(n=>text(n).replace(/\s+/g,' ').trim()),['场景与转场 部分 4/5','镜头 全部关闭','人物 全部','效果 全部','CG 全部'])
  assert.ok(toggles.every(n=>n.props['aria-expanded']===false),'groups start folded')
  toggles[4].props.onClick();tree=await f.r.settle()
  await walk(tree).find(n=>n.type==='button'&&n.props.role==='checkbox'&&text(n)==='CG').props.onClick();tree=await f.r.settle()
  assert.deepEqual(clone(saves.at(-1).patch),{dimensions:{cg:false}});assert.equal(saves.at(-1).expectedRevision,'engine-r1')
  saves.length=0
  assert.doesNotMatch(text(tree),/对话主题|导入主题|樱花信笺|更多|向量匹配|素材智能匹配|每类补到|组件执行|确认开启/)
  assert.equal(walk(tree).filter(n=>n.type==='input'&&n.props.type==='file').length,0,'no theme import')
  for(const label of ['门槛','每类上限','超时','附加说明'])assert.ok(walk(tree).some(n=>n.props.className==='fork-inline-label-text'&&text(n)===label),label+' shown without a fold')
  assert.equal(walk(tree).filter(n=>/ap-hint-mark/.test(n.props.className||'')).length,0,'an optional unset judge is not a warning')
  assert.doesNotMatch(text(tree),/模组只按触发词|靠它才会/)
  assert.match(JSON.stringify(tree),/配置后可减轻导演负担、更精准地挑选素材/)
  // A draft change saves without the retired dimensions or the unused themes.
  tree=await commitInput(f,tree,'画面效果 每轮上限','3')
  await button(tree,'保存').props.onClick();await f.r.settle()
  assert.equal(saves.length,1);assert.equal(Object.hasOwn(saves[0].patch,'dimensions'),false);assert.equal(Object.hasOwn(saves[0].patch,'dialogueThemes'),false)
  assert.equal(saves[0].patch.actionCaps.beat,3)
})
// private fork (settings polish, owner 2026-10): 配音服务选择 lists a voice method only when it has a real choice (≥ 2 installed
// services) or its stored choice names a missing service; with one service per method the section is gone.
test('private fork: engine page shows 配音服务 only for methods with several services',async t=>{
  const engine={values:defaultAssetEngineSettings(),revision:'engine-r1',writable:true}
  const page=async(services,voiceServices={})=>{engine.values={...defaultAssetEngineSettings(),voiceServices};const f=await fixture(t,'EnginePage',{rpc:async method=>method==='getAssetEngineSettings'?engine:method==='getAssetVoiceServices'?{services}:method==='getTavernSettings'?{modelCatalog:[]}:undefined});return f.tree}
  const fish={id:'fish',kind:'fish-audio'},fish2={id:'fish-2',kind:'fish-audio'},qwen={id:'qwen',kind:'qwen'},local={id:'local',kind:'reference-api',capabilities:{localEngine:'gpt-sovits'}}
  let tree=await page([fish,qwen,local])
  assert.doesNotMatch(text(tree),/配音服务/,'one service per method: no section')
  tree=await page([fish,fish2,qwen])
  assert.match(text(tree),/配音服务/);assert.ok(byLabel(tree,'Fish Audio 默认服务：自动'));assert.ok(byLabel(tree,'通义千问 默认服务：自动') === undefined) // private fork (engine row): the section is 配音服务
  tree=await page([qwen],{'fish-audio':'gone'})
  assert.ok(byLabel(tree,'Fish Audio 默认服务：gone（不可用）'),'a stored choice of a missing service still shows')
})// private fork (owner 2026-10): the vector / semantic recall is removed — the engine page shows no matching section, makes no
// recall RPC and never sends the stored semanticRecall back; editing a field still saves only on explicit 保存.
test('private fork: engine page has no vector recall; fields save only on explicit 保存 without semanticRecall',async t=>{
  const f=await fixture(t,'EnginePage');let tree=f.tree
  assert.doesNotMatch(text(tree),/向量|智能匹配|每类补到|重建索引|密钥来源|最近六段正文/)
  assert.ok(byLabel(tree,'匹配服务模型') === undefined)
  byLabel(tree,'画面效果 每轮上限').props.onChange({target:{value:'3'}});tree=await f.r.settle();byLabel(tree,'画面效果 每轮上限').props.onBlur();tree=await f.r.settle()
  assert.equal(f.calls.some(([name])=>name==='saveAssetEngineSettings'),false)
  await button(tree,'保存').props.onClick();await f.r.settle()
  const args=f.calls.find(([name])=>name==='saveAssetEngineSettings')[1]
  assert.equal(args.expectedRevision,'engine-r1');assert.equal(args.patch.actionCaps.beat,3);assert.equal(Object.hasOwn(args.patch,'semanticRecall'),false)
  assert.equal(f.calls.some(([name])=>/Semantic|Recall/.test(name)),false,'no recall RPC')
})

// private fork (card import r3): the 导入卡片 sheet names the card's 模组 (paths only in 详情), asks once in the sheet
// itself and closes on Escape; no preview code executes.
const cardImportService=(f,{widgets=[{packId:PACK_ID,packName:'Remapped pack',widgetId:'clock',widgetName:'Named clock'}],on=true}={})=>{
  const applies=[],raw={spec:'chara_card_v2',data:{name:'Card',extensions:{dsh_tavern:{stage:{widgets:on},assetBindings:{boundPackIds:[PACK_ID]}}}}}
  Object.assign(f.binding.service,{inspectCardBundle:async()=>({inspectionId:'card-preview',expectedRevision:'c1',packs:[],raw,currentRaw:raw}),
    previewCardBundleDecisions:async()=>({mappings:[],scriptRisk:[{packId:PACK_ID,packName:'Remapped pack',widgetId:'clock',widgetName:'Named clock',path:'bundles/widget/index.js'}],cardWidgetRisks:widgets,raw}),
    applyCardBundle:async args=>{if(!args.cancel)applies.push(args);return args.cancel?{status:'cancelled'}:{status:'committed',mappings:[]}}})
  return applies
}
test('card import asks about 模组 once in its own sheet and closes on Escape; no preview code executes',async t=>{
  const f=await fixture(t,'App'),applies=cardImportService(f);let closed=0,done=0
  f.r.render(f.views.CardImportSheet,{binding:f.binding,path:'card.json',file:{name:'card.zip',arrayBuffer:async()=>new ArrayBuffer(1)},onClose:()=>closed++,onDone:()=>done++})
  // private fork: names are authoritative even when no old-id lookup table exists.
  const tree=await f.r.settle();assert.match(text(tree),/「Named clock」/);assert.doesNotMatch(text(tree),/bundles\/|index\.js|沙箱|读点/);assert.equal(walk(tree).some(n=>n.props.type==='checkbox'||n.type==='iframe'),false)
  await button(tree,'启用').props.onClick();assert.equal(done,1);assert.equal(applies[0].disableWidgets,false)
  const dialog=walk(tree).find(n=>n.props.role==='dialog');let prevented=false;dialog.props.onKeyDown({key:'Escape',preventDefault(){prevented=true},stopPropagation(){}});assert.ok(prevented)
  const other=await fixture(t,'App');cardImportService(other);other.r.render(other.views.CardImportSheet,{binding:other.binding,path:'card.json',file:{name:'card.zip',arrayBuffer:async()=>new ArrayBuffer(1)},onClose:()=>closed++,onDone(){}})
  const second=walk(await other.r.settle()).find(n=>n.props.role==='dialog');second.props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(closed,1)
})
test('binding releases late leases and subscriptions on unload, settings writes require native CAS',async()=>{
  const context={};vm.runInNewContext(bindingSource+';this.create=createForkAssetPackBinding;',context)
  let resolve,released=0,saved;const pending=new Promise(r=>{resolve=r})
  const b=context.create({service:{apiVersion:2,capabilities:['packs'],leaseMedia:()=>pending,releaseLease:()=>released++},settings:{read:async()=>({values:{globalEnabledPackIds:[]},revision:'s1'}),save:async args=>{saved=args;return {values:{globalEnabledPackIds:args.globalEnabledPackIds},revision:'s2'}}}})
  await b.setGlobalEnabled(PACK_ID,true);assert.equal(saved.expectedRevision,'s1');assert.deepEqual(Array.from(b.globalEnabledPackIds),[PACK_ID])
  const lease=b.previewMedia({packId:PACK_ID,hash:'a'});b.dispose();resolve({ticket:'t',url:'/lease'});await assert.rejects(lease);assert.equal(released,1)
})
test('styles keep narrow layouts, opaque settings, aligned labels and visible keyboard focus',async()=>{
  const css=await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css',import.meta.url),'utf8')
  // private fork: panel-ui-design.md label column and narrow breakpoint.
  // private fork (inline-field sweep): the boxed .ap-field rows are gone (label + value rows are .fork-inline-field).
  assert.doesNotMatch(css,/\.ap-field \{/);assert.match(css,/\.fork-inline-field \{/);assert.match(css,/@container \(max-width: 560px\)/);assert.match(css,/\.ap-ui :focus-visible/);assert.match(css,/\.ap-modal[\s\S]*Canvas/)
})


test('offline browser: desktop and narrow screens, keyboard modal containment and unload cleanup',async()=>{
  const {chromium}=await import('playwright')
  const {browserReactScript}=await import('./fixtures/browser-react.mjs')
  const {mkdir}=await import('node:fs/promises')
  await mkdir(new URL('../.tmp/asset-packs-preview/',import.meta.url),{recursive:true})
  const browser=await chromium.launch({channel:'chrome',headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1100,height:900}}), errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.setContent('<html><head></head><body><div id="root"></div></body></html>')
    const css=await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css',import.meta.url),'utf8')
    await page.addStyleTag({content:css+' body {margin:0;--fork-ink:#20252d;--fork-ink-2:#687080;--fork-hairline:#dce1e8;--fork-surface:#fbfcfe;--fork-accent:#3f6ddd;--fork-accent-soft:#e9effc;} '})
    const pack=await syntheticPack(), snapshot={manifest:pack.manifest,figures:pack.figures,sprites:pack.sprites,revision:'r1'}
    const image='data:image/png;base64,'+[...pack.files].find(([file])=>file.endsWith('.png'))[1].toString('base64')
    const playback=await readFile(new URL('../tavern-plugin/src/client/fork-pack-playback.cjs',import.meta.url),'utf8')
    await page.addScriptTag({content:await browserReactScript()+';window.React=modules.react;window.ReactDOM=modules["react-dom/client"];'+playback+source+pickerSource})
    await page.evaluate(({snapshot,card,engine,packId,figureId,image,figureMoods})=>{
      window.listenerCount=0
      window.binding={service:{apiVersion:2,capabilities:['packs','figures'],listPackSummaries:async()=>[snapshot],getPackSnapshot:async()=>snapshot,subscribe:()=>{window.listenerCount++;return()=>window.listenerCount--;}},rpc:async method=>method==='getAssetVoiceServices'?{services:[]}: method==='getAssetPackDependencies'?{available:true,count:2}:method==='getCardAssetBindings'?{extension:card,revision:'r1'}:{values:engine,revision:'r1',writable:true},download(){}}
      window.binding.previewMedia=async()=>({url:image,release(){}})
      window.binding.service.patchFigure=async({figureId,patch})=>{window.lastFigurePatch=patch;snapshot={...snapshot,revision:snapshot.revision+'x',figures:{...snapshot.figures,[figureId]:{...snapshot.figures[figureId],...patch}}};return {snapshot}}
      window.views=createForkAssetPackUI(window.React,{VoicePicker:ForkBubbleLibraryPicker,AvatarImage:ForkPackImage,emotions:{moods:figureMoods}});window.root=ReactDOM.createRoot(document.getElementById('root'))
      window.show=name=>window.root.render(React.createElement('div',{className:'ap-ui'},React.createElement(window.views[name],{binding:window.binding,path:'card',cardPath:'card',cardName:'Card',ready:true,snapshot,figure:snapshot.figures[figureId],packId,packs:[snapshot],onClose(){},onPack(){},onSaved(){}})))
      window.show('Home')
    },{snapshot,card:cardExtension(),engine:defaultAssetEngineSettings(),packId:PACK_ID,figureId:FIGURE_ID,image,figureMoods})
    // private fork: the 素材库 title moved to App; the card page saves with a single 保存.
    // private fork (packs-v3): the pack modal replaced FigureEditor; 舞台设置's pack section is 「当前素材包 · 管理」.
    for(const [screen,label] of [['Home','Synthetic pack'],['PackModal','School'],['StagePage','管理'],['EnginePage','保存']] /* private fork (engine ui r2) */){
      await page.evaluate(screen=>window.show(screen),screen)
      await page.getByText(label,{exact:true}).first().waitFor()
      if(screen==='PackModal') {
        assert.deepEqual(await page.locator('.ap-face').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label'))),figureMoods.map(row=>row.label)) // private fork (figure select): exactly what the outfit declares, in its order
        // private fork (owner 2026-10 r2): a roster face expands just that emotion (演出指导 + media).
        await page.locator('.ap-face[aria-label="平和"]').click()
        await page.getByLabel('平和使用情景',{exact:true}).fill('平静') // private fork (figure-editor r7): 使用情景
        await page.getByLabel('平和使用情景',{exact:true}).press('Tab') // private fork (figure-editor r7): 使用情景
        await page.waitForFunction(()=>window.lastFigurePatch?.emotions?.find(row=>row.id==='calm')?.guidance==='平静')
        assert.equal(await page.locator('.ap-raw').count(),0)
        const canvas=page.locator('.ap-still-canvas');await canvas.scrollIntoViewIfNeeded();await canvas.hover()
        const scroll=await page.locator('.ap-pack-right').evaluate(el=>el.scrollTop)
        await page.mouse.wheel(0,-120)
        await page.waitForFunction(()=>!document.querySelector('.ap-still-image').style.transform.endsWith('scale(1)'))
        assert.equal(await page.locator('.ap-pack-right').evaluate(el=>el.scrollTop),scroll,'zoom does not scroll the editor')
        await canvas.dblclick()
        await page.waitForFunction(()=>document.querySelector('.ap-still-image').style.transform.endsWith('scale(1)'))
      }
      if(screen==='StagePage') {
        // private fork (stage setup wizard, owner 2026-10-15): no 人物 section; figures open from the pack row (素材库).
        assert.equal(await page.locator('.ap-cast').count(),0)
      }
      assert.equal(await page.locator('.ap-ui').evaluate(el=>el.getBoundingClientRect().width),1100,screen+' must fill the desktop container')
      await page.screenshot({path:new URL('../.tmp/asset-packs-preview/'+screen+'.png',import.meta.url).pathname.replace(/^\/(.:)/,'$1'),fullPage:true})
      await page.setViewportSize({width:375,height:900})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,screen+' must fit a narrow viewport')
      assert.equal(await page.locator('.ap-ui').evaluate(el=>el.getBoundingClientRect().width),375,screen+' must fill the narrow container')
      await page.setViewportSize({width:1100,height:900})
    }
    await page.setViewportSize({width:375,height:900})
    // private fork (card import r3): the 导入卡片 sheet with its 模组 question; focus moves to 不启用 once the card is read.
    await page.evaluate(()=>{
      const raw={spec:'chara_card_v2',data:{name:'Card',extensions:{dsh_tavern:{stage:{widgets:true},assetBindings:{boundPackIds:['p']}}}}}
      Object.assign(window.binding.service,{inspectCardBundle:async()=>({inspectionId:'card-preview',expectedRevision:'c1',packs:[],raw,currentRaw:raw}),
        previewCardBundleDecisions:async()=>({mappings:[],scriptRisk:[],cardWidgetRisks:[{packId:'p',packName:'Pack',widgetId:'clock',widgetName:'Clock'}],raw}),
        applyCardBundle:async args=>args.cancel?{status:'cancelled'}:{status:'committed',mappings:[]}})
      window.root.render(React.createElement('div',{className:'ap-ui'},React.createElement(window.views.CardImportSheet,{binding:window.binding,path:'card',file:{name:'card.zip',arrayBuffer:async()=>new ArrayBuffer(1)},onDone(){},onClose:()=>window.show('EnginePage')})))
    })
    await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'启用',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'启用',exact:true}).isEnabled(),true)
    await page.waitForFunction(()=>document.activeElement?.textContent==='不启用')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]')),true)
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0)
    await page.screenshot({path:new URL('../.tmp/asset-packs-preview/narrow.png',import.meta.url).pathname.replace(/^\/(.:)/,'$1'),fullPage:true})
    await page.evaluate(()=>window.root.unmount())
    assert.equal(await page.evaluate(()=>window.listenerCount),0)
    assert.deepEqual(errors,[])
  } finally {await browser.close()}
})


// private fork (pack catalogue r2, docs/fork/pack-catalogue-ui.md): a single pack installs through the plain install sheet.
// The widget risk prompt belongs to card import (owner decision), so there is no risk step: the explicit 「替换」 button is
// the decision and carries the backend's acceptScriptRisk acknowledgement. No select, no checkbox, no +/改/删 ledger.
test('single-pack import replaces only through the explicit 替换 button and acknowledges script risk with it (no risk step)',async t=>{
  const f=await fixture(t,'Home'),calls=[]
  const risk={packId:PACK_ID,packName:'Synthetic pack',path:'bundles/widget/index.js'}
  const preview={inspectionId:'preview',packId:PACK_ID,expectedRevision:'frozen',incoming:f.snapshot,current:null,choices:['update','keep-both','cancel'],diff:{assets:{added:['clock'],changed:[],removed:[]},figures:{added:[],changed:[],removed:[]},files:{added:[],changed:[],removed:['old-file']}},scriptRisk:[risk]}
  f.binding.service.applyImport=async args=>{calls.push(args);return {status:'updated'}}
  f.r.render(f.views.ConflictDialog,{binding:f.binding,preview,onClose(){},onDone(){}})
  let tree=await f.r.settle()
  assert.equal(walk(tree).some(n=>n.type==='select'||n.props.type==='checkbox'||n.props.role==='radiogroup'),false)
  assert.match(text(tree),/会用这个文件替换已安装的/);assert.doesNotMatch(text(tree),/导入前确认风险|改 \d+ \/|删 \d+|bundles\//)
  assert.equal(calls.length,0,'nothing is published before the explicit choice')
  await walk(tree).find(n=>n.type==='button'&&n.props.className==='ap-primary'&&text(n)==='替换').props.onClick();tree=await f.r.settle()
  assert.equal(calls.length,1);assert.equal(calls[0].acceptScriptRisk,true);assert.equal(calls[0].decision,'update');assert.equal(calls[0].expectedRevision,'frozen')
  assert.doesNotMatch(text(tree),/导入前确认风险/)
})

// private fork: the validated card contract permits name-only character rows.
// private fork: shared searchable picker writes only the card voice id.


// private fork: cast rows never depend on the retired baked-avatar map.
// private fork (stage setup wizard, owner 2026-10-15): the 人物 tiles left 舞台设置; the same figure faces are read in the pack's 人物 list.
const figureList=(f,binding,key)=>f.r.render(f.views.PackModal,{key,binding,packId:PACK_ID,packs:[f.snapshot],initial:{kind:'figures'},onClose(){}})
test('figure faces never borrow a different outfit and leave no-art characters empty',async t=>{
  const previews=[],released=[]
  const f=await fixture(t,'StagePage',{previewMedia:async input=>{previews.push(input);return {url:'blob:'+input.hash,release:()=>released.push(input.hash)}}})
  const figure=f.snapshot.figures[FIGURE_ID],body=figure.outfits[0],priorPreviews=previews.length
  const crop={x:0.22,y:0.02,w:0.5,h:0.25}
  body.sprite.avatarCropAuto={calm:crop};delete body.avatars
  figure.outfits=[{key:'model',label:'Model',enabled:true,live2d:figure.outfits[1].live2d},body]
  figureList(f,{...f.binding})
  let tree=await f.r.settle()
  const image=walk(tree).find(n=>n.type==='img'&&n.props['data-avatar-crop'])
  assert.equal(image,undefined)
  // The figure page beside the list may show the outfit's 立绘; the face itself borrows nothing.
  assert.equal(walk(walk(tree).find(n=>/(^| )ap-item-avatar( |$)/.test(n.props.className||''))).some(n=>n.type==='img'),false);void priorPreviews
  figure.outfits=[]
  // Thumbnail leases are shared and held briefly after their last user (no flash on remount), then released.
  f.context.setTimeout=fn=>{fn();return 0}
  figureList(f,{...f.binding})
  tree=await f.r.settle()
  assert.ok(walk(tree).some(n=>/(^| )ap-item-avatar( |$)/.test(n.props.className||'')&&n.props['data-empty']))
  // private fork (character v3): a no-art face is a silhouette (the thumbnail unmounts; the fixture renderer runs cleanups on dispose).
  f.r.dispose()
})
// private fork: no flash (owner 2026-10) — a loading thumbnail is an empty box, never a letter; one pack image is one
// shared lease, and a remount within the hold paints the image in its first render.
test('thumbnails prefer host cache and share fallback leases across remounts',async t=>{
  const previews=[],released=[],pending=[]
  const f=await fixture(t,'StagePage',{previewMedia:input=>{previews.push(input);return new Promise(r=>pending.push(()=>r({url:'blob:'+input.hash,release:()=>released.push(input.hash)})))}})
  const binding=f.binding,avatar=tree=>walk(tree).find(n=>n.props.className==='ap-item-avatar')
  let tree=figureList(f,binding,'a');tree=await f.r.settle()
  assert.match(walk(avatar(tree)).find(n=>n.type==='img').props.src,/\/v2\/thumbnail\?/)
  for(const node of walk(tree))if(node.type==='img'&&node.props.src?.includes('/v2/thumbnail?'))node.props.onError?.()
  tree=await f.r.settle()
  assert.ok(avatar(tree)?.props['data-empty']);assert.equal(walk(avatar(tree)).some(n=>n.props.className==='ap-thumb-initial'),false,'no letter while the fallback is on its way')
  const hashes=new Set(previews.map(p=>p.hash));assert.equal(previews.length,hashes.size,'one lease per pack image')
  while(pending.length)pending.shift()();tree=await f.r.settle()
  assert.equal(avatar(tree).props['data-empty'],undefined);assert.equal(avatar(tree).props['data-ap-media'],'loading','hidden until decoded, then faded in')
  const leases=previews.length
  f.r.dispose();assert.equal(released.length,0,'held briefly after the last user')
  figureList(f,binding,'b');tree=await f.r.settle()
  for(const node of walk(tree))if(node.type==='img'&&node.props.src?.includes('/v2/thumbnail?'))node.props.onError?.()
  tree=await f.r.settle()
  assert.equal(avatar(tree).props['data-empty'],undefined);assert.equal(previews.length,leases,'a remount reuses the held fallback lease')
})

// private fork: a retired optional item is visible as a warning, not a broken or silently missing pack.
test('library flags unavailable widget items while the mixed pack remains browsable',async t=>{
 const f=await fixture(t,'App');f.snapshot.diagnostics=[{ref:{packId:PACK_ID,kind:'widgets',assetId:'old-phone'},name:'Old Phone',code:'WIDGET_UNAVAILABLE',message:'Unsupported widget document'}]
 f.r.render(f.views.Home,{binding:f.binding,onPack:()=>{}});let tree=await f.r.settle()
 assert.ok(walk(tree).some(node=>node.props.role==='status'&&node.props.title?.includes('模组不可用'))) // private fork (rename-mod): 模组
 assert.match(text(tree),/Synthetic pack/)
 f.r.render(f.views.PackModal,{binding:f.binding,packId:PACK_ID,packs:[f.snapshot],onClose(){}});tree=await f.r.settle()
 assert.match(text(tree),/Old Phone/);assert.match(text(tree),/Unsupported widget document/);assert.match(text(tree),/其它素材继续可用/)
 assert.ok(options(tree).length>0)
})

// private fork: exercise the structured editor against the actual figure validator and CAS snapshots.
const figureMoods=importFigureVariants({}, {f:{outfits:[{}]}},{}).figures.f.emotions
async function editableFigure(t,viewOptions={}) {
  const f=await modal(t,{}, {viewOptions:{emotions:{moods:figureMoods},...viewOptions}})
  const {validateFigure}=await import('../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js')
  let current=f.snapshot,revision=1
  f.current=()=>current
  f.bump=snapshot=>{current={...snapshot,revision:'pack-r'+(++revision)};return {snapshot:current}}
  f.binding.service.getPackSnapshot=async()=>current
  f.binding.service.patchPack=async args=>{f.calls.push(['patchPack',args]);assert.equal(args.expectedRevision,current.revision);const next=applyAtomicPatch(current,args);for(const figure of Object.values(next.figures))validateFigure(figure);return f.bump(next)}
  f.binding.service.patchFigure=async args=>{
    f.calls.push(['patchFigure',args]);assert.equal(args.expectedRevision,current.revision)
    const next=clone({...current.figures[args.figureId],...args.patch})
    // private fork: the service interprets explicit null as optional-field deletion.
    for(const [key,value] of Object.entries(args.patch))if(value===null)delete next[key]
    validateFigure(next)
    return f.bump({...current,figures:{...current.figures,[args.figureId]:next}})
  }
  return f
}
// private fork (voice v4 P1): the figure page keeps one 「声音」 property beside 身高 / 形象色; its pill opens the voice page
// in place of the figure column. Opening never synthesizes; choosing a machine voice is one serialized CAS write; the
// saved-voice ▶ sends only the saved figure (no voiceSpec, no global synthesis ID) and a paid answer asks first.
// The full A–H flows run in real Chromium: tests/voice-p1-ui.test.mjs.
test('figure voice property opens the voice page; personal template, language and saved preview stay figure-scoped',async t=>{
  const f=await editableFigure(t);let tree=f.tree;const previous=f.binding.rpc
  f.binding.rpc=async(method,args)=>{
    f.calls.push([method,args])
    if(method==='getAssetVoiceServices')return {services:[{id:'local',kind:'reference-api',capabilities:{paid:true}}]}
    if(method==='getFigureVoiceEditor')return {packRevision:f.current().revision,binding:f.current().figures[FIGURE_ID].voice||null,voiceLibrary:f.current().manifest.voiceLibrary||{version:1,voices:{}},effective:null,issues:[],recommended:[]}
    if(method==='previewFigureVoice')return {status:'confirmation-required',confirmToken:'once',expiresAt:Date.now()+60000,billing:{serviceId:'local',paid:true}}
    if(method==='closeFigureVoicePreview')return {closed:true}
    return previous(method,args)
  }
  f.binding.service.saveFigureVoiceBinding=async args=>{f.calls.push(['saveFigureVoiceBinding',args]);assert.equal(args.expectedRevision,f.current().revision);const p=f.current();return f.bump({...p,figures:{...p.figures,[args.figureId]:{...p.figures[args.figureId],voice:args.binding}}})}
  f.binding.service.listVoiceTemplates=async()=>({templates:[{templateId:'template-local',revision:'t1',name:'Local voice',voiceSpec:{sources:{}}}]})
  f.binding.service.assignVoiceTemplate=async args=>{f.calls.push(['assignVoiceTemplate',args]);assert.equal(args.expectedRevision,f.current().revision);const p=f.current(),voiceId='copied-voice';return f.bump({...p,manifest:{...p.manifest,voiceLibrary:{version:1,voices:{...p.manifest.voiceLibrary?.voices,[voiceId]:{name:'Local voice',language:'ja',defaultSource:'fish',sources:{fish:{kind:'voice-id',provider:'fish-audio',voiceId:'fixture'}}}}}},figures:{...p.figures,[FIGURE_ID]:{...p.figures[FIGURE_ID],voice:{voice:voiceId}}}})}
  f.binding.tts={call:async method=>{f.calls.push(['tts.'+method]);if(method==='listRecommendedFishVoices')return {voices:[]};throw Object.assign(new Error('REQUEST_FAILED'),{code:'REQUEST_FAILED'})},audioUrl:ticket=>'/audio/'+ticket}
  tree=await settle(f)
  const props=walk(tree).filter(n=>n.props.className==='fork-inline-label-text').map(n=>text(n).trim()) // private fork (r6): 基础设定 is an inline grid
  assert.ok(props.indexOf('声音')===props.indexOf('形象色')+1&&props.indexOf('形象色')===props.indexOf('身高')+1,'声音 follows 形象色 in the property strip: '+props.join('|'))
  const pill=walk(tree).find(n=>n.props['aria-label']?.startsWith('声音：'));assert.ok(pill,'the 声音 pill');pill.props.onClick();tree=await settle(f,3)
  assert.ok(walk(tree).some(n=>n.props.role==='region'&&n.props['aria-label']?.endsWith('的声音')),'the voice page replaces the figure column')
  const head=title=>walk(tree).find(n=>n.props.className==='ap-voice-way-head'&&text(n).startsWith(title))
  assert.equal(head('Fish 声音').props['aria-expanded'],false,'a figure with a voice opens on its voice, every way folded')
  head('声音预设').props.onClick();tree=await settle(f,3)
  byLabel(tree,'复制使用 Local voice').props.onClick();tree=await settle(f,3)
  const assigned=f.calls.find(([m])=>m==='assignVoiceTemplate')[1]
  assert.equal(assigned.figureId,FIGURE_ID);assert.equal(assigned.packId,PACK_ID);assert.equal(assigned.templateId,'template-local');assert.equal(assigned.templateRevision,'t1');assert.equal(f.calls.some(([m])=>m==='listFigureVoiceChoices'),false)
  assert.equal(f.current().figures[FIGURE_ID].voice.voice,'copied-voice')
  byLabel(tree,'配音语言：日语').props.onClick();tree=await settle(f)
  walk(tree).find(n=>n.props.role==='menuitemradio'&&text(n).includes('英语')).props.onClick();tree=await settle(f,3)
  assert.equal(f.current().figures[FIGURE_ID].voice.language,'en')
  // private fork (voice language): 「配音语言」 + (?) holds the explanation (never visible text); ⚠ only when the voice cannot speak it.
  const voiceKeys=walk(tree).filter(n=>n.props.className==='ap-prop-key').map(n=>text(n).trim())
  assert.ok(voiceKeys.some(k=>k.startsWith('配音语言')),'the 配音语言 property: '+voiceKeys.join('|'))
  assert.ok(byLabel(tree,'配音语言 说明'),'the (?) beside 配音语言')
  assert.equal(text(tree).split('画面上仍显示正文').length,2,'the explanation appears once: the (?) tooltip, no visible line')
  assert.doesNotMatch(text(tree),/这个声音不会说/,'Fish speaks English: no warning')
  byLabel(tree,'配音语言：英语').props.onClick();tree=await settle(f)
  assert.ok(walk(tree).some(n=>n.props.role==='menuitemradio'&&text(n).includes('日语')&&text(n).includes('声音默认')),'the voice\'s own language is marked')
  walk(tree).find(n=>n.props.role==='menuitemradio'&&text(n).includes('粤语')).props.onClick();tree=await settle(f,3)
  assert.equal(f.current().figures[FIGURE_ID].voice.language,'yue')
  assert.match(text(tree),/这个声音不会说粤语/,'Fish cannot speak Cantonese: ⚠')
  byLabel(tree,'配音语言：粤语').props.onClick();tree=await settle(f)
  walk(tree).find(n=>n.props.role==='menuitemradio'&&text(n).includes('日语')).props.onClick();tree=await settle(f,3)
  assert.equal(f.current().figures[FIGURE_ID].voice.language,undefined,'back to the voice\'s own language: no override is stored')
  assert.doesNotMatch(text(tree),/这个声音不会说/)
  assert.equal(f.calls.some(([m])=>m==='previewFigureVoice'||m==='synthesize'||m==='openFigureVoicePreview'),false,'opening, choosing and saving never synthesize')
  walk(tree).find(n=>n.props.className==='ap-voice-go').props.onClick();tree=await settle(f,4)
  const asked=f.calls.find(([m])=>m==='previewFigureVoice')[1]
  assert.equal(asked.figureId,FIGURE_ID);assert.equal(asked.voiceSpec,undefined);assert.equal(asked.voiceId,undefined);assert.equal(asked.confirmToken,undefined)
  assert.match(text(tree),/付费试听/)
  walk(tree).find(n=>n.props.onClick&&text(n).trim()==='取消').props.onClick();tree=await settle(f,3)
  assert.equal(f.calls.filter(([m])=>m==='previewFigureVoice').length,1,'cancel never resends')
  assert.doesNotMatch(text(tree),/付费试听/)
  byLabel(tree,'返回人物').props.onClick();tree=await settle(f)
  assert.ok(byLabel(tree,'声音：Local voice'),'back on the figure, the property shows the chosen voice')
})
// private fork (outfit usage, owner 2026-10): the selected outfit's 「使用情景」 — the 差分 row's inline field and (?) style,
// under the tiles and before 触发词; it saves `guidance` on that outfit only, ≤ 80 字, and clearing it removes the field.
test('outfit 使用情景: an inline row before 触发词 saves the selected outfit guidance; empty removes it',async t=>{
  const f=await editableFigure(t);let tree=f.tree
  const settings=()=>byLabel(tree,'所选服装设置'),field=()=>walk(settings()).find(n=>/fork-inline-field/.test(n.props.className||'')&&/is-usage/.test(n.props.className||''))
  assert.deepEqual(walk(settings()).filter(n=>n.props.className==='fork-inline-label-text').map(text),['服装名','使用情景','触发词']) // private fork (outfit polish): 服装名 first
  assert.equal(byLabel(tree,'服装使用情景').props.placeholder,'例：在中转站工作时');assert.equal(byLabel(tree,'服装使用情景').type,'textarea')
  assert.ok(byLabel(field(),'服装使用情景 说明'),'(?) beside the label')
  assert.doesNotMatch(text(settings()),/school|casual|guidance/,'no internal ids')
  tree=await commitInput(f,tree,'服装使用情景','  在中转站工作时  ')
  let outfits=f.current().figures[FIGURE_ID].outfits
  assert.equal(outfits[0].guidance,'在中转站工作时');assert.equal(Object.hasOwn(outfits[1],'guidance'),false)
  assert.equal(JSON.stringify(outfits[0].sprite),JSON.stringify(f.snapshot.figures[FIGURE_ID].outfits[0].sprite),'media untouched')
  // The other outfit shows its own (empty) value; switching back shows the saved one.
  walk(tree).find(n=>n.props.className==='ap-outfit-face'&&text(n)==='Casual').props.onClick();tree=await settle(f)
  assert.equal(byLabel(tree,'服装使用情景').props.value,'')
  walk(tree).find(n=>n.props.className==='ap-outfit-face'&&text(n).replace(/^默认 /,'')==='School') /* private fork (outfit polish): 默认 badge */.props.onClick();tree=await settle(f)
  assert.equal(byLabel(tree,'服装使用情景').props.value,'在中转站工作时')
  const writes=f.calls.length
  tree=await commitInput(f,tree,'服装使用情景','字'.repeat(81))
  assert.equal(f.calls.length,writes,'over 80 is not saved');assert.match(text(settings()),/使用情景最多 80 字/)
  tree=await commitInput(f,tree,'服装使用情景','字'.repeat(80))
  assert.equal(f.current().figures[FIGURE_ID].outfits[0].guidance,'字'.repeat(80))
  tree=await commitInput(f,tree,'服装使用情景','')
  assert.equal(Object.hasOwn(f.current().figures[FIGURE_ID].outfits[0],'guidance'),false,'empty means absent')
})
test('figure colour and sparse guidance save only to the pack; the grid lists the declared 差分 of the outfit in order',async t=>{ // private fork (figure select)
  const f=await editableFigure(t,{prepareImage:async()=>({bytes:new Uint8Array([1]),descriptor:{ext:'png',mime:'image/png',size:1},width:8,height:8,warnings:[]})});let tree=f.tree
  assert.deepEqual(walk(tree).filter(n=>n.props.className==='ap-face').map(n=>n.props['aria-label']),figureMoods.map(row=>row.label)) // private fork (figure select): no virtual standard slots
  assert.doesNotMatch(text(tree),/状态 [2-8]/)
  // private fork (character v3): a palette popover with a hex field replaces the native colour input.
  // private fork (figure-editor r6): the shared inline colour field — its value is named 形象色：<colour | 自动>; a pick closes it.
  walk(tree).find(n=>n.props['aria-label']?.startsWith('形象色：')).props.onClick();tree=await settle(f)
  tree=await commitInput(f,tree,'形象色色值','#aabbcc')
  assert.equal(f.current().figures[FIGURE_ID].imageColor,'#aabbcc')
  byLabel(tree,'形象色：#aabbcc').props.onClick();tree=await settle(f)
  byLabel(tree,'自动形象色').props.onClick();tree=await settle(f)
  assert.equal(Object.hasOwn(f.current().figures[FIGURE_ID],'imageColor'),false)
  // private fork (figure-editor r5, owner 2026-10): the control is the swatch alone (no hex / 自动 text); automatic is a flag + tooltip.
  assert.equal(byLabel(tree,'形象色：自动').props['data-auto'],true);assert.equal(text(byLabel(tree,'形象色：自动')).trim(),'') // private fork (r6)
  // private fork (owner 2026-10 r2): 演出指导 lives in the emotion opened from its roster face.
  assert.ok(byLabel(tree,'平和使用情景') === undefined) // private fork (figure-editor r7): 使用情景
  walk(tree).find(n=>n.props.className==='ap-face'&&n.props['aria-label']==='平和').props.onClick();tree=await settle(f)
  tree=await commitInput(f,tree,'平和使用情景','不催促') // private fork (figure-editor r7): 使用情景
  assert.equal(f.current().figures[FIGURE_ID].emotions.find(row=>row.id==='calm').guidance,'不催促') // private fork
  tree=await commitInput(f,tree,'平和使用情景','') // private fork (figure-editor r7): 使用情景
  assert.equal(f.current().figures[FIGURE_ID].emotions.find(row=>row.id==='calm').guidance,undefined) // private fork
  // private fork: complex art is not rewritten; add an own-image custom to the simple outfit.
  walk(tree).find(n=>n.props.className==='ap-outfit-face'&&text(n)==='Casual').props.onClick();tree=await settle(f)
  walk(tree).find(n=>n.props.role==='radio'&&text(n)==='立绘').props.onClick();tree=await settle(f)
  byLabel(tree,'添加差分').props.onClick();tree=await settle(f)
  // private fork (figure select): ＋ takes a typed name; one this outfit already declares is refused.
  const declared=walk(tree).filter(n=>n.props.className==='ap-face').map(n=>n.props['aria-label'])
  byLabel(tree,'新差分名称').props.onChange({target:{value:declared[0]}});tree=await settle(f);button(tree,'添加差分').props.onClick();tree=await settle(f)
  assert.match(text(tree),/这套服装已有这个差分/)
  byLabel(tree,'新差分名称').props.onChange({target:{value:'得意'}});tree=await settle(f);await button(tree,'添加差分').props.onClick();tree=await settle(f)
  assert.ok(f.current().figures[FIGURE_ID].emotions.some(row=>row.label==='得意')) // private fork: metadata-only additions remain declared
  assert.equal(f.current().figures[FIGURE_ID].emotions.at(-1).label,'得意') // private fork
  tree=await commitInput(f,tree,'得意使用情景','轻轻挑眉') // private fork (figure-editor r7): 使用情景
  assert.equal(f.current().figures[FIGURE_ID].emotions.at(-1).guidance,'轻轻挑眉') // private fork
  // private fork: confirmation and failed CAS retain the difference; success uses the native deletion boundary.
  const custom=f.current().figures[FIGURE_ID].emotions.at(-1).id;let fail=true,removals=0
  f.binding.service.removeFigureEmotion=async args=>{
    removals++;assert.equal(args.expectedRevision,f.current().revision);assert.equal(args.emotionId,custom);assert.equal(args.figureId,FIGURE_ID)
    if(fail)throw Object.assign(new Error('Deletion revision conflict'),{code:'REVISION_CONFLICT'})
    const {removeFigureEmotion}=await import('../tavern-plugin/packages/dsh-asset-library/src/pack-v2/remove-figure-emotion.js')
    const current=f.current(),manifest=clone(current.manifest),files=new Map(current.files)
    for(const [id,figure]of Object.entries(current.figures))files.set('figures/'+id+'.json',Buffer.from(JSON.stringify(figure)))
    for(const [key,sprite]of Object.entries(current.sprites))files.set(manifest.sprites[key],Buffer.from(JSON.stringify(sprite)))
    removeFigureEmotion(manifest,files,current,FIGURE_ID,custom)
    return f.bump(applyAtomicPatch(current,{patch:manifest,fileUpdates:files}))
  }
  // private fork (figure select, owner 2026-10): no ⋯ on the 差分 tiles and no action line under the open 差分; no 「默认」
  // badge on 平和. The 差分 heading's ⋯ keeps 设为默认外观 (立绘 is not the default view) and offers 「删除…」: a delete mode
  // where built-ins are disabled and custom 差分 are checkboxes; 已选 N · 取消 · 删除 in the heading, Esc cancels, 删除 asks first.
  assert.equal(walk(tree).some(n=>n.props.className==='ap-tile-more'||n.props.className==='ap-emotion-cell'&&n.props.onContextMenu),false)
  assert.equal(walk(tree).some(n=>/ap-detail-action|ap-tile-badge/.test(n.props.className||'')),false)
  const face=label=>walk(tree).find(n=>n.props.className==='ap-face'&&n.props['aria-label']===label)
  const enterDelete=async()=>{byLabel(tree,'立绘 操作').props.onClick();tree=await settle(f)
    // private fork (gen-ui r12): a picked tile's own menu may be open too (the fixture never clicks outside) — the heading's ⋯ only.
    const items=walk(walk(tree).find(n=>n.props.role==='menu'&&n.props['aria-label']==='立绘 操作')).filter(n=>/^menuitem/.test(n.props.role||''));assert.equal(text(items[0]).trim(),'设为默认外观');assert.equal(text(items.at(-1)).trim(),'删除差分…') // private fork (avatar-actions): the label names what it deletes
    items.at(-1).props.onClick();tree=await settle(f)}
  const section=()=>byLabel(tree,'人物差分'),esc={key:'Escape',defaultPrevented:false,preventDefault(){},stopPropagation(){}}
  await enterDelete()
  assert.equal(face('平和').props.role,'checkbox');assert.equal(face('平和').props.disabled,undefined);assert.equal(face('得意').props['aria-checked'],false) // private fork
  assert.match(text(section()),/已选\s*0/);assert.equal(button(tree,'删除').props.disabled,true);assert.ok(byLabel(tree,'得意使用情景') === undefined, 'the detail block hides in the delete mode')
  section().props.onKeyDown(esc);tree=await settle(f);assert.equal(face('得意').props.role,undefined,'Esc leaves the delete mode')
  await enterDelete();face('得意').props.onClick();tree=await settle(f)
  assert.equal(face('得意').props['aria-checked'],true);assert.match(text(section()),/已选\s*1/)
  button(tree,'删除').props.onClick();tree=await settle(f);assert.match(text(tree),/删除差分「得意」/);button(tree,'取消').props.onClick();tree=await settle(f);assert.equal(removals,0)
  assert.equal(face('得意').props['aria-checked'],true,'cancelling the confirm keeps the selection')
  button(tree,'删除').props.onClick();tree=await settle(f);button(tree,'删除').props.onClick();tree=await settle(f)
  assert.equal(f.current().figures[FIGURE_ID].emotions.at(-1).id,custom);assert.match(text(tree),/内容已被修改，请重新载入/) // private fork
  fail=false;button(tree,'删除').props.onClick();tree=await settle(f)
  assert.equal(removals,2);assert.equal(f.current().figures[FIGURE_ID].emotions.some(row=>row.id===custom),false) // private fork
  assert.equal(walk(tree).some(n=>n.props.className==='ap-face'&&n.props.role==='checkbox'),false,'a done delete leaves the mode')
  assert.equal(f.calls.some(([m])=>m==='saveCardAssetBindings'),false)
  assert.equal(walk(tree).some(n=>n.props.className==='ap-raw'),false)
})
test('all outfits remain editable; missing art stays missing, opening reorders and deletion names the pack',async t=>{
  const f=await editableFigure(t);let tree=f.tree
  // private fork (character v3): 停用 lives in the outfit's ⋯ menu; a disabled outfit stays listed and editable.
  // private fork (tile menus): the selected outfit tile's own ⋯ (each tile has one).
  // private fork (outfit polish): the selected outfit's actions are the text actions of its block under the grid.
  // private fork (figure select, owner 2026-10): deleting is the 服装 heading ⋯'s 「删除…」 — a delete mode (tiles are checkboxes).
  const cell=name=>walk(tree).find(n=>n.props.className==='ap-outfit-cell'&&walk(n).some(m=>m.props.className==='ap-outfit-name'&&text(m)===name))
  const tile=name=>walk(cell(name)).find(n=>n.props.className==='ap-outfit-face')
  const enterDelete=async()=>{byLabel(tree,'服装操作').props.onClick();tree=await settle(f);walk(tree).find(n=>n.props.role==='menuitem'&&text(n).trim()==='删除服装…' /* private fork (avatar-actions) */).props.onClick();tree=await settle(f)}
  const deleteOnly=async name=>{await enterDelete();tile(name).props.onClick();tree=await settle(f);button(tree,'删除').props.onClick();tree=await settle(f);button(tree,'删除').props.onClick();tree=await settle(f)}
  // private fork (owner 2026-10 r3): the outfit's 启用 is folded into its 触发策略 as the third lamp, 关闭 (灰灯); a lit lamp re-enables it.
  assert.equal(walk(tree).some(n=>n.props.role==='menuitem'&&/停用这套服装|启用这套服装/.test(text(n))),false)
  // private fork (figure-editor r7): set from the tile's own lamp dot (a menu), for that outfit.
  const first=f.current().figures[FIGURE_ID].outfits[0].label,lamp=async mode=>{tree=await pickOutfitLamp(f,tree,first,mode)}
  await lamp('off');assert.equal(f.current().figures[FIGURE_ID].outfits[0].enabled,false)
  assert.equal(walk(tree).filter(n=>n.props.className==='ap-outfit-face').length,2)
  assert.equal(outfitLampButton(tree,first).props['data-mode'],'off','the tile shows its grey lamp')
  assert.equal(walk(tree).find(n=>n.props.className==='ap-outfit-face'&&n.props['data-disabled']===true)!==undefined,true,'the tile is greyed')
  await lamp('constant');assert.equal(f.current().figures[FIGURE_ID].outfits[0].enabled,true);assert.equal(f.current().figures[FIGURE_ID].outfits[0].recall.mode,'constant')
  // private fork: a missing own slot cannot select another image or pretend calm fills it.
  walk(tree).find(n=>n.props.className==='ap-face'&&n.props['aria-label']==='喜悦').props.onClick();tree=await settle(f)
  assert.equal(walk(tree).find(n=>n.props.className==='ap-face'&&n.props['aria-label']==='喜悦').props['data-missing'],true)
  assert.ok(byLabel(tree,'Special state') === undefined);assert.equal(f.current().figures[FIGURE_ID].outfits[0].sprite.emotionMap,undefined)
  assert.equal(walk(tree).some(n=>n.props.className==='ap-map-choice'),false)
  walk(tree).find(n=>n.props.className==='ap-face'&&n.props['aria-label']==='平和').props.onClick();tree=await settle(f)
  walk(tree).find(n=>n.props.className==='ap-outfit-face'&&text(n)==='Casual').props.onClick();tree=await settle(f)
  // private fork (figure select, owner 2026-10): no 「默认」 badge and no 设为默认 (the opening outfit is chosen in 开场); the order
  // (first enabled = fallback) is untouched. No right-click menu, no action line.
  assert.equal(walk(tree).some(n=>n.props['data-default']||/ap-tile-badge|ap-detail-action/.test(n.props.className||'')||/^设为默认/.test(n.props['aria-label']||text(n))&&n.type==='button'),false)
  assert.deepEqual(f.current().figures[FIGURE_ID].outfits.map(o=>o.key),['school','casual'])
  assert.equal(cell('School').props.onContextMenu,undefined)
  // The delete mode: checkboxes, no ＋ tile, no selected outfit's block; 已选 N; 删除 names the pack and asks; Esc leaves.
  await enterDelete()
  assert.equal(tile('School').props.role,'checkbox');assert.ok(byLabel(tree,'添加服装') === undefined);assert.ok(byLabel(tree,'所选服装设置') === undefined)
  assert.equal(walk(tree).some(n=>/^服装「.+」的灯：/.test(n.props['aria-label']||'')),false,'no lamp menus while picking')
  tile('School').props.onClick();tile('Casual').props.onClick();tree=await settle(f)
  assert.equal(tile('Casual').props['aria-checked'],true);assert.match(text(byLabel(tree,'服装')),/已选\s*2/)
  button(tree,'删除').props.onClick();tree=await settle(f)
  assert.match(text(tree),/删除 2 套服装/);assert.match(text(tree),/「School」「Casual」 将从素材包「Synthetic pack」中删除/)
  button(tree,'取消').props.onClick();tree=await settle(f)
  assert.equal(f.current().figures[FIGURE_ID].outfits.length,2)
  byLabel(tree,'服装').props.onKeyDown({key:'Escape',defaultPrevented:false,preventDefault(){},stopPropagation(){}});tree=await settle(f)
  assert.equal(tile('School').props.role,'radio');assert.ok(byLabel(tree,'所选服装设置'))
  tile('Casual').props.onClick();tree=await settle(f)
  // private fork (figure-editor r4): wheel is a native non-passive listener now; the on-card 放大 / 缩小 / 复原 cluster and the
  // focused card's keys drive the same view.
  const canvas=()=>walk(tree).find(n=>n.props.className==='ap-still-canvas')
  assert.match(canvas().props['aria-label'],/^立绘预览/);assert.equal(canvas().props.tabIndex,0)
  assert.equal(byLabel(tree,'复原').props.disabled,true)
  byLabel(tree,'放大').props.onClick();tree=await settle(f)
  assert.match(walk(tree).find(n=>n.props.className==='ap-still-image').props.style.transform,/scale\(1\.25\)$/);assert.equal(byLabel(tree,'复原').props.disabled,false)
  canvas().props.onKeyDown({key:'-',preventDefault(){}});canvas().props.onKeyDown({key:'-',preventDefault(){}});tree=await settle(f)
  assert.match(walk(tree).find(n=>n.props.className==='ap-still-image').props.style.transform,/scale\(0\.8\)$/)
  canvas().props.onDoubleClick();tree=await settle(f)
  assert.equal(walk(tree).find(n=>n.props.className==='ap-still-image').props.style.transform,'translate(0px,0px) scale(1)')
  // private fork: removing the last outfit also explicitly removes height, without clearing figure metadata.
  await deleteOnly('Casual') // private fork (figure select)
  assert.equal(f.current().figures[FIGURE_ID].outfits.length,1)
  assert.ok(f.current().figures[FIGURE_ID].heightCm)
  await deleteOnly('School')
  assert.equal(f.current().figures[FIGURE_ID].outfits.length,0)
  assert.equal(Object.hasOwn(f.current().figures[FIGURE_ID],'heightCm'),false)
  assert.equal(f.calls.filter(([m])=>m==='patchFigure').at(-1)[1].patch.heightCm,null)
})
// private fork: Live2D textures/snapshots are not signature-colour sources.
test('Live2D intake maps names without sampling models or creating manual colour',async t=>{
  let samples=0;
  const snapshots={peek:()=>({}),request:async()=>{throw new Error('snapshot must not be sampled')}};
  const f=await editableFigure(t,{live2d:{snapshots},prepareImage:async()=>{samples++;return {imageColor:'#234567'}}});
  f.snapshot.figures[FIGURE_ID]={schemaVersion:1,id:FIGURE_ID,name:'Empty',enabled:true,appearance:'live2d',recall:{mode:'keyword'},emotions:figureMoods,outfits:[{key:'daily',label:'Daily',enabled:true,defaultEmotion:'calm'}]};
  f.context.fetch=async()=>({blob:async()=>({})});f.binding.service.leaseBundle=async()=>({});
  f.binding.service.putBundle=async args=>{f.calls.push(['putBundle',args]);assert.equal(args.packId,PACK_ID);assert.equal(args.expectedRevision,f.current().revision);return f.bump(f.current())};
  const document={Version:3,FileReferences:{Moc:'body.moc3',Textures:['body.png'],Expressions:[{Name:'Smile',File:'smile.exp3.json'}]}};
  const content={'body.model3.json':JSON.stringify(document),'body.moc3':'MOC3\u0003'};f.context.TextDecoder=TextDecoder
  const files=['body.model3.json','body.moc3','body.png','smile.exp3.json'].map(name=>({name,webkitRelativePath:'model/'+name,size:1,arrayBuffer:async()=>Uint8Array.from(Buffer.from(content[name]||'x')).buffer}));
  f.render({key:'live-intake'});let tree=await settle(f);
  // private fork (model tab, owner 2026-10): the switch is 模型 / 立绘 / 头像. 模型 without a model is one short phrase; its
  // heading's 「导入模型」 (where 立绘 / 头像 put their generate button) opens the shared import sheet for this outfit and
  // imports again to replace; the ⋯ 「删除模型…」 removes it. 立绘 / 头像 ⋯ offer no model import.
  // private fork (导入模型): only exact declared names prefill (「Smile」 is no key).
  assert.deepEqual(walk(walk(tree).find(n=>n.props['aria-label']==='素材种类')).filter(n=>n.props.role==='radio').map(text),['模型','立绘','头像'])
  const viewMenu=async name=>{byLabel(tree,name+' 操作').props.onClick();tree=await settle(f);const menu=walk(tree).find(n=>n.props.role==='menu'&&n.props['aria-label']===name+' 操作');
    return walk(menu).filter(n=>/^menuitem/.test(n.props.role||'')).map(n=>text(n).trim())}
  for(const name of ['立绘','头像']){walk(tree).find(n=>n.props.role==='radio'&&text(n)===name).props.onClick();tree=await settle(f)
    assert.ok(!button(tree,'导入模型'),name+' has no model import');assert.ok(!(await viewMenu(name)).some(item=>/导入|模型/.test(item)),name+' ⋯ has no model item');byLabel(tree,name+' 操作').props.onClick();tree=await settle(f)}
  walk(tree).find(n=>n.props.role==='radio'&&text(n)==='模型').props.onClick();tree=await settle(f)
  assert.match(text(walk(tree).find(n=>n.props['aria-label']==='人物差分')),/还没有模型/)
  const upload=async()=>{button(tree,'导入模型').props.onClick();tree=await settle(f)
    walk(tree).find(n=>n.props['data-for']==='模型文件夹').props.onChange({target:{files,value:'x'}});tree=await settle(f,6)
    await button(tree,'导入').props.onClick();tree=await settle(f,6)};
  await upload();const figure=f.current().figures[FIGURE_ID];assert.equal(figure.imageColor,undefined);assert.equal(figure.autoColor,undefined);assert.equal(figure.outfits[0].live2d.emotionMap,undefined);assert.equal(samples,0); // private fork
  assert.equal(walk(tree).find(n=>n.props.role==='radio'&&text(n)==='模型').props['aria-checked'],true)
  await upload();assert.equal(samples,0);assert.equal(f.current().figures[FIGURE_ID].imageColor,undefined);
  assert.equal(f.calls.filter(([m])=>m==='putBundle').length,2);assert.equal(f.calls.some(([m])=>m==='saveCardAssetBindings'),false);
  assert.doesNotMatch(text(tree),/保存到：|选择素材包/);
  // 删除模型… asks once, then drops the outfit's live2d block and the bundle nobody uses any more.
  const bundleKey=f.current().figures[FIGURE_ID].outfits[0].live2d.bundleKey
  f.binding.service.removeBundle=async args=>{f.calls.push(['removeBundle',args]);assert.equal(args.expectedRevision,f.current().revision);return f.bump(f.current())}
  assert.ok((await viewMenu('模型')).includes('删除模型…'))
  walk(tree).find(n=>n.props.role==='menuitem'&&text(n).trim()==='删除模型…').props.onClick();tree=await settle(f)
  assert.match(text(tree),/删除「Daily」的模型？/)
  await button(tree,'删除').props.onClick();tree=await settle(f,4)
  assert.equal(f.current().figures[FIGURE_ID].outfits[0].live2d,undefined)
  assert.deepEqual(f.calls.filter(([m])=>m==='removeBundle').map(([,a])=>a.bundleKey),[bundleKey])
  assert.match(text(walk(tree).find(n=>n.props['aria-label']==='人物差分')),/还没有模型/)
});
// private fork (导入模型): 「添加文件 › 导入模型…」 makes a new figure + outfit from a raw Live2D folder. Expressions named exactly like an
// emotion key prefill; a model without Idle gets the chosen 待机 clip as its Idle group in the installed model3.json.
test('导入模型 creates a figure from a Live2D folder with exact-name prefill and an Idle group',async t=>{
  const f=await editableFigure(t);f.context.TextDecoder=TextDecoder
  const {validateFigure}=await import('../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js')
  f.binding.service.putBundle=async args=>{f.calls.push(['putBundle',args]);assert.equal(args.expectedRevision,f.current().revision);return f.bump(f.current())}
  f.binding.service.createFigure=async args=>{f.calls.push(['createFigure',args]);assert.equal(args.expectedRevision,f.current().revision)
    const id='99999999-9999-4999-8999-999999999999',figure={...clone(args.figure),id};validateFigure(figure)
    return {...f.bump({...f.current(),manifest:{...f.current().manifest,figures:[...f.current().manifest.figures,id]},figures:{...f.current().figures,[id]:figure}}),figureId:id}}
  const clips=[{File:'m0.motion3.json'},{File:'m1.motion3.json'}]
  const document={Version:3,FileReferences:{Moc:'body.moc3',Textures:['body.png'],Expressions:[{Name:'joy',File:'joy.exp3.json'},{Name:'Smile',File:'smile.exp3.json'}],Motions:{Motion:clips}}}
  const content={'body.model3.json':JSON.stringify(document),'body.moc3':'MOC3\u0003'}
  const files=['body.model3.json','body.moc3','body.png','joy.exp3.json','smile.exp3.json','m0.motion3.json','m1.motion3.json','readme.exe'].map(name=>({name,webkitRelativePath:'Hiyori/'+name,size:1,arrayBuffer:async()=>Uint8Array.from(Buffer.from(content[name]||'x')).buffer}))
  let tree=f.tree
  byLabel(tree,'添加文件').props.onClick();tree=await f.r.settle()
  walk(tree).find(n=>n.props.role==='menuitem'&&text(n)==='导入模型…').props.onClick();tree=await settle(f)
  assert.equal(button(tree,'导入').props.disabled,true,'nothing to import yet')
  walk(tree).find(n=>n.props['data-for']==='模型文件夹').props.onChange({target:{files,value:'x'}});tree=await settle(f,6)
  assert.equal(byLabel(tree,'新人物名称').props.value,'Hiyori')
  // A file drag stops at the sheet: the host composer's document listener would store the files as chat attachments.
  const drag={dataTransfer:{types:['Files']},stopped:0,stopPropagation(){this.stopped++},preventDefault(){this.defaultPrevented=true},defaultPrevented:false}
  const frame=walk(tree).find(n=>n.props['data-drop']==='model');frame.props.onDragEnter(drag);frame.props.onDragOver(drag);frame.props.onDragLeave(drag)
  assert.equal(drag.stopped,3);assert.equal(drag.defaultPrevented,true)
  // A new outfit of an existing figure (which has its own 默认) starts with the model's name.
  const target=async name=>{walk(tree).find(n=>String(n.props['aria-label']||'').startsWith('导入到人物：')).props.onClick();tree=await settle(f)
    walk(tree).find(n=>/fork-inline-option/.test(n.props.className||'')&&text(n)===name).props.onClick();tree=await settle(f)}
  await target(f.current().figures[FIGURE_ID].name)
  assert.equal(byLabel(tree,'新服装名称').props.value,'Hiyori')
  await target('新人物')
  // The pack service's refusal reads in Chinese, with the host's reason.
  const accept=f.binding.service.putBundle
  f.binding.service.putBundle=async()=>{throw Object.assign(new Error('INVALID_ASSET_PACK'),{code:'INVALID_ASSET_PACK',detail:'Texture is not a PNG'})}
  await button(tree,'导入').props.onClick();tree=await settle(f,6)
  assert.match(text(tree),/模型文件没有通过校验.*Texture is not a PNG/)
  f.binding.service.putBundle=accept
  assert.equal(byLabel(tree,'新服装名称').props.value,'默认')
  await button(tree,'导入').props.onClick();tree=await settle(f,6)
  const [,put]=f.calls.find(([m])=>m==='putBundle'),[,made]=f.calls.find(([m])=>m==='createFigure')
  assert.deepEqual([...put.files.keys()].sort(),['body.moc3','body.model3.json','body.png','joy.exp3.json','m0.motion3.json','m1.motion3.json','smile.exp3.json'])
  assert.deepEqual(JSON.parse(new TextDecoder().decode(put.files.get('body.model3.json'))).FileReferences.Motions,{Motion:clips,Idle:[clips[0]]})
  const outfit=clone(made.figure.outfits[0])
  assert.equal(made.figure.name,'Hiyori');assert.equal(made.figure.appearance,'live2d');assert.equal(outfit.defaultEmotion,'calm')
  assert.deepEqual(outfit.live2d,{bundleKey:put.bundleKey,emotionMap:{joy:{expression:'joy'}}})
  assert.equal(f.current().manifest.figures.length,2)
})
test('source uploads update derived colour; unrelated emotions preserve it and manual overrides',async t=>{
  const image={bytes:new Uint8Array([1]),descriptor:{ext:'png',mime:'image/png',size:1},width:8,height:8,warnings:[],autoColor:'#123456'}
  const f=await editableFigure(t,{prepareImage:async()=>image})
  f.snapshot.figures[FIGURE_ID]={schemaVersion:1,id:FIGURE_ID,name:'Empty',enabled:true,appearance:'live2d',recall:{mode:'keyword'},emotions:figureMoods,outfits:[{key:'daily',label:'Daily',enabled:true,defaultEmotion:'calm'}]}
  f.render({key:'empty'});let tree=await settle(f)
  let hash='a'.repeat(64)
  f.binding.service.putBlob=async args=>{assert.equal(args.packId,PACK_ID);assert.equal(args.expectedRevision,f.current().revision);return {...f.bump(f.current()),hash}}
  f.binding.service.createSimpleSprite=async args=>{
    assert.equal(args.packId,PACK_ID);assert.equal(args.expectedRevision,f.current().revision)
    const {createSimpleSprite}=await import('../tavern-plugin/packages/dsh-asset-library/src/pack-v2/simple-sprite.js')
    const made=createSimpleSprite(args,Object.fromEntries(Object.values(args.images).map(value=>[value.hash,image.descriptor]))) // private fork: retain descriptors for earlier states
    return {...f.bump({...f.current(),sprites:{...f.current().sprites,[args.spriteKey]:made.manifest}}),sprite:{manifestKey:args.spriteKey,assets:made.assets}}
  }
  // private fork (character v3): uploads sit in the emotion's media popover, opened from its face.
  // private fork (owner 2026-10 r2): the face toggles its inline detail, so only open it when it is not open yet.
  // private fork (owner 2026-10 v3.1): the asset (立绘 / 头像) is picked in the 差分 header, and every picked file passes the
  // framer (an unchanged frame uploads the original file).
  f.context.URL={createObjectURL:()=>'blob:photo',revokeObjectURL(){}}
  const upload=async label=>{const asset=label.endsWith('头像')?'头像':'立绘';walk(tree).find(n=>n.props.role==='radio'&&text(n)===asset).props.onClick();tree=await settle(f)
    if(!byLabel(tree,label)){const face=walk(tree).find(n=>n.props.className==='ap-face'&&n.props['aria-label']===label.slice(2,-2));if(face&&!face.props['aria-pressed']){face.props.onClick();tree=await settle(f)}} // private fork (figure select): an outfit that declares nothing has no tiles; the card's ⤒ uploads its resting 平和
    // private fork (avatar-actions, owner 2026-10): an upload is the 差分 tile's menu item (上传图片… / 替换为本地图片…), which
    // feeds the editor's one hidden file input; the preview card no longer repeats it.
    const name=label.slice(2,-2),menu=()=>walk(walk(tree).find(n=>n.props.className==='ap-emotion-cell'&&walk(n).some(m=>m.props.className==='ap-face'&&m.props['aria-label']===name))).find(n=>/ap-cell-menu/.test(n.props.className||'')&&n.props.className!=='ap-cell-menu-head')
    if(!menu()){walk(tree).find(n=>n.props.className==='ap-face'&&n.props['aria-label']===name).props.onContextMenu({preventDefault(){}});tree=await settle(f)} // private fork (cell menu input, owner 2026-10-17): right click on PC
    walk(menu()).find(n=>n.type==='button'&&/^(上传图片|替换为本地图片)…/.test(text(n).trim())).props.onClick();tree=await settle(f)
    await walk(tree).find(n=>n.type==='input'&&n.props['aria-label']==='选择图片').props.onChange({target:{files:[{name:'photo.png'}],value:'x'}});tree=await settle(f)
    walk(tree).find(n=>n.type==='img'&&n.props.src==='blob:photo').props.onLoad({currentTarget:{naturalWidth:8,naturalHeight:8}});tree=await settle(f)
    await button(tree,'使用这张').props.onClick();tree=await settle(f,4)}
  await upload('上传平和立绘')
  assert.equal(f.current().figures[FIGURE_ID].autoColor,'#123456');assert.equal(f.current().figures[FIGURE_ID].imageColor,undefined)
  assert.equal(f.current().figures[FIGURE_ID].outfits[0].sprite.emotionMap,undefined)
  f.current().figures[FIGURE_ID].imageColor='#fedcba';hash='b'.repeat(64);image.autoColor='#abcdef';image.bytes=new Uint8Array([2]);await upload('上传平和立绘');image.autoColor='#123456'
  // All character emotions already exist on this outfit's grid; fill its missing art directly.
  await upload('上传喜悦立绘')
  await upload('上传喜悦头像')
  // private fork: replacing calm replaces its own slot; no alternate state pool accumulates.
  const dressed=f.current().figures[FIGURE_ID].outfits[0],emotions=f.current().sprites[dressed.sprite.manifestKey].emotions
  assert.deepEqual(Object.keys(emotions),['calm','joy']);assert.equal(dressed.sprite.emotionMap,undefined) // private fork (figure select): joy added by ＋ under its existing key
  hash=createHash('sha256').update(image.bytes).digest('hex');assert.equal(dressed.sprite.assets[emotions.calm.stage.src],hash)
  assert.equal(f.current().figures[FIGURE_ID].imageColor,'#fedcba');assert.equal(f.current().figures[FIGURE_ID].autoColor,'#abcdef')
  assert.equal(f.current().figures[FIGURE_ID].outfits[0].avatars.joy,hash)
  assert.equal(f.calls.some(([m])=>m==='saveCardAssetBindings'),false)
  assert.doesNotMatch(text(tree),/保存到：|选择素材包/)
})

// private fork: one card-import sheet offers an ordinary card toggle, not per-pack execution grants.
// private fork (card import r3): plain words; 不启用 = disable this card's 模组, 启用 = keep the card's setting.
test('card widget question offers disable or keep without native controls',async t=>{
 const choices=[]
 for(const label of ['不启用','启用']){
  const f=await fixture(t,'App'),applies=cardImportService(f,{widgets:[{packId:PACK_ID,packName:'Pack',widgetId:'clock',widgetName:'Clock'}]})
  f.r.render(f.views.CardImportSheet,{binding:f.binding,path:'card.json',file:{name:'card.zip',arrayBuffer:async()=>new ArrayBuffer(1)},onClose(){},onDone(){}})
  const tree=await f.r.settle()
  assert.match(text(tree),/第三方模组可能有安全风险，请仅启用值得信赖的模组。/)
  assert.equal(walk(tree).some(n=>n.type==='input'||n.type==='select'||n.type==='iframe'),false)
  await button(tree,label).props.onClick();await f.r.settle();choices.push([applies[0].acceptScriptRisk,applies[0].disableWidgets])
 }
 assert.deepEqual(choices,[[true,true],[true,false]])
})

// private fork: post-import colour failure is visible; retry cannot install/remap the pack twice.
test('committed pack import retries only the missing colour CAS and preserves its manual override',async t=>{
  const f=await fixture(t,'Home');f.snapshot.figures[FIGURE_ID].outfits=[];f.snapshot.figures[FIGURE_ID].imageColor='#123456'
  let imports=0,writes=0,done
  f.binding.service.applyImport=async args=>{if(args.decision!=='cancel')imports++;return {status:'updated',snapshot:f.snapshot}}
  f.binding.service.patchPack=async args=>{writes++;if(writes===1)throw Object.assign(Error('stale'),{code:'REVISION_CONFLICT'});const saved=JSON.parse(new TextDecoder().decode(args.fileUpdates.get('figures/'+FIGURE_ID+'.json')));assert.equal(saved.imageColor,'#123456');assert.equal(saved.autoColor,'#78808c');assert.equal(args.expectedRevision,'pack-r1');return {snapshot:{...f.snapshot,figures:{[FIGURE_ID]:saved}}}}
  const empty={added:[],changed:[],removed:[]},preview={inspectionId:'auto-retry',packId:PACK_ID,expectedRevision:'frozen',incoming:f.snapshot,current:null,choices:['update','cancel'],diff:{assets:empty,figures:empty,files:empty},scriptRisk:[]}
  f.r.render(f.views.ConflictDialog,{binding:f.binding,preview,onClose(){},onDone:value=>done=value});let tree=await f.r.settle()
  // private fork (pack catalogue r2): the install sheet's explicit 「替换」 button is the decision (no native select, no radio row).
  assert.equal(walk(tree).some(n=>n.type==='select'),false)
  await button(tree,'替换').props.onClick();tree=await f.r.settle();assert.match(text(tree),/已导入.*自动取色未完成/);assert.equal(done,undefined)
  await button(tree,'替换').props.onClick();await f.r.settle()
  assert.equal(imports,1);assert.equal(writes,2);assert.equal(done.snapshot.figures[FIGURE_ID].autoColor,'#78808c')
})

// private fork (library export, owner 2026-10): each 素材库 row shows its size and a quiet 导出 icon (tooltip 导出) just left of
// its state pill; it exports that pack alone (usePackActions.exportPack, the pack ⋯ menu's export).
test('library rows show size and a 导出 icon left of the state pill that exports that pack alone',async t=>{
  let downloads=[];const f=await fixture(t,'Home',{download:r=>{downloads.push(r)}})
  f.binding.service.exportPack=async args=>{f.calls.push(['exportPack',args]);return {filename:'one.zip',warnings:[]}}
  f.r.render(f.views.Home,{...f.props,key:'export'});let tree=await f.r.settle()
  const name=f.snapshot.manifest.name,row=walk(tree).find(n=>n.type==='li'&&n.props.className==='ap-pack-row is-openable'),nodes=walk(row)
  const icon=byLabel(row,'导出 '+name),pill=byLabel(row,name+'：关闭，更改'),size=nodes.find(n=>n.props.className==='ap-lib-size')
  assert.ok(icon&&pill&&size);assert.equal(icon.props.title,'导出');assert.match(text(size),/^\d+(\.\d)? (KB|MB|GB)$/)
  assert.ok(nodes.indexOf(size)<nodes.indexOf(icon)&&nodes.indexOf(icon)<nodes.indexOf(pill),'size · 导出 · state, in that order')
  assert.ok(byLabel(tree,'导出') === undefined, 'no batch 导出 without the host pack-set capability')
  await icon.props.onClick();tree=await f.r.settle()
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(([m])=>m==='exportPack'))),[['exportPack',{packId:PACK_ID,expectedRevision:'pack-r1'}]]);assert.equal(downloads[0].filename,'one.zip')
})
// private fork (pack row hit area, owner 2026-10): the whole row opens the pack (the name's action); clicks from the state
// chip, its menu or another control of the row never also open it. Hit map: tests/harness/pack-row-hit.mjs.
test('a pack row opens on a click anywhere but its controls; the state chip keeps its clicks',async t=>{
  const opened=[],f=await fixture(t,'Home',{})
  f.r.render(f.views.Home,{...f.props,key:'hit',onOpen:o=>opened.push(o)});const tree=await f.r.settle()
  const name=f.snapshot.manifest.name,row=walk(tree).find(n=>n.type==='li'&&/\bap-pack-row\b/.test(n.props.className||''))
  assert.match(row.props.className,/\bis-openable\b/);assert.equal(typeof row.props.onClick,'function')
  const click=closest=>row.props.onClick({currentTarget:{contains:()=>true},target:{closest:()=>closest}})
  click(null);assert.deepEqual(opened.map(o=>o?.packId),[PACK_ID],'empty space / previews open the pack')
  click({});assert.equal(opened.length,1,'a click inside a button, menu or checkbox of the row is theirs')
  row.props.onClick({currentTarget:{contains:()=>false},target:{closest:()=>null}});assert.equal(opened.length,1,'portalled clicks (outside the row) never open')
  let stopped=0;byLabel(row,'打开 '+name).props.onClick({stopPropagation:()=>stopped++});assert.equal(opened.length,2);assert.equal(stopped,1,'the name opens once')
  const anchor=walk(row).find(n=>/\bap-state-anchor\b/.test(n.props.className||''))
  let chipStopped=0;anchor.props.onClick({stopPropagation:()=>chipStopped++});assert.equal(chipStopped,1,'the chip anchor (trigger and menu) stops clicks')
})
// private fork (library export): the header's 导出 (a share glyph, never 获取素材包's ⤓) enters selection mode like 舞台设置's
// 「导出」 — house-style round checks, none checked; 「已选 N」 · 取消 · 导出; confirming is one download of the checked packs.
test('batch export: selection mode with house checks (none checked), 已选 N · 取消 · 导出, one download of the checked packs',async t=>{
  const other={...(await syntheticPack()),revision:'o1'};other.manifest={...other.manifest,id:OTHER_PACK_ID,name:'Other pack'}
  const downloads=[],f=await fixture(t,'Home',{download:r=>{downloads.push(r)}})
  f.binding.service.capabilities=['packs','figures','pack-set'];f.binding.service.listPackSummaries=async()=>[f.snapshot,other]
  f.binding.service.exportPack=async args=>{f.calls.push(['exportPack',args]);return {filename:'one.zip',warnings:[]}}
  f.binding.service.exportPacks=async args=>{f.calls.push(['exportPacks',args]);return {filename:'asset-packs-2.zip',warnings:[]}}
  f.r.render(f.views.Home,{...f.props,key:'batch'});let tree=await f.r.settle()
  const glyph=label=>walk(byLabel(tree,label)).find(n=>n.type==='path').props.d
  assert.ok(byLabel(tree,'导出'));assert.notEqual(glyph('导出'),glyph('获取素材包'),'not the ⤓ of 获取素材包')
  const checks=()=>walk(tree).filter(n=>n.props.role==='checkbox'),enter=async()=>{byLabel(tree,'导出').props.onClick();tree=await f.r.settle()}
  assert.equal(checks().length,0)
  await enter()
  assert.equal(checks().length,2);assert.ok(checks().every(n=>n.type==='button'&&n.props['aria-checked']===false&&n.props.className==='ap-pack-check'),'house checks, none checked')
  assert.equal(walk(tree).some(n=>n.type==='input'&&n.props.type==='checkbox'),false,'no native checkbox')
  assert.ok(byLabel(tree,'获取素材包') === undefined);assert.ok(byLabel(tree,'新建素材包') === undefined);assert.ok(byLabel(tree,'导出 Other pack') === undefined, 'no row icons while selecting')
  assert.match(text(walk(tree).find(n=>/ap-lib-picked/.test(n.props.className||''))),/已选\s+0/);assert.equal(button(tree,'导出').props.disabled,true)
  checks().find(n=>n.props['aria-label']==='Other pack').props.onClick();tree=await f.r.settle()
  assert.match(text(tree),/已选\s+1/);await button(tree,'导出').props.onClick();tree=await f.r.settle()
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(([m])=>/^exportPacks?$/.test(m)))),[['exportPack',{packId:OTHER_PACK_ID,expectedRevision:'o1'}]],'one pack: its own ZIP')
  assert.equal(checks().length,0,'confirming leaves the mode');assert.ok(byLabel(tree,'获取素材包'))
  await enter();for(const check of checks())check.props.onClick();tree=await f.r.settle()
  assert.ok(checks().every(n=>n.props['aria-checked']===true));assert.match(text(tree),/已选\s+2/)
  await button(tree,'导出').props.onClick();tree=await f.r.settle()
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(([m])=>m==='exportPacks')[1])),{packs:[{packId:OTHER_PACK_ID,expectedRevision:'o1'},{packId:PACK_ID,expectedRevision:'pack-r1'}]})
  assert.deepEqual(downloads.map(d=>d.filename),['one.zip','asset-packs-2.zip'],'one download per confirm');assert.equal(checks().length,0)
  await enter();await button(tree,'取消').props.onClick();tree=await f.r.settle();assert.equal(checks().length,0)
  await enter();walk(tree).find(n=>/^ap-home/.test(n.props.className||'')).props.onKeyDown({key:'Escape',defaultPrevented:false,preventDefault(){}});tree=await f.r.settle();assert.equal(checks().length,0,'Esc leaves the mode')
  assert.equal(f.calls.filter(([m])=>/^exportPacks?$/.test(m)).length,2,'取消 and Esc export nothing')
})