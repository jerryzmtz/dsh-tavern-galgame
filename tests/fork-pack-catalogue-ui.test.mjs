// private fork (rename-mod, owner 2026-10): the user-facing widget term is 模组 (display text only; ids stay widgets).
// private fork: expand the shared emotion dependency in isolated client fragments.
import {withSpriteEmotionSource} from './helpers/sprite-emotion-source.mjs'
// private fork: 素材库 pack catalogue UI (docs/fork/pack-catalogue-contract.md) against a mocked v2 control port.
// No network, no live data: every catalogue / download RPC is an in-memory fake.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'

const client=name=>readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
let source=await client('fork-asset-pack-ui.js')
source=source.split('// @include-shared figure-auto-color.cjs').join(await readFile(new URL('../tavern-plugin/shared/figure-auto-color.cjs',import.meta.url),'utf8'))
source=source.split('// @include-shared asset-image-publication.cjs').join(await readFile(new URL('../tavern-plugin/shared/asset-image-publication.cjs',import.meta.url),'utf8'))
source=source.split('// @include-protocol director-commands.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs',import.meta.url),'utf8'))
source=source.split('// @include-domain pack-avatar.cjs').join(withSpriteEmotionSource(await readFile(new URL('../tavern-plugin/lib/domain/pack-avatar.cjs',import.meta.url),'utf8')))
for(const name of ['figure','spine','import','card','opening','character','engine','entry','cg','catalogue','setup','voice','gen'])source=source.split('// @include fork-asset-pack-'+name+'-ui.js').join(await client('fork-asset-pack-'+name+'-ui.js'))
for(const name of ['fork-widget-contracts.cjs','fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js'] /* private fork: mod library lives inside the pack UI closure */){const included=await client(name);source=source.replace('// @include '+name,()=>included)}
source=forkSpinnerSource+'\n'+source

const PACK='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',FIG='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NEW='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OFFICIAL={sourceId:'source-official',url:'https://packs.example.org/catalogue.json',enabled:true,official:true}
const COMMUNITY={sourceId:'source-community',url:'https://fans.example.net/c.json',enabled:true,official:false}
const SHA='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const clone=v=>JSON.parse(JSON.stringify(v))
const byLabel=(tree,label)=>walk(tree).find(n=>n.props['aria-label']===label)
const button=(tree,label)=>walk(tree).find(n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label))
const conflict=code=>Object.assign(new Error(code),{code})
const IDS=/[0-9a-f]{8}-[0-9a-f]{4}-|source-official|source-community|asset\/|outfit\//

function installed({version='1.0.0',sha='old'.padEnd(64,'0')}={}) {
  return {manifest:{id:PACK,name:'校园背景',assets:[{kind:'backgrounds',id:'bg1',name:'教室',enabled:true},{kind:'music',id:'m1',name:'旧曲',enabled:true}],figures:[FIG]},
    figures:{[FIG]:{id:FIG,name:'小圆',enabled:true,outfits:[{key:'casual',label:'便服',enabled:true}]}},sprites:{},revision:'pack-r1',installedAt:1,updatedAt:2,
    distribution:{sourceId:OFFICIAL.sourceId,catalogueUrl:OFFICIAL.url,version,archiveSha256:sha,upstreamContentHash:'x',baseMetadata:{}}}
}
const cataloguePack=(over={})=>({id:PACK,title:'校园背景',version:'1.2.0',size:125829120,sha256:SHA,preview:'https://img.example.org/p.webp',licence:{id:'CC-BY-4.0'},credits:[{name:'作者甲'}],requires:['asset-pack-schema:1'],
  downloads:[{id:'github',label:'GitHub Releases',url:'https://github.com/x/packs/releases/download/v1.2.0/school.zip'},{id:'cn',label:'国内镜像',url:'https://cdn.example.cn/school-1.2.0.zip'}],
  sourceId:OFFICIAL.sourceId,official:true,compatibility:{supported:true,unsupported:[]},...over})
const snapshotOf=(src,packs)=>({sourceId:src.sourceId,official:src.official,catalogueRevision:'rev-'+src.sourceId,fetchedAt:Date.UTC(2026,9,9,1,2),stale:false,catalogue:{id:'cat',title:src.official?'官方精选':'同好目录',updatedAt:'2026-10-01T00:00:00Z'},packs})
function inspection(over={}) {
  const incoming={manifest:{id:PACK,name:'校园背景',assets:[],figures:[]},figures:{},sprites:{},widgets:{}}
  return {inspectionId:'insp-1',packId:PACK,expectedRevision:null,choices:['install','keep-both','cancel'],expiresAt:Date.now()+9e5,current:null,incoming,scriptRisk:[],conflictFigures:[],
    diff:{assets:{added:[],changed:[],removed:[]},figures:{added:[],changed:[],removed:[]},files:{added:[],changed:[],removed:[]}},
    distribution:{sourceId:null,official:false,archiveSha256:SHA,integrity:'unverified'},merge:{preserved:[],removedEdited:[],withoutBaseline:false,wholePackReplacement:false},...over}
}

// One fake control port. `script` lists each job's snapshots; f.advance() moves every job one step (the last repeats).
function fixture(t,{capable=true,sources=[],mirrorPrefix='',packs=[],catalogues={},updates=null,script=[]}={}) {
  const r=assetRenderer();t.after(()=>r.dispose())
  const storage=new Map(),context={React:r.React,TextEncoder,AbortController,URL,setTimeout,clearTimeout,setInterval,clearInterval,forkForeground:{media:node=>node},
    document:{activeElement:null,addEventListener(){},removeEventListener(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))}}
  vm.runInNewContext(source+';this.views=createForkAssetPackUI;',context)
  const calls=[],steps=new Map();let at=0,settings={revision:'c1',values:{sources:clone(sources),preferredDownloadId:'',mirrorPrefix}},serial=0,saveFailures=0
  const service={apiVersion:2,capabilities:capable?['packs','pack-catalogue-v1','url-install']:['packs'],subscribe:()=>()=>{},
    listPackSummaries:async()=>clone(packs),getPackSnapshot:async({packId})=>({manifest:{id:packId,name:'校园背景',assets:[],figures:[]},figures:{},sprites:{},revision:'pack-r2'}),
    catalogueSettings:async()=>{calls.push(['catalogueSettings']);return clone(settings)},
    saveCatalogueSettings:async args=>{calls.push(['saveCatalogueSettings',clone(args)]);if(saveFailures>0){saveFailures--;settings={...settings,revision:'c-other'};throw conflict('REVISION_CONFLICT')}
      if(args.expectedRevision!==settings.revision)throw conflict('REVISION_CONFLICT')
      settings={revision:'c'+(++serial+1),values:{preferredDownloadId:args.preferredDownloadId,mirrorPrefix:args.mirrorPrefix,sources:args.sources.map(s=>({sourceId:s.sourceId||'source-new-'+serial,url:s.url,enabled:s.enabled,official:s.sourceId===OFFICIAL.sourceId}))}};return clone(settings)},
    refreshCatalogue:async({sourceId})=>{calls.push(['refreshCatalogue',sourceId]);const value=catalogues[sourceId];if(!value)throw conflict('DOWNLOAD_FAILED');return clone(value)},
    checkPackUpdates:async()=>{calls.push(['checkPackUpdates']);return clone(updates||{updates:[],unavailableSources:[]})},
    startPackDownload:async args=>{calls.push(['startPackDownload',clone(args)]);const jobId='job-'+(++serial);steps.set(jobId,clone(script));at=0;return {jobId}},
    getPackDownload:async({jobId})=>{calls.push(['getPackDownload',jobId]);const list=steps.get(jobId);return {jobId,...clone(list[Math.min(at,list.length-1)])}},
    controlPackDownload:async({jobId,action})=>{calls.push(['controlPackDownload',jobId,action]);const state={pause:'paused',resume:'queued',cancel:'cancelled'}[action];const list=steps.get(jobId),now={...list[Math.min(at,list.length-1)],state};steps.set(jobId,[now]);at=0;return {jobId,...clone(now)}},
    applyImport:async args=>{calls.push(['applyImport',clone(args)]);return {status:'installed',snapshot:{manifest:{id:PACK,name:'校园背景',assets:[],figures:[]},figures:{},sprites:{},revision:'pack-r2'}}}}
  const binding={service,downloadPollMs:5,rpc:async method=>{if(method==='getAssetPackDependencies')return {available:true,count:1};throw new Error(method)},download(){}}
  const views=context.views(r.React,{})
  return {r,views,binding,service,calls,failSave:n=>{saveFailures=n},settings:()=>settings,advance:()=>{at++},
    async settle(n=2){let tree;for(let i=0;i<n;i++){tree=await r.settle();await sleep(12)}return r.settle()}}
}

// private fork (pack catalogue r2, owner review 「文案需要让没有技术背景的用户也能理解」): plain words only. No 摘要 /
// 校验 / SHA / 沙箱 / 读点 wording, no +/改/删 ledgers or 「影响 N 张卡」, no internal paths, and no blocking widget step.
const JARGON=/SHA|摘要|校验|沙箱|读点|哈希|内部完整性/
const LEDGER=/[+＋]\d+ \/|改 \d+ \/|删 \d+|影响 \d+ 张卡/
const PATHS=/bundles\/|index\.js|omikuji\/|\.json\b/
const plain=(tree,where)=>{const body=text(tree);for(const [name,re] of [['jargon',JARGON],['ledger',LEDGER],['path',PATHS],['ids',IDS]])assert.doesNotMatch(body,re,where+': '+name)}
const openMore=async(f,label='详情')=>{const toggle=walk(f.r.render()).find(n=>n.type==='button'&&n.props['aria-expanded']===false&&text(n)===label);assert.ok(toggle,label+' disclosure');toggle.props.onClick();return f.settle()}

// private fork (library header, owner 2026-10): one 「获取素材包」 button replaces 导入素材包 (link / file) and 浏览素材目录;
// the catalogue list and the link field need the catalogue capability, the file import never does. // private fork (get packs)
test('library offers 获取素材包 always; its catalogue list and link field only with the catalogue capability',async t=>{
  const old=fixture(t,{capable:false});old.r.render(old.views.Home,{binding:old.binding})
  let tree=await old.settle();assert.ok(byLabel(tree,'浏览素材目录') === undefined);assert.ok(byLabel(tree,'导入素材包') === undefined) // private fork (library header)
  assert.ok(byLabel(tree,'从网址安装') === undefined);assert.ok(byLabel(tree,'安装 / 导入 ZIP') === undefined, 'the link and upload icons are one button')
  byLabel(tree,'获取素材包').props.onClick();tree=await old.settle() // private fork (library header)
  assert.match(text(tree),/获取素材包/);assert.equal(walk(tree).some(n=>n.props.role==='tab'),false,'nothing to choose between');assert.equal(walk(tree).some(n=>n.props.id==='ap-cat-url'),false,'no link field without the capability');assert.ok(button(tree,'选择 ZIP 文件')) // private fork (get packs): the ZIP pick is the only control
  assert.equal(old.calls.some(([m])=>m==='catalogueSettings'),false,'no catalogue reads without the capability')
  const f=fixture(t);f.r.render(f.views.Home,{binding:f.binding});tree=await f.settle()
  assert.ok(byLabel(tree,'获取素材包'));assert.ok(byLabel(tree,'浏览素材目录') === undefined, 'one header icon');assert.equal(f.calls.some(([m])=>m==='checkPackUpdates'),false,'no catalogue packs → no update check') // private fork (library header)
})

// private fork (get packs, owner 2026-10: 「丑，浪费空间，不需要两个页签」): 「获取素材包」 is one compact view — the link field,
// an inline 获取 and a 选择 ZIP icon on top, the catalogue rows right below; no tabs and no foot. A catalogue download stays
// in its row (no sheet on top); 目录来源 opens above the dialog.
test('获取素材包: one compact view — link field · 获取 · 选择 ZIP on top, the catalogue rows below; no tabs, no foot',async t=>{
  const f=fixture(t,{sources:[OFFICIAL],packs:[],catalogues:{[OFFICIAL.sourceId]:snapshotOf(OFFICIAL,[cataloguePack()])},
    script:[{state:'downloading',receivedBytes:5,totalBytes:100,speed:1,downloadUrl:'https://cdn.example.org/packs/school.zip',integrity:'sha256'}]})
  f.r.render(f.views.Home,{binding:f.binding});let tree=await f.settle()
  byLabel(tree,'获取素材包').props.onClick();tree=await f.settle(3)
  const dialogs=()=>walk(tree).filter(n=>n.props.role==='dialog'),url=()=>walk(tree).find(n=>n.props.id==='ap-cat-url')
  assert.equal(dialogs().length,1);assert.equal(dialogs()[0].props['aria-label'],'获取素材包')
  assert.equal(walk(tree).some(n=>['tab','tablist','tabpanel'].includes(n.props.role)),false,'no tabs')
  assert.equal(walk(dialogs()[0]).some(n=>n.type==='footer'),false,'no foot');assert.ok(button(tree,'下一步') === undefined);assert.ok(button(tree,'取消') === undefined)
  assert.equal(url().props.placeholder,'粘贴素材包链接');assert.equal(byLabel(tree,'选择 ZIP').props.title,'选择 ZIP，或拖入此窗口')
  assert.equal(walk(tree).some(n=>/ap-import-drop/.test(n.props.className||'')),false,'no dashed drop box')
  assert.equal(button(tree,'获取').props.disabled,true,'nothing to get yet')
  assert.ok(byLabel(tree,'目录来源'));assert.ok(byLabel(tree,'安装 校园背景'));assert.match(text(tree),/作者甲 · 120 MB/)
  assert.equal(walk(tree).some(n=>n.props.className==='ap-get-group-head'),false,'one official source needs no heading')
  url().props.onChange({target:{value:'school'}});tree=await f.settle();assert.equal(button(tree,'获取').props.disabled,true,'not a URL yet')
  url().props.onChange({target:{value:'https://cdn.example.org/packs/school.zip'}});tree=await f.settle();assert.equal(button(tree,'获取').props.disabled,false)
  byLabel(tree,'目录来源').props.onClick();tree=await f.settle()
  assert.deepEqual(dialogs().map(n=>n.props['aria-label']),['获取素材包','目录来源']);walk(dialogs()[1]).find(n=>n.props['aria-label']==='关闭').props.onClick();tree=await f.settle()
  assert.equal(url().props.value,'https://cdn.example.org/packs/school.zip','目录来源 keeps the link')
  // A catalogue install runs in its row: progress, pause and cancel in place; nothing opens on top.
  await byLabel(tree,'安装 校园背景').props.onClick();tree=await f.settle(3)
  assert.deepEqual(f.calls.find(([m])=>m==='startPackDownload')[1].selection.packId,PACK)
  assert.deepEqual(dialogs().map(n=>n.props['aria-label']),['获取素材包'],'no download sheet on top')
  const row=walk(tree).find(n=>n.props.className==='ap-get-row')
  assert.ok(walk(row).some(n=>n.props.role==='progressbar'));assert.match(text(row),/5 B \/ 100 B/);assert.ok(byLabel(tree,'暂停 校园背景'));assert.ok(byLabel(tree,'取消下载 校园背景'))
  plain(tree,'获取素材包')
})

test('URL install in place: paste → 获取 → 确认下载 under the field (file, domain, one plain warning; exact link under 详情) → progress → install sheet',async t=>{
  const f=fixture(t,{script:[{state:'downloading',receivedBytes:50,totalBytes:100,speed:2048,downloadUrl:'https://cdn.example.org/packs/school.zip',integrity:'unverified',source:null},
    {state:'ready',receivedBytes:100,totalBytes:100,speed:0,downloadUrl:'https://cdn.example.org/packs/school.zip',integrity:'unverified',source:null,inspection:inspection()}]})
  let done=null;f.r.render(f.views.catalogue.PackGetSheet,{binding:f.binding,packs:[],catalogueReady:true,onClose(){},onSources(){},onPreview(){},onInstalled:result=>{done=result}});let tree=await f.settle()
  const dialogs=()=>walk(tree).filter(n=>n.props.role==='dialog'),url=()=>walk(tree).find(n=>n.props.id==='ap-cat-url')
  // private fork (owner 2026-10 library toolbar): no 「更多选项 › 文件指纹」 for a link.
  assert.equal(walk(tree).some(n=>n.props.id==='ap-cat-sha'),false);assert.doesNotMatch(text(tree),/文件指纹|更多选项|加速镜像/)
  url().props.onChange({target:{value:'http://cdn.example.org/a.zip'}});tree=await f.settle();button(tree,'获取').props.onClick();tree=await f.settle()
  assert.match(text(tree),/请粘贴以 https:\/\/ 开头的链接/);assert.equal(url().props['aria-invalid'],true)
  url().props.onChange({target:{value:' https://cdn.example.org/packs/school.zip#top '}});tree=await f.settle()
  url().props.onKeyDown({key:'Enter',preventDefault(){}});tree=await f.settle()
  const confirm=()=>walk(tree).find(n=>n.props.role==='group'&&n.props['aria-label']==='确认下载')
  assert.ok(confirm(),'确认下载 sits under the field');assert.equal(dialogs().length,1,'not a second sheet');assert.equal(button(tree,'获取').props.disabled,true)
  assert.match(text(confirm()),/school\.zip/);assert.match(text(confirm()),/来自 cdn\.example\.org/)
  assert.match(text(confirm()),/这个素材包来自非官方来源，无法确认作者。请只安装你信任的人分享的素材包。/)
  assert.equal(walk(tree).some(n=>n.props.className==='ap-cat-url'),false,'the raw link is not the focus')
  tree=await openMore(f)
  assert.equal(text(walk(tree).find(n=>n.props.className==='ap-cat-url')),'https://cdn.example.org/packs/school.zip');plain(tree,'url confirm with 详情 open')
  assert.equal(walk(tree).some(n=>['select','img','details'].includes(n.type)),false,'no native select / disclosure, no remote image')
  assert.equal(f.calls.some(([m])=>m==='startPackDownload'),false,'nothing starts before 开始下载')
  await button(tree,'开始下载').props.onClick();tree=await f.settle()
  assert.deepEqual(f.calls.find(([m])=>m==='startPackDownload')[1],{url:'https://cdn.example.org/packs/school.zip'})
  assert.equal(confirm(),undefined);assert.equal(url().props.value,'','the field is free again')
  assert.match(text(tree),/50 B \/ 100 B/);assert.ok(walk(tree).some(n=>n.props.role==='progressbar'));assert.ok(byLabel(tree,'暂停 school.zip'));plain(tree,'progress')
  f.advance();tree=await f.settle(3)
  assert.deepEqual(dialogs().map(n=>n.props['aria-label']),['获取素材包','安装素材包'],'the finished download opens the install sheet on top')
  assert.match(text(tree),/非官方来源/);plain(tree,'install sheet')
  const submit=button(tree,'安装');assert.ok(submit&&!submit.props.disabled,'the 安装 button is the explicit choice')
  assert.equal(walk(tree).some(n=>n.props.role==='radiogroup'),false,'no 处理方式 control for a new pack')
  await submit.props.onClick();tree=await f.settle()
  assert.deepEqual(f.calls.find(([m])=>m==='applyImport')[1],{inspectionId:'insp-1',expectedRevision:null,decision:'install',acceptScriptRisk:false})
  assert.equal(done?.status,'installed');assert.deepEqual(dialogs().map(n=>n.props['aria-label']),['获取素材包']);assert.equal(walk(tree).some(n=>n.props.role==='progressbar'),false)
})

// private fork (get packs): no dashed box — the small 选择 ZIP icon, or a ZIP dropped anywhere on the dialog (a quiet
// full-dialog highlight while a file is dragged over it); the file is read in place and opens the install sheet.
test('ZIP: the 选择 ZIP icon or a ZIP dropped anywhere on the dialog opens the install sheet; a quiet highlight while dragging',async t=>{
  const f=fixture(t,{mirrorPrefix:'https://mirror.example/'}),previews=[];let release
  f.service.inspectImport=async args=>{f.calls.push(['inspectImport',args.bytes.length,Object.keys(args)]);if(!release)await new Promise(r=>{release=r});return inspection()}
  f.r.render(f.views.catalogue.PackGetSheet,{binding:f.binding,packs:[],catalogueReady:true,onClose(){},onSources(){},onInstalled(){},onPreview:p=>previews.push(p)});let tree=await f.settle()
  const dialog=()=>walk(tree).find(n=>n.props.role==='dialog'),ev=dataTransfer=>({preventDefault(){},dataTransfer})
  assert.doesNotMatch(text(tree),/文件指纹|更多选项|加速镜像/);assert.equal(walk(tree).some(n=>n.props.role==='radio'),false)
  dialog().props.onDragEnter(ev({types:['Files']}));tree=await f.settle()
  assert.equal(dialog().props['data-drop'],true);assert.match(text(tree),/松开以导入 ZIP/)
  dialog().props.onDragEnter(ev({types:['Files']}));dialog().props.onDragLeave(ev({types:['Files']}));tree=await f.settle()
  assert.equal(dialog().props['data-drop'],true,'moving over a child keeps the highlight')
  dialog().props.onDragLeave(ev({types:['Files']}));tree=await f.settle();assert.equal(dialog().props['data-drop'],undefined)
  dialog().props.onDragEnter(ev({types:['text/plain']}));tree=await f.settle();assert.equal(dialog().props['data-drop'],undefined,'only files light it')
  dialog().props.onDrop(ev({types:['Files'],files:[{name:'notes.txt',size:3}]}));tree=await f.settle()
  assert.match(text(tree),/请选择 \.zip 格式的素材包/);assert.equal(f.calls.some(([m])=>m==='inspectImport'),false)
  const zip={name:'和风神社.zip',size:2048,arrayBuffer:async()=>new ArrayBuffer(2048)}
  dialog().props.onDrop(ev({types:['Files'],files:[zip]}));tree=await f.settle()
  assert.match(text(tree),/正在读取 和风神社\.zip/);assert.doesNotMatch(text(tree),/请选择 \.zip/)
  assert.equal(walk(dialog()).find(n=>n.props['aria-label']==='关闭').props.disabled,true,'reading: ✕ waits');assert.equal(byLabel(tree,'选择 ZIP').props.disabled,true)
  release();tree=await f.settle()
  assert.deepEqual(f.calls.find(([m])=>m==='inspectImport'),['inspectImport',2048,['bytes']]);assert.equal(previews.length,1);assert.equal(previews[0].inspectionId,'insp-1')
  assert.doesNotMatch(text(tree),/正在读取/)
  // The picker behind the icon works the same.
  walk(tree).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[zip],value:'x'}});tree=await f.settle()
  assert.equal(previews.length,2);assert.equal(f.calls.some(([m])=>m==='startPackDownload'),false)
})

test('install sheet: what is inside in words, one plain widget note and no blocking risk step (acknowledged with 安装)',async t=>{
  const W='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const incoming={manifest:{id:W,name:'和风神社背景',assets:[{kind:'backgrounds',id:'b1',name:'神社正殿'},{kind:'backgrounds',id:'b2',name:'参道'},{kind:'backgrounds',id:'b3',name:'鸟居'},
    {kind:'ambience',id:'a1',name:'蝉鸣'},{kind:'widgets',id:'omikuji',name:'神社御签'}],figures:[]},figures:{},sprites:{},widgets:{}}
  const preview=inspection({packId:W,incoming,diff:{assets:{added:['backgrounds/b1','backgrounds/b2','backgrounds/b3','ambience/a1','widgets/omikuji'],changed:[],removed:[]},figures:{added:[],changed:[],removed:[]},files:{added:['bundles/omikuji/index.js'],changed:[],removed:[]}},
    scriptRisk:[{packId:W,packName:'和风神社背景',widgetId:'omikuji',widgetName:'神社御签',path:'bundles/omikuji/index.js'}]})
  const f=fixture(t);let done=null
  f.r.render(f.views.ConflictDialog,{binding:f.binding,preview,origin:{url:'https://cdn.example.org/shrine.zip'},onClose(){},onDone:v=>{done=v}});let tree=await f.settle()
  assert.match(text(tree),/和风神社背景/);assert.match(text(tree),/3 张背景 · 1 段环境音 · 1 个模组/)
  assert.match(text(tree),/含模组「神社御签」。第三方模组可能有安全风险，请仅启用值得信赖的模组。/)
  assert.doesNotMatch(text(tree),/互动组件/,'the owner term is 模组') // private fork (owner copy rule: risk + 「请仅…」 instruction)
  assert.doesNotMatch(text(tree),/导入前确认风险|接受风险|处理方式|保留两份/)
  tree=await openMore(f);plain(tree,'install sheet with 详情 open')
  assert.match(text(tree),/背景 神社正殿、参道、鸟居/);assert.match(text(tree),/https:\/\/cdn\.example\.org\/shrine\.zip/);assert.match(text(tree),/来源 网址（非官方）/)
  await button(tree,'安装').props.onClick();tree=await f.settle()
  const applies=f.calls.filter(([m])=>m==='applyImport');assert.equal(applies.length,1,'one click installs')
  assert.deepEqual(applies[0][1],{inspectionId:'insp-1',expectedRevision:null,decision:'install',acceptScriptRisk:true})
  assert.ok(done);assert.equal(walk(tree).some(n=>n.props.className==='ap-modal ap-risk-dialog'),false)
})

test('install sheet: replacing from a local ZIP says what is lost; 另存一份 and identical content are plain choices',async t=>{
  const current={manifest:{id:PACK,name:'校园背景',assets:[{kind:'backgrounds',id:'bg1',name:'教室'},{kind:'music',id:'m1',name:'旧曲'}],figures:[]},figures:{},sprites:{},revision:'pack-r1'}
  const incoming={manifest:{id:PACK,name:'校园背景',assets:[{kind:'backgrounds',id:'bg1',name:'教室'}],figures:[]},figures:{},sprites:{},widgets:{}}
  const local=inspection({choices:['update','keep-both','cancel'],expectedRevision:'pack-r1',current,incoming,distribution:undefined,merge:undefined,
    diff:{assets:{added:[],changed:['backgrounds/bg1'],removed:['music/m1']},figures:{added:[],changed:[],removed:[]},files:{added:[],changed:[],removed:['m1.ogg']}}})
  delete local.distribution;delete local.merge
  const f=fixture(t);f.r.render(f.views.ConflictDialog,{binding:f.binding,preview:local,onClose(){},onDone(){}});let tree=await f.settle()
  // private fork (r3 brevity): the list of what is lost carries no count of itself.
  assert.match(text(tree),/会用这个文件替换已安装的「校园背景」，你对它做过的修改都不会保留。/);assert.match(text(tree),/替换后，下面这些会被删除：/);assert.match(text(tree),/旧曲/)
  assert.doesNotMatch(text(tree),/教室/,'only what is lost is listed');plain(tree,'local replace')
  button(tree,'改为另存一份').props.onClick();tree=await f.settle()
  assert.match(text(tree),/会另存为一份新的素材包，原来的「校园背景」保持不变。/);assert.doesNotMatch(text(tree),/会被删除/)
  await button(tree,'另存一份').props.onClick();await f.settle()
  assert.deepEqual(f.calls.find(([m])=>m==='applyImport')[1],{inspectionId:'insp-1',expectedRevision:'pack-r1',decision:'keep-both',acceptScriptRisk:false})
  const same=fixture(t);same.r.render(same.views.ConflictDialog,{binding:same.binding,preview:inspection({choices:['noop','cancel']}),onClose(){},onDone(){}});tree=await same.settle()
  assert.match(text(tree),/已经安装过了/);assert.match(text(tree),/和已安装的内容完全相同。/);assert.doesNotMatch(text(tree),/不需要再安装/,'private fork (r3): the title already says it');await button(tree,'完成').props.onClick();await same.settle()
  assert.equal(same.calls.find(([m])=>m==='applyImport')[1].decision,'noop')
})

// private fork (card import r3, owner: 「废话太多，noise 太大。请尽量简洁，用人能理解的方式来表达。不要一件事重复说，也不要搞太多
// 术语。」): one 导入卡片 sheet from the picked file to the imported card. No native inputs; no counts of cards, ledgers or raw
// JSON outside 「详情」; a decision row only for a pack that differs from an installed one; the 模组 sentence exactly once
// beside its two answers, and both answers import (only disableWidgets differs).
const W='dddddddd-dddd-4ddd-8ddd-dddddddddddd',T='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',G='ffffffff-ffff-4fff-8fff-ffffffffffff'
const NONE={added:[],changed:[],removed:[]}
const SHRINE={id:W,name:'和风神社背景',assets:[{kind:'backgrounds',id:'b1',name:'鸟居'},{kind:'backgrounds',id:'b2',name:'拜殿'},{kind:'ambience',id:'a1',name:'风铃'},{kind:'widgets',id:'omikuji',name:'神社御签'}],figures:[FIG]}
const SFX={id:G,name:'通用音效',assets:[{kind:'sfx',id:'s1',name:'铃声'}],figures:[]}
const cardPack=(manifest,over={})=>({packId:manifest.id,expectedRevision:null,choices:['install','keep-both','cancel'],incoming:{manifest,figures:{[FIG]:{id:FIG,name:'巫女'}},sprites:{}},current:null,diff:{assets:NONE,figures:NONE,files:NONE},scriptRisk:[],...over})
const SHRINE_SCRIPTS=[{packId:W,packName:'和风神社背景',widgetId:'omikuji',widgetName:'神社御签',path:'bundles/omikuji/index.js'},
  {packId:W,packName:'和风神社背景',widgetId:'omikuji',widgetName:'神社御签',path:'bundles/omikuji/widget.json',variables:{reads:[{id:'luck',source:'mvu',path:'/主角/运势',includesChildren:true}],writes:[{id:'coins',source:'mvu',path:'/主角/香火钱',ops:['delta'],scope:'exact',includesChildren:false}]}}]
const CARD_WIDGETS=[{packId:W,packName:'和风神社背景',widgetId:'omikuji',widgetName:'神社御签'},{packId:T,packName:'通用模组',widgetId:'phone',widgetName:'手机'}]
const WIDGET_SENTENCE='含模组「神社御签」「手机」。第三方模组可能有安全风险，请仅启用值得信赖的模组。'
const NATIVE=['input','select','textarea','details','summary','pre']
function cardImport(t,{packs=[cardPack(SHRINE)],widgets=null,cardWidgetRisks=[],currentRaw,inspect,apply,name='巫女日记'}={}) {
  const f=fixture(t),applies=[],cancels=[],inspects=[];let done=null,picks=0,closed=0
  const raw={spec:'chara_card_v2',data:{name,extensions:{dsh_tavern:{stage:{...(widgets===null?{}:{widgets})},assetBindings:{boundPackIds:[...packs.map(p=>p.packId),T]}}}}}
  const scriptRisk=packs.flatMap(p=>p.choices.includes('noop')?[]:p.scriptRisk)
  Object.assign(f.service,{
    inspectCardBundle:async args=>{inspects.push(args);if(inspect)await inspect(inspects.length);
      return {inspectionId:'card-'+inspects.length,path:'cards/miko.json',expectedRevision:'c1',currentRaw:currentRaw===undefined?{spec:'chara_card_v2',data:{name}}:currentRaw,raw,dependencies:[],packs:clone(packs)}},
    previewCardBundleDecisions:async args=>{f.calls.push(['previewCardBundleDecisions',clone(args)]);return {mappings:[],scriptRisk,cardWidgetRisks,raw}},
    applyCardBundle:async args=>{if(args.cancel){cancels.push(args.inspectionId);return {status:'cancelled'}}applies.push(clone(args));if(apply)await apply(applies.length);return {status:'committed',path:'cards/miko.json',mappings:[],widgetRisks:scriptRisk}}})
  const file={name:name+'.zip',arrayBuffer:async()=>new ArrayBuffer(4)}
  const first=f.r.render(f.views.CardImportSheet,{binding:f.binding,path:'cards/miko.json',file,cardName:name,onPick:()=>picks++,onClose:()=>closed++,onDone:v=>{done=v}})
  return {...f,first,applies,cancels,inspects,done:()=>done,picks:()=>picks,closed:()=>closed}
}
const sheetOf=tree=>walk(tree).find(n=>n.props.role==='dialog')
const footOf=tree=>walk(sheetOf(tree)).find(n=>n.type==='footer')
const footButtons=tree=>walk(footOf(tree)).filter(n=>n.type==='button').map(text)
// Everything the sheet says outside the closed 「详情」 body.
const shown=tree=>text(sheetOf(tree))
const RAW=/[{}[\]]|"spec"|chara_card|dsh_tavern|assetBindings/
const plainSheet=(tree,where)=>{const sheet=sheetOf(tree);plain(sheet,where);assert.doesNotMatch(text(sheet),RAW,where+': raw JSON');assert.equal(walk(sheet).some(n=>NATIVE.includes(n.type)||n.props.type==='checkbox'),false,where+': native control')}

test('card import: reading (spinner only after 150 ms), then the card, what comes with it and one 导入',async t=>{
  let release;const pending=new Promise(r=>{release=r})
  const f=cardImport(t,{inspect:()=>pending,packs:[cardPack(SHRINE,{scriptRisk:[{packId:W,packName:'和风神社背景',path:'bundles/extra/readme.html'}]}),cardPack(SFX,{choices:['noop','cancel']})]})
  assert.equal(sheetOf(f.first).props['aria-label'],'导入卡片');assert.match(text(f.first),/巫女日记/)
  let tree=await f.settle()
  assert.doesNotMatch(text(tree),/正在读取/,'no words before 150 ms');assert.equal(walk(tree).some(n=>n.props.className?.startsWith?.('fork-spinner')),false)
  await sleep(170);tree=await f.settle()
  assert.match(text(tree),/正在读取…/);assert.ok(walk(tree).some(n=>n.props.className==='fork-spinner'),'ForkSpinner after the delay')
  assert.deepEqual(footButtons(tree),['取消'])
  release();tree=await f.settle()
  assert.match(shown(tree),/巫女日记/);assert.match(shown(tree),/1 个人物 · 2 张背景 · 1 个音效 · 1 段环境音 等/,'what comes with it, in words')
  assert.match(shown(tree),/会替换这张卡现在的内容。/);assert.equal(walk(tree).some(n=>n.props.className==='ap-card-pack'),false,'no decision without a differing installed pack')
  assert.doesNotMatch(shown(tree),/模组可能有安全风险/,'no widget question for a card without 模组');assert.deepEqual(footButtons(tree),['取消','导入'])
  assert.ok(walk(tree).some(n=>n.type==='img'&&n.props.src==='/api/dsh-tavern/card-image?path=cards%2Fmiko.json'),'the card\'s own picture')
  plainSheet(tree,'ready')
  assert.deepEqual(f.calls.find(([m])=>m==='previewCardBundleDecisions')[1].decisions,{[W]:'install',[G]:'noop'})
  // private fork (settings-polish r4): the import facts show open in the sheet; there is no 「详情」 disclosure.
  assert.equal(walk(tree).some(n=>n.props.className==='ap-cat-more'),false,'no 详情 disclosure');const more=walk(tree).find(n=>n.props.className==='ap-card-import-facts')
  assert.match(text(more),/和风神社背景 1 个人物 · 2 张背景 · 1 段环境音 · 1 个模组 · 新安装/);assert.match(text(more),/通用音效 1 个音效 · 已装过相同的/);assert.match(text(more),/extra\/readme\.html/)
  assert.doesNotMatch(text(more),RAW,'no raw JSON even in 详情')
  await button(tree,'导入').props.onClick();tree=await f.settle()
  assert.deepEqual(f.applies,[{inspectionId:'card-1',expectedRevision:'c1',decisions:{[W]:'install',[G]:'noop'},acceptScriptRisk:true}],'no disableWidgets for a card without 模组')
  assert.equal(f.done().status,'committed')
})

test('card import: a pack that differs from an installed one is one plain row; 另存一份 by default, 替换原来的 says what is lost',async t=>{
  const current={manifest:{id:T,name:'通用素材',assets:[{kind:'backgrounds',id:'old',name:'旧教室'},{kind:'music',id:'m1',name:'放学后'}],figures:[]},figures:{}}
  const general=cardPack({id:T,name:'通用素材',assets:[{kind:'music',id:'m1',name:'放学后'}],figures:[]},{choices:['update','keep-both','cancel'],expectedRevision:'p1',current,diff:{assets:{added:[],changed:['music/m1'],removed:['backgrounds/old']},figures:NONE,files:NONE}})
  const clash=cardPack(SFX,{choices:['keep-both','cancel']})
  for(const replace of [false,true]){
    const f=cardImport(t,{packs:[cardPack(SHRINE),general,clash]});let tree=await f.settle()
    const rows=walk(tree).filter(n=>n.props.className==='ap-card-pack');assert.equal(rows.length,1,'only the differing installed pack asks')
    assert.match(text(rows[0]),/通用素材/);assert.match(text(rows[0]),/你装过另一个版本。另存一份，原来的不变。/)
    assert.equal(walk(rows[0]).find(n=>n.props.role==='radio'&&text(n)==='另存一份').props['aria-checked'],true,'nothing installed changes by default')
    assert.deepEqual(f.calls.find(([m])=>m==='previewCardBundleDecisions')[1].decisions,{[W]:'install',[T]:'keep-both',[G]:'keep-both'})
    plainSheet(tree,'conflict');assert.doesNotMatch(shown(tree),/旧教室|会被删除/)
    if(replace){
      walk(tree).find(n=>n.props.role==='radio'&&text(n)==='替换原来的').props.onClick();tree=await f.settle()
      const row=walk(tree).find(n=>n.props.className==='ap-card-pack')
      assert.match(text(row),/你装过另一个版本。替换后，用到它的卡都会跟着变。/);assert.match(text(row),/替换后，下面这些会被删除：/);assert.match(text(row),/旧教室/)
      assert.doesNotMatch(text(row),/放学后|\d+ 项|\d+ 张卡/,'only what is lost, without a count');plainSheet(tree,'conflict replace')
    }
    await button(tree,'导入').props.onClick();await f.settle()
    assert.deepEqual(f.applies[0].decisions,{[W]:'install',[T]:replace?'update':'keep-both',[G]:'keep-both'})
  }
})

test('card import with 模组: the risk sentence once, 不启用 / 启用 both import and only the card switch differs',async t=>{
  for(const [label,disableWidgets] of [['不启用',true],['启用',false]]){
    const f=cardImport(t,{packs:[cardPack(SHRINE,{scriptRisk:SHRINE_SCRIPTS})],widgets:true,cardWidgetRisks:CARD_WIDGETS});let tree=await f.settle()
    const body=shown(tree)
    assert.equal(body.split(WIDGET_SENTENCE).length-1,1,'the widget sentence is said exactly once');assert.equal(body.split('请仅启用').length-1,1)
    assert.ok(text(footOf(tree)).includes(WIDGET_SENTENCE),'the question sits beside its answers')
    assert.doesNotMatch(body,/沙箱|读点|脚本|文件路径|最近 20 轮|互动组件|导入前确认风险|接受风险/);plainSheet(tree,'widgets')
    assert.deepEqual(footButtons(tree),['不启用','启用'],'two answers, no separate 导入 / 取消');assert.equal(button(tree,'不启用').props['data-autofocus'],true,'focus starts on 不启用')
    assert.equal(walk(tree).filter(n=>n.type==='section'&&n.props.role==='dialog').length,1,'part of the import sheet, not a second modal')
    assert.equal(f.applies.length,0,'nothing is imported before the answer')
    // private fork (settings-polish r4): facts open in the sheet; a 模组 lists its pack and values, not its program files.
    const more=text(walk(tree).find(n=>n.props.className==='ap-card-import-facts'))
    assert.doesNotMatch(more,/omikuji\/index\.js/);assert.match(more,/读取 MVU 变量\s+\/主角\/运势/);assert.match(more,/改动 MVU 变量\s+\/主角\/香火钱\s*（增减）/);assert.match(more,/来自素材包「通用模组」/)
    assert.equal(shown(tree).split(WIDGET_SENTENCE).length-1,1,'详情 does not repeat it');assert.doesNotMatch(more,IDS)
    await button(tree,label).props.onClick();tree=await f.settle()
    assert.equal(f.applies.length,1,label+' imports');assert.equal(f.applies[0].disableWidgets,disableWidgets);assert.equal(f.applies[0].acceptScriptRisk,true)
    assert.ok(f.done(),label+' finishes the import')
  }
})

test('card import: 模组 exported off stay off without a question; × cancels the reading',async t=>{
  const f=cardImport(t,{widgets:null,cardWidgetRisks:CARD_WIDGETS});let tree=await f.settle()
  assert.doesNotMatch(shown(tree),/模组可能有安全风险|不启用/,'the quieter option: no question');assert.deepEqual(footButtons(tree),['取消','导入'])
  await button(tree,'导入').props.onClick();await f.settle()
  assert.equal(f.applies[0].disableWidgets,true,'the import cannot switch them on, so they stay off')
  const g=cardImport(t);tree=await g.settle()
  walk(sheetOf(tree)).find(n=>n.props['aria-label']==='关闭').props.onClick();await g.settle()
  assert.equal(g.closed(),1);assert.deepEqual(g.cancels,['card-1'],'the inspection is released');assert.equal(g.applies.length,0)
})

test('card import errors are one plain line with one way out',async t=>{
  // A file that is no card ZIP: 换一个文件 picks again through the caller.
  const bad=cardImport(t,{inspect:()=>{throw conflict('INVALID_INPUT')}});let tree=await bad.settle()
  const alert=walk(sheetOf(tree)).find(n=>n.props.role==='alert');assert.equal(text(alert),'这个文件不是卡片 ZIP，或者已经损坏。')
  assert.deepEqual(footButtons(tree),['关闭','换一个文件']);plainSheet(tree,'bad file')
  button(tree,'换一个文件').props.onClick();assert.equal(bad.picks(),1);assert.equal(bad.applies.length,0)
  // The card changed after reading: 重试 reads the same file again and releases the stale inspection.
  const changed=cardImport(t,{apply:n=>{if(n===1)throw conflict('REVISION_CONFLICT')}});tree=await changed.settle()
  await button(tree,'导入').props.onClick();tree=await changed.settle()
  assert.equal(text(walk(sheetOf(tree)).find(n=>n.props.role==='alert')),'卡片或素材刚刚被改过，请重试。');assert.deepEqual(footButtons(tree),['关闭','重试'])
  button(tree,'重试').props.onClick();tree=await changed.settle()
  assert.equal(changed.inspects.length,2);assert.deepEqual(changed.cancels,['card-1'])
  await button(tree,'导入').props.onClick();await changed.settle()
  assert.equal(changed.applies.length,2);assert.equal(changed.applies[1].inspectionId,'card-2');assert.ok(changed.done())
  // A refusal at import time is never blamed on the file (the sheet stays, nothing was imported).
  const refused=cardImport(t,{apply:n=>{if(n===1)throw conflict('INVALID_INPUT')}});tree=await refused.settle()
  await button(tree,'导入').props.onClick();tree=await refused.settle()
  assert.equal(text(walk(sheetOf(tree)).find(n=>n.props.role==='alert')),'没能导入，请重试。');assert.deepEqual(footButtons(tree),['取消','导入']);assert.equal(refused.done(),null)
  // Committed, but the figure colours did not finish: 重试 continues without importing twice.
  const colour=cardImport(t);let fails=1;const snapshot=colour.service.getPackSnapshot
  colour.service.getPackSnapshot=async args=>{if(fails-->0)throw conflict('ASSET_UNAVAILABLE');return snapshot(args)}
  tree=await colour.settle();await button(tree,'导入').props.onClick();tree=await colour.settle()
  assert.match(shown(tree),/卡片已导入，但人物的颜色还没设置好，请重试。/);assert.deepEqual(footButtons(tree),['关闭','重试']);assert.equal(colour.done(),null)
  await button(tree,'重试').props.onClick();await colour.settle()
  assert.equal(colour.applies.length,1,'imported once');assert.ok(colour.done())
})

// private fork (r3 brevity pass): a list carries no count of itself, 「详情」 does not repeat the hero, and a program-file
// note does not repeat the 非官方来源 instruction.
test('install sheets say each thing once',async t=>{
  const official=inspection({choices:['update','keep-both','cancel'],expectedRevision:'pack-r1',current:installed(),incoming:{manifest:{id:PACK,name:'校园背景',assets:[{kind:'backgrounds',id:'bg1',name:'教室'}],figures:[]},figures:{},sprites:{},widgets:{}},distribution:{sourceId:OFFICIAL.sourceId,official:true,version:'1.2.0',archiveSha256:SHA,integrity:'sha256'},
    merge:{preserved:[],removedEdited:['asset/music/m1'],withoutBaseline:false,wholePackReplacement:true}})
  const f=fixture(t);f.r.render(f.views.ConflictDialog,{binding:f.binding,preview:official,onClose(){},onDone(){}});let tree=await f.settle()
  assert.match(text(tree),/官方素材 · 文件完整/);assert.match(text(tree),/更新后，下面这些你改过的内容会消失：/);assert.doesNotMatch(text(tree),/\d+ 项/)
  tree=await openMore(f);const more=text(walk(tree).find(n=>n.props.className==='ap-cat-more-body'))
  assert.match(more,/背景 教室/);assert.doesNotMatch(more,/1\.0\.0|文件完整|官方素材目录/,'详情 leaves out what the hero says')
  const scripts=inspection({scriptRisk:[{packId:PACK,packName:'校园背景',path:'bundles/skin/run.js'}]})
  const g=fixture(t);g.r.render(g.views.ConflictDialog,{binding:g.binding,preview:scripts,onClose(){},onDone(){}});tree=await g.settle()
  assert.equal(text(tree).split(/请只安装/).length-1,1,'one 请只安装 instruction');assert.match(text(tree),/这个素材包来自非官方来源，无法确认作者。请只安装你信任的人分享的素材包。/)
  const local=inspection({scriptRisk:scripts.scriptRisk});delete local.distribution;delete local.merge
  const l=fixture(t);l.r.render(l.views.ConflictDialog,{binding:l.binding,preview:local,onClose(){},onDone(){}});tree=await l.settle()
  assert.match(text(tree),/含程序文件。第三方程序可能有安全风险，请只安装你信任的素材包。/)
})

// private fork (get packs): the catalogue is a list inside 获取素材包 — every enabled source (official first), a quiet heading
// only with more than one source, one 非官方 line per unofficial source; 封面 rows with author and size; a row's name opens
// its facts and choices in place. No sources → no list at all (目录来源 stays in the head).
test('catalogue list: nothing without sources; official first, one 非官方 line, rows with author and size, facts and choices in place; no remote previews',async t=>{
  const props=f=>({binding:f.binding,catalogueReady:true,onClose(){},onSources(){},onInstalled(){},onPreview(){}})
  const empty=fixture(t);empty.r.render(empty.views.catalogue.PackGetSheet,{...props(empty),packs:[]})
  let tree=await empty.settle();assert.equal(walk(tree).some(n=>n.props.className==='ap-get-catalogue'),false,'no catalogue → no list');assert.ok(byLabel(tree,'目录来源'))
  assert.doesNotMatch(text(tree),IDS)
  const fan=cataloguePack({id:NEW,title:'同好立绘',sourceId:COMMUNITY.sourceId,official:false,credits:[],version:'0.3.0'})
  const f=fixture(t,{sources:[COMMUNITY,OFFICIAL],packs:[installed()],catalogues:{[OFFICIAL.sourceId]:snapshotOf(OFFICIAL,[cataloguePack()]),[COMMUNITY.sourceId]:snapshotOf(COMMUNITY,[fan])},
    script:[{state:'queued',receivedBytes:0,totalBytes:125829120,speed:0,integrity:'sha256'}]})
  f.r.render(f.views.catalogue.PackGetSheet,{...props(f),packs:[installed()]});tree=await f.settle(3)
  const groups=walk(tree).filter(n=>n.props.className==='ap-get-group')
  assert.deepEqual(groups.map(g=>g.props['aria-label']),['官方精选','同好目录'],'official first')
  assert.deepEqual(f.calls.filter(([m])=>m==='refreshCatalogue').map(c=>c[1]).sort(),[COMMUNITY.sourceId,OFFICIAL.sourceId].sort(),'every listed source is fetched once')
  assert.match(text(groups[0]),/官方/);assert.doesNotMatch(text(groups[0]),/非官方/)
  assert.match(text(groups[1]),/非官方/);assert.match(text(groups[1]),/这是非官方目录，无法确认作者。请只安装你信任的人分享的素材包。/)
  assert.match(text(groups[0]),/校园背景/);assert.match(text(groups[0]),/1\.0\.0\s*1\.2\.0\s*·\s*作者甲 · 120 MB/);assert.ok(byLabel(tree,'更新 校园背景'))
  assert.doesNotMatch(text(tree),/CC-BY/,'licence only in the facts');assert.match(text(groups[1]),/同好立绘/);assert.doesNotMatch(text(groups[1]),/未提供署名|SHA/)
  assert.ok(walk(tree).some(n=>n.props.className==='ap-cat-art'),'each row has its 封面')
  assert.equal(walk(tree).some(n=>n.type==='img'||/img\.example/.test(JSON.stringify(n.props))),false,'remote previews are never loaded')
  // The name opens the row's facts and choices right below it.
  byLabel(tree,'校园背景 详情').props.onClick();tree=await f.settle()
  assert.equal(byLabel(tree,'校园背景 详情').props['aria-expanded'],true);assert.ok(byLabel(tree,'下载源：GitHub Releases'));assert.match(text(tree),/github\.com/)
  byLabel(tree,'下载源：GitHub Releases').props.onClick();tree=await f.settle()
  walk(tree).find(n=>n.props.role==='menuitemradio'&&/国内镜像/.test(text(n))).props.onClick();tree=await f.settle()
  assert.equal(text(walk(tree).find(n=>n.props.className==='ap-cat-url')),'https://cdn.example.cn/school-1.2.0.zip')
  assert.match(text(tree),/使用许可 CC-BY-4\.0/);assert.match(text(tree),/文件指纹 目录已提供，下载完会核对/);plain(tree,'row facts')
  await byLabel(tree,'更新 校园背景').props.onClick();tree=await f.settle()
  assert.deepEqual(f.calls.find(([m])=>m==='startPackDownload')[1],{selection:{sourceId:OFFICIAL.sourceId,catalogueRevision:'rev-'+OFFICIAL.sourceId,packId:PACK,version:'1.2.0',downloadId:'cn'}})
  const row=walk(tree).find(n=>n.props.className==='ap-get-row'&&/校园背景/.test(text(n)))
  assert.ok(walk(row).some(n=>n.props.role==='progressbar'));assert.match(text(row),/准备下载/);assert.ok(byLabel(tree,'取消下载 校园背景'));assert.ok(byLabel(tree,'更新 校园背景') === undefined)
  assert.equal(walk(tree).filter(n=>n.props.role==='dialog').length,1);assert.doesNotMatch(text(tree),IDS)
})

test('catalogue states: same version with different bytes, unsupported requirements and a stale cache never claim 已是最新',async t=>{
  const props=(f,packs)=>({binding:f.binding,packs,catalogueReady:true,onClose(){},onSources(){},onInstalled(){},onPreview(){}})
  const changed=cataloguePack({version:'1.0.0'}),blocked=cataloguePack({id:NEW,title:'未来格式',compatibility:{supported:false,unsupported:['asset-pack-schema:9']}})
  const f=fixture(t,{sources:[OFFICIAL],catalogues:{[OFFICIAL.sourceId]:{...snapshotOf(OFFICIAL,[changed,blocked]),stale:true,error:{code:'DOWNLOAD_FAILED',message:'x'}}}})
  f.r.render(f.views.catalogue.PackGetSheet,props(f,[installed()]));let tree=await f.settle(3)
  assert.match(text(tree),/暂时连不上这个目录，显示的是 .* 的内容/);assert.match(text(tree),/暂时无法更新/);assert.match(text(tree),/暂不支持/);assert.doesNotMatch(text(tree),/已是最新|已安装/)
  assert.ok(byLabel(tree,'更新 校园背景') === undefined);assert.ok(byLabel(tree,'安装 未来格式') === undefined, 'nothing to start')
  byLabel(tree,'校园背景 详情').props.onClick();tree=await f.settle()
  assert.match(text(tree),/发布者换了文件却没有改版本号。请等发布者发布新版本。/)
  byLabel(tree,'未来格式 详情').props.onClick();tree=await f.settle()
  assert.match(text(tree),/需要更新 DSH Tavern 后才能安装这个素材包/)
  assert.equal(f.calls.some(([m])=>m==='startPackDownload'),false);plain(tree,'states')
  // The same release that is installed reads 已安装 (no action).
  const same=fixture(t,{sources:[OFFICIAL],catalogues:{[OFFICIAL.sourceId]:snapshotOf(OFFICIAL,[cataloguePack({version:'1.0.0'})])}})
  same.r.render(same.views.catalogue.PackGetSheet,props(same,[installed({sha:SHA})]));tree=await same.settle(3)
  const row=walk(tree).find(n=>n.props.className==='ap-get-row');assert.match(text(row),/已安装/);assert.equal(walk(row).filter(n=>n.type==='button').length,1,'only the name (facts)')
})

// private fork (get packs): a failed download stays on its row — one plain line, 重试 / 放弃, never a force option.
test('a failed catalogue download stays on its row: one plain line with 重试 / 放弃',async t=>{
  const f=fixture(t,{sources:[OFFICIAL],catalogues:{[OFFICIAL.sourceId]:snapshotOf(OFFICIAL,[cataloguePack()])},
    script:[{state:'failed',receivedBytes:100,totalBytes:100,speed:0,integrity:'sha256',error:{code:'INTEGRITY_MISMATCH',message:'ZIP SHA-256 mismatch'}}]})
  f.r.render(f.views.catalogue.PackGetSheet,{binding:f.binding,packs:[],catalogueReady:true,onClose(){},onSources(){},onInstalled(){},onPreview(){}});let tree=await f.settle(3)
  await byLabel(tree,'安装 校园背景').props.onClick();tree=await f.settle(4)
  const row=()=>walk(tree).find(n=>n.props.className==='ap-get-row')
  assert.equal(text(walk(row()).find(n=>n.props.role==='alert')),'下载到的文件和发布的不一样，可能已损坏或被改动过，不能安装')
  assert.equal(walk(tree).some(n=>/仍然|强制/.test(text(n))),false);plain(tree,'failed row')
  await button(tree,'重试').props.onClick();tree=await f.settle()
  assert.equal(f.calls.filter(([m])=>m==='controlPackDownload').at(-1)[2],'resume')
  f.service.getPackDownload=async({jobId})=>({jobId,state:'failed',receivedBytes:100,totalBytes:100,speed:0,integrity:'sha256',error:{code:'DOWNLOAD_FAILED',message:''}});tree=await f.settle(4)
  assert.match(text(row()),/下载失败。请检查网络后重试，或换一个下载源/)
  await button(tree,'放弃').props.onClick();tree=await f.settle()
  assert.equal(f.calls.filter(([m])=>m==='controlPackDownload').at(-1)[2],'cancel');assert.ok(byLabel(tree,'安装 校园背景'),'back to 安装')
})

test('source settings add, toggle and remove catalogue URLs with CAS; a conflict reloads instead of overwriting',async t=>{
  const f=fixture(t,{sources:[OFFICIAL]});f.r.render(f.views.catalogue.CatalogueSourcesSheet,{binding:f.binding,adding:false,onClose(){}})
  let tree=await f.settle();assert.match(text(tree),/目录来源/);assert.match(text(tree),/官方/);assert.ok(byLabel(tree,'移除 官方素材目录') === undefined, 'the built-in source is never removed')
  byLabel(tree,'添加目录来源').props.onClick();tree=await f.settle()
  const input=()=>byLabel(tree,'目录地址')
  input().props.onChange({target:{value:'http://fans.example.net/c.json'}});tree=await f.settle();await button(tree,'添加').props.onClick();tree=await f.settle()
  assert.match(text(tree),/请输入以 https:\/\/ 开头的目录地址/);assert.equal(f.calls.some(([m])=>m==='saveCatalogueSettings'),false)
  input().props.onChange({target:{value:'https://fans.example.net/c.json'}});tree=await f.settle();await button(tree,'添加').props.onClick();tree=await f.settle()
  const add=f.calls.find(([m])=>m==='saveCatalogueSettings')[1]
  assert.equal(add.expectedRevision,'c1');assert.deepEqual(add.sources,[{sourceId:OFFICIAL.sourceId,url:OFFICIAL.url,enabled:true},{url:'https://fans.example.net/c.json',enabled:true}])
  assert.match(text(tree),/fans\.example\.net/);assert.match(text(tree),/非官方/)
  await byLabel(tree,'停用 官方素材目录').props.onClick();tree=await f.settle()
  assert.equal(f.settings().values.sources[0].enabled,false);assert.equal(f.calls.filter(([m])=>m==='saveCatalogueSettings').at(-1)[1].sources[0].sourceId,OFFICIAL.sourceId)
  f.failSave(1);const before=f.calls.filter(([m])=>m==='catalogueSettings').length
  await byLabel(tree,'启用 官方素材目录').props.onClick();tree=await f.settle()
  assert.match(text(tree),/来源设置刚在别处改过，已重新载入/);assert.ok(f.calls.filter(([m])=>m==='catalogueSettings').length>before,'reloaded after the conflict')
  byLabel(tree,'移除 fans.example.net').props.onClick();tree=await f.settle()
  assert.match(text(tree),/已安装的素材包会保留/);await button(tree,'移除').props.onClick();tree=await f.settle()
  assert.deepEqual(f.settings().values.sources.map(s=>s.url),[OFFICIAL.url])
  const mirror=walk(tree).find(n=>n.props.id==='ap-cat-mirror')
  mirror.props.onChange({target:{value:'http://proxy.example/'}});tree=await f.settle();walk(tree).find(n=>n.props.id==='ap-cat-mirror').props.onBlur();tree=await f.settle()
  assert.match(text(tree),/请输入 https 地址/)
  walk(tree).find(n=>n.props.id==='ap-cat-mirror').props.onChange({target:{value:'https://proxy.example/'}});tree=await f.settle();walk(tree).find(n=>n.props.id==='ap-cat-mirror').props.onBlur();tree=await f.settle()
  assert.equal(f.settings().values.mirrorPrefix,'https://proxy.example/');assert.match(text(tree),/加速镜像/);assert.match(text(tree),/下载时的地址会像这样 https:\/\/proxy\.example\/https:\/\/github\.com/)
  assert.doesNotMatch(text(tree),/source-official|source-new|镜像前缀|摘要/)
})

test('update: 可更新 chip → 有新版本 → one plain consequence, only edited items the author removed are listed → CAS conflict downloads again',async t=>{
  const merge={preserved:['asset/backgrounds/bg1'],removedEdited:['asset/music/m1','outfit/'+FIG+'/casual'],withoutBaseline:false,wholePackReplacement:true}
  const ready={state:'ready',receivedBytes:10,totalBytes:10,speed:0,integrity:'sha256',source:{sourceId:OFFICIAL.sourceId,official:true,version:'1.2.0',packId:PACK},
    inspection:inspection({choices:['update','keep-both','cancel'],expectedRevision:'pack-r1',current:installed(),distribution:{sourceId:OFFICIAL.sourceId,official:true,version:'1.2.0',archiveSha256:SHA,integrity:'sha256'},merge})}
  const f=fixture(t,{sources:[OFFICIAL],packs:[installed()],catalogues:{[OFFICIAL.sourceId]:snapshotOf(OFFICIAL,[cataloguePack()])},
    updates:{updates:[{packId:PACK,sourceId:OFFICIAL.sourceId,currentVersion:'1.0.0',nextVersion:'1.2.0',status:'update'}],unavailableSources:[]},script:[ready]})
  let applies=0;f.service.applyImport=async args=>{f.calls.push(['applyImport',clone(args)]);if(args.decision==='cancel')return {status:'cancelled'};applies++;throw conflict('REVISION_CONFLICT')}
  f.r.render(f.views.Home,{binding:f.binding});let tree=await f.settle(3)
  assert.equal(f.calls.filter(([m])=>m==='checkPackUpdates').length,1)
  const chip=byLabel(tree,'更新 校园背景');assert.match(text(chip),/可更新/);chip.props.onClick();tree=await f.settle()
  assert.match(text(tree),/有新版本/);assert.match(text(tree),/校园背景/);assert.match(text(tree),/1\.0\.0 +1\.2\.0/);plain(tree,'update sheet')
  await button(tree,'更新到 1.2.0').props.onClick();tree=await f.settle(3)
  const body=text(tree);assert.match(body,/更新素材包/);assert.match(body,/官方素材 · 文件完整/);assert.match(body,/1\.0\.0 +1\.2\.0/)
  assert.match(body,/新版本会替换整个素材包。你开关过的条目和触发设置会保留，其它改动（比如改过的名字、备注）会换成作者的版本。/)
  assert.match(body,/更新后，下面这些你改过的内容会消失：/);assert.doesNotMatch(body,/\d+ 项/,'private fork (r3): no count of the list');assert.match(body,/旧曲/);assert.match(body,/小圆 · 便服/)
  assert.doesNotMatch(body,/教室/,'kept items are not listed');plain(tree,'update review')
  await button(tree,'更新').props.onClick();tree=await f.settle()
  // private fork (r3 brevity): the band does not repeat its 「重新下载」 button.
  assert.equal(applies,1);assert.match(text(tree),/这个素材包刚在别处被改过。为了不覆盖那些改动，这次没有更新。/);assert.equal(button(tree,'更新').props.disabled,true,'never overwrites')
  await button(tree,'重新下载').props.onClick();tree=await f.settle()
  assert.deepEqual(f.calls.filter(([m])=>m==='applyImport').map(c=>c[1].decision),['update','cancel'])
  assert.equal(f.calls.find(([m])=>m==='applyImport')[1].acceptScriptRisk,false)
  const starts=f.calls.filter(([m])=>m==='startPackDownload').map(c=>c[1]);assert.equal(starts.length,2);assert.deepEqual(starts[1],starts[0])
})

test('download sheet: pause, resume, a plain failure without a force option, and abandon',async t=>{
  const f=fixture(t,{script:[{state:'downloading',receivedBytes:30,totalBytes:100,speed:10,integrity:'sha256',downloadUrl:'https://cdn.example.org/a.zip',source:null}]})
  const jobId=await f.views.catalogue.startCatalogueDownload(f.binding,{mode:'url',label:'a.zip',input:{url:'https://cdn.example.org/a.zip'}}) // private fork (library toolbar): no user fingerprint
  let closed=0;f.r.render(f.views.catalogue.CatalogueJobSheet,{binding:f.binding,jobId,onClose:()=>closed++,onInstalled(){},onRetry(){}});let tree=await f.settle()
  assert.match(text(tree),/30 B \/ 100 B/);assert.equal(walk(tree).find(n=>n.props.role==='progressbar').props['aria-valuenow'],30);plain(tree,'download')
  await button(tree,'暂停').props.onClick();tree=await f.settle();assert.match(text(tree),/已暂停/)
  await button(tree,'继续').props.onClick();tree=await f.settle()
  assert.deepEqual(f.calls.filter(([m])=>m==='controlPackDownload').map(c=>c[2]),['pause','resume'])
  f.service.getPackDownload=async()=>({jobId,state:'failed',receivedBytes:100,totalBytes:100,speed:0,integrity:'sha256',error:{code:'INTEGRITY_MISMATCH',message:'ZIP SHA-256 mismatch'}})
  tree=await f.settle(3)
  assert.match(text(tree),/下载到的文件和发布的不一样，可能已损坏或被改动过，不能安装/);assert.equal(walk(tree).some(n=>/仍然|强制/.test(text(n))),false);plain(tree,'failed download')
  await button(tree,'放弃').props.onClick();tree=await f.settle()
  assert.equal(f.calls.filter(([m])=>m==='controlPackDownload').at(-1)[2],'cancel');assert.equal(closed,1)
})

// private fork (library export, owner 2026-10): the 素材库's batch export is one 素材包合集 ZIP. 「获取素材包」 takes it like any
// pack ZIP (a picked / dropped file, or a link) and installs it pack by pack through the one install sheet — every check and
// choice unchanged, the title counting 「1/2」; 取消 skips only that pack, and packs never reached are discarded.
const packSet=()=>{const second=inspection({inspectionId:'insp-2',packId:NEW,incoming:{manifest:{id:NEW,name:'和风神社',assets:[],figures:[]},figures:{},sprites:{},widgets:{}}})
  return {kind:'pack-set',inspectionId:'set-1',uploadHash:SHA,expiresAt:Date.now()+9e5,packs:[inspection(),second]}}
test('a 素材包合集 ZIP picked in 获取素材包 installs pack by pack through the install sheet (1/2, 2/2); 取消 skips one',async t=>{
  const f=fixture(t,{capable:false});f.service.inspectImport=async args=>{f.calls.push(['inspectImport',Object.keys(args)]);return packSet()}
  f.r.render(f.views.Home,{binding:f.binding});let tree=await f.settle()
  byLabel(tree,'获取素材包').props.onClick();tree=await f.settle()
  walk(tree).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'asset-packs-2.zip',size:9,arrayBuffer:async()=>new ArrayBuffer(9)}],value:'x'}});tree=await f.settle(3)
  const dialogs=()=>walk(tree).filter(n=>n.props.role==='dialog').map(n=>n.props['aria-label'])
  assert.deepEqual(dialogs(),['安装素材包 1/2'],'the first pack of the set, in the ordinary install sheet');assert.match(text(tree),/校园背景/);plain(tree,'set 1/2')
  await button(tree,'安装').props.onClick();tree=await f.settle(3)
  assert.deepEqual(dialogs(),['安装素材包 2/2']);assert.match(text(tree),/和风神社/)
  await button(tree,'取消').props.onClick();tree=await f.settle(3)
  assert.deepEqual(dialogs(),[],'done after the last pack')
  const applied=f.calls.filter(([m])=>m==='applyImport').map(([,a])=>[a.inspectionId,a.decision])
  assert.deepEqual(applied.filter(([,d])=>d!=='cancel'),[['insp-1','install']]);assert.ok(applied.some(([id,d])=>id==='insp-2'&&d==='cancel'))
  assert.equal(applied.some(([id])=>id==='set-1'),false,'the set id is never applied')
})
test('a link to a 素材包合集: the finished download walks its packs; closing early discards the packs not reached',async t=>{
  const f=fixture(t,{script:[{state:'ready',receivedBytes:9,totalBytes:9,speed:0,downloadUrl:'https://cdn.example.org/asset-packs-2.zip',integrity:'unverified',source:null,inspection:packSet()}]})
  const jobId=await f.views.catalogue.startCatalogueDownload(f.binding,{mode:'url',label:'asset-packs-2.zip',input:{url:'https://cdn.example.org/asset-packs-2.zip'}})
  let done=null,closed=0;f.r.render(f.views.catalogue.CatalogueJobSheet,{binding:f.binding,jobId,onClose:()=>closed++,onInstalled:r=>{done=r},onRetry(){}});let tree=await f.settle(3)
  const dialogs=()=>walk(tree).filter(n=>n.props.role==='dialog').map(n=>n.props['aria-label'])
  assert.deepEqual(dialogs(),['安装素材包 1/2']);assert.match(text(tree),/非官方来源/,'each pack keeps the link warning')
  await button(tree,'安装').props.onClick();tree=await f.settle(3);assert.deepEqual(dialogs(),['安装素材包 2/2'])
  await button(tree,'安装').props.onClick();tree=await f.settle(3)
  assert.equal(done?.status,'installed');assert.equal(closed,0)
  assert.deepEqual(f.calls.filter(([m,a])=>m==='applyImport'&&a.decision!=='cancel').map(([,a])=>a.inspectionId),['insp-1','insp-2'])
  // A second set left on its first pack (the library closes): that pack is cancelled by its sheet, the one never reached is discarded too.
  const g=fixture(t,{script:[{state:'ready',receivedBytes:9,totalBytes:9,speed:0,downloadUrl:'https://cdn.example.org/asset-packs-2.zip',integrity:'unverified',source:null,inspection:packSet()}]})
  const again=await g.views.catalogue.startCatalogueDownload(g.binding,{mode:'url',label:'asset-packs-2.zip',input:{url:'https://cdn.example.org/asset-packs-2.zip'}})
  g.r.render(g.views.catalogue.CatalogueJobSheet,{binding:g.binding,jobId:again,onClose(){},onInstalled(){},onRetry(){}});tree=await g.settle(3)
  assert.deepEqual(dialogs(),['安装素材包 1/2'])
  g.r.dispose();await sleep(20)
  assert.deepEqual([...new Set(g.calls.filter(([m])=>m==='applyImport').map(([,a])=>a.inspectionId+':'+a.decision))].sort(),['insp-1:cancel','insp-2:cancel'])
})
for(const mode of ['pick','drop'])test('private fork: several collection files '+mode+' sequentially, without retaining several archive previews',async t=>{
  const f=fixture(t,{capable:false});let reads=0
  f.service.inspectImport=async()=>{reads++;return reads===1?packSet():inspection({inspectionId:'next-file',packId:NEW})}
  f.r.render(f.views.Home,{binding:f.binding});let tree=await f.settle()
  byLabel(tree,'获取素材包').props.onClick();tree=await f.settle()
  const files=[1,2].map(i=>({name:'素材包合集-'+i+'of2.zip',size:9,arrayBuffer:async()=>new ArrayBuffer(9)}))
  const input=walk(tree).find(n=>n.type==='input'&&n.props.type==='file')
  assert.equal(input.props.multiple,true) // private fork
  if(mode==='pick')input.props.onChange({target:{files,value:'selected'}})
  else walk(tree).find(n=>n.props.onDrop).props.onDrop({preventDefault(){},dataTransfer:{files,types:['Files']}})
  tree=await f.settle(3)
  assert.equal(reads,1) // private fork
  await button(tree,'安装').props.onClick();tree=await f.settle(3)
  assert.equal(reads,1) // private fork: second pack of the first archive still awaits confirmation.
  await button(tree,'取消').props.onClick();tree=await f.settle(3)
  assert.equal(reads,2) // private fork
  await button(tree,'安装').props.onClick();tree=await f.settle(3)
  assert.equal(walk(tree).filter(n=>n.props.role==='dialog').length,0) // private fork
  assert.deepEqual(f.calls.filter(([method,args])=>method==='applyImport'&&args.decision==='install').map(([,args])=>args.inspectionId),['insp-1','next-file']) // private fork
})