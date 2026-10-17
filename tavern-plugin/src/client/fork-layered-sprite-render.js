// The base remains immutable. The same compositor drives PIXI and the full GAL dialogue portrait.
function forkSpriteBundle(model, requested, view = 'stage', fallback = '') {
    const pack = model && model.spritePack, state = forkSpriteState(pack, requested, fallback);
    return state ? { pack, state, view: state[view], key: model.id + ':' + state.id + ':' + view, revision: JSON.stringify([model.id, state.id, state[view], forkSpriteAtlas(pack, state), state.mouthFrames, state.initialPhoneme]) } : null;
}
function forkSpriteUrls(bundle) {
    if (bundle?.parts) return forkPartsUrls(bundle.parts);
    return bundle ? [bundle.view.src, forkSpriteAtlas(bundle.pack, bundle.state)?.src, bundle.view.mouthOcclusionMask, ...(bundle.view.blink?.blend === 'replace' ? [bundle.view.blink.closed, bundle.view.blink.half] : [])].filter(Boolean) : [];
}
// private fork (layered pilot phase 1): a parts 差分 is the composite of one variant per group, drawn in the rig's
// fixed order underlay → pose → face → mouth → front (source-over at each part's rect, nothing else). Lip-sync picks
// the mouth group's frame, blinking the face group's frame: no overlay is stacked on top of a finished picture.
// `parts` is the resolved closure from sprite-emotions.cjs hybridSpriteRender (src already mapped to URLs).
const FORK_PARTS_REST_PREFIX = 'fork-parts:';
function forkPartsUrls(parts) {
    return [...new Set(Object.values(parts.parts).map(part => part.src))];
}
// Mouth: 'initial'/'idle' keep the rest mouth; a vowel without its own frame uses the closed frame, else the rest mouth.
// Blink: 'half'/'closed' use the face group's frame when authored; anything else is the open (rest) face.
function forkPartsLayers(parts, event = 'initial', blink = 'open') {
    const selection = {...parts.selection}, mouth = parts.mouthFrames || {}, eyes = parts.blinkFrames || {};
    if (FORK_SPRITE_EVENTS.includes(event)) { const id = mouth[event] || mouth.closed; if (id) selection.mouth = id; }
    if ((blink === 'half' || blink === 'closed') && eyes[blink]) selection.face = eyes[blink];
    return parts.drawOrder.filter(group => selection[group] && selection[group] !== 'none').map(group => selection[group]);
}
// private fork (layered renderer fix): a part may declare `clearRect` (rig canvas pixels), cleared right before that part
// is drawn so an old arm outline below it never shows through. Its footprint is rect ∪ clearRect: both enter the dirty
// region of a change and the intersection test of a clipped repaint.
function forkPartsFootprint(part) {
    return part.clearRect ? [part.rect, part.clearRect] : [part.rect];
}
function forkPartsBox(parts, ids) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) for (const [x, y, w, h] of forkPartsFootprint(parts.parts[id])) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
    return x1 > x0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}
// Full paint on a new picture; afterwards only the union of the parts that changed (old and new) is cleared and redrawn,
// clipped, with every layer that touches it, so a mouth frame costs a small region, not a 1.5 MP redraw.
function forkPartsPaint(canvas, parts, images, event, blink) {
    const [width, height] = parts.canvas, layers = forkPartsLayers(parts, event, blink);
    for (const id of layers) {
        const part = parts.parts[id], image = images.get(part.src);
        if (!image || image.width !== part.rect[2] || image.height !== part.rect[3]) throw new Error('分层部件尺寸不匹配');
    }
    const previous = canvas.forkParts, ctx = canvas.getContext('2d');
    let box = null;
    if (previous && previous.revision === parts.revision && canvas.width === width && canvas.height === height) {
        const changed = [...previous.layers.filter(id => !layers.includes(id)), ...layers.filter(id => !previous.layers.includes(id))];
        if (!changed.length) return false;
        box = forkPartsBox(parts, changed);
    } else {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
    }
    const [bx, by, bw, bh] = box || [0, 0, width, height];
    ctx.save();
    if (box) { ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip(); }
    ctx.clearRect(bx, by, bw, bh);
    for (const id of layers) {
        const part = parts.parts[id];
        if (box && forkPartsFootprint(part).every(([x, y, w, h]) => x >= bx + bw || y >= by + bh || x + w <= bx || y + h <= by)) continue;
        // clearRect obeys the clip, so a partial repaint clears exactly what a full paint would inside the box.
        if (part.clearRect) ctx.clearRect(...part.clearRect);
        if (part.replaceRect) ctx.clearRect(...part.replaceRect);
        ctx.drawImage(images.get(part.src), part.rect[0], part.rect[1]);
    }
    ctx.restore();
    canvas.forkParts = { revision: parts.revision, layers };
    return true;
}
// The rest picture (rest mouth, open eyes) of a parts 差分 has a stable pseudo URL, so the scene loads, fades, measures
// and prunes it like any other figure texture; its parts are ordinary URL textures shared by every 差分 that uses them.
function forkPartsRestUrl(parts) {
    return FORK_PARTS_REST_PREFIX + parts.revision;
}
// Scaling straight from the atlas lets bilinear filtering sample neighbouring frames at the
// patch edges. Isolate each frame first (1:1 copy, cached per atlas image) and scale that.
const forkSpriteFramePatches = new WeakMap();
function forkSpriteFramePatch(atlas, f) {
    let patches = forkSpriteFramePatches.get(atlas);
    if (!patches) { patches = new Map(); forkSpriteFramePatches.set(atlas, patches); }
    const key = f.x + ',' + f.y + ',' + f.w + ',' + f.h;
    let patch = patches.get(key);
    if (!patch) {
        patch = document.createElement('canvas'); patch.width = f.w; patch.height = f.h;
        patch.getContext('2d').drawImage(atlas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
        patches.set(key, patch);
    }
    return patch;
}
// Replacement masks store straight RGBA, not opacity to stack over the same coverage.
// Cache the small decoded mask; transparent pixels (including tear exclusions) keep the base.
const forkBlinkPixels = new WeakMap();
function forkSpriteReplacePatch(ctx, image, rect) {
    let patch = forkBlinkPixels.get(image);
    if (!patch) {
        const work = document.createElement('canvas'); work.width = image.width; work.height = image.height;
        const source = work.getContext('2d'); source.drawImage(image, 0, 0);
        patch = source.getImageData(0, 0, image.width, image.height); forkBlinkPixels.set(image, patch);
    }
    const [x, y, w, h] = rect, target = ctx.getImageData(x, y, w, h);
    for (let i = 0; i < patch.data.length; i += 4) if (patch.data[i + 3]) target.data.set(patch.data.subarray(i, i + 4), i);
    ctx.putImageData(target, x, y);
}
function forkSpritePaint(canvas, bundle, images, event, blink) {
    if (bundle.parts) { forkPartsPaint(canvas, bundle.parts, images, event, blink); return; }
    const v = bundle.view, a = forkSpriteAtlas(bundle.pack, bundle.state), base = images.get(v.src), atlas = images.get(a?.src);
    if (!base || base.width !== v.width || base.height !== v.height) throw new Error('分层底图尺寸不匹配');
    if (canvas.width !== v.width) canvas.width = v.width;
    if (canvas.height !== v.height) canvas.height = v.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, v.width, v.height); ctx.drawImage(base, 0, 0);
    const eyes = v.blink;
    if (eyes?.blend === 'replace' && (blink === 'closed' || blink === 'half') && eyes[blink]) forkSpriteReplacePatch(ctx, images.get(eyes[blink]), eyes.rect);
    const frame = forkSpriteFrame(bundle.pack, bundle.state, event, v);
    if (!frame) return;
    if (!atlas || atlas.width !== a.width || atlas.height !== a.height) throw new Error('分层 atlas 尺寸不匹配');
    const f = frame.rect, r = v.mouthByFrame?.[frame.id] || v.mouth;
    const before = v.mouthOcclusionMask ? ctx.getImageData(r.x, r.y, r.w, r.h) : null;
    // private fork: clear only explicitly authored replacement patches.
    if (f.replace) ctx.clearRect(r.x, r.y, r.w, r.h);
    if (f.w === r.w && f.h === r.h) ctx.drawImage(atlas, f.x, f.y, f.w, f.h, r.x, r.y, r.w, r.h);
    else ctx.drawImage(forkSpriteFramePatch(atlas, f), 0, 0, f.w, f.h, r.x, r.y, r.w, r.h);
    if (before) {
        const mask = images.get(v.mouthOcclusionMask);
        if (!mask || mask.width !== v.width || mask.height !== v.height) throw new Error('分层遮挡 mask 尺寸不匹配');
        // Luminance is the mask, not alpha. Composite(base, patched, grayscale) like the asset tool.
        const work = document.createElement('canvas'); work.width = r.w; work.height = r.h;
        const mctx = work.getContext('2d'); mctx.drawImage(mask, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const m = mctx.getImageData(0, 0, r.w, r.h).data, after = ctx.getImageData(r.x, r.y, r.w, r.h);
        for (let i = 0; i < m.length; i += 4) {
            const alpha = (m[i] * 0.299 + m[i + 1] * 0.587 + m[i + 2] * 0.114) / 255;
            for (let channel = 0; channel < 4; channel++) after.data[i + channel] = Math.round(before.data[i + channel] * alpha + after.data[i + channel] * (1 - alpha));
        }
        ctx.putImageData(after, r.x, r.y);
    }
}
const forkSpriteVoice = (() => {
    const samples = new Map();
    return (key, audio, enabled, now = forkForeground.now()) => {
        const old = samples.get(key);
        if (old && old.audio === audio && old.enabled === enabled && old.paused === audio?.paused && old.ended === audio?.ended && (!audio || audio.currentTime + 0.02 >= old.time) && now >= old.at && now - old.at < 12) return old.event;
        const mixer = typeof forkStageAudio !== 'undefined' ? forkStageAudio.get() : null;
        const audible = !mixer || mixer.master > 0 && mixer.voice > 0 && !mixer.muted.master && !mixer.muted.voice;
        const active = Boolean(enabled && audible && !document.hidden);
        const value = forkSpriteVoiceStep(old, audio, active && audio ? forkLipSync.level(audio) : 0, active, now);
        value.enabled = enabled; value.paused = audio?.paused; value.ended = audio?.ended; samples.delete(key); samples.set(key, value);
        while (samples.size > 64) samples.delete(samples.keys().next().value);
        return value.event;
    };
})();
function ForkSpriteImage(props) {
    const h = React.createElement, ref = React.useRef(null), live = React.useRef(props);
    live.current = props;
    const [ready, setReady] = React.useState('');
    const held = React.useRef(null), [,retry] = React.useState(0);
    if (!held.current || held.current.bundle.revision !== props.bundle.revision || held.current.failed && held.current.bundle !== props.bundle) held.current = {bundle:props.bundle,failed:false};
    const bundle = held.current.bundle, identity = bundle.revision;
    React.useEffect(() => {
        let cancelled = false, raf = 0, previous = '', loaded = [];
        const canvas = ref.current; setReady('');
        Promise.all(forkSpriteUrls(bundle).map(async src => {
            const image = new Image(); image.src = src; await image.decode(); return [src, image];
        })).then(records => {
            if (cancelled) return;
            loaded = records; const images = new Map(records);
            function tick() {
                if (cancelled) return;
                const latest = live.current;
                const event = forkSpriteVoice(latest.voiceKey, latest.audio, latest.enabled);
                if (event !== previous) {
                    try { forkSpritePaint(canvas, bundle, images, event); previous = event; setReady(identity); }
                    catch (error) { setReady(''); console.warn('[layered-sprite] portrait retained base', error); return; }
                }
                raf = forkForeground.requestAnimationFrame(tick);
            }
            raf = forkForeground.requestAnimationFrame(tick);
        }).catch(error => { if (!cancelled) {
            held.current.failed = true;
            if (live.current.bundle !== bundle) retry(n => n + 1);
            console.warn('[layered-sprite] portrait retained base', error);
        } });
        return () => { cancelled = true; forkForeground.cancelAnimationFrame(raf); loaded = []; };
    }, [bundle]);
    // private fork: keep face orientation on the shared base/canvas wrapper.
    return h('span', { className: (props.className || '') + ' fork-sprite-surface', 'data-enter': props.enter, 'data-out': props.out || undefined, 'data-sprite-state': bundle.state.id, 'data-face-actor': props.faceActor },
        h(ForkPackImage, { identity, src: props.bundle.view.src, alt: '', draggable: false, style: { visibility: ready === identity ? 'hidden' : 'visible' } }),
        h('canvas', { ref, width: bundle.view.width, height: bundle.view.height, 'aria-hidden': true, style: { visibility: ready === identity ? 'visible' : 'hidden' } }));
}
function forkSpriteClearScene(entry) {
    if (entry.spriteTexture) entry.spriteTexture.destroy(true);
    entry.spriteTexture = null; entry.spriteCanvas = null; entry.spriteEvent = ''; entry.spriteBundleKey = '';
}
function forkSpriteTickScene(entry, textures, PIXI, enabled) {
    const bundle = entry.figure.spriteBundle;
    if (!bundle) { if (entry.spriteTexture) forkSpriteClearScene(entry); return false; }
    const sprite = entry.sprite;
    if (!sprite || entry.loadedIdentity !== entry.figure.identity) return true;
    if (entry.spriteBundleKey !== bundle.revision) { forkSpriteClearScene(entry); entry.spriteBundleKey = bundle.revision; }
    const images = new Map();
    for (const url of forkSpriteUrls(bundle)) {
        const record = textures.get(url), source = record?.ready && record.texture?.baseTexture?.resource?.source;
        if (!source) { sprite.texture = entry.baseTexture; return true; }
        images.set(url, source);
    }
    // private fork (layered pilot): a parts 差分 also repaints when its blink phase changes (face group frame).
    const voice = forkSpriteVoice(entry.figure.spriteVoiceKey, entry.figure.audio, enabled);
    const event = bundle.parts || bundle.view?.blink?.blend === 'replace' ? voice + '|' + (entry.spriteBlink || 'open') : voice;
    // At rest the loaded rest composite is already the picture: no second full-size canvas/texture until it animates.
    if (bundle.parts && !entry.spriteTexture && (voice === 'initial' || voice === 'idle') && entry.spriteBlink !== 'half' && entry.spriteBlink !== 'closed') {
        sprite.texture = entry.baseTexture; entry.spriteEvent = event; return true;
    }
    if (entry.spriteEvent !== event) {
        try {
            entry.spriteCanvas ||= document.createElement('canvas');
            forkSpritePaint(entry.spriteCanvas, bundle, images, voice, entry.spriteBlink);
            if (!entry.spriteTexture) entry.spriteTexture = PIXI.Texture.from(entry.spriteCanvas);
            else entry.spriteTexture.baseTexture.update();
            entry.spriteEvent = event;
        } catch (error) {
            sprite.texture = entry.baseTexture;
            if (entry.spriteFault !== bundle.key) console.warn('[layered-sprite] stage retained base', error);
            entry.spriteFault = bundle.key; return true;
        }
    }
    sprite.texture = entry.spriteTexture || entry.baseTexture;
    return true;
}
