// private fork (layered pilot phase 1): real Chromium canvas pixels for a parts 差分 — group order (front over mouth over
// face over underlay), lip-sync / blink frames folded into groups 04 / 03, and the partial repaint equal to a full one.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8')

test('parts composite pixels: order, folded mouth/blink frames, partial repaint = full repaint', async () => {
  const browser = await chromium.launch({headless:true})
  try {
    const page = await browser.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent('<!doctype html><html><body></body></html>')
    await page.addScriptTag({content:(await read('tavern-plugin/src/client/fork-layered-sprite.cjs')) + '\n' + (await read('tavern-plugin/src/client/fork-layered-sprite-render.js')) +
      '\nwindow.forkPartsPaint = forkPartsPaint; window.forkSpritePaint = forkSpritePaint;'})
    const edges = await page.evaluate(() => {
      const base = document.createElement('canvas'); base.width = 4; base.height = 1;
      const pixels = new ImageData(new Uint8ClampedArray([255,255,255,253, 0,0,255,128, 0,255,0,64, 255,0,0,255]), 4, 1);
      base.getContext('2d').putImageData(pixels, 0, 0);
      const patch = document.createElement('canvas'); patch.width = 3; patch.height = 1;
      patch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray([0,0,0,253, 255,0,0,128, 0,0,0,0]), 3, 1), 0, 0);
      const bundle = {pack:{},state:{},view:{src:'base',width:4,height:1,blink:{closed:'patch',rect:[0,0,3,1],blend:'replace'}}};
      const images = new Map([['base',base],['patch',patch]]), out = document.createElement('canvas');
      forkSpritePaint(out,bundle,images,'initial','closed');
      const closed = [...out.getContext('2d').getImageData(0,0,4,1).data];
      forkSpritePaint(out,bundle,images,'initial','open');
      return {closed,open:[...out.getContext('2d').getImageData(0,0,4,1).data]};
    });
    assert.deepEqual(edges.closed,[0,0,0,253,255,0,0,128,0,255,0,64,255,0,0,255]);
    assert.deepEqual(edges.open,[255,255,255,253,0,0,255,128,0,255,0,64,255,0,0,255]);
    const result = await page.evaluate(async () => {
      const solid = async (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h)
        const image = new Image(); image.src = c.toDataURL(); await image.decode(); return image }
      const spec = {base:['underlay', [0, 0, 40, 60], 'rgb(255,0,0)'], face:['face', [10, 10, 20, 10], 'rgb(0,0,255)'], blink:['face', [10, 10, 20, 10], 'rgb(0,255,0)'],
        rest:['mouth', [14, 24, 12, 6], 'rgb(255,255,0)'], open:['mouth', [14, 24, 12, 8], 'rgb(255,0,255)'], clip:['front', [12, 12, 4, 4], 'rgb(255,255,255)']}
      const parts = {canvas:[40, 60], drawOrder:['underlay', 'pose', 'face', 'mouth', 'front'], revision:'r1',
        selection:{underlay:'base', pose:'none', face:'face', mouth:'rest', front:'clip'}, mouthFrames:{a:'open'}, blinkFrames:{closed:'blink'}, parts:{}}
      const images = new Map()
      for (const [id, [group, rect, color]] of Object.entries(spec)) { parts.parts[id] = {group, src:id + '.png', rect}; images.set(id + '.png', await solid(rect[2], rect[3], color)) }
      const at = (canvas, x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)].join(',')
      const live = document.createElement('canvas'), steps = [['initial', 'open'], ['a', 'open'], ['a', 'closed'], ['closed', 'closed'], ['initial', 'open'], ['e', 'half']], out = []
      for (const [event, blink] of steps) {
        forkSpritePaint(live, {parts}, images, event, blink)
        const fresh = document.createElement('canvas'); forkPartsPaint(fresh, parts, images, event, blink)
        const a = live.getContext('2d').getImageData(0, 0, 40, 60).data, b = fresh.getContext('2d').getImageData(0, 0, 40, 60).data
        let diff = 0; for (let i = 0; i < a.length; i++) diff += a[i] !== b[i]
        out.push({event, blink, diff, corner:at(live, 1, 1), eye:at(live, 25, 12), front:at(live, 13, 13), mouth:at(live, 20, 26), chin:at(live, 20, 31)})
      }
      return out
    })
    const [rest, talk, blink, closed, back] = result
    assert.deepEqual(result.map(r => r.diff), [0, 0, 0, 0, 0, 0], 'every partial repaint equals a full composite')
    assert.equal(rest.corner, '255,0,0'); assert.equal(rest.eye, '0,0,255'); assert.equal(rest.mouth, '255,255,0'); assert.equal(rest.chin, '255,0,0')
    assert.equal(rest.front, '255,255,255', 'front (05) is drawn over the face (03)')
    assert.equal(talk.mouth, '255,0,255'); assert.equal(talk.chin, '255,0,255', 'the open mouth frame replaces the rest mouth in group 04')
    assert.equal(blink.eye, '0,255,0'); assert.equal(blink.front, '255,255,255', 'the blink frame replaces the face in group 03, front still on top')
    assert.equal(closed.mouth, '255,255,0', 'no closed frame: the rest mouth')
    assert.equal(back.eye, '0,0,255'); assert.equal(back.chin, '255,0,0', 'back at rest, the taller open mouth leaves no trace')
    assert.equal(result[5].eye, '0,0,255', 'no half frame: eyes stay open')
    assert.deepEqual(errors, [])
    // Budget (PLAN §05): warmed composite P95 ≤ 4 ms on desktop at the pilot's 1024×1536 canvas; lip-sync repaints only
    // the mouth region. Canvas work only (the texture upload is the same as the legacy layered path).
    const timing = await page.evaluate(async () => {
      const solid = async (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h)
        const image = new Image(); image.src = c.toDataURL(); await image.decode(); return image }
      const parts = {canvas:[1024, 1536], drawOrder:['underlay', 'pose', 'face', 'mouth', 'front'], revision:'big', selection:{underlay:'base', pose:'none', face:'face', mouth:'rest', front:'clip'},
        mouthFrames:{closed:'closed', a:'a'}, blinkFrames:{closed:'blink'}, parts:{base:{src:'b', rect:[0, 0, 1024, 1536]}, face:{src:'f', rect:[312, 470, 362, 264]}, blink:{src:'k', rect:[312, 530, 362, 132]},
          rest:{src:'r', rect:[425, 640, 140, 94]}, closed:{src:'c', rect:[425, 640, 140, 94]}, a:{src:'a', rect:[425, 640, 140, 94]}, clip:{src:'p', rect:[280, 380, 460, 160]}}}
      const images = new Map()
      for (const part of Object.values(parts.parts)) images.set(part.src, await solid(part.rect[2], part.rect[3], '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')))
      const p95 = list => list.sort((x, y) => x - y)[Math.floor(list.length * 0.95)]
      const full = [], mouth = []
      for (let i = 0; i < 30; i++) { const c = document.createElement('canvas'), t = performance.now(); forkPartsPaint(c, parts, images, 'initial', 'open'); c.getContext('2d').getImageData(0, 0, 1, 1); full.push(performance.now() - t) }
      const live = document.createElement('canvas'); forkPartsPaint(live, parts, images, 'initial', 'open')
      for (let i = 0; i < 60; i++) { const t = performance.now(); forkPartsPaint(live, parts, images, ['a', 'closed', 'initial'][i % 3], i % 7 ? 'open' : 'closed'); live.getContext('2d').getImageData(0, 0, 1, 1); mouth.push(performance.now() - t) }
      return {full:p95(full.slice(5)), mouth:p95(mouth.slice(5))}
    })
    console.log('# parts composite p95 ms', JSON.stringify(timing))
    assert.ok(timing.mouth <= 4, 'mouth/blink repaint p95 ' + timing.mouth)
    assert.ok(timing.full <= 25, 'full composite p95 ' + timing.full)
  } finally { await browser.close() }
})


test('baked mouth RGBA uses one replacement in static, atlas and parts browser paths', async () => {
  const browser=await chromium.launch({headless:true,args:['--mute-audio']})
  try {
    const page=await browser.newPage()
    await page.addScriptTag({content:(await read('tavern-plugin/src/client/fork-layered-sprite.cjs'))+'\n'+(await read('tavern-plugin/src/client/fork-layered-sprite-render.js'))+'\n'+(await read('tavern-plugin/src/client/fork-gal-mouth.js'))})
    const result=await page.evaluate(()=>{
      const canvas=(w,h,rgba)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const d=new Uint8ClampedArray(w*h*4);for(let i=0;i<d.length;i+=4)d.set(rgba,i);c.getContext('2d').putImageData(new ImageData(d,w,h),0,0);return c}
      const base=canvas(60,50,[180,150,130,254]),patch=canvas(40,30,[180,150,130,254]);
      const color=new Uint8ClampedArray(10*6*4);for(let i=0;i<color.length;i+=4)color.set([70,20,35,254],i)
      patch.getContext('2d').putImageData(new ImageData(color,10,6),10,10)
      const expected=canvas(60,50,[0,0,0,0]),ctx=expected.getContext('2d');ctx.drawImage(base,0,0);ctx.clearRect(10,10,40,30);ctx.drawImage(patch,10,10)
      const pixels=c=>c.getContext('2d').getImageData(0,0,60,50).data,want=pixels(expected),diff=c=>pixels(c).reduce((n,v,i)=>n+(v!==want[i]),0)
      const flat=document.createElement('canvas'),bundle={binding:{canvas:[60,50],mouth:{surface:'mouthless',anchor:{x:10,y:10,scale:1,rotation:0}}},set:{canvas:[40,30],pivot:[0,0],frames:{small:'patch'},blends:{small:'replace'}}}
      forkGalMouthPaint(flat,base,bundle,new Map([['patch',patch]]),'small',true)
      const layered=document.createElement('canvas'),pack={mouthAtlas:{src:'patch',width:40,height:30,frames:{a:{x:0,y:0,w:40,h:30,replace:true}}}},state={mouthFrames:{a:'a'}},view={src:'base',width:60,height:50,mouth:{x:10,y:10,w:40,h:30}}
      state.stage=view;state.portrait={};forkSpritePaint(layered,{pack,state,view},new Map([['base',base],['patch',patch]]),'a','open')
      const parts={canvas:[60,50],revision:'matte',drawOrder:['underlay','pose','face','mouth','front'],selection:{underlay:'body',pose:'none',face:'none',mouth:'none',front:'none'},mouthFrames:{a:'mouth'},parts:{body:{src:'base',rect:[0,0,60,50]},mouth:{src:'patch',rect:[10,10,40,30],replaceRect:[10,10,40,30]}}},live=document.createElement('canvas'),images=new Map([['base',base],['patch',patch]])
      forkPartsPaint(live,parts,images,'initial','open');forkPartsPaint(live,parts,images,'a','open');const partDiff=diff(live)
      forkPartsPaint(live,parts,images,'initial','open');const back=pixels(live),source=pixels(base)
      return {flat:diff(flat),layered:diff(layered),parts:partDiff,rest:back.reduce((n,v,i)=>n+(v!==source[i]),0),alpha:[...pixels(flat)].filter((_,i)=>i%4===3).every(a=>a===254)}
    })
    assert.deepEqual(result,{flat:0,layered:0,parts:0,rest:0,alpha:true})
  }finally{await browser.close()}
})
