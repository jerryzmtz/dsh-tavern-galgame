// private fork: finite visual blocks contribute to the same foreground schedule as their cues.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {skinOverlayTiming}=require('../tavern-plugin/src/client/fork-skin-overlay-timing.cjs')
const {createPhasedSkinOverlayMotion}=require('../tavern-plugin/src/client/fork-skin-overlay-phase.cjs')
test('overlay timing bounds entry, exit and ritual work and includes finite cue/shake offsets',()=>{
 const overlay={pieces:[{id:'a',fps:10,enter:{at:300,steps:2},exit:{at:200,steps:3}}],cues:{entry:{sfx:'entry',ms:500,ritual:{revealAt:100,skinSwapAt:120,reveal:{steps:2}},shake:[{at:110,ms:200,amp:2}]},exit:{ms:100}}}
 const value=skinOverlayTiming(overlay,'entry')
 assert.equal(value.durationMs,500);assert.equal(value.skinSwapAt,120)
 // Authored phase SFX starts at the cue boundary, not paper/reveal time (prototype parity).
 assert.ok(value.cues.some(event=>event.cueId==='entry'&&event.at===0))
 assert.ok(value.effects.some(event=>event.do==='shake'&&event.at===110))
 assert.equal(skinOverlayTiming(overlay,'exit').durationMs,500)
 assert.equal(skinOverlayTiming({...overlay,cues:{entry:{ms:100000}}},'entry').durationMs,4000)
})
test('phase changes preserve authored pieces and snap to the sustained high-level frame',()=>{
 const piece={id:'a',frame:'old',h:20,at:{r:'screen',u:.1,v:.1},phases:[{cue:'turn',at:100,frame:'new',anchor:{r:'screen',u:.7,v:.1}}],enter:{at:0,steps:2}}
 const motion=createPhasedSkinOverlayMotion({id:'fixture',pieces:[piece],intensity:2})
 const rects={screen:{x:0,y:0,w:100,h:100}},sizes={old:{w:20,h:20},new:{w:20,h:20}}
 const early=motion.sample(500,rects,sizes)
 motion.setPhase({phase:'idle',level:3,snap:true})
 const late=motion.sample(0,rects,sizes)
 assert.equal(early[0].piece.img,'old');assert.equal(late[0].piece.img,'new');assert.equal(piece.frame,'old')
 assert.equal(late[0].piece.at.u,.7)
})

test('authored phase leave disappears live and remains absent after sustained seek',()=>{
 const piece={id:'doll',frame:'a',h:20,fps:8,at:{r:'screen',u:.5,v:.5},phases:[{cue:'turn',at:400,leave:{to:'pop',steps:2}}]}
 const motion=createPhasedSkinOverlayMotion({id:'fixture',pieces:[piece],intensity:3})
 const rects={screen:{x:0,y:0,w:1600,h:900}},sizes={a:{w:20,h:20}}
 motion.setPhase({phase:'turn',level:3})
 assert.equal(motion.sample(450,rects,sizes).length,1)
 assert.equal(motion.sample(1000,rects,sizes).length,0)
 motion.setPhase({phase:'idle',level:3,snap:true})
 assert.equal(motion.sample(0,rects,sizes).length,0)
 assert.equal(skinOverlayTiming({pieces:[piece]},'turn').durationMs,650)
})