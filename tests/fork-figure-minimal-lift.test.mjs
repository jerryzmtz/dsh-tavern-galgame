// private fork: fixed pixel fixtures copied from approved pack anatomy, no live IO.
import test from 'node:test'
import assert from 'node:assert/strict'
import {forkPackFigureRecord,resolveFigureSizing} from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
const viewports=[[1600,900],[1920,1080],[1366,768],[390,844],[844,390]]
const base={source:'fixture',version:1,heightBasis:'standing',sceneHMax:158}
const fish={figureTop:13/1200,headTop:.12,chin:560/1200,feet:1184/1200,visibleBottom:1184/1200,supportX:.511441647597254,posture:'standing',crop:'full',poseHeightRatio:1,assetScale:.55}
function input(anatomy,heightCm,canvas,W,H,extra={}) {
  const i={...base,anatomy,heightCm,canvas,W,H,occluderTop:H*.72,assetScale:anatomy.assetScale??1,...extra}
  return {...i,metrics:forkPackFigureRecord(i,canvas)}
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`)
test('Dafeiyu is lower than feet-at-textbox at all common viewports, with exact minimum chin clearance',()=>{
  for(const [W,H] of viewports) for(const sceneGroundRatio of [.85,.9,1]) {
    const i=input(fish,120,[1311,1200],W,H,{sceneGroundRatio}),r=resolveFigureSizing(i)
    assert.equal(r.mode,'physical');assert.equal(r.ownGround,true)
    assert.ok(r.support.y>i.occluderTop)
    close(r.restHead.chin,i.occluderTop-H*40/900)
    const shared=resolveFigureSizing({...i,occluderTop:undefined})
    close(r.scale,shared.scale);close(r.poseSpan,shared.poseSpan)
    assert.ok(r.groundY<=shared.groundY)
    // Any further lowering violates the margin; the body is not resized to get here.
    assert.ok(r.restHead.chin+.001>i.occluderTop-H*40/900)
  }
})
test('three Madoka figures retain shared ground and identical geometry across viewports',()=>{
  // calm: Madoka, Homura and Mami. Sprite normalization is independent of image resolution.
  const rows=[[152,.006510416666666667,.15735176282051283,.9869791666666666,.5205078125],
    [155,.005208333333333333,.1574519230769231,.9947916666666666,.525390625],
    [158,.005208333333333333,.15705128205128208,.9921875,.5]]
  for(const [W,H] of viewports) for(const [heightCm,headTop,chin,feet,supportX] of rows) {
    const anatomy={figureTop:headTop,headTop,chin,feet,visibleBottom:feet,supportX,posture:'standing',crop:'full',poseHeightRatio:1}
    const i=input(anatomy,heightCm,[1024,1536],W,H),r=resolveFigureSizing(i),shared=resolveFigureSizing({...i,occluderTop:undefined})
    assert.equal(r.ownGround,false);assert.deepEqual(r,shared)
    assert.ok(r.restHead.chin<i.occluderTop-H*40/900)
  }
})
test('missing head or occluder preserves shared ground, including no-height legacy mode',()=>{
  const i=input(fish,120,[1311,1200],1600,900)
  const withoutHead={...i,metrics:{...i.metrics,override:{...i.metrics.override,headTop:undefined,chin:undefined}}}
  const r=resolveFigureSizing(withoutHead)
  assert.equal(r.ownGround,false);assert.equal(r.groundY,r.sharedGroundY)
  assert.equal(resolveFigureSizing({...i,heightCm:undefined}).mode,'legacy')
  const high=resolveFigureSizing({...i,elevationCm:100})
  assert.equal(high.ownGround,false);close(high.support.y,high.sharedGroundY-100*high.pxPerCm)
})
