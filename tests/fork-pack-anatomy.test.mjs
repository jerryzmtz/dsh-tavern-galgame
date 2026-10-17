import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {forkPackAnatomy, forkPackEstimatedAnatomy, forkPackFigureRecord, forkMeasureFigureAlpha, resolveFigureSizing} from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
import {validateFigure} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure.js'
import {syntheticPack, cardExtension, PACK_ID, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {createAssetPackPresentation, selectPackFigure} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'

// Numeric calibration from the pre-P6 backup; no live files or GPU are required.
const fixtures = [
  {name:'Kyubey', canvas:[462,462], heightCm:23, heightBasis:'seated', scale:1.016289, span:307.94, ground:650,
    metrics:{figureTop:80, headTop:80, chin:276.95000000000005, visibleBottom:383, feet:383, supportX:235, poseHeightRatio:1, posture:'seated', heightBasis:'seated', crop:'full'}},
  {name:'Mami 200501', canvas:[2400,3100], heightCm:158, heightBasis:'standing', scale:0.369231, span:1116, ground:1233,
    metrics:{figureTop:259.810546875, headTop:259.810546875, chin:724.810546875, visibleBottom:3128.001708984375, feet:3282.310546875, supportX:1200.0003662109375, poseHeightRatio:1, headsPerBody:6.5, posture:'standing', heightBasis:'standing', crop:'custom'}}
]
function size(f, anatomy) {
  const input = {heightCm:f.heightCm, heightBasis:f.heightBasis, anatomy, source:'pack-content', version:1, assetScale:anatomy.assetScale ?? 1}
  return resolveFigureSizing({...input, metrics:forkPackFigureRecord(input,f.canvas), canvas:f.canvas, sceneHMax:158, W:1600, H:900, occluderTop:650})
}
for (const f of fixtures) test('normalized calibrated ' + f.name + ' preserves pre-P6 size with face-safe ground', () => {
  const anatomy = forkPackAnatomy(f.metrics,f.canvas,f.heightBasis)
  const result = size(f,anatomy)
  assert.equal(result.mode,'physical')
  assert.equal(Number(result.scale.toFixed(6)),f.scale)
  assert.equal(Number(result.poseSpan.toFixed(2)),f.span)
  // private fork: the short figure now receives only the lift needed for a 40px chin margin.
  if (f.name === 'Kyubey') {
    assert.ok(result.support.y>f.ground)
    assert.ok(Math.abs(result.restHead.chin-610)<1e-6)
  } else assert.equal(result.support.y,f.ground)
  assert.equal(result.ownGround,f.name === 'Kyubey')
  assert.equal(anatomy.source,'calibrated')
  if (f.name.startsWith('Mami')) { assert.ok(anatomy.feet > 1); assert.equal(anatomy.crop,'custom') }
  console.log(f.name, JSON.stringify({scale:result.scale,bodySpan:result.poseSpan,feetY:result.support.y}))
})

test('1536x1024 uncalibrated seated body ignores detached thin ink and estimates its chin', () => {
  const canvas = [1536,1024], pixels = new Uint8Array(canvas[0] * canvas[1] * 4)
  const fill = (left,top,right,bottom) => { for (let y=top;y<bottom;y++) for (let x=left;x<right;x++) pixels[(y*canvas[0]+x)*4+3]=255 }
  fill(450,240,1086,950); fill(760,20,764,180)
  const measured = forkMeasureFigureAlpha(pixels,...canvas)
  assert.equal(measured.figureTop,240)
  const anatomy = forkPackEstimatedAnatomy(measured,canvas,'seated')
  const result = size({canvas,heightCm:23,heightBasis:'seated'},anatomy)
  assert.equal(anatomy.source,'estimated'); assert.equal(result.mode,'physical')
  // private fork: estimated anatomy uses the same minimal-lift policy as calibrated figures.
  assert.ok(result.support.y>650); assert.equal(result.ownGround,true)
  assert.ok(Math.abs(result.restHead.chin-610)<1e-6)
  assert.ok(Math.abs(anatomy.chin - (240+710*0.65)/1024)<1e-12)
  console.log('Estimated Kyubey',JSON.stringify({scale:result.scale,bodySpan:result.poseSpan,feetY:result.support.y}))
})

test('pack schema and selection retain virtual feet, basis, elevation and state-specific anatomy', () => {
  const f = fixtures[1], anatomy = forkPackAnatomy(f.metrics,f.canvas,f.heightBasis)
  const figure = {schemaVersion:1,id:'22222222-2222-4222-8222-222222222222',name:'Mami',enabled:true,appearance:'live2d',recall:{mode:'keyword'},heightCm:158,heightBasis:'standing',elevationCm:12,
    outfits:[{key:'default',label:'Default',enabled:true,live2d:{bundleKey:'mami',anatomy}}]}
  validateFigure(figure)
  const selection = selectPackFigure(figure,{})
  assert.equal(selection.anatomy,anatomy); assert.equal(selection.elevationCm,12); assert.equal(selection.heightBasis,'standing')
  assert.throws(() => validateFigure({...figure,elevationCm:-1}))
  const invalid = structuredClone(figure); invalid.outfits[0].live2d.anatomy.feet = NaN
  assert.throws(() => validateFigure(invalid))
})

test('Live2D pack runtime renders once per identity and releases temporary GPU texture', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-figure-measure.js',import.meta.url),'utf8')
  let rendered=0, released=0, rest=0
  const context = {forkMeasureFigureAlpha:() => ({figureTop:2,visibleBottom:9,supportX:5})}
  vm.createContext(context); vm.runInContext(source,context)
  context.forkFigureMeasureLive2d = () => { rest++; return {canvas:[10,10],auto:{}} }
  const PIXI = {Rectangle:class {}}
  const renderer = {generateTexture:() => { rendered++; return {destroy:() => released++} },plugins:{extract:{canvas:() => ({width:10,height:10,getContext:() => ({getImageData:() => ({data:[]})})})}}}
  const first = context.forkFigureMeasurePackLive2d({},'model:outfit-a',renderer,PIXI)
  assert.equal(context.forkFigureMeasurePackLive2d({},'model:outfit-a',renderer,PIXI),first)
  context.forkFigureMeasurePackLive2d({},'model:outfit-b',renderer,PIXI)
  assert.equal(rendered,2); assert.equal(released,2); assert.equal(rest,2)
})


test('historical frames project current pack calibration without replacing their media selection', async () => {
  const pack = await syntheticPack(), figure = pack.figures[FIGURE_ID]
  figure.heightCm = 158; figure.heightBasis = 'standing'; figure.elevationCm = 7
  figure.outfits[1].live2d.anatomy = forkPackAnatomy(fixtures[1].metrics,fixtures[1].canvas,'standing')
  const service = {apiVersion:2,subscribe:() => () => {},getPackSnapshot:async () => ({...pack,revision:'current'})}
  const consumer = createAssetPackPresentation({raw:{extensions:{dsh_tavern:cardExtension()}},getService:() => service})
  const recorded = {ref:{packId:PACK_ID,figureId:FIGURE_ID},outfitKey:figure.outfits[1].key,outfit:figure.outfits[1],form:'live2d',heightCm:1,geometry:{stage:'recorded-media-key'}}
  const projected = await consumer.frozen({characters:[recorded]})
  assert.equal(projected.characters[0].heightCm,158)
  assert.equal(projected.characters[0].heightBasis,'standing')
  assert.equal(projected.characters[0].elevationCm,7)
  assert.equal(projected.characters[0].anatomy.feet,fixtures[1].metrics.feet/3100)
  assert.deepEqual(projected.characters[0].geometry,recorded.geometry)
  assert.equal(recorded.heightCm,1)
  consumer.dispose()
})


test('face rectangles, artistic scale and invalid measurement failures survive the pack bridge', () => {
  const canvas = [400,800], metrics = {figureTop:100, visibleBottom:700, feet:900, faceRect:[150,120,80,100], supportX:210,
    posture:'standing', heightBasis:'standing', crop:'custom', poseHeightRatio:0.8, visibleFraction:0.75}
  const anatomy = forkPackAnatomy(metrics,canvas,'standing','calibrated',1.2)
  assert.deepEqual(anatomy.faceRect,[0.375,0.15,0.2,0.125])
  assert.equal(anatomy.headRatio,(900-120)/800*0.8*1.2)
  const record = forkPackFigureRecord({source:'test',heightBasis:'standing',anatomy},canvas)
  assert.deepEqual(record.override.faceRect,metrics.faceRect)
  assert.equal(record.override.feet,900)
  assert.ok(Math.abs(record.override.chin-220)<1e-10)
  assert.equal(anatomy.assetScale,1.2)
  assert.equal(forkPackEstimatedAnatomy({invalid:true},canvas),null)
  assert.equal(forkPackFigureRecord({source:'test'},canvas),undefined)
})
