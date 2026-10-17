// private fork (card-zip-entry; new-user journey 2026-10): one 「导入人物卡」 for card files and card ZIPs, plus 「从网址导入卡」.
// Real Chromium, the production entry (fork-card-zip-entry.js) around a host-shaped card library that uses its `forkCardZip`
// prop the way card-library.js does, the production 导入卡片 / 从网址导入卡 sheets over a mocked pack service; never live RPC.
// SHOTS=<dir> also writes screenshots (dark / light × 1600 / 375).
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'
const read=name=>readFile(new URL('../tavern-plugin/'+name,import.meta.url),'utf8')
async function packUiSource(){
 let source=await read('src/client/fork-asset-pack-ui.js')
 for(const [tag,file]of [['// @include-shared asset-image-publication.cjs','shared/asset-image-publication.cjs'],['// @include-shared figure-auto-color.cjs','shared/figure-auto-color.cjs'],['// @include-domain pack-avatar.cjs','lib/domain/pack-avatar.cjs'],['// @include-protocol director-commands.cjs','packages/dsh-presentation-protocol/src/director-commands.cjs']])source=source.split(tag).join(await read(file))
 // Every client include the pack UI pulls in, nested ones too (the build's own @include rule).
 for(let match;(match=source.match(/\/\/ @include ([\w.-]+)/));){const body=await read('src/client/'+match[1]);source=source.replace(match[0],()=>'\n'+body)}
 return source
}
async function fixture(t,{width=1600,height=900,theme='dark'}={}){
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
 const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(String(e)))
 await page.setContent(`<!doctype html><html data-theme="${theme}"><body class="${theme}" style="margin:0;background:${theme==='dark'?'#1b1b1c':'#f6f6f7'}"><aside id="pane" style="width:min(420px,100vw);height:100vh;margin-left:auto;display:flex;flex-direction:column;overflow:auto"><div id="root" style="display:flex;flex-direction:column;min-height:0"></div></aside></body></html>`)
 await page.addStyleTag({content:await read('lib/client-assets/tavern.css')})
 await page.addStyleTag({content:await read('lib/client-assets/fork-theme.css')})
 await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM=modules["react-dom"],ReactDOMClient=modules["react-dom/client"];\n'+forkSpinnerSource+'\n'+await packUiSource()+'\n'+await read('src/client/fork-card-zip-entry.js')+`
  window.calls=[];window.views=createForkAssetPackUI(React);
  const raw={spec:'chara_card_v2',data:{name:'巫女日记',extensions:{dsh_tavern:{assetBindings:{boundPackIds:[]}}}}};
  window.urlFailure=null;
  window.binding={rpc:async()=>({}),service:{
   inspectCardBundleUrl:async args=>{calls.push(['url',args.url]);if(urlFailure)throw urlFailure;return{inspectionId:'card-preview',expectedRevision:null,packs:[],raw,currentRaw:null}},
   inspectCardBundle:async args=>{calls.push(['inspect',args.path]);return{inspectionId:'card-preview',expectedRevision:null,packs:[],raw,currentRaw:null}},
   previewCardBundleDecisions:async()=>({mappings:[],scriptRisk:[],cardWidgetRisks:[],raw}),
   applyCardBundle:async args=>{calls.push(['apply',args.cancel?'cancel':'commit']);return args.cancel?{status:'cancelled'}:{status:'committed',mappings:[]}},
   getPackSnapshot:async()=>({manifest:{id:'p',figures:[]},figures:{}})}};
  window.target={reserve:async file=>{calls.push(['reserve',file?.name || 'URL']);return{path:'cards/巫女日记.json',release:async()=>calls.push(['release'])}}};
  // The host tab, shaped like card-library.js: 「导入人物卡」 takes .png/.json/.zip (ZIPs go to forkCardZip.openFile), and
  // 「从网址导入卡」 sits beside it while the entry is available.
  function Host(props){const h=React.createElement,input=React.useRef(null),zip=props.forkCardZip&&props.forkCardZip.available?props.forkCardZip:null,[status,setStatus]=React.useState('');
   if(props.forkCardZip&&props.forkCardZip.pickerRef)props.forkCardZip.pickerRef.current=()=>input.current&&input.current.click();
   async function pick(files){const split=zip?await forkSplitCardFiles(files):{cards:files,zips:[]};calls.push(['host-cards',split.cards.map(f=>f.name)]);if(split.zips.length)zip.openFile(split.zips[0]).catch(e=>setStatus(e.message));}
   return h('div',{className:'dsh-tavern-library dsh-tavern-card-library'},
    h('div',{className:'dsh-tavern-status-head'},h('div',{className:'dsh-tavern-status-title'},'人物卡库'),h('div',{className:'dsh-tavern-question-sub'},'3 张人物卡'),
     h('div',{className:'dsh-tavern-library-head-actions'},h('button',{className:'dsh-tavern-btn primary',onClick:()=>input.current.click()},'导入人物卡'),
      zip?h('button',{type:'button',className:'dsh-tavern-btn fork-card-url-import',disabled:zip.busy,onClick:zip.openUrl},'从网址导入卡'):null,
      h('input',{ref:input,type:'file',multiple:true,accept:zip?'.png,.json,.zip':'.png,.json',style:{display:'none'},onChange:e=>{const files=Array.from(e.target.files||[]);e.target.value='';pick(files);}}))),
    h('div',{className:'dsh-tavern-question-sub dsh-tavern-card-import-hint',role:'status'},status||(zip?'可多选 PNG、JSON 人物卡，也可以选卡片 ZIP':'支持多选 PNG、JSON 人物卡一起导入')),
    h('div',{className:'dsh-tavern-resource-body'},['巫女日记','灯塔小镇','雨夜来信'].map(name=>h('div',{key:name,className:'dsh-tavern-library-card-row'},h('button',{className:'dsh-tavern-library-card'},name)))));}
  window.sidebar={updateTab:(id,patch)=>calls.push(['updateTab',id,patch])};
  window.mount=target=>{window.reactRoot?.unmount();window.reactRoot=ReactDOMClient.createRoot(document.getElementById('root'));
   reactRoot.render(React.createElement(ForkCardLibraryWithZip,{host:Host,hostProps:{scope:{sessionId:''},tab:{id:'cards-tab'},ctx:{betterSidebar:sidebar}},target,binding,views}));};
 `})
 assert.deepEqual(errors,[])
 return {page,errors}
}
const zip={name:'巫女日记.zip',mimeType:'application/zip',buffer:Buffer.from('PK\x03\x04')}
const png={name:'灯塔小镇.png',mimeType:'image/png',buffer:Buffer.from('\x89PNG')}
const shots=process.env.SHOTS
async function shot(page,name){if(!shots)return;await mkdir(shots,{recursive:true});await page.waitForTimeout(200);await page.screenshot({path:path.join(shots,name+'.png')})}
async function pickFiles(page,files){const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入人物卡'}).click();await (await chooser).setFiles(files)}
async function readUrl(page,url){
 await page.getByRole('button',{name:'从网址导入卡',exact:true}).click()
 const sheet=page.getByRole('dialog',{name:'从网址导入卡',exact:true});await sheet.waitFor()
 await page.getByLabel('卡片下载地址').fill(url)
 await page.getByRole('button',{name:'读取',exact:true}).click()
 return sheet
}

test('no new-card target: the host renders unchanged, no 从网址导入卡, card files only',async t=>{
 const {page,errors}=await fixture(t)
 await page.evaluate(()=>mount(null))
 await page.getByRole('button',{name:'导入人物卡'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'从网址导入卡'}).count(),0)
 assert.equal(await page.locator('input[type=file]').getAttribute('accept'),'.png,.json')
 assert.deepEqual(errors,[])
})

test('one 「导入人物卡」: card files stay with the host, a card ZIP opens 导入卡片; cancel releases, done opens the card',async t=>{
 const {page,errors}=await fixture(t)
 await page.evaluate(()=>mount(target))
 await page.getByRole('button',{name:'从网址导入卡'}).waitFor()
 assert.deepEqual(await page.locator('.dsh-tavern-library-head-actions > button').allTextContents(),['导入人物卡','从网址导入卡'])
 assert.equal(await page.locator('input[type=file]').getAttribute('accept'),'.png,.json,.zip')
 await shot(page,'01-entry')
 await pickFiles(page,[png,zip])
 const sheet=page.getByRole('dialog',{name:'导入卡片',exact:true});await sheet.waitFor()
 await page.getByRole('button',{name:'导入',exact:true}).waitFor()
 const first=await page.evaluate(()=>calls.slice(0,3))
 assert.deepEqual(first,[['host-cards',['灯塔小镇.png']],['reserve','巫女日记.zip'],['inspect','cards/巫女日记.json']])
 await shot(page,'02-sheet')
 await page.getByRole('button',{name:'取消',exact:true}).click()
 await sheet.waitFor({state:'detached'})
 await page.waitForFunction(()=>calls.some(c=>c[0]==='release'))
 // Second run: import.
 await page.evaluate(()=>{calls.length=0})
 await pickFiles(page,[zip])
 await page.getByRole('button',{name:'导入',exact:true}).click()
 await page.waitForFunction(()=>calls.some(c=>c[0]==='updateTab'))
 const log=await page.evaluate(()=>calls)
 assert.deepEqual(log.find(c=>c[0]==='updateTab'),['updateTab','cards-tab',{meta:{cardPath:'cards/巫女日记.json'}}])
 assert.equal(log.some(c=>c[0]==='release'),false)
 assert.equal(await sheet.count(),0)
 assert.deepEqual(errors,[])
})

test('a renamed ZIP is recognised by its header; PNG / JSON are never sniffed',async t=>{
 const {page,errors}=await fixture(t)
 const kinds=await page.evaluate(async()=>{
  const file=(name,bytes)=>new File([new Uint8Array(bytes)],name)
  return Promise.all([file('card.zip',[0]),file('download',[0x50,0x4b,3,4,9]),file('card.png',[0x50,0x4b,3,4]),file('card.json',[0x7b]),file('notes.txt',[0x41,0x42,0x43,0x44])].map(forkIsCardZip))
 })
 assert.deepEqual(kinds,[true,true,false,false,false])
 assert.deepEqual(errors,[])
})

test('从网址导入卡: an address that cannot be read says why before anything is reserved; a good one previews and imports on confirm',async t=>{
 const {page,errors}=await fixture(t);await page.evaluate(()=>mount(target))
 await page.getByRole('button',{name:'从网址导入卡',exact:true}).click()
 const sheet=page.getByRole('dialog',{name:'从网址导入卡',exact:true});await sheet.waitFor()
 // Focus starts in the address field.
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'卡片下载地址')
 await page.getByRole('button',{name:'读取',exact:true}).click()
 await sheet.getByRole('alert').filter({hasText:'请粘贴卡片的下载地址'}).waitFor()
 await shot(page,'03-url-empty')
 for(const [value,problem] of [['TODO(owner): 正式地址','这不是网址，请粘贴以 https:// 开头的下载地址'],['http://example.com/card.zip','只支持 https:// 开头的地址'],['https://me:pw@example.com/card.zip','地址里不能带账号或密码']]){
  await page.getByLabel('卡片下载地址').fill(value);await page.getByLabel('卡片下载地址').press('Enter')
  await sheet.getByRole('alert').filter({hasText:problem}).waitFor()
 }
 assert.equal(await page.evaluate(()=>calls.length),0)
 await page.getByLabel('卡片下载地址').fill('https://github.com/example/cards/releases/download/v1/card.zip#readme')
 await page.getByLabel('卡片下载地址').press('Enter')
 await page.getByRole('button',{name:'导入',exact:true}).waitFor()
 assert.equal(await sheet.count(),0)
 assert.deepEqual(await page.evaluate(()=>calls.slice(0,2)),[['reserve','URL'],['url','https://github.com/example/cards/releases/download/v1/card.zip']])
 assert.equal(await page.evaluate(()=>calls.some(c=>c[0]==='apply'&&c[1]==='commit')),false)
 await page.getByRole('button',{name:'导入',exact:true}).click()
 await page.waitForFunction(()=>calls.some(c=>c[0]==='apply'&&c[1]==='commit'))
 assert.deepEqual(errors,[])
})

test('从网址导入卡 failures: 404 / 403 / no network / not a card / too large are worded, with the right way out',async t=>{
 const {page,errors}=await fixture(t);await page.evaluate(()=>mount(target))
 const url='https://github.com/example/cards/releases/download/v1/dafeiyu.card-bundle.zip'
 await page.evaluate(()=>{urlFailure=Object.assign(new Error('DOWNLOAD_FAILED'),{code:'DOWNLOAD_FAILED',detail:'Catalogue HTTP request failed (HTTP 404)'})})
 await readUrl(page,url)
 const card=page.getByRole('dialog',{name:'导入卡片',exact:true});await card.waitFor()
 await card.getByRole('alert').filter({hasText:'这个网址找不到文件（404）。请检查地址是否完整、文件是否还在。'}).waitFor()
 // The name is the address's file name, not 「未命名」.
 assert.equal(await card.locator('.ap-cat-hero-name').textContent(),'dafeiyu.card-bundle')
 await shot(page,'04-url-404')
 // 「换一个网址」 returns to the address sheet with the address kept; the reservation is released.
 await card.getByRole('button',{name:'换一个网址',exact:true}).click()
 const sheet=page.getByRole('dialog',{name:'从网址导入卡',exact:true});await sheet.waitFor()
 assert.equal(await page.getByLabel('卡片下载地址').inputValue(),url)
 await page.waitForFunction(()=>calls.some(c=>c[0]==='release'))
 await page.getByRole('button',{name:'取消',exact:true}).click();await sheet.waitFor({state:'detached'})
 const cases=[
  [{code:'DOWNLOAD_FAILED',detail:'Catalogue HTTP request failed (HTTP 403)'},'这个网址不让下载（403）。请确认文件是公开的。','换一个网址'],
  [{code:'DOWNLOAD_FAILED',detail:'Network request failed (ENOTFOUND)'},'连不上这个网址。请检查网络，或确认地址能在浏览器里打开。','重试'],
  [{code:'DOWNLOAD_FAILED',detail:'Download timed out'},'下载超时。请检查网络后重试。','重试'],
  [{code:'DOWNLOAD_FAILED',detail:'Catalogue HTTP request failed (HTTP 503)'},'对方服务器出错了（503），请稍后重试。','重试'],
  [{code:'INVALID_INPUT'},'下载到的不是卡片 ZIP。请确认地址直接指向 .zip 文件，而不是网页。','换一个网址'],
  [{code:'LIMIT_EXCEEDED'},'文件太大（上限 256 MB），或者暂存空间不够。','换一个网址']]
 for(const [failure,text,action] of cases){
  await page.evaluate(failure=>{urlFailure=Object.assign(new Error(failure.code),failure)},failure)
  await readUrl(page,url);await card.waitFor()
  await card.getByRole('alert').filter({hasText:text}).waitFor()
  assert.equal(await card.getByRole('button',{name:action,exact:true}).count(),1,text)
  await card.getByRole('button',{name:'关闭',exact:true}).first().click();await card.waitFor({state:'detached'})
 }
 // 重试 reads the same address again.
 await page.evaluate(()=>{urlFailure=Object.assign(new Error('DOWNLOAD_FAILED'),{code:'DOWNLOAD_FAILED',detail:'Network request failed (ECONNRESET)'});calls.length=0})
 await readUrl(page,url);await card.getByRole('button',{name:'重试',exact:true}).click()
 await page.waitForFunction(()=>calls.filter(c=>c[0]==='url').length===2)
 assert.deepEqual(errors,[])
})

if(shots)test('screenshots: light and phone',async t=>{
 for(const [theme,width,height] of [['light',1600,900],['dark',375,812],['light',375,812]]){
  const {page}=await fixture(t,{theme,width,height});await page.evaluate(()=>mount(target))
  await page.getByRole('button',{name:'从网址导入卡'}).waitFor();await shot(page,`01-entry-${theme}-${width}`)
  await page.getByRole('button',{name:'从网址导入卡'}).click();await page.getByLabel('卡片下载地址').waitFor();await shot(page,`03-url-${theme}-${width}`)
  await page.evaluate(()=>{urlFailure=Object.assign(new Error('DOWNLOAD_FAILED'),{code:'DOWNLOAD_FAILED',detail:'Catalogue HTTP request failed (HTTP 404)'})})
  await page.getByLabel('卡片下载地址').fill('https://github.com/example/cards/releases/download/v1/dafeiyu.card-bundle.zip')
  await page.getByRole('button',{name:'读取',exact:true}).click()
  await page.getByRole('button',{name:'换一个网址'}).waitFor();await shot(page,`04-url-404-${theme}-${width}`)
 }
})
