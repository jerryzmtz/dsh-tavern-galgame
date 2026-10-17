// private fork: Madoka motion stays outside the generic stage/client bundle.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {createSkinOverlayClock,createSkinOverlayMotion,skinOverlayCorners,skinOverlayIntersects,skinOverlayAnchor} = require('../tavern-plugin/src/client/fork-skin-overlay-motion.cjs')
const rects = {screen:{x:0,y:0,w:1600,h:900},box:{x:220,y:660,w:1100,h:200},text:{x:260,y:700,w:1000,h:100},qm:{x:1200,y:620,w:150,h:30}}
const piece = {id:'paper',at:{r:'box',u:0.3,v:0,dy:-25},layer:'over',img:'paper',h:30,fps:7,idle:[{op:'spin',deg:8}]}
const sizes = {paper:{w:50,h:30}}
test('independent deterministic clocks hold poses and do not synchronize', () => {
  const a = createSkinOverlayClock(12,7), b = createSkinOverlayClock(47,7), replay = createSkinOverlayClock(12,7)
  let different = 0, steps = new Set()
  for (let t=0;t<10000;t+=16) {
    const x=a.sample(t), y=b.sample(t)
    assert.deepEqual(x,replay.sample(t)); if (x.step!==y.step) different++
    steps.add(x.step)
  }
  assert.ok(different>20); assert.ok(steps.size>=60 && steps.size<=80)
  const motion=createSkinOverlayMotion({id:'fixture',pieces:[piece],snap:false})
  assert.deepEqual(motion.sample(2000,rects,sizes),motion.sample(2001,rects,sizes))
})
test('rotated geometry catches corners that an unrotated rectangle misses', () => {
  const points=skinOverlayCorners({x:50,y:50,rot:45,s:1,sx:1,sy:1},100,10)
  assert.equal(skinOverlayIntersects(points,{x:80,y:80,w:10,h:10}),true)
  assert.equal(skinOverlayIntersects(points,{x:90,y:40,w:5,h:5}),false)
})
test('over pieces immediately reanchor then hide before painting any forbidden body', () => {
  const motion=createSkinOverlayMotion({id:'fixture',pieces:[piece],snap:true})
  const before=motion.sample(2000,rects,sizes)[0]
  const changed={...rects,box:{...rects.box,y:550}}
  const after=motion.sample(2000,changed,sizes)[0]
  assert.equal(before.pose.y-after.pose.y,110)
  const covered={...changed,text:{x:after.pose.x-100,y:after.pose.y-100,w:200,h:200}}
  assert.deepEqual(motion.sample(2000,covered,sizes),[])
  for (const key of ['qm','side','choices']) assert.deepEqual(motion.sample(2000,{...changed,[key]:covered.text},sizes),[])
  assert.deepEqual(motion.sample(2000,{...changed,widgets:[covered.text]},sizes),[])
})
test('missing anchors hide rather than guessing screen and offsets scale with stage', () => {
  assert.equal(skinOverlayAnchor(rects,{r:'name',u:1}),null)
  assert.equal(skinOverlayAnchor(rects,{r:'name'}, {r:'screen',u:1,dx:-10}).x,1590)
  assert.equal(skinOverlayAnchor({...rects,screen:{x:0,y:0,w:800,h:450}},{r:'screen',dx:10}).x,5)
})
test('reduced motion is static, explicit exit removes pieces, snap never replays entry', () => {
  const motion=createSkinOverlayMotion({id:'fixture',pieces:[piece],reducedMotion:true})
  assert.deepEqual(motion.sample(0,rects,sizes),motion.sample(500000,rects,sizes))
  motion.exit(500001); assert.deepEqual(motion.sample(500001,rects,sizes),[])
  const snap=createSkinOverlayMotion({id:'fixture',pieces:[{...piece,enter:{at:1000,from:'left',steps:4}}],snap:true})
  assert.equal(snap.sample(0,rects,sizes).length,1)
})
// private fork: history/seek snaps skip one-shot entry/exit only; idle stepping keeps running on every page.
test('idle loop steps on history (snap) pages; only the explicit reduced choice freezes, OS calm slows', () => {
  const steps = motion => new Set(Array.from({length:40},(_,i) => JSON.stringify(motion.sample(i*150,rects,sizes)[0].pose))).size
  const history = createSkinOverlayMotion({id:'fixture',pieces:[{...piece,enter:{at:1000,from:'left',steps:4}}],snap:true})
  assert.equal(history.sample(0,rects,sizes)[0].pose.s,1,'no replayed entry transition on a history page')
  assert.ok(steps(history) > 20,'history idle keeps stepping')
  assert.equal(steps(createSkinOverlayMotion({id:'fixture',pieces:[piece],snap:true,reducedMotion:true})),1)
  const calm = steps(createSkinOverlayMotion({id:'fixture',pieces:[piece],snap:true,tempo:0.6}))
  assert.ok(calm > 10 && calm < steps(createSkinOverlayMotion({id:'fixture',pieces:[piece],snap:true})),'calm is slower, not frozen')
})