// private fork: the opening thumbnail and empty stage share theme colours and the same pixels.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const read = path => readFile(new URL('../tavern-plugin/'+path, import.meta.url), 'utf8')

test('empty-stage palettes follow theme tokens; preview and renderer paint identical gradients', async t => {
  const browser = await chromium.launch({headless:true})
  t.after(()=>browser.close())
  const page = await browser.newPage()
  await page.setContent('<div class="fork-gal-stage" data-theme="classic"><canvas width="640" height="360"></canvas></div><canvas class="fork-gal-theme-scope" data-theme="classic" width="640" height="360"></canvas>')
  await page.addStyleTag({content:await read('lib/client-assets/fork-theme.css')})
  await page.addScriptTag({content:await read('src/client/fork-stage-empty.js')})
  const result = await page.evaluate(()=>{
    const stage=document.querySelector('div'),preview=document.querySelector('canvas.fork-gal-theme-scope'),canvas=stage.firstChild;
    return ['classic','gothic','magical','classic','crt','aero'].map(theme=>{
      stage.dataset.theme=preview.dataset.theme=theme;
      const palette=forkStageEmptyPalette(stage),other=forkStageEmptyPalette(preview);
      forkStagePaintEmpty(canvas.getContext('2d'),640,360,palette);
      forkStagePaintEmpty(preview.getContext('2d'),640,360,other);
      return {palette,other,equal:canvas.toDataURL()===preview.toDataURL(),pixel:[...canvas.getContext('2d').getImageData(320,72,1,1).data]};
    });
  })
  for(const row of result){assert.deepEqual(row.palette,row.other);assert.equal(row.equal,true);assert.equal(row.pixel[3],255)}
  assert.deepEqual(result[0],result[3], 'changing back restores the classic palette')
  assert.notDeepEqual(result[0].pixel,result[1].pixel)
  assert.notDeepEqual(result[1].pixel,result[2].pixel)
  for(const [i,value] of [59,45,87].entries())assert.ok(Math.abs(result[0].pixel[i]-value)<=2,'classic retains its purple glow')
  const scene=await read('src/client/fork-gal-scene.js'),opening=await read('src/client/fork-asset-pack-opening-ui.js')
  assert.match(scene,/forkStagePaintEmpty\(ctx, w, h, forkStageEmptyPalette\(host\)\)/)
  assert.match(scene,/generated\.empty\.baseTexture\.update\(\)/)
  assert.match(scene,/attributeFilter:\['data-theme'\]/)
  assert.match(scene,/emptyThemeObserver\.disconnect\(\)/)
  assert.match(opening,/forkStagePaintEmpty\(canvas\.current\.getContext/)
  assert.match(opening,/\[background,theme\]/)
})
