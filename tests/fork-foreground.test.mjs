// private fork: foreground scheduling is independent of transport/synthesis clocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../tavern-plugin/src/client/fork-foreground.js', import.meta.url), 'utf8');
function fixture(focused = true) {
    let clock = 0, id = 0;
    const jobs = new Map();
    const host = new EventTarget(), doc = new EventTarget();
    Object.assign(doc, {visibilityState:'visible', hasFocus:() => focused});
    Object.assign(host, {performance:{now:() => clock}, console,
        setTimeout(fn, ms) { const key = ++id; jobs.set(key, {fn, at:clock + ms}); return key; },
        clearTimeout(key) { jobs.delete(key); }});
    host.requestAnimationFrame = fn => host.setTimeout(fn, 16);
    host.cancelAnimationFrame = host.clearTimeout;
    vm.runInNewContext(source, {window:host, document:doc});
    return {host, doc, api:host.forkForeground,
        focus(value) { focused = value; host.dispatchEvent(new Event(value ? 'focus' : 'blur')); },
        visible(value) { doc.visibilityState = value ? 'visible' : 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); },
        advance(ms) { const end = clock + ms; for (;;) { const job = [...jobs].sort((a,b)=>a[1].at-b[1].at)[0]; if (!job || job[1].at > end) break; clock=job[1].at; jobs.delete(job[0]); job[1].fn(); } clock=end; }
    };
}
test('blur debounce, immediate return/visibility, and focused iframe semantics', () => {
    const f=fixture(); f.focus(false); f.advance(299); assert.equal(f.api.isForeground(),true);
    f.focus(true); f.advance(1); assert.equal(f.api.isForeground(),true);
    f.host.dispatchEvent(new Event('blur')); f.advance(400); assert.equal(f.api.isForeground(),true);
    f.focus(false); f.advance(300); assert.equal(f.api.isForeground(),false);
    f.focus(true); assert.equal(f.api.isForeground(),true);
    f.visible(false); assert.equal(f.api.isForeground(),false);
    f.visible(true); assert.equal(f.api.isForeground(),true);
});
test('picker overrides focus and visibility only until closed', () => {
    const f=fixture(); f.api.picker(true); f.focus(false); f.visible(false); f.advance(1000);
    assert.equal(f.api.isForeground(),true); f.api.picker(false); assert.equal(f.api.isForeground(),false);
});
test('timeouts preserve remainder; intervals, frames and virtual time do not catch up', () => {
    const f=fixture(); let timeout=0, ticks=0, frames=0;
    f.api.setTimeout(()=>timeout++,1000); const interval=f.api.setInterval(()=>ticks++,200);
    f.advance(150); f.visible(false); const stopped=f.api.now();
    f.api.requestAnimationFrame(()=>frames++); f.advance(10000);
    assert.equal(timeout,0); assert.equal(ticks,0); assert.equal(frames,0); assert.equal(f.api.now(),stopped);
    f.visible(true); f.advance(49); assert.equal(ticks,0); assert.equal(frames,1);
    f.advance(1); assert.equal(ticks,1); f.api.clearInterval(interval);
    f.advance(799); assert.equal(timeout,0); f.advance(1); assert.equal(timeout,1);
});
test('new background work and cancellation do not leak', () => {
    const f=fixture(false); let calls=0;
    const a=f.api.setTimeout(()=>calls++,100), b=f.api.requestAnimationFrame(()=>calls++);
    f.api.clearTimeout(a); f.api.cancelAnimationFrame(b); f.advance(1000); f.focus(true); f.advance(200);
    assert.equal(calls,0);
});
test('media preserves intent and position, user stop cancels resume, new playback waits', async () => {
    const f=fixture(); let plays=0;
    const node=Object.assign(new EventTarget(),{paused:true,currentTime:12,play(){this.paused=false; plays++; return Promise.resolve();},pause(){this.paused=true;}});
    f.api.media(node); await node.play(); f.visible(false);
    assert.equal(node.paused,true); assert.equal(node.currentTime,12); assert.equal(f.api.isPlaying(node),true);
    f.visible(true); assert.equal(node.paused,false); assert.equal(plays,2);
    f.visible(false); node.pause(); f.visible(true); assert.equal(plays,2);
    f.visible(false); await node.play(); assert.equal(plays,2); f.visible(true); assert.equal(plays,3);
});
test('context cannot be woken by decoding while hidden; resume ramps 150ms', async () => {
    const f=fixture(); const ramps=[];
    const context={state:'running',currentTime:7,suspend(){this.state='suspended';return Promise.resolve();},resume(){this.state='running';return Promise.resolve();}};
    f.api.context(context,{gain:{cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(...args){ramps.push(args);}}});
    f.visible(false); await context.resume(); assert.equal(context.state,'suspended');
    f.visible(true); assert.equal(context.state,'running'); assert.deepEqual(ramps,[[1,7.15]]);
});

test('pause-aborted native play is not a voice/SFX failure, even across a quick return', async () => {
    const f=fixture(); let reject, plays=0;
    const node=Object.assign(new EventTarget(),{paused:true,volume:1,
        play(){this.paused=false; return ++plays===1 ? new Promise((_,no)=>reject=no) : Promise.resolve();},
        pause(){this.paused=true;}});
    f.api.media(node); const pending=node.play();
    f.visible(false); f.visible(true);
    reject(Object.assign(new Error('interrupted'),{name:'AbortError'}));
    await pending; assert.equal(f.api.isPlaying(node),true); assert.equal(plays,2);
});
test('private fork: background pause/resume owns stage animations only, never host or already-paused animations', () => {
    const f = fixture();
    const make = (stage, state = 'running') => ({ playState: state, pauses: 0, plays: 0,
        effect: { target: { closest: selector => stage && selector.includes('.fork-gal-stage') } },
        pause() { this.playState = 'paused'; this.pauses++; }, play() { this.playState = 'running'; this.plays++; } });
    const host = make(false), stage = make(true), userPaused = make(true, 'paused');
    f.doc.getAnimations = () => [host, stage, userPaused];
    f.visible(false);
    assert.equal(host.playState, 'running'); assert.equal(host.pauses, 0);
    assert.equal(stage.playState, 'paused');
    f.visible(true);
    assert.equal(host.plays, 0); assert.equal(stage.plays, 1); assert.equal(userPaused.plays, 0);
});
test('application subscriber blocks explicit updates/renders and does not start a user-stopped app', () => {
    const f=fixture(); let frames=0, renders=0;
    const app={ticker:{started:false,update(){frames++;}},renderer:{render(){renders++;}},
        stop(){this.ticker.started=false;},start(){this.ticker.started=true;}};
    const off=f.api.application(app); f.visible(false); app.ticker.update(); app.renderer.render();
    assert.equal(frames,0); assert.equal(renders,0);
    f.visible(true); assert.equal(app.ticker.started,false); off();
});