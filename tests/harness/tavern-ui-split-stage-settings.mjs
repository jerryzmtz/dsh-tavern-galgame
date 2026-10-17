// Private fork: offline before/after shell CSS parity. No live RPC or persistent server.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { browserReactScript } from '../fixtures/browser-react.mjs';
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs';
import surfaces from '../../tavern-plugin/src/client/fork-surfaces.cjs';
const root=fileURLToPath(new URL('../../',import.meta.url)).replaceAll('\\','/').replace(/\/$/,''), out=root+'/.tmp/ui-split-evidence/shots';
fs.mkdirSync(out,{recursive:true});
const read=p=>fs.readFileSync(root+'/'+p,'utf8');
const before=execFileSync('git',['-C',root,'show','ef5a7923:tavern-plugin/lib/client-assets/fork-theme.css'],{encoding:'utf8',maxBuffer:8*1024*1024});
const after=read('tavern-plugin/packages/dsh-tavern-ui/src/shell.css')+'\n'+read('tavern-plugin/lib/client-assets/fork-theme.css');
const {source,picker,playback}=await stageSource(), react=await browserReactScript();
const browser=await chromium.launch({headless:true}),results=[];
try{
for(const theme of ['light','dark','pink-skin'])for(const width of [375,1440]){
const images=[];
for(const version of ['before','after']){
const page=await browser.newPage({viewport:{width,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div class="pane"><div id="panel"></div></div></body></html>'}));await page.goto('http://stage.test/');
await page.addStyleTag({content:(version==='before'?before:after)+'\n'+surfaces.css()+`html,body{margin:0;height:100%}body{${THEMES[theme==='dark'?'dark':'light']}font-family:"Microsoft YaHei UI",sans-serif;background:var(--page)}.pane{height:100%;width:min(100%,520px);overflow:auto;margin-left:auto}#panel{display:flex;flex-direction:column;height:100%;min-height:0}*,*::before,*::after{animation:none!important;transition:none!important}`});
await page.evaluate(theme=>{document.body.dataset.fkContext=theme==='dark'?'chat-dark':'chat-light';if(theme==='pink-skin'){document.body.style.setProperty('--fork-accent','#e91e63');document.body.style.setProperty('--fork-surface','#f7f0f3')}},theme);
await page.addScriptTag({content:react+';window.React=modules.react;window.ReactDOM=modules["react-dom/client"];'+playback+source+picker});await page.evaluate(pageSetup);
await page.evaluate(()=>{window.scenario('main');window.show('main')});await page.getByText('本卡读音词典').waitFor();await page.waitForTimeout(800);
if(errors.length)throw Error(errors.join('\n'));
images.push(await page.screenshot({path:out+'/stage-settings-'+theme+'-'+width+'-'+version+'.png'}));await page.close();
}
const pixelIdentical=images[0].equals(images[1]);results.push({theme,width,pixelIdentical});console.log('stage-settings',theme,width,pixelIdentical?'IDENTICAL':'DIFFERENT');
}
}finally{await browser.close();fs.writeFileSync(out+'/stage-settings-results.json',JSON.stringify(results,null,2)+'\n')}
if(results.some(x=>!x.pixelIdentical))process.exitCode=1;
