'use strict';
// private fork: presentation-only clock. Canonical CG intent remains in the stage store.
const FORK_CG_TIMINGS = Object.freeze({enter:300,variant:150,pan:4000,exit:250});
function forkCgTransform(view, image, focus) {
    const base = Math.min(view.width / image.width, view.height / image.height);
    const zoom = focus?.zoom || 1, clamp = (n, edge) => edge ? Math.max(-edge,Math.min(edge,n)) : 0;
    const width = image.width * base * zoom, height = image.height * base * zoom;
    return {zoom,x:clamp((0.5-(focus?.x ?? 0.5))*width,Math.max(0,(width-view.width)/2)),y:clamp((0.5-(focus?.y ?? 0.5))*height,Math.max(0,(height-view.height)/2))};
}
// private fork (D05 composition editor): the part of the image a view shows for a focus — forkCgTransform read back,
// normalized to the image ({x,y,w,h}; may reach past 0..1 where the view letterboxes). Effective center = x + w/2.
function forkCgWindow(view, image, focus) {
    const t = forkCgTransform(view, image, focus), scale = Math.min(view.width / image.width, view.height / image.height) * t.zoom;
    const w = view.width / (image.width * scale), h = view.height / (image.height * scale);
    return {x:0.5 - (view.width / 2 + t.x) / (image.width * scale),y:0.5 - (view.height / 2 + t.y) / (image.height * scale),w,h};
}
// The reading settings and the OS reduced-motion query, as one CG policy (stage and author preview alike).
function forkCgMotionPolicy({reducedMotion = false,photosensitive = true} = {}, osReduced = false) {
    return {reducedMotion:reducedMotion === true || !!osReduced,whiteAllowed:photosensitive === false && !osReduced};
}
function createForkCgConsumer({clock,onFrame = () => false,onVisible = () => {},onPlayed = () => {}}) {
    const full = () => ({x:0.5,y:0.5,zoom:1});
    const sameRef = (a,b) => a && b && ['packId','kind','assetId'].every(k => a.ref[k] === b.ref[k]);
    let current = null, previous = null, alpha = 0, focus = full(), motion = null, fade = null;
    let frame = null, last = clock.now(), paused = false, reduced = false, disposed = false, visible = false;
    let settle = null, token = null, painted = false, acknowledged = false, white = 0, allowWhite = false, lastFlash = -Infinity;
    const flashed = new Set();
    function visibility(value) {if (visible !== value) {visible=value;onVisible(value);}}
    function finish() {const done=settle;settle=null;done?.();}
    function snapshot() {return {current,previous,alpha,focus:{...focus},visible,white};}
    function publish(fromFrame=false) {
        // private fork: only two clock frames can confirm paint; ResizeObserver/redraw cannot.
        const drawn = onFrame(snapshot()) === true;
        const eligible = !disposed && !paused && clock.isForeground?.() !== false && white < 1 && alpha > 0 && !!current && drawn;
        if (fromFrame && painted && eligible && !acknowledged) {acknowledged=true;onPlayed(current,token);}
        painted = fromFrame && eligible;
    }
    function schedule() {if (frame === null && !paused && !disposed && (fade || motion || current && !acknowledged)) frame=clock.requestAnimationFrame(tick);}
    function tick() {
        frame=null;
        if (paused || disposed) return;
        const now=clock.now(), delta=Math.max(0,now-last);last=now;
        if (fade) {
            fade.elapsed+=delta;
            const progress=Math.min(1,fade.elapsed/fade.duration);
            const blend=fade.white ? Math.max(0,(fade.elapsed-80)/220) : progress;
            alpha=fade.from+(fade.to-fade.from)*Math.min(1,blend);
            white=fade.white ? 1-Math.min(1,blend) : 0;
            if (progress === 1) {fade=null;previous=null;white=0;if (!current) visibility(false);finish();}
        }
        if (motion) {
            motion.elapsed+=delta;
            const p=Math.min(1,motion.elapsed/FORK_CG_TIMINGS.pan), ease=p*p*(3-2*p);
            focus=Object.fromEntries(['x','y','zoom'].map(k=>[k,motion.from[k]+(motion.to[k]-motion.from[k])*ease]));
            if (p === 1) motion=null;
        }
        publish(true);schedule();
    }
    return {
        snapshot,
        redraw() {publish();schedule();},
        present(value,{snap=false,provenance}={}) {
            if (disposed) return Promise.resolve();
            const old=current, same=sameRef(old,value), imageChanged=old?.media.identity !== value?.media.identity;
            const continuing=same && !imageChanged && !snap && !reduced;
            if (!continuing) finish();
            if (!same) {acknowledged=false;painted=false;}
            if (token !== provenance) {painted=false;acknowledged=false;}
            token=provenance;current=value;last=clock.now();
            const target=value?.focus || full();
            if (value) visibility(true);
            if (!continuing) white=0;
            if (snap || reduced) {focus={...target};motion=null;alpha=value ? 1 : 0;previous=null;fade=null;visibility(!!value);publish();schedule();return Promise.resolve();}
            if (!same) {focus={...target};motion=null;}
            else if (['x','y','zoom'].some(k=>target[k] !== (motion?.to[k] ?? focus[k]))) motion={from:{...focus},to:{...target},elapsed:0};
            if (!imageChanged && !!old === !!value) {
                publish();schedule();
                if (!fade) return Promise.resolve();
                // Metadata/receipt refresh cannot release the outgoing image before its fade ends.
                return new Promise(resolve=>{const previous=settle;settle=()=>{previous?.();resolve();};});
            }
            previous=old;
            alpha=value ? 0 : 1;
            const receipt=value?.receipt, identity=JSON.stringify([receipt?.binding?.stream?.operationId || receipt?.expectedDirectionToken?.sourceKey,receipt?.expectedDirectionToken?.generation,value?.ref]);
            const flash=!!value && !same && value.transition === 'white' && allowWhite && !flashed.has(identity) && last-lastFlash >= 1000;
            if (flash) {flashed.add(identity);lastFlash=last;white=1;if(flashed.size>128)flashed.delete(flashed.values().next().value);}
            fade={from:alpha,to:value ? 1 : 0,elapsed:0,white:flash,duration:value ? same ? FORK_CG_TIMINGS.variant : FORK_CG_TIMINGS.enter : FORK_CG_TIMINGS.exit};
            const promise=new Promise(resolve=>{settle=resolve;});
            publish();schedule();return promise;
        },
        policy({pause=false,reducedMotion=false,snap=false,whiteAllowed=false}={}) {
            paused=pause;reduced=reducedMotion;allowWhite=whiteAllowed;last=clock.now();
            if (!allowWhite && white) {white=0;if(fade)fade.white=false;}
            if (paused) {painted=false;if(frame !== null) clock.cancelAnimationFrame(frame);frame=null;}
            if (reduced || snap) {focus={...(motion?.to || focus)};motion=null;fade=null;white=0;previous=null;alpha=current ? 1 : 0;visibility(!!current);finish();publish();}
            schedule();
        },
        dispose() {disposed=true;if(frame !== null)clock.cancelAnimationFrame(frame);frame=null;current=previous=null;motion=fade=null;alpha=white=0;visibility(false);finish();onFrame(snapshot());}
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {FORK_CG_TIMINGS,forkCgTransform,forkCgWindow,forkCgMotionPolicy,createForkCgConsumer};
