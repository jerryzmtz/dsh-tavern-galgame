// private fork (mod-ui, owner 2026-10): 舞台设置 › 模组 rows are 基础设置 SwitchRows (one per mod, the panel's ForkSwitch),
// and every fork popup shares one stack — a press outside the topmost popup or Esc closes only that popup; a press during an
// unsaved text edit only ends the edit (docs/fork/ui-design.md §三.16).
// private fork (one mod entry, owner 2026-10): a row opens the mod's page in place in 舞台设置 (no dialog, no 模组库 tab);
// the stack still closes one popup at a time there, and Esc on the page goes back with the focus on the row's 「›」.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {widgetServer} from './fixtures/widget-harness.mjs'
import {stageSource,THEMES} from './harness/card-centric-stage.mjs'
import {createModRegistry} from '../tavern-plugin/lib/domain/mods/registry.js'
import {createModRpc} from '../tavern-plugin/lib/fork-mod-rpc.js'
const root=new URL('../',import.meta.url)

test('stage mod rows are switch rows and stacked popups close one at a time on an outside press or Esc',async t=>{
  const manifest=JSON.parse(await readFile(new URL('tavern-plugin/mods/demo/manifest.json',root))),registry=createModRegistry()
  delete manifest.ui.internal
  await registry.install({manifest,expectedRevision:registry.snapshot().revision})
  const api=createModRpc({library:registry,authorize:()=>true})
  const origin=await widgetServer(t,{connect(){},serve(){return false}},(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="zh-CN"><div id="root" class="ap-ui"></div>');return true})
  const browser=await chromium.launch({headless:true,args:['--explicitly-allowed-ports='+new URL(origin).port]});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin)
  await page.exposeFunction('modRpc',async(method,args)=>api[method](args,{origin}))
  await page.addScriptTag({content:await browserReactScript()})
  await page.addStyleTag({content:await readFile(new URL('tavern-plugin/lib/client-assets/fork-theme.css',root),'utf8')+'body{margin:0;padding:16px;box-sizing:border-box;'+THEMES.dark+'}'})
  await page.addScriptTag({content:`const React=modules.react,ReactDOM=modules['react-dom'];${(await stageSource()).source}
    const ui=createForkAssetPackUI(React),root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    let back=null;
    function Stage(){const [mod,setMod]=React.useState(null);
      const ctx={binding:{engineRpc:window.modRpc},openMod:setMod,takeModFocus:id=>{if(back!==id)return false;back=null;return true;}};
      return mod?React.createElement(ui.ModDetail,{rpc:window.modRpc,cardId:'card-a',modId:mod,onBack:()=>{back=mod;setMod(null);}}):React.createElement(ui.StageModSection,{ctx,cardId:'card-a'});}
    root.render(React.createElement(Stage));`})
  const fail=async error=>{t.diagnostic(JSON.stringify({errors,body:await page.locator('body').innerText()}));throw error}
  const name=manifest.name,toggle=page.getByRole('switch',{name,exact:true})
  await toggle.waitFor({timeout:5000}).catch(fail)
  // (a) One SwitchRow per mod: the bare panel switch (no chat-side track skin), the name and a 「›」 that open the mod.
  assert.equal(await page.locator('.ap-switch-row').count(),1)
  assert.equal(await page.locator('.dsh-tavern-settings-switch, .ap-state-tag').count(),0)
  // private fork (settings-ux r2, owner 2026-10): the row opens the mod; only the switch (in its own small label) toggles.
  assert.equal(await page.locator('.ap-switch-row.is-openable label.ap-switch-hit > input[role="switch"]').count(),1)
  assert.equal(await page.locator('.ap-switch-row label.ap-switch-main').count(),0)
  const dialogs=page.getByRole('dialog')
  // Enabling asks first; a press outside the confirmation closes it and changes nothing.
  await toggle.click();await page.getByRole('button',{name:'允许并启用',exact:true}).waitFor()
  await page.mouse.click(4,4)
  await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'))
  assert.equal(await toggle.isChecked(),false);assert.equal(registry.listMods({cardId:'card-a'}).mods[0].scope,'off')
  await toggle.click();await page.getByRole('button',{name:'允许并启用',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('input[role="switch"]')?.checked)
  // (b) The mod opens in place (‹ 舞台设置); a colour popup inside it is the topmost popup.
  const detail=page.locator('.ap-mod-detail')
  await page.getByRole('button',{name:name+' 设置',exact:true}).click();await detail.waitFor()
  // The loaded detail can itself contain switch fields; only the list's navigation row must disappear.
  assert.equal(await dialogs.count(),0,'no dialog');assert.equal(await page.getByRole('button',{name:name+' 设置',exact:true}).count(),0,'the page replaces the list')
  assert.match(await page.locator('.ap-subhead-back').getAttribute('aria-label'),/舞台设置/)
  await page.getByRole('button',{name:'视觉',exact:true}).click()
  const swatch=page.getByRole('button',{name:'强调色：#225566',exact:true}),colour=page.locator('.fork-inline-pop.is-palette')
  await swatch.click();await colour.waitFor()
  await page.mouse.click(4,4) // outside the popup
  await colour.waitFor({state:'detached'});assert.equal(await detail.count(),1,'only the colour popup closed')
  await swatch.click();await colour.waitFor()
  await page.keyboard.press('Escape');await colour.waitFor({state:'detached'});assert.equal(await detail.count(),1,'Esc closed only the colour popup')
  // An unsaved typed edit: the outside press only ends the edit (it saves on blur); the page stays.
  const caption=page.getByRole('textbox',{name:'标题',exact:true});await caption.fill('草稿标题')
  await page.mouse.click(4,4)
  await page.waitForFunction(()=>document.querySelector('input[aria-label="标题"]')?.value==='草稿标题'&&!document.querySelector('[data-fork-draft]'))
  assert.equal(await detail.count(),1,'a draft keeps the page')
  for(let i=0;i<50&&registry.getMod({modId:manifest.id}).settings.values.caption!=='草稿标题';i++)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(registry.getMod({modId:manifest.id}).settings.values.caption,'草稿标题')
  // Esc on the page goes back to the list, the focus on the row's 「›」.
  await page.locator('.ap-subhead-back').focus();await page.keyboard.press('Escape');await detail.waitFor({state:'detached'})
  await page.waitForFunction(label=>document.activeElement?.getAttribute('aria-label')===label,name+' 设置')
  assert.deepEqual(errors,[])
})
