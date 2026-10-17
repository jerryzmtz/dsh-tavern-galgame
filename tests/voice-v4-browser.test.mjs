// private fork: real Chromium, production controls, mocked authenticated transport; never live RPC/TTS.
// private fork: isolated browser source includes the native emotion resolver.
import {withSpriteEmotionSource} from './helpers/sprite-emotion-source.mjs'
import test from 'node:test'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'
const read=name=>readFile(new URL('../tavern-plugin/'+name,import.meta.url),'utf8')
async function fixture(t){
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
 let source=await read('src/client/fork-asset-pack-ui.js')
 for(const [tag,file]of [['// @include-shared asset-image-publication.cjs','shared/asset-image-publication.cjs'],['// @include-shared figure-auto-color.cjs','shared/figure-auto-color.cjs'],['// @include-domain pack-avatar.cjs','lib/domain/pack-avatar.cjs'],['// @include-protocol director-commands.cjs','packages/dsh-presentation-protocol/src/director-commands.cjs']])source=withSpriteEmotionSource(source.split(tag).join(await read(file)))
 // private fork (voice v4 P1): the figure voice page is its own included module.
 for(const name of ['figure','spine','import','voice','card','opening','character','engine','entry','cg','catalogue','setup','gen'])source=source.split('// @include fork-asset-pack-'+name+'-ui.js').join(await read('src/client/fork-asset-pack-'+name+'-ui.js'))
 for(const name of ['fork-widget-contracts.cjs','fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js'] /* private fork: mod library lives inside the pack UI closure */)source=source.replace('// @include '+name,()=>included[name])
 new vm.Script(source)
 await page.setContent('<!doctype html><main class="ap-ui"><div id="root"></div></main>')
 await page.addStyleTag({content:await read('lib/client-assets/fork-theme.css')})
 await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM=modules["react-dom/client"];\n'+forkSpinnerSource+'\n'+source+`
  window.calls=[];window.root=ReactDOM.createRoot(document.getElementById('root'));window.views=createForkAssetPackUI(React);
  window.Audio=class{play(){return Promise.resolve()}pause(){}};
  window.binding={rpc:async(method,args)=>{calls.push([method,args]);if(method==='listFigureVoiceChoices')return{voices:[]};if(method==='openFigureVoicePreview')return{scope:'preview',voice:{source:'saved',id:'voice'},language:'ja'};if(method==='closeFigureVoicePreview')return{};if(method==='getAssetPackDependencies')return{available:true,count:1};throw Error(method)},tts:{synthesize:async input=>{calls.push(['synthesize',input]);return{ticket:'mock'}},audioUrl:()=>''},service:{}};
 `})
 assert.deepEqual(errors,[])
 return{page,errors}
}
const included={};for(const name of ['fork-widget-contracts.cjs','fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js'] /* private fork: mod library lives inside the pack UI closure */)included[name]=await read('src/client/'+name)
// private fork (voice v4 P1): the P0 figure voice picker (FigureVoice) is replaced by the figure voice page; its
// pasted-ID, language and explicit-preview checks live in tests/voice-p1-ui.test.mjs (scenarios A–H, billing gate).
test('ordinary and card imports cannot publish local fallback before explicit confirmation',async t=>{
 const{page,errors}=await fixture(t)
 for(const card of [false,true]){
  await page.evaluate(card=>{
   window.calls=[];const row={packId:'pack',incoming:{manifest:{name:'Incoming'}},current:null,choices:['install','cancel'],scriptRisk:[],diff:Object.fromEntries(['assets','figures','files'].map(k=>[k,{added:[],changed:[],removed:[]}])),voiceChanges:[{figureId:'figure',from:'local',to:'fish',reason:'LOCAL_UNAVAILABLE'}]}
   binding.service={inspectCardBundle:async()=>({inspectionId:'card-inspection',packs:[row],raw:{}}),applyImport:async args=>{calls.push(['apply',args]);return{snapshot:{manifest:{id:'pack'}}}},applyCardBundle:async args=>{calls.push(['apply',args]);return{mappings:[{from:'pack',packId:'pack'}]}},getPackSnapshot:async()=>({manifest:{id:'pack',figures:[]},figures:{}}),previewCardBundleDecisions:async()=>({scriptRisk:[]})}
   // private fork: exercise the catalogue's actual split sheets, not the removed card ConflictDialog.
   root.render(React.createElement(card?views.CardImportSheet:views.ConflictDialog,{key:String(card),binding,file:{name:'card.zip',arrayBuffer:async()=>new ArrayBuffer(0)},preview:{inspectionId:'pack-inspection',expectedRevision:'r1',...row},onDone:()=>calls.push(['done']),onClose:()=>{}}))
  },card)
  await page.getByRole('dialog',{name:card?'导入卡片':'安装素材包',exact:true}).waitFor()
  const confirm=page.getByRole('button',{name:card?'导入':'安装',exact:true});await confirm.waitFor()
  assert.equal(await confirm.isDisabled(),true)
  assert.equal(await page.evaluate(()=>calls.some(c=>c[0]==='apply'&&c[1].decision!=='cancel'&&!c[1].cancel)),false)
  await page.getByRole('checkbox',{name:/确认这些人物声音变化/}).check();await confirm.click()
  await page.waitForFunction(()=>calls.some(c=>c[0]==='done'))
  assert.equal(await page.evaluate(()=>calls.find(c=>c[0]==='apply'&&c[1].acceptVoiceFallback)?.[1].acceptVoiceFallback),true)
 }
 assert.deepEqual(errors,[])
})
