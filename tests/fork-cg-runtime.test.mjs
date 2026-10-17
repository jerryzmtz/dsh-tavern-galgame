// private fork: CG presentation clock and resource handoff, no model or live profile.
import test from 'node:test'
import assert from 'node:assert/strict'
import cg from '../tavern-plugin/src/client/fork-cg-consumer.cjs'
const image=(id='rice',variant='base',focus={key:'full',x:0.5,y:0.5,zoom:1})=>({ref:{packId:'pack',kind:'cg',assetId:id},variant,focus,media:{identity:id+':'+variant,url:'blob:'+id+variant}})
function harness() {
  let time=0,serial=0;const frames=new Map(),played=[],visible=[];
  const clock={now:()=>time,isForeground:()=>true,requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id)};
  const consumer=cg.createForkCgConsumer({clock,onFrame:()=>true,onVisible:v=>visible.push(v),onPlayed:v=>played.push(v.ref.assetId)});
  return {consumer,played,visible,step(ms) {time+=ms;const next=[...frames.values()];frames.clear();next.forEach(fn=>fn(time));}};
}
test('CG handoff holds face until exit, marks only a rendered frame and uses 300/150/250 ms fades', async () => {
  const h=harness();let done=false;
  const entered=h.consumer.present(image()).then(()=>{done=true;});
  assert.deepEqual(h.visible,[true]);assert.equal(h.played.length,0);
  h.step(100);assert.equal(done,false);assert.equal(h.played.length,0);
  h.step(100);assert.deepEqual(h.played,['rice']);
  h.step(100);await entered;assert.equal(done,true);
  const variant=h.consumer.present(image('rice','turn'));h.step(149);assert.ok(h.consumer.snapshot().previous);h.step(1);await variant;
  assert.equal(h.played.length,1);
  const exit=h.consumer.present(null);h.step(249);assert.equal(h.consumer.snapshot().visible,true);h.step(1);await exit;
  assert.deepEqual(h.visible,[true,false]);assert.equal(h.consumer.snapshot().current,null);
});
test('pan uses foreground elapsed time, local overlays pause, interruptions start at the current focus', async () => {
  const h=harness();await h.consumer.present(image(),{snap:true});h.step(16);
  await h.consumer.present(image('rice','base',{x:0.8,y:0.2,zoom:2}));
  h.step(2000);const halfway=h.consumer.snapshot().focus;assert.equal(halfway.zoom,1.5);
  h.consumer.policy({pause:true});h.step(9000);assert.deepEqual(h.consumer.snapshot().focus,halfway);
  h.consumer.policy({pause:false});h.step(1000);assert.ok(h.consumer.snapshot().focus.zoom<2);
  const from=h.consumer.snapshot().focus;await h.consumer.present(image('rice','base',{x:0.5,y:0.5,zoom:1}));
  assert.deepEqual(h.consumer.snapshot().focus,from);
  h.step(4000);assert.equal(h.consumer.snapshot().focus.zoom,1);
});
test('history/reduced motion snap without replay; hidden preparation cannot acknowledge; dispose releases handoff', async () => {
  const h=harness();h.consumer.policy({pause:true});await h.consumer.present(image(),{snap:true});h.step(20);assert.equal(h.played.length,0);
  h.consumer.policy({pause:false,reducedMotion:true});h.step(16);assert.equal(h.played.length,0);h.step(16);assert.deepEqual(h.played,['rice']);
  const other=h.consumer.present(image('other'));h.consumer.dispose();await other;assert.equal(h.consumer.snapshot().visible,false);
});
test('contain/zoom clamps wide and tall images without accidental full-view cropping',()=>{
  assert.deepEqual(cg.forkCgTransform({width:1600,height:900},{width:4000,height:1000},{x:1,y:1,zoom:1}),{zoom:1,x:0,y:0});
  assert.deepEqual(cg.forkCgTransform({width:1600,height:900},{width:4000,height:1000},{x:1,y:1,zoom:2}),{zoom:2,x:-800,y:0});
  assert.deepEqual(cg.forkCgTransform({width:500,height:900},{width:1000,height:4000},{x:1,y:0,zoom:2}),{zoom:2,x:0,y:450});
});

test('safe white uses 80ms cover plus 220ms reveal, never acknowledges the cover, and deduplicates re-entry',async()=>{
  const h=harness(),value={...image(),transition:'white'};h.consumer.policy({whiteAllowed:true});
  const entering=h.consumer.present(value);assert.equal(h.consumer.snapshot().white,1);
  h.step(80);assert.equal(h.consumer.snapshot().alpha,0);assert.equal(h.played.length,0);
  h.step(1);assert.ok(h.consumer.snapshot().white<1);assert.equal(h.played.length,0);
  h.step(1);assert.equal(h.played.length,1);h.step(218);await entering;
  const exit=h.consumer.present(null);h.step(250);await exit;h.step(1000);
  const again=h.consumer.present(value);assert.equal(h.consumer.snapshot().white,0);h.step(300);await again;
  for(const policy of [{whiteAllowed:false},{whiteAllowed:true,reducedMotion:true}]) {
    h.consumer.policy(policy);const next=h.consumer.present({...image('other'+JSON.stringify(policy)),transition:'white'});
    assert.equal(h.consumer.snapshot().white,0);h.step(300);await next;
  }
});

test('receipt refresh holds outgoing pins through the same variant handoff and cannot restart white',async()=>{
  const h=harness();await h.consumer.present(image(),{snap:true});h.step(16);
  let released=0;const switching=h.consumer.present(image('rice','turn'),{provenance:{id:1}}).then(()=>released++);
  h.step(50);const refreshed=h.consumer.present(image('rice','turn'),{provenance:{id:2}}).then(()=>released++);
  await Promise.resolve();assert.equal(released,0);assert.ok(h.consumer.snapshot().previous);
  h.step(100);await Promise.all([switching,refreshed]);assert.equal(released,2);
  h.consumer.policy({whiteAllowed:true});const white=h.consumer.present({...image('other'),transition:'white'},{provenance:{id:3}});h.step(40);
  const converged=h.consumer.present({...image('other'),transition:'white'},{provenance:{id:4}});assert.equal(h.consumer.snapshot().white,1);
  h.step(260);await Promise.all([white,converged]);assert.equal(h.consumer.snapshot().white,0);
});

test('undrawn and background frames cannot acknowledge; a new explicit provenance can retry once',async()=>{
  let time=0,frame,drawn=false,foreground=true,played=0;
  const consumer=cg.createForkCgConsumer({clock:{now:()=>time,isForeground:()=>foreground,requestAnimationFrame:fn=>{frame=fn;return 1},cancelAnimationFrame:()=>{frame=null}},onFrame:()=>drawn,onPlayed:()=>played++});
  const step=()=>{time+=16;const next=frame;frame=null;next?.();};
  const a={visitId:1};await consumer.present(image(),{snap:true,provenance:a});step();assert.equal(played,0);
  drawn=true;foreground=false;step();step();assert.equal(played,0);
  foreground=true;step();assert.equal(played,0);step();assert.equal(played,1);step();assert.equal(played,1);
  await consumer.present(image(),{snap:true,provenance:{visitId:2}});step();assert.equal(played,1);step();assert.equal(played,2);consumer.dispose();
});

import {harness as resourceHarness,drain,fixtureScale} from './helpers/stage-resource-harness.mjs'
test('CG readiness is independent; failed different refs clear CG, same ref variants keep last-good; revocation releases it',async t=>{
  const h=await resourceHarness(t);await h.direct();
  const ref=id=>({packId:'cg-pack',kind:'cg',assetId:id});
  const value=(id,variant='base')=>({ref:ref(id),variant,focus:{key:'full',x:0.5,y:0.5,zoom:1},media:{identity:id+variant,url:{resource:true,kind:'media',ref:ref(id),hash:id+variant,identity:id+variant,revision:'pack-1'}}});
  const respond=cg=>h.setResponse({status:'ready',directionToken:h.store.getSnapshot().director.token,value:{state:{lighting:{},figureScale:fixtureScale},scene:{cg},characters:[],avatars:[],widgets:[],audio:{music:null,soundscape:{version:1,layers:[]},sfx:[]}}});
  respond(value('rice'));h.refresh();await drain();
  const first=h.store.getSnapshot().accepted.cg;
  assert.equal(first.ref.assetId,'rice');assert.match(first.media.url,/^blob:/);
  assert.equal(h.store.getSnapshot().accepted.scene.cg,undefined,'base scene never owns CG resources');
  h.rejectBytes(url=>url.includes('bad'));respond(value('rice','bad'));h.refresh();await drain();
  assert.equal(h.store.getSnapshot().accepted.cg,first,'failed variant does not replace last-good');
  respond(value('bad'));h.refresh();await drain();h.clock.advance(700);await drain();h.clock.advance(700);await drain();assert.equal(h.store.getSnapshot().accepted.cg,null,'failed different identity reveals base scene');
  h.rejectBytes(null);respond(value('rice'));h.refresh();await drain();assert.ok(h.store.getSnapshot().accepted.cg);
  h.resources.revoke('session',{refs:[ref('rice')]},h.store.dispatch,h.store.getSnapshot);
  assert.equal(h.store.getSnapshot().accepted.cg,null);assert.equal(h.owner.snapshot().pins,0);
});
// private fork: synchronous redraw/ResizeObserver is not a rendered frame.
test('snap redraw and disposal without two animation frames never acknowledge',async()=>{
  const h=harness();await h.consumer.present(image(),{snap:true});h.consumer.redraw();h.consumer.redraw();
  assert.equal(h.played.length,0);h.step(16);assert.equal(h.played.length,0);
  h.consumer.redraw();h.step(16);assert.equal(h.played.length,0);h.consumer.dispose();h.step(16);assert.equal(h.played.length,0);
});

// private fork (D05): the author composition reads the window back from the same transform the stage paints with.
test('CG window is the inverse of the stage transform and the motion policy is shared',()=>{
  const view={width:1600,height:900},wide={width:1672,height:941},close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,a+' vs '+b)
  const full=cg.forkCgWindow(view,{width:1600,height:900},{x:0.5,y:0.5,zoom:1});close(full.x,0);close(full.y,0);close(full.w,1);close(full.h,1)
  const half=cg.forkCgWindow(view,{width:1600,height:900},{x:0.9,y:0.1,zoom:2});close(half.w,0.5);close(half.x,0.5);close(half.y,0) // clamped at the corner
  const phone=cg.forkCgWindow({width:375,height:812},wide,{x:0.3,y:0.5,zoom:2});close(phone.w,0.5);assert.ok(phone.h>1,'a phone view letterboxes a wide picture')
  // Round trip: the image point at the window centre is where forkCgTransform puts the view centre.
  const t=cg.forkCgTransform(view,wide,{x:0.3,y:0.6,zoom:1.8}),w=cg.forkCgWindow(view,wide,{x:0.3,y:0.6,zoom:1.8}),scale=Math.min(1600/1672,900/941)*1.8
  close((w.x+w.w/2-0.5)*1672*scale,-t.x);close((w.y+w.h/2-0.5)*941*scale,-t.y)
  assert.deepEqual(cg.forkCgMotionPolicy({reducedMotion:false,photosensitive:true},false),{reducedMotion:false,whiteAllowed:false})
  assert.deepEqual(cg.forkCgMotionPolicy({reducedMotion:false,photosensitive:false},false),{reducedMotion:false,whiteAllowed:true})
  assert.deepEqual(cg.forkCgMotionPolicy({reducedMotion:false,photosensitive:false},true),{reducedMotion:true,whiteAllowed:false})
  assert.deepEqual(cg.forkCgMotionPolicy(undefined,false),{reducedMotion:false,whiteAllowed:false})
})