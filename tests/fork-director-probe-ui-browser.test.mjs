// private fork (director probe, owner 2026-10): 舞台模式 › 导演模型 — 「测试连接」 beside the model menu (the 智能判断 test's
// look and flow) and the menu greying a model whose stored test found no tool calling (docs/fork/director-probe.md). Fake
// RPCs only: no model is ever called. Shots go to .tmp/director-probe-ui (1600×900 and 375).
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'
import {stageSource,THEMES} from './harness/card-centric-stage.mjs'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'

const root=fileURLToPath(new URL('../',import.meta.url)),outDir=path.join(root,'.tmp/director-probe-ui')
const key=(provider,model)=>JSON.stringify([provider,model])

function mock({values,support}) {
  window.calls=[];window.support=support;window.values=values;window.nextTest=null
  const clone=v=>JSON.parse(JSON.stringify(v))
  const engine=()=>({revision:'r'+window.calls.filter(([m])=>m==='saveAssetEngineSettings').length,writable:true,values:clone(window.values)})
  const rpc=async(method,args)=>{
    window.calls.push([method,clone(args??null)])
    if(method==='getAssetEngineSettings')return engine()
    if(method==='saveAssetEngineSettings'){Object.assign(window.values,args.patch);return engine()}
    if(method==='getAssetVoiceServices')return {services:[]}
    if(method==='getTavernSettings')return {modelCatalog:[{provider:'openai',providerName:'OpenAI',models:[{id:'gpt-6-luna',name:'GPT-6 Luna'},{id:'text-only',name:'Text Only'},{id:'fresh',name:'Fresh'}]}]}
    if(method==='getDirectorToolSupport')return {models:clone(window.support)}
    if(method==='getJudgeCredentialStatus')return {configured:false,source:null}
    if(method==='testDirectorConnection'){
      await new Promise(r=>setTimeout(r,300))
      const sel=args.selection&&typeof args.selection==='object'?args.selection:{provider:'openai',model:'gpt-6-luna'},k=JSON.stringify([sel.provider,sel.model])
      if(window.nextTest==='connection')return {ok:false,selection:sel,latencyMs:41,error:{code:'DIRECTOR_CONNECTION_ERROR',message:'连接失败，请检查模型配置后重试'}}
      const supported=sel.model!=='text-only';window.support[k]=supported
      return {ok:supported,supported,selection:sel,latencyMs:812,...(supported?{}:{error:{code:'DIRECTOR_NO_TOOL_CALL',message:'导演模型没有调用工具，请换一个支持工具调用的模型'}})}
    }
    throw new Error('unexpected '+method)
  }
  const ui=createForkAssetPackUI(React,{HelpTip:window.ForkHelpTip})
  window.binding={rpc:(m,a)=>rpc(m,{...a,sessionId:'s1'}),engineRpc:rpc}
  window.reactRoot?.unmount();window.reactRoot=ReactDOMClient.createRoot(document.getElementById('root'));window.reactRoot.render(React.createElement(ui.EnginePage,{binding:window.binding,onBack(){}}))
}

test('导演模型: 测试连接 shows tool support or the connection error; the menu greys a no-tool model and keeps untested ones',async t=>{
  await mkdir(outDir,{recursive:true})
  const {source}=await stageSource(),css=await forkThemeCss()
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  for(const [size,viewport] of [['1600',{width:1600,height:900}],['375',{width:375,height:812}]]){
    const page=await browser.newPage({viewport,deviceScaleFactor:size==='375'?2:1}),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.route('http://stage.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body class="dsh-tavern-shell-active"><div class="pane"><div id="root" class="ap-ui"></div></div></body></html>'}))
    await page.goto('http://stage.test/')
    await page.addStyleTag({content:css+`html,body{margin:0}body{${THEMES.dark}background:var(--page);font-family:"Microsoft YaHei UI","PingFang SC",sans-serif}.pane{width:${size==='375'?'100%':'720px'};box-sizing:border-box;padding:12px;background:#0b0b0c;container-type:inline-size}`})
    await page.evaluate(()=>{document.body.dataset.fkContext='chat-dark'})
    await page.addScriptTag({content:await browserReactScript()+';window.React=modules.react;window.ReactDOM={...modules["react-dom/client"],createPortal:modules["react-dom"].createPortal};window.ReactDOMClient=modules["react-dom/client"];'+source})
    await page.evaluate(mock,{values:{...defaultAssetEngineSettings(),directorModel:{provider:'openai',model:'gpt-6-luna'}},support:{[key('openai','text-only')]:false}})
    const section=page.locator('.ap-engine-model-section'),menu=section.getByRole('button',{name:/^模型：/}),button=section.getByRole('button',{name:'测试连接',exact:true})
    const result=section.locator('.ap-judge-test-result')
    await button.waitFor()

    // The menu: the stored no-tool model is disabled with its reason; untested and supported models stay selectable.
    await menu.click()
    const off=page.getByRole('menuitemradio',{name:/Text Only/})
    assert.equal(await off.isDisabled(),true)
    assert.equal((await off.innerText()).replace(/\s+/g,' ').trim(),'Text Only 不支持工具调用')
    assert.equal(await page.getByRole('menuitemradio',{name:'Fresh',exact:true}).isDisabled(),false)
    assert.equal(await page.getByRole('menuitemradio',{name:/GPT-6 Luna/}).isDisabled(),false)
    assert.ok(!/费用|成本|价格|计费/.test(await page.locator('.fork-inline-pop').innerText()),'nothing about cost')
    // Keyboard: ↓ skips the disabled model.
    await page.getByRole('menuitemradio',{name:/GPT-6 Luna/}).focus()
    await page.keyboard.press('ArrowDown')
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Fresh')
    await page.locator('.fork-inline-pop').screenshot({path:path.join(outDir,`menu-${size}.png`)})
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.fork-inline-pop').count(),0)

    // Supported: running → 「支持工具调用 ✓」 + latency; the call names the menu's model and goes with the session.
    await button.click()
    await section.getByRole('status').filter({hasText:'正在测试'}).waitFor()
    assert.equal(await button.isDisabled(),true)
    await section.locator('.ap-judge-test-result.is-ok').waitFor()
    assert.equal((await result.innerText()).replace(/\s+/g,' ').trim(),'支持工具调用 · 812 毫秒')
    assert.equal(await result.locator('.ap-glyph').count(),1)
    const sent=await page.evaluate(()=>window.calls.filter(([m])=>m==='testDirectorConnection').at(-1)[1])
    assert.deepEqual(sent,{selection:{provider:'openai',model:'gpt-6-luna'},sessionId:'s1'})
    await page.locator('.pane').screenshot({path:path.join(outDir,`supported-${size}.png`)})

    // Connection error: the message, no re-read of the stored support.
    const reads=()=>page.evaluate(()=>window.calls.filter(([m])=>m==='getDirectorToolSupport').length),before=await reads()
    await page.evaluate(()=>{window.nextTest='connection'})
    await button.click();await section.locator('.ap-judge-test-result.is-error').waitFor()
    assert.equal((await result.innerText()).replace(/\s+/g,' ').trim(),'连接失败，请检查模型配置后重试 · 41 毫秒')
    assert.equal(await reads(),before)
    await page.evaluate(()=>{window.nextTest=null})

    // Picking another model clears the result; a no-tool result says so and the re-read greys that model in the menu.
    await menu.click();await page.getByRole('menuitemradio',{name:'Fresh',exact:true}).click()
    await page.waitForFunction(()=>window.values.directorModel?.model==='fresh')
    await result.waitFor({state:'detached',timeout:3000})
    // An untested model stored as the director model (remounted: text-only has no result yet) tests as no-tool.
    await page.evaluate(mock,{values:{...await page.evaluate(()=>window.values),directorModel:{provider:'openai',model:'text-only'}},support:{}})
    await button.waitFor();await button.click()
    await section.locator('.ap-judge-test-result.is-error').waitFor()
    assert.equal((await result.innerText()).replace(/\s+/g,' ').trim(),'不支持工具调用 · 812 毫秒')
    await page.waitForFunction(()=>window.calls.filter(([m])=>m==='getDirectorToolSupport').length>=2)
    await menu.click()
    assert.equal(await page.getByRole('menuitemradio',{name:/Text Only/}).isDisabled(),true)
    await page.keyboard.press('Escape')
    await page.locator('.pane').screenshot({path:path.join(outDir,`unsupported-${size}.png`)})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal scroll')
    const box=await button.boundingBox();assert.ok(box.height>=(size==='375'?36:30),'tap target '+box.height)
    assert.deepEqual(errors,[])
    await page.close()
  }
})
