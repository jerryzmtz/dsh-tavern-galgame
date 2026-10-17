// private fork: deterministic inference and WCAG helpers shared by browser ingress and the offline fill.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {FIGURE_AUTO_NEUTRAL,inferFigureAutoColor,figureColorRegion,figureTextColor,figureContrast,figureInks,figureColorShades} = require('../tavern-plugin/shared/figure-auto-color.cjs')
const image = pixels => ({data:Uint8Array.from(pixels.flat()),width:pixels.length,height:1})
const repeated = (rgb,n,alpha=255) => Array.from({length:n},()=>[...rgb,alpha])

test('ignores padding, skin, white, black and greys in favour of chromatic art',()=>{
  const pixels = [...repeated([250,250,250],200),...repeated([10,10,10],200),...repeated([156,156,156],200),...repeated([247,217,192],200),...repeated([255,0,0],100,0),...repeated([218,113,45],30)]
  assert.equal(inferFigureAutoColor(image(pixels)),'#da712d')
  assert.equal(inferFigureAutoColor(image(pixels.reverse())),'#da712d')
})

test('groups light and dark shades of one hue; does not average unrelated colours',()=>{
  const pixels = [...repeated([90,140,230],20),...repeated([54,84,138],20),...repeated([190,35,45],25)]
  assert.equal(inferFigureAutoColor(image(pixels)),'#4870b8')
})

test('alpha weighting and tie-breaking are deterministic',()=>{
  assert.equal(inferFigureAutoColor(image([...repeated([255,0,0],5,64),...repeated([0,0,255],3)])),'#0000ff')
  const pixels = [[255,0,0,255],[0,0,255,255]]
  assert.equal(inferFigureAutoColor(image(pixels)),inferFigureAutoColor(image(pixels.reverse())))
})

test('fallback preserves dark violet and pastel blue; monochrome gets neutral',()=>{
  assert.equal(inferFigureAutoColor(image(repeated([39,31,48],30))),'#271f30')
  assert.equal(inferFigureAutoColor(image(repeated([188,195,215],30))),'#bcc3d7')
  for (const pixels of [repeated([200,200,200],30),repeated([255,255,255],30),repeated([1,1,1],30),repeated([255,0,0],30,0)]) {
    assert.equal(inferFigureAutoColor(image(pixels)),FIGURE_AUTO_NEUTRAL)
  }
})

test('sprite head uses opaque bounds rather than canvas padding or costume',()=>{
  const width = 100, height = 200, data = new Uint8Array(width*height*4)
  for(let y=20;y<180;y++)for(let x=30;x<70;x++)data.set(y<65?[220,95,143,255]:[20,45,170,255],(y*width+x)*4)
  assert.deepEqual(figureColorRegion(data,width,height,true),{left:34,right:66,top:20,bottom:52})
  assert.equal(inferFigureAutoColor({data,width,height},{sprite:true}),'#dc5f8f')
  assert.equal(inferFigureAutoColor({data,width,height}),'#142daa')
})

test('text colours reach 4.5 on light, dark and mid-tone backgrounds after rounding',()=>{
  const backgrounds = ['#ffffff','#f8f5ee','#151820','#20242a','#777777','#888888','#eeeeee']
  const bases = ['#ffbada','#bfc8ff','#271f30','#ffdf00','#ec1111','#123456',FIGURE_AUTO_NEUTRAL]
  for(const background of backgrounds)for(const base of bases){
    const adjusted=figureTextColor(base,background)
    assert.ok(figureContrast(adjusted,background)>=4.5,`${base} -> ${adjusted} on ${background}`)
    assert.equal(figureTextColor(base,background),adjusted)
    if(figureContrast(base,background)>=4.5)assert.equal(adjusted,base)
  }
})

test('contrast helper handles the entire sampled RGB cube without missing a passing colour',()=>{
  for(let r=0;r<256;r+=51)for(let g=0;g<256;g+=51)for(let b=0;b<256;b+=51){
    const base='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('')
    for(const background of ['#ffffff','#161820','#777777'])assert.ok(figureContrast(figureTextColor(base,background),background)>=4.5)
  }
})

// private fork (owner 2026-10): one image colour per character; its name inks pass WCAG on both chat backgrounds and the
// picker swatches are shades of that colour (no preset palette).
test('image colour inks and picker shades',()=>{
  for(const color of ['#fdd4b4','#4d6bfe','#e0689f',FIGURE_AUTO_NEUTRAL]){
    const ink=figureInks(color,{light:'#ffffff',dark:'#232324'})
    assert.ok(figureContrast(ink.light,'#ffffff')>=4.5&&figureContrast(ink.dark,'#232324')>=4.5,color)
  }
  assert.equal(figureColorShades('#e0689f').length,6);assert.deepEqual(figureColorShades('var(--x)'),[])
})
