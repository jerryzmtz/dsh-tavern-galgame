// private fork: full-body framing is renderer-local; the director/ruler remains unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {resolveFigureSizing, forkPackFigureRecord} from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const ctx = {}
vm.runInNewContext(source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime')), ctx)
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`)
const anatomy = {figureTop:.05234375,headTop:.1518,chin:.4691,feet:.94453125,visibleBottom:.94453125,supportX:.51171875,posture:'standing',crop:'full',poseHeightRatio:1,assetScale:.55}
function resolve(overrides={}) {
  const input={version:1,source:'fixture',heightCm:120,heightBasis:'standing',canvas:[1311,1200],W:1600,H:900,sceneHMax:120,sceneGroundRatio:.4918039895923678,occluderTop:648,anatomy,assetScale:.55,...overrides}
  input.metrics=forkPackFigureRecord(input,input.canvas)
  return resolveFigureSizing(input)
}
const place=r=>ctx.forkGalFaceRest(r.restHead,r.support.y,70,648,900,r.restBounds)
test('Live2D and sprite anatomy both place full figures above the box without rescaling',()=>{
  for(const a of [anatomy,{...anatomy,figureTop:.0108333333,headTop:.12,chin:.466666667,feet:.986666667,visibleBottom:.986666667}]) {
    const r=resolve({anatomy:a}), p=place(r)
    assert.equal(p.fullBody,true); near(p.scale,1)
    near(r.restBounds.bottom-p.lift,636)
    assert.ok(r.restBounds.top-p.lift>=90)
    assert.ok(r.restHead.chin-p.lift<608)
  }
})
test('mixed cast preserves the ruler and scale; only the short figure gets a ledge',()=>{
  const small=resolve({sceneHMax:158,sceneGroundRatio:1}), p=place(small)
  assert.equal(p.fullBody,true)
  const tall=resolve({heightCm:158,sceneHMax:158,sceneGroundRatio:1,assetScale:1,anatomy:{...anatomy,figureTop:.06,headTop:.06,chin:.21,feet:.98,visibleBottom:.98}})
  assert.equal(place(tall).fullBody,undefined)
  near(small.sharedGroundY,tall.sharedGroundY)
  near(p.scale,1); near(place(tall).scale,1)
})
test('ink below feet and hair above head count toward fit; no forced shrink',()=>{
  const head={top:400,chin:500,width:100,x:800}
  const fit=ctx.forkGalFaceRest(head,800,70,648,900,{top:304,bottom:850})
  assert.equal(fit.fullBody,true); near(fit.lift,214)
  const noFit=ctx.forkGalFaceRest(head,800,70,648,900,{top:303,bottom:850})
  assert.equal(noFit.fullBody,undefined); near(noFit.scale,1)
})
test('close-up omission restores minimal framing and eases between decisions',()=>{
  const r=resolve(), p=place(r), minimal=ctx.forkGalFaceRest(r.restHead,r.support.y,70,648,900)
  assert.ok(p.lift>minimal.lift)
  const a=ctx.forkGalFaceRestUpdate(null,'normal',r.restHead,r.support.y,70,648,900,0,true,r.restBounds)
  const b=ctx.forkGalFaceRestUpdate(a,'close',r.restHead,r.support.y,70,648,900,100,false,null)
  near(b.from.lift,p.lift); near(b.to.lift,minimal.lift)
  near(ctx.forkGalFaceRestFrame(b,800).lift,minimal.lift)
  assert.match(source,/!closeShot && !entry.figure.close \? lockBody : null/)
})
test('legacy figures use conservative canvas bounds; mobile uses proportional margins',()=>{
  for(const H of [900,844]) {
    const p=ctx.forkGalFaceRest({top:H*.5,chin:H*.6},H,H*.08,H*.75,H,{top:H*.5,bottom:H*.9})
    assert.equal(p.fullBody,true); near(H*.9-p.lift,H*(.75-12/900))
  }
  assert.match(source,/entry\.restBody\.y \+ entry\.restBody\.height/)
})
test('runtime REST seam applies full-body lift and invalidates on close shots',()=>{
  const r=resolve(), spec={version:1,source:'fixture',heightCm:120,heightBasis:'standing',canvas:[1311,1200],W:1600,H:900,sceneHMax:120,sceneGroundRatio:.4918039895923678,occluderTop:648,anatomy,assetScale:.55}
  spec.metrics=forkPackFigureRecord(spec,spec.canvas)
  const moves=[], entry={figure:{alias:'small'},figureSizing:spec,figureResolved:r,cx:{v:.5},restHead:r.restHead,container:{scale:{set(){}},position:{set(x,y){moves.push([x,y])}}}}
  const runtime={...ctx,resolveFigureSizing,console,state:{figureScale:{scene:1,rescales:0,to:120,groundTo:.4918039895923678},figures:new Map([['small',entry]])},faceEnvironment:()=>({key:'normal',top:70,occluderTop:648})}
  vm.runInNewContext(source.slice(source.indexOf('function tickFaceRest('),source.indexOf('function tickFaceClamp(')),runtime)
  runtime.tickFaceRest({camera:{shot:'wide'}},0,1600,900)
  assert.equal(entry.faceRest.to.fullBody,true);near(moves.at(-1)[1],-place(r).lift)
  entry.restHead=r.restHead;runtime.tickFaceRest({camera:{shot:'wide'}},100,1600,900);assert.equal(entry.faceRest.computations,1)
  entry.restHead=r.restHead;runtime.tickFaceRest({camera:{shot:'close',target:'small'}},200,1600,900);assert.equal(entry.faceRest.to.fullBody,undefined);assert.equal(entry.faceRest.computations,2)
  entry.restHead=r.restHead;runtime.tickFaceRest({camera:{shot:'wide'}},1000,1600,900);assert.equal(entry.faceRest.to.fullBody,true);assert.equal(entry.faceRest.computations,3)
})
