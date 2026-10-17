// private fork: skin overlay renderer + production foreground clock/resource budget, offline.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createSkinOverlayPlayer}=require('../tavern-plugin/src/client/fork-skin-overlay-player.cjs')
const {createDecorativeScript}=require('../tavern-plugin/src/client/fork-skin-overlay-script.cjs')
const {createStageResourceOwner}=require('../tavern-plugin/src/client/fork-stage-resources.cjs')
const foregroundSource=await readFile(new URL('../tavern-plugin/src/client/fork-foreground.js',import.meta.url),'utf8')
function fixture(maxBytes=10000000,options={},frameMs=16){
 let time=0,id=0;const timers=new Map(),host=new EventTarget(),doc=new EventTarget()
 Object.assign(doc,{visibilityState:'visible',hasFocus:()=>true})
 Object.assign(host,{performance:{now:()=>time},setTimeout(fn,ms){timers.set(++id,{fn,at:time+ms});return id},clearTimeout:id=>timers.delete(id)})
 host.requestAnimationFrame=fn=>host.setTimeout(fn,frameMs);host.cancelAnimationFrame=host.clearTimeout
 vm.runInNewContext(foregroundSource,{window:host,document:doc})
 const owner=createStageResourceOwner({service:{},maxBytes})
 const geometry={revision:1,screen:{x:0,y:0,w:800,h:450},text:{x:100,y:350,w:600,h:80},box:{x:80,y:320,w:640,h:120},widgets:[]},listeners=new Set(),frames=[],errors=[]
 const contexts=[0,1].map(()=>({draws:0,clearRect(){},save(){},restore(){},translate(){},rotate(){},scale(){},drawImage(){this.draws++}}))
 const player=createSkinOverlayPlayer({definition:{id:'fixture',pieces:[{id:'p',img:'paper',h:20,at:{r:'box',u:0.5,dy:-30},layer:'over',idle:[{op:'spin',deg:10}]}]},textures:{paper:[{width:30,height:20}]},foreground:host.forkForeground,owner,rects:{getSnapshot:()=>geometry,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}},under:{getContext:()=>contexts[0]},over:{getContext:()=>contexts[1]},changed:value=>frames.push(value),onError:error=>errors.push(error),...options})
 return {player,owner,frames,errors,listeners,geometry,contexts,hide(value){doc.visibilityState=value?'hidden':'visible';doc.dispatchEvent(new Event('visibilitychange'))},advance(ms){const end=time+ms;for(;;){const job=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!job||job[1].at>end)break;time=job[1].at;timers.delete(job[0]);job[1].fn()}time=end},timers}
}
test('skinOverlay frames pause/resume without clock catch-up and dispose releases canvas budget',()=>{
 const f=fixture();f.advance(2000);const frame=f.frames.at(-1),count=f.frames.length
 assert.ok(count>8);assert.equal(f.contexts[0].draws,0);assert.ok(f.contexts[1].draws>0)
 assert.equal(f.owner.snapshot().bytes,800*450*4*2)
 f.hide(true);f.advance(300000);assert.equal(f.frames.length,count)
 f.hide(false);f.advance(32);assert.ok(f.frames.at(-1).time-frame.time<200)
 f.player.dispose();assert.equal(f.owner.snapshot().bytes,0);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);f.owner.dispose()
})
// private fork: a completed turn replayed in history snaps one-shots but must keep the idle collage stepping.
test('skinOverlay idle loop keeps animating on history pages and under OS calm; explicit reduced motion freezes',()=>{
 const distinct=f=>{f.advance(4000);return new Set(f.frames.map(frame=>JSON.stringify(frame.poses.map(p=>p.pose)))).size}
 const history=fixture(10000000,{snap:true}),live=fixture()
 history.player.setPhase({phase:'idle',snap:true})
 assert.ok(distinct(history)>10,'history page idle steps');assert.ok(history.timers.size>0,'frame loop still scheduled')
 const calm=fixture(10000000,{snap:true,calm:true});calm.player.setPhase({phase:'idle',snap:true})
 const calmSteps=distinct(calm);assert.ok(calmSteps>5 && calmSteps<distinct(live),'calm slows, never freezes')
 const frozen=fixture(10000000,{snap:true,reducedMotion:true});frozen.player.setPhase({phase:'idle',snap:true})
 assert.ok(distinct(frozen)<=1,'explicit CONFIG reduced motion is static')
 for(const f of [history,live,calm,frozen]){f.player.dispose();f.owner.dispose()}
})
test('skinOverlay caps high-refresh sampling without freezing independent idle steps',()=>{
 const pieces=Array.from({length:24},(_,i)=>({id:'p'+i,img:'paper',h:20,at:{r:'screen',u:i/24,v:.2},layer:'under',fps:7+i/10,idle:[{op:'spin',deg:10}]}));
 const f=fixture(10000000,{definition:{id:'many',pieces},snap:true},1000/144);
 f.player.setPhase({phase:'idle',snap:true});f.advance(10000);
 assert.ok(f.frames.length<=601,'not more than 60 repaints/s: '+f.frames.length);
 assert.ok(f.frames.length>300,'independent piece clocks still animate');
 assert.ok(f.frames.at(-1).time>9900,'presentation time is not slowed by the cap');
 f.player.dispose();assert.equal(f.timers.size,0);assert.equal(f.owner.snapshot().bytes,0);
});
test('skinOverlay budget refusal allocates no canvas and does not schedule a retry storm',()=>{
 const f=fixture(1024);f.advance(1000)
 assert.equal(f.errors.length,1);assert.equal(f.errors[0].code,'RESOURCE_BUDGET');assert.equal(f.owner.snapshot().bytes,0);assert.equal(f.timers.size,0)
 f.player.dispose();f.owner.dispose()
})
test('decorative script uses supplied outlines, tracks dropped characters and never changes dialogue',()=>{
 const data={meta:{em:1000,fillRule:'evenodd',privateUse:true},glyphs:{A:{d:'M0 0L100 0L50 -100Z',w:100,h:100,adv:120}}}
 const script=createDecorativeScript(data,{Path:class{constructor(d){this.d=d}},normalize:t=>t.toUpperCase()})
 const original='a A?\u4e2d',result=script.layout(original,100,{tracking:0})
 assert.equal(result.width,98);assert.deepEqual(result.dropped,['\u4e2d']);assert.equal(original,'a A?\u4e2d')
 assert.throws(()=>createDecorativeScript({...data,glyphs:{A:{...data.glyphs.A,d:'<script>'}}}),/Invalid decorative/)
})
