// Standalone Chromium pixel/runtime smoke, not a DSH-host or real-TTS acceptance test.
// CHROMIUM_PATH=/path/to/chromium node tests/fork-layered-sprite-browser.mjs
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { spriteFixture, storedZip } from './fixtures/fork-layered-sprite.mjs'
const root = new URL('../', import.meta.url)
const read = file => readFile(new URL('tavern-plugin/src/client/' + file, root), 'utf8')
// private fork: rendering remains in Tavern, image conversion now lives in the native package.
const conversion = await readFile(new URL('tavern-plugin/packages/dsh-asset-library/src/client/sprite-import.js', root), 'utf8')
const scripts = (await Promise.all(['fork-layered-sprite.cjs', 'fork-layered-sprite-render.js'].map(read))).join('\n') + '\n' + conversion.slice(conversion.indexOf('export async function assetSpriteWebp'), conversion.indexOf('export async function prepareAssetSprites')).replace('export ', '')
const input = spriteFixture('assets/base.webp'); input.mouthAtlas.src = 'assets/atlas.webp'
for (const state of input.states) { state.portrait.src = 'assets/portrait.webp'; state.stage.mouthOcclusionMask = 'assets/mask.webp' }
const directory = await mkdtemp(path.join(tmpdir(), 'sprite-browser-'))
try {
  const html = `<!doctype html><meta charset="utf-8"><title>Layered sprite runtime smoke</title><pre id="result">pending</pre><script>${scripts}
  const results=[]; const check=(value,label)=>{if(!value)throw Error(label);results.push(label)};
  const canvas=(w,h,color)=>{const c=document.createElement('canvas');c.width=w;c.height=h;if(color){c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,w,h)}return c};
  const pixel=(c,x,y)=>Array.from(c.getContext('2d').getImageData(x,y,1,1).data).join(',');
  const forkStageAudio={get:()=>({master:1,voice:1,muted:{master:false,voice:false}})};let sampled=0,amplitude=.9;const forkLipSync={level:()=>{sampled++;return amplitude}};
  (async()=>{
    const pack=forkSpriteManifest(${JSON.stringify(input)}),model={id:'synthetic',spritePack:pack},stage=forkSpriteBundle(model,'calm'),portrait=forkSpriteBundle(model,'calm','portrait');
    const base=canvas(8,8,'blue'),head=canvas(8,8,'blue'),atlas=canvas(8,8),mask=canvas(8,8,'black');
    const actx=atlas.getContext('2d');['red','lime','yellow','cyan','magenta','black','white'].forEach((c,i)=>{actx.fillStyle=c;actx.fillRect(i,0,1,1)});
    const images=new Map([['assets/base.webp',base],['assets/portrait.webp',head],['assets/atlas.webp',atlas],['assets/mask.webp',mask]]),out=canvas(8,8);
    forkSpritePaint(out,stage,images,'initial');check(pixel(out,1,2)==='0,0,255,255','initial restores exact base');
    forkSpritePaint(out,stage,images,'a');check(pixel(out,1,2)==='255,0,0,255','stage anchor draws atlas patch');check(pixel(out,4,5)==='0,0,255,255','stage does not use portrait anchor');
    forkSpritePaint(out,portrait,images,'i');check(pixel(out,4,5)==='0,255,0,255','portrait independently anchored');check(pixel(out,1,2)==='0,0,255,255','portrait does not use stage anchor');
    forkSpritePaint(out,stage,images,'closed');check(pixel(out,1,2)==='0,0,255,255','closed restores exact base');
    const open=forkSpriteBundle(model,'signature');forkSpritePaint(out,open,images,'initial');check(pixel(out,1,2)==='0,0,255,255','open native base is untouched initially');
    forkSpritePaint(out,open,images,'closed');check(pixel(out,1,2)==='0,0,0,255','genuine closed patch resolves');
    forkSpritePaint(out,open,images,'a');check(pixel(out,1,2)==='255,255,255,255','emotion mapping overrides default frame');
    const mctx=mask.getContext('2d');mctx.fillStyle='white';mctx.fillRect(1,2,1,1);mctx.fillStyle='rgb(128,128,128)';mctx.fillRect(2,2,1,1);
    forkSpritePaint(out,stage,images,'a');check(pixel(out,1,2)==='0,0,255,255','white mask restores foreground');check(pixel(out,2,2)==='127,0,128,255','gray mask blends foreground');
    check(pixel(base,1,2)==='0,0,255,255','cached base never mutated');
    const custom=structuredClone(portrait);custom.view.mouthByFrame={a:{x:0,y:7,w:1,h:1}};forkSpritePaint(out,custom,images,'a');check(pixel(out,0,7)==='255,0,0,255','per-frame anchor is honored');
    let updates=0,destroys=0;const PIXI={Texture:{from:c=>({baseTexture:{resource:{source:c},update:()=>updates++},destroy:()=>destroys++})}},textures=new Map([...images].map(([url,source])=>[url,{ready:true,texture:{baseTexture:{resource:{source}}}}]));
    const audio={paused:false,ended:false,currentTime:1},entry={figure:{spriteBundle:stage,spriteVoiceKey:'page:1:calm',audio},sprite:{},src:stage.view.src,baseTexture:{original:true}};
    forkSpriteTickScene(entry,textures,PIXI,true);check(entry.spriteEvent==='a','PIXI stage follows actual analyser level');
    const event=forkSpriteVoice('page:1:calm',audio,true);check(event==='a','portrait consumes same voice state');check(sampled===1,'one shared analyser sample per frame');
    entry.figure.audio=null;forkSpriteTickScene(entry,textures,PIXI,false);check(entry.spriteEvent==='closed','stop closes open mouth');
    forkSpriteClearScene(entry);check(destroys===1&&entry.spriteTexture===null,'PIXI resources released');
    const missing={...entry,figure:{...entry.figure,spriteBundle:stage},sprite:{},src:stage.view.src,baseTexture:{original:true}};forkSpriteTickScene(missing,new Map(),PIXI,true);check(missing.sprite.texture===missing.baseTexture,'missing assets retain selected base');
    const webp=await assetSpriteWebp(await new Promise(r=>base.toBlob(r,'image/png')),[8,8]);check(/^[a-f0-9]{64}$/.test(webp.sha)&&webp.blob.size>16,'real browser conversion yields SHA-addressed WebP');
    let mismatch=false;try{await assetSpriteWebp(await new Promise(r=>base.toBlob(r,'image/png')),[9,8])}catch{mismatch=true}check(mismatch,'browser decode validates declared dimensions');
    const deflated=await new Response(new Blob(['real deflate']).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();check(deflated.byteLength>0,'browser supports bounded deflate stream');
    document.getElementById('result').textContent=JSON.stringify({ok:true,count:results.length,results});
  })().catch(error=>document.getElementById('result').textContent=JSON.stringify({ok:false,error:String(error.stack)}));
  </script>`
  const file = path.join(directory, 'smoke.html'); await writeFile(file, html)
  if (process.env.SPRITE_SMOKE_HTML) { await writeFile(process.env.SPRITE_SMOKE_HTML, html); console.log(process.env.SPRITE_SMOKE_HTML); process.exit(0) }
  const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {channel:'chrome'})})
  try {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(pathToFileURL(file).href)
    await page.waitForFunction(() => document.getElementById('result').textContent !== 'pending', null, {timeout:45000})
    const result = JSON.parse(await page.locator('#result').textContent())
    console.log(JSON.stringify(result, null, 2)); assert.equal(result.ok, true, JSON.stringify({result, errors}))
  } finally { await browser.close() }
} finally { await rm(directory, { recursive: true, force: true }) }
