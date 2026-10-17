// Private fork (docs/fork/galgame-stage.md): the stage's scene renderer. One pixi Application draws
// everything behind the DOM text box: backgrounds, figures (Live2D models and static portraits), the
// camera and the screen overlays. ForkGalStage hands it a plain scene description every render; the
// pixi side eases towards it in its own ticker, so paging never re-renders pixi objects.
//
// Display tree (filters attach to any of these through forkGalFilterChain):
//   stage
//   ├─ world       camera: the shot's focus point, zoom, rotation, shake offset. filters: the stage look
//   │  │           (grade, bloom, screen, film; fork-gal-looks.js), beat blur / glitch / shockwave
//   │  ├─ backdrop background layers (current + incoming, transition masks; each picture carries its
//   │  │           own time-of-day correction) and the vignette. filters: depth-of-field / dream blur
//   │  ├─ backFx   weather particles behind the figures
//   │  ├─ figures  sortable; one container per figure (Live2D model or portrait sprites). filters: one
//   │  │           colour matrix (time grade, figure light, speaker lighting, alpha), rim glow, blur
//   │  ├─ frontFx  weather particles in front of the figures
//   │  └─ emotes   emote stickers above heads
//   └─ overlay     screen space: transition cover, look overlays (vignette, haze, leaks, flare), flashes,
//                  lightning, blackout

// @include fork-gal-mouth.js
// @include fork-sprite-blink.cjs
// @include fork-spine.js
// @include fork-spine-preview.js

// Stage-keyed readers expose geometry, never Pixi nodes or mutable scene state.
const forkGalFigureSources = new WeakMap();
function forkGalFigureRects(figures, camera, W, H) {
    if (!camera) return [];
    const c = Math.cos(camera.rotation || 0), s = Math.sin(camera.rotation || 0), z = camera.zoom || 1;
    function project(rect, shift) {
        const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]].map(([x, y]) => {
            x -= camera.fx * W; y += shift - camera.fy * H;
            return { x: camera.ax * W + z * (c * x - s * y), y: camera.ay * H + z * (s * x + c * y) };
        });
        const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
        return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
    }
    return figures.filter(f => f.visible && f.body && f.head).map(f => ({ id: f.id,
        body: project(f.body, f.shift || 0), head: project({ x: f.head.x - f.head.width / 2, y: f.head.top, width: f.head.width, height: f.head.chin - f.head.top }, f.shift || 0) }));
}
// private fork: under a close-up, a non-subject figure left mostly outside the frame (a sliver at the
// edge) fades out instead of reading as a framing error. Fully visible figures stay.
function forkGalCropHidden(body, camera, W, H, minVisible = 0.75) {
    if (!body || !camera || !(body.width > 0)) return false;
    const [rect] = forkGalFigureRects([{ id: "", visible: true, body, head: { x: body.x + body.width / 2, width: 1, top: body.y, chin: body.y + 1 } }], camera, W, H);
    const visible = Math.max(0, Math.min(W, rect.body.x + rect.body.width) - Math.max(0, rect.body.x));
    return visible / rect.body.width < minVisible;
}

// ---------- Scene helpers (pure; tests/fork-gal-scene.test.mjs) ----------
function forkGalFrameRate(quality, animated, refreshRate, frameCap = 60) {
    const display = Number.isFinite(refreshRate) && refreshRate > 0 ? refreshRate : Infinity;
    const cap = [0, 30, 60, 120].includes(frameCap) ? frameCap : 60;
    if (quality === "low" || !animated) return Math.min(display, 30);
    // Zero bypasses software pacing: requestAnimationFrame follows the actual display refresh.
    return cap === 0 ? 0 : Math.min(display, cap);
}
// Round to the nearest available vsync without Pixi 6's integer-ms truncation/drift.
function forkGalFrameDue(pace, now, fps) {
    const gap = now - pace.last;
    pace.last = now;
    if (gap > 0 && gap < 50) pace.vsync = pace.vsync ? Math.min(pace.vsync * 0.95 + gap * 0.05, gap * 1.1) : gap;
    if (fps === 0) { pace.fps = 0; pace.next = now; return true; }
    const period = 1000 / fps, tolerance = Math.min(period * 0.45, (pace.vsync || 0) / 2);
    if (pace.fps !== fps || now - pace.next > period * 2) { pace.fps = fps; pace.next = now; }
    if (now + tolerance < pace.next) return false;
    pace.next += period;
    return true;
}
// URL ownership spans scene instances and in-flight loads (outfit crossfades can share a cache entry).
function forkGalTextureOwners() {
    const records = new Map();
    let pending = 0;
    function sweep() {
        if (pending) return;
        records.forEach((record, key) => {
            if (record.count) return;
            records.delete(key);
            const bases = new Set();
            record.textures.forEach(texture => { if (texture.baseTexture) bases.add(texture.baseTexture); texture.destroy(false); });
            bases.forEach(base => { if (!base.destroyed) base.destroy(); });
        });
    }
    return {
        begin() { pending++; },
        end() { pending--; sweep(); },
        retain(textures) {
            const keys = new Set();
            (textures || []).forEach(texture => {
                const base = texture.baseTexture, resource = base && base.resource;
                const key = resource && (resource.url || resource.source && resource.source.src) || base || texture;
                let record = records.get(key);
                if (!record) { record = { count: 0, textures: new Set() }; records.set(key, record); }
                record.textures.add(texture);
                if (!keys.has(key)) { record.count++; keys.add(key); }
            });
            let released = false;
            return () => { if (released) return; released = true; keys.forEach(key => records.get(key).count--); sweep(); };
        }
    };
}
// A line token changes only on paging, not on typing/audio rerenders. Consume blocked attempts
// too: finishing a higher-priority act must not start a delayed mood motion halfway into a line.
function forkGalMoodMotionPlan(previous, figure, groups, now, random, suppressed = false) {
    const state = previous || { line: null, mood: null, lastAt: -Infinity };
    const line = figure.visible !== false && figure.speaking ? figure.moodLine : null;
    if (line == null) return { state: Object.assign({}, state, { line: null, waiting: false }), motion: null };
    const mood = figure.mood || "calm", changed = mood !== state.mood;
    const fresh = line !== state.line || changed, pending = !fresh && state.waiting;
    if (!fresh && !pending) return { state, motion: null };
    const next = { line, mood, lastAt: state.lastAt, lineAt: fresh ? now : state.lineAt, waiting: false };
    // private fork: history/skip keeps expressions, but consumes rather than replays mood gestures.
    if (suppressed) return { state: next, motion: null };
    // private fork: pack outfits name their gesture (emotionMap motion, projected as moodMotion; null = none)
    // and play it once per emotion change; card models keep Mood_<id> with the 8 s repeat.
    const explicit = figure.moodMotion !== undefined;
    const group = explicit ? figure.moodMotion : "Mood_" + mood, clips = group && groups && groups[group];
    if (!Array.isArray(clips) || !clips.length || (!pending && !changed && (explicit || now - state.lastAt < 8000))) return { state: next, motion: null };
    // Expressions change immediately; only the gesture waits for the matching line's voice.
    if (figure.voiced && !figure.voiceStarted && now - next.lineAt < 1200) {
        next.waiting = true;
        return { state: next, motion: null };
    }
    next.lastAt = now;
    return { state: next, motion: { group, index: Math.min(clips.length - 1, Math.floor((random == null ? 0 : random) * clips.length)), priority: 2 } };
}
function forkGalPlayMoodMotion(entry, figure, now, suppressed) {
    const plan = forkGalMoodMotionPlan(entry.moodMotion, figure, entry.model.internalModel.settings.motions, now, Math.random(), suppressed);
    entry.moodMotion = plan.state;
    if (plan.motion) {
        const motion = plan.motion;
        // NORMAL (2) can crossfade another mood, but cannot interrupt a FORCE director act.
        Promise.resolve(entry.model.motion(motion.group, motion.index, motion.priority)).catch(error => console.warn("[fork-gal-scene] mood motion failed", error));
    }
}
function forkGalMotionFade(seconds) { return Number.isFinite(seconds) && seconds >= 0.45 ? seconds : 0.45; }
function forkGalMotionTransitions(internal) { forkGalInstallMotionLayers(internal); }
function forkGalShouldBlink(eyeOpen) { return !Number.isFinite(eyeOpen) || eyeOpen >= 0.2; }
function forkGalOwnBlink(internal, seconds) {
    const blink = internal.eyeBlink;
    if (!blink) return;
    // Layered motion/springs -> blink -> saveParameters -> expressions -> physics -> lip sync.
    internal.eyeBlink = undefined;
    const ids = blink.getParameterIds();
    internal.on("afterMotionUpdate", function () {
        const core = internal.coreModel, open = ids.map(id => core.getParameterValueById(id));
        // Advance the blink clock even under a closed-eye pose; never force that pose open.
        blink.updateParameters(core, seconds());
        ids.forEach((id, i) => core.setParameterValueById(id, forkGalShouldBlink(open[i]) ? Math.min(open[i], core.getParameterValueById(id)) : open[i]));
    });
}
// private fork: the one Live2D idle, shared by the stage and the figure editor's preview — layered motions (the Idle group
// loops uninterrupted, 开场动作 gestures blend over it), the blink running under it, and the Idle group started. The
// import dialog names the chosen 待机 group Idle. seconds(): the blink clock (default: the motion layers' own step).
function forkLive2dStartIdle(model, seconds) {
    const internal = model.internalModel, groups = internal.settings.motions || {};
    forkGalMotionTransitions(internal);
    const layers = internal.motionManager.forkMotionLayers;
    forkGalOwnBlink(internal, seconds || (() => layers ? layers.dt : 0));
    const idle = Object.keys(groups).find(name => /^idle$/i.test(name));
    if (idle) { internal.motionManager.groups.idle = idle; model.motion(idle, 0, 1); }
}
// private fork: anatomy uses canvas pixels here; transform once, including the sprite anchor.
function forkGalHeadCheeks(head, cheeks, matrix, ax = 0, ay = 0) {
    if (!head || !cheeks) return head;
    const point = ([x, y]) => [matrix.a * (x - ax) + matrix.c * (y - ay) + matrix.tx, matrix.b * (x - ax) + matrix.d * (y - ay) + matrix.ty];
    return { ...head, cheeks: { left: point(cheeks.left), right: point(cheeks.right), size: cheeks.size * Math.hypot(matrix.c, matrix.d) } };
}
// Mesh points are Cubism units (Y up), not model canvas pixels. The caller supplies
// the complete affine transform into the emote layer, excluding the shared camera.
function forkGalMeshHead(arrays, transform, rotation) {
    const angle = rotation || 0, c = Math.cos(angle), s = Math.sin(angle);
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const vertices of arrays) for (let i = 0; i + 1 < vertices.length; i += 2) {
        const x = transform.a * vertices[i] + transform.c * vertices[i + 1] + transform.tx;
        const y = transform.b * vertices[i] + transform.d * vertices[i + 1] + transform.ty;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const u = c * x + s * y, v = -s * x + c * y;
        left = Math.min(left, u); right = Math.max(right, u); top = Math.min(top, v); bottom = Math.max(bottom, v);
    }
    if (!(right > left && bottom > top)) return null;
    const u = (left + right) / 2, v = (top + bottom) / 2, y = s * u + c * v, h = bottom - top;
    return { x: c * u - s * v, top: y - h / 2, chin: y + h / 2, width: right - left, rotation: angle };
}
function forkGalFaceDrawables(ids, parts, parents) {
    // Older converted MOCs can expose invalid parent indices. Do not interpret those
    // as Parts: Magia Record provides an explicitly named, deforming head hit mesh.
    const head = ids.findIndex(id => /^(?:HitAreaHead|HeadHitArea)$/i.test(id));
    if (head >= 0) return [head];
    const validParents = parents && parents.length === ids.length && Array.from(parents).every(i => i >= -1 && i < parts.length);
    const labels = ids.map((id, i) => id + " " + (validParents && parts[parents[i]] || ""));
    let indices = labels.map((label, i) => /face/i.test(label) ? i : -1).filter(i => i >= 0);
    if (!indices.length) indices = labels.map((label, i) => /cheek|eye|mouth/i.test(label) ? i : -1).filter(i => i >= 0);
    return indices;
}
function forkGalCheekIndex(core) {
    const index = core.getParameterIndex("ParamCheek");
    // Cubism allocates a virtual index for unknown IDs instead of returning -1.
    return index >= 0 && index < core.getParameterCount() ? index : -1;
}
function forkGalCheekValue(expression, amount, min, max) {
    return Math.max(min, Math.min(max, expression + Math.max(0, amount)));
}
function forkGalFlushFace(model) {
    // pixi-live2d-display defers model.update() until _render. Consume that queued
    // CPU update before sampling vertices; _render then draws without advancing twice.
    if (model.deltaTime) {
        model.internalModel.update(model.deltaTime, model.elapsedTime);
        model.deltaTime = 0;
    }
}
function forkGalInitFace(model) {
    const im = model.internalModel, core = im.coreModel, raw = core.getModel ? core.getModel() : core._model;
    const indices = forkGalFaceDrawables(core.getDrawableIds(), raw && raw.parts.ids || [], raw && raw.drawables.parentPartIndices);
    return { indices, reference: indices.map(i => core.getDrawableVertices(i).slice()), cheek: forkGalCheekIndex(core) };
}
// Least-squares rigid rotation of the same vertices, independent of face translation.
// Unlike eye bounding boxes this stays stable while blinking or changing expression.
function forkGalMeshRotation(reference, arrays) {
    let ax = 0, ay = 0, bx = 0, by = 0, n = 0;
    for (let j = 0; j < arrays.length; j++) for (let i = 0; i < arrays[j].length; i += 2) {
        ax += reference[j][i]; ay += reference[j][i + 1]; bx += arrays[j][i]; by += arrays[j][i + 1]; n++;
    }
    if (!n) return 0;
    ax /= n; ay /= n; bx /= n; by /= n;
    let dot = 0, cross = 0;
    for (let j = 0; j < arrays.length; j++) for (let i = 0; i < arrays[j].length; i += 2) {
        const x = reference[j][i] - ax, y = reference[j][i + 1] - ay;
        const u = arrays[j][i] - bx, v = arrays[j][i + 1] - by;
        dot += x * u + y * v; cross += x * v - y * u;
    }
    return Math.atan2(cross, dot);
}
function forkGalFallbackHead(head, params) {
    const h = head.chin - head.top, p = params || {};
    const rotation = -((p.ParamAngleZ || 0) + (p.ParamBodyAngleZ || 0) * 0.7) * Math.PI / 180;
    const pivot = head.chin + h * 0.12, dy = (head.top + head.chin) / 2 - pivot;
    const x = head.x - Math.sin(rotation) * dy + head.width * ((p.ParamAngleX || 0) * 0.12 + (p.ParamBodyAngleX || 0) * 0.2) / 30;
    const y = pivot + Math.cos(rotation) * dy - h * (p.ParamAngleY || 0) / 30 * 0.08;
    return { x, top: y - h / 2, chin: y + h / 2, width: head.width, rotation };
}
function forkGalDisplayMatrix(display, target, local) {
    const point = (x, y) => target.toLocal(display.toGlobal({ x: local.a * x + local.c * y + local.tx, y: local.b * x + local.d * y + local.ty }));
    const o = point(0, 0), x = point(1, 0), y = point(0, 1);
    return { a: x.x - o.x, b: x.y - o.y, c: y.x - o.x, d: y.y - o.y, tx: o.x, ty: o.y };
}
function forkGalSmoothHead(face, head, now) {
    const keys = ["x", "top", "chin", "width", "rotation"], dt = Math.max(0, Math.min(0.05, (now - face.at) / 1000));
    if (!face.spring) face.spring = Object.fromEntries(keys.map(key => [key, forkGalSpringValue(head[key] || 0)]));
    else if (dt > 0) keys.forEach(key => forkGalSpring(face.spring[key], head[key] || 0, 100, dt));
    face.at = now;
    return Object.fromEntries(keys.map(key => [key, face.spring[key].v]));
}
function forkGalLipSyncIds(settings) {
    const groups = settings && settings.json && settings.json.Groups || [];
    const ids = groups.filter(group => group.Target === "Parameter" && group.Name === "LipSync").flatMap(group => group.Ids || []);
    return ids.length ? ids : ["ParamMouthOpenY"];
}
function forkGalApplyLipSync(core, ids, entry) {
    if (entry.mouthActive) ids.forEach(id => core.setParameterValueById(id, entry.mouth));
}
// Director head moves (gaze, nod/shake/bow acts) are offsets on the model's own pose, like Cubism's look-at: idle and
// gesture head motion keep playing while a figure looks aside. Applied on afterMotionUpdate, i.e. before physics, so the
// inputs the model's physics3 declares (head angles driving hair, ribbons) follow them. The core clamps to the model's range.
function forkGalApplyStageHead(core, look, param) {
    const p = param || {}, x = look * 20 + (p.angleX || 0);
    if (x) core.addParameterValueById("ParamAngleX", x);
    if (look) core.addParameterValueById("ParamEyeBallX", look * 0.8);
    if (p.angleY) core.addParameterValueById("ParamAngleY", p.angleY);
}
// Two thresholds and an 80 ms hold keep a two-frame mouth from chattering. Stopping
// playback overrides the hold immediately; there is deliberately no text/synthetic fallback.
function forkGalFlapStep(previous, amplitude, voiced, now) {
    const state = previous || { open: false, changedAt: -Infinity };
    if (!voiced) return { open: false, changedAt: state.open ? now : state.changedAt };
    const level = Number.isFinite(amplitude) ? amplitude : 0;
    const open = state.open ? level >= 0.18 : level > 0.32;
    return open !== state.open && now - state.changedAt >= 80 ? { open, changedAt: now } : state;
}
function forkGalStaticVoiced(figure) {
    const audio = figure.audio;
    return Boolean(figure.speaking && figure.visible !== false && audio && !audio.paused && !audio.ended && !audio.muted && audio.volume !== 0);
}
const forkGalEase = {
    linear: t => t,
    inQuad: t => t * t,
    outQuad: t => 1 - (1 - t) * (1 - t),
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    inOutSine: t => (1 - Math.cos(Math.PI * t)) / 2
};
function forkGalClamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
// Critically damped spring, exact for any time step: starts smoothly, never overshoots from rest and
// keeps its velocity when the target changes mid-move. s = { v: value, d: velocity }; dt in seconds.
function forkGalSpring(s, target, omega, dt) {
    const x = s.v - target, e = Math.exp(-omega * dt), temp = (s.d + omega * x) * dt;
    s.v = target + (x + temp) * e;
    s.d = (s.d - omega * temp) * e;
    if (Math.abs(s.v - target) < 1e-5 && Math.abs(s.d) < 1e-4) { s.v = target; s.d = 0; }
    return s.v;
}
function forkGalSpringValue(v) { return { v, d: 0 }; }
// A timed move between two values (camera push, grade): { from, to, start, duration, ease }.
function forkGalTween(from, to, start, duration, ease) { return { from, to, start, duration: Math.max(0, duration), ease: ease || "inOutCubic" }; }
function forkGalTweenAt(tween, now) {
    if (!tween) return 0;
    const t = tween.duration > 0 ? forkGalClamp01((now - tween.start) / tween.duration) : 1;
    return tween.from + (tween.to - tween.from) * forkGalEase[tween.ease](t);
}
// Renderer resolution: devicePixelRatio capped at 2; the low quality setting renders at 1.
function forkGalResolution(quality, dpr) { return quality === "low" ? 1 : Math.max(1, Math.min(2, dpr || 1)); }
// Cover-fit of a picture to the screen (overscan > 1 leaves room for camera shake).
function forkGalCover(texW, texH, W, H, overscan) {
    const scale = Math.max(W / (texW || 1), H / (texH || 1)) * (overscan || 1);
    return { scale, x: (W - texW * scale) / 2, y: (H - texH * scale) / 2 };
}

// Background transitions. The director may pick one per scene change later; the default is a cross-fade.
const FORK_GAL_TRANSITIONS = { cut: 0, fade: 600, black: 1200, white: 1000, wipe: 900, iris: 1000 };
function forkGalBackgroundTransition(kind, desc, previous) {
    const background = desc.background || {};
    const plan = forkGalTransitionPlan(kind, { skipping: desc.skipping, first: !previous, direction: background.direction });
    if (!desc.snap && previous && background.scene && previous.scene === background.scene && desc.timeFadeMs === 2500) {
        return { ...plan, kind: "fade", duration: 2500 };
    }
    return plan;
}
function forkGalTransitionPlan(kind, options) {
    options = options || {};
    let name = Object.prototype.hasOwnProperty.call(FORK_GAL_TRANSITIONS, kind) ? kind : "fade";
    // The very first picture rises out of the dark stage; skipping pages keeps changes short and plain.
    if (options.first && name !== "cut") name = "fade";
    let duration = FORK_GAL_TRANSITIONS[name];
    if (options.skipping && name !== "cut") { name = "fade"; duration = 180; }
    return { kind: name, duration, direction: options.direction === "right" ? "right" : "left" };
}
// State of a transition at t (0..1): incoming layer alpha, full-screen cover (black/white), mask progress
// (wipe/iris, -1 = no mask). When done the incoming layer is plain and the layers below can go.
function forkGalTransitionFrame(plan, t) {
    const p = plan.duration > 0 ? forkGalClamp01(t) : 1;
    const frame = { incoming: 1, cover: 0, color: 0x000000, mask: -1, done: p >= 1 };
    if (frame.done) return frame;
    if (plan.kind === "fade") frame.incoming = forkGalEase.inOutSine(p);
    else if (plan.kind === "black" || plan.kind === "white") {
        const out = plan.kind === "black" ? 0.42 : 0.36, hold = plan.kind === "black" ? 0.58 : 0.46;
        frame.color = plan.kind === "black" ? 0x000000 : 0xffffff;
        frame.cover = p < out ? forkGalEase.inOutSine(p / out) : p < hold ? 1 : forkGalEase.inOutSine(1 - (p - hold) / (1 - hold));
        frame.incoming = p < out ? 0 : 1; // swapped under the full cover
    } else if (plan.kind === "wipe" || plan.kind === "iris") frame.mask = forkGalEase.inOutCubic(p);
    return frame;
}
// private fork: switch scale only while the existing scene transition conceals the figures.
// Black/white already cover the whole stage; the other transitions fade the figure layer at the cut.
function forkGalFigureCutFrame(plan, progress) {
    if (!plan || plan.kind === "cut" || progress >= 1) return { swap: true, alpha: 1 };
    if (plan.kind === "black" || plan.kind === "white") return { swap: forkGalTransitionFrame(plan, progress).incoming === 1, alpha: 1 };
    const p = forkGalClamp01(progress);
    return { swap: p >= 0.5, alpha: Math.abs(2 * p - 1) };
}
// Wipe mask: a white strip (opaque part = screen width, then a soft edge of soft × width) slides across.
function forkGalWipeRect(progress, W, soft, direction) {
    const width = W * (1 + soft), x = -width * (1 - progress);
    return direction === "right" ? { x: W - x, width, flip: -1 } : { x, width, flip: 1 };
}
// Iris mask: a soft disc (opaque up to inner × radius) centred at (cx, cy) growing until it covers the screen.
function forkGalIrisSize(progress, W, H, cx, cy, inner) {
    const reach = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    return progress * 2 * reach / (inner || 1);
}

// Colour matrices (pixi ColorMatrixFilter layout: 4 rows × 5, offsets in 0..1). multiply(a, b) = apply b, then a.
const forkGalMatrix = {
    identity: () => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    multiply(a, b) {
        const out = new Array(20);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
            let sum = c === 4 ? a[r * 5 + 4] : 0;
            for (let k = 0; k < 4; k++) sum += a[r * 5 + k] * b[k * 5 + c];
            out[r * 5 + c] = sum;
        }
        return out;
    },
    chain(...list) { return list.reduce((acc, m) => forkGalMatrix.multiply(m, acc), forkGalMatrix.identity()); },
    saturate(s) {
        const r = 0.2126 * (1 - s), g = 0.7152 * (1 - s), b = 0.0722 * (1 - s);
        return [r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0];
    },
    scale(r, g, b) { return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]; },
    contrast(c) { const o = 0.5 * (1 - c); return [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0]; },
    offset(r, g, b) { return [1, 0, 0, 0, r, 0, 1, 0, 0, g, 0, 0, 1, 0, b, 0, 0, 0, 1, 0]; },
    mix(a, b, t) { return a.map((value, i) => value + (b[i] - value) * t); },
    isIdentity(m) { const id = forkGalMatrix.identity(); return m.every((value, i) => Math.abs(value - id[i]) < 1e-3); }
};
// The time of day is graded per picture and per figure (not on world, where the mood looks live), from
// the `time` stage looks (forkGalTimeGrade / forkGalLayerCorrection, fork-gal-looks.js): the paired grade
// on every picture and figure alike (so nobody looks pasted on) and, for a stand-in picture that shows
// another time, a "day-for-night" correction on the backdrop only. A picture already showing that time
// (its own name says so) stays as it is while the figures still get the paired grade, so they match it.
// Figure light: glow (warm lift; the rim / aura is a glow filter on top) and shadow (a near-black
// silhouette with a navy cast; a faint cool edge glow outlines it).
const FORK_GAL_GLOW_MATRIX = forkGalMatrix.chain(forkGalMatrix.scale(1.07, 1.03, 0.94), forkGalMatrix.offset(0.035, 0.022, 0.004));
const FORK_GAL_SHADOW_MATRIX = [0.06, 0.03, 0.01, 0, 0.012, 0.02, 0.07, 0.02, 0, 0.02, 0.02, 0.04, 0.11, 0, 0.045, 0, 0, 0, 1, 0];
// One colour matrix per figure: time grade, then figure light, then the speaker lighting (shade), with
// the figure's alpha in the alpha row.
function forkGalFigureMatrix(shade, alpha, glow, shadow, grade) {
    const M = forkGalMatrix;
    const lit = M.mix(M.mix(M.identity(), FORK_GAL_GLOW_MATRIX, glow || 0), FORK_GAL_SHADOW_MATRIX, shadow || 0);
    const m = M.multiply(M.scale(shade, shade, shade), M.multiply(lit, grade || M.identity()));
    m[15] = 0; m[16] = 0; m[17] = 0; m[18] = alpha; m[19] = 0;
    return m;
}

// Camera: the persistent state (zoom in → slow push to 1.12; pan and rotation reserved) and one-shots.
const FORK_GAL_ZOOM_IN = 1.12;
const FORK_GAL_ZOOM_MS = 1200;
function forkGalCameraTarget(camera) {
    camera = camera || {};
    const number = (value, fallback) => typeof value === "number" && isFinite(value) ? value : fallback;
    return { zoom: Math.max(0.5, number(camera.zoom, 1)), panX: number(camera.panX, 0), panY: number(camera.panY, 0), rotation: number(camera.rotation, 0) };
}
// Shake: an additive, decaying offset in screen pixels. Strength 1–3; deterministic for a seed.
const FORK_GAL_SHAKE = [[0, 0], [4, 510], [14, 600], [24, 690]];
function forkGalShakeAt(strength, seed, ms) {
    const [px, duration] = FORK_GAL_SHAKE[Math.max(1, Math.min(3, Math.round(strength) || 1))];
    const t = ms / duration;
    if (t >= 1 || t < 0) return { x: 0, y: 0, done: t >= 1 };
    const s = seed || 0, env = Math.pow(1 - t, 1.6) * Math.min(1, t * 12), sec = ms / 1000;
    const x = px * env * (0.62 * Math.sin(2 * Math.PI * 17 * sec + s) + 0.38 * Math.sin(2 * Math.PI * 27 * sec + s * 2.3));
    const y = px * 0.6 * env * (0.6 * Math.sin(2 * Math.PI * 21 * sec + s * 1.7) + 0.4 * Math.sin(2 * Math.PI * 31 * sec + s * 3.1));
    return { x, y, done: false };
}
// Screen overlays for one-shot effects: flash (white), fade black (dip and return), fade in (from black).
function forkGalOverlayAt(effect, ms) {
    if (effect.op === "flash") { const t = ms / 520; return { color: "white", alpha: t >= 1 ? 0 : 0.92 * (1 - forkGalEase.outCubic(forkGalClamp01(t))), done: t >= 1 }; }
    if (effect.op === "fade" && effect.value === "in") { const t = ms / 1200; return { color: "black", alpha: t >= 1 ? 0 : 1 - forkGalEase.inQuad(forkGalClamp01(t)), done: t >= 1 }; }
    if (effect.op === "fade") {
        const t = ms / 1900;
        const alpha = t >= 1 ? 0 : t < 0.28 ? forkGalEase.inOutSine(t / 0.28) : t < 0.5 ? 1 : forkGalEase.inOutSine(1 - (t - 0.5) / 0.5);
        return { color: "black", alpha, done: t >= 1 };
    }
    return { color: "", alpha: 0, done: true };
}

// private fork: figures fade at their slot; horizontal travel would cross the stage axis.
// Reflow still eases; "none" (skipping) reveals instantly.
const FORK_GAL_SCENE_DIP_MS = 480;
// Add / replace / retire decisions for the figures on stage. current: [{ key, kind, url, leaving }].
function forkGalFigurePlan(current, figures) {
    const plan = { add: [], replace: [], retire: [], revive: [] };
    const wanted = new Map(figures.map(figure => [figure.key, figure]));
    current.forEach(function (entry) {
        const figure = wanted.get(entry.key);
        if (!figure) { if (!entry.leaving) plan.retire.push(entry.key); return; }
        if (figure.kind !== entry.kind || ((figure.kind === "live2d" || figure.kind === "spine") && figure.identity !== entry.identity)) plan.replace.push(entry.key);
        else if (entry.leaving) plan.revive.push(entry.key);
    });
    figures.forEach(function (figure) { if (!current.some(entry => entry.key === figure.key)) plan.add.push(figure); });
    return plan;
}
// First frame of a figure whose picture has just become ready.
function forkGalFigureInit(entry, figure) {
    const base = figure.x != null ? figure.x : 0.5;
    // private fork: insertion is not travel across the stage; fade at the assigned slot.
    entry.cx = forkGalSpringValue(base);
    entry.alpha = forkGalSpringValue(figure.enter === "none" ? 1 : 0);
    entry.shade = forkGalSpringValue(figure.shade != null ? figure.shade : 1);
    entry.flip = forkGalSpringValue(figure.gaze === -1 ? -1 : 1);
    entry.lift = forkGalSpringValue(figure.close ? 1 : 0);
    entry.look = 0; entry.lookOn = false;
    entry.scene = figure.scene; entry.hideUntil = 0; entry.exitFrom = null;
    entry.started = true;
    return entry;
}
// One eased step towards the description. now in ms, dt in seconds.
function forkGalFigureStep(entry, figure, now, dt) {
    if (!entry.started) forkGalFigureInit(entry, figure);
    const base = figure.x != null ? figure.x : entry.cx.v;
    // A new scene: figures dip out with the old background and come back with the new one.
    if (figure.scene !== entry.scene) { entry.scene = figure.scene; if (figure.enter !== "none") entry.hideUntil = now + FORK_GAL_SCENE_DIP_MS; }
    const hiding = entry.hideUntil > now;
    if (hiding && entry.alpha.v < 0.04) { entry.cx.v = base; entry.cx.d = 0; }
    const gone = figure.visible === false;
    // private fork: exits fade in place, even when old records request a crossing sweep.
    let tx;
    if (gone) {
        if (entry.exitFrom == null) entry.exitFrom = entry.cx.v;
        tx = entry.exitFrom;
    } else { entry.exitFrom = null; tx = hiding ? entry.cx.v : base; }
    forkGalSpring(entry.cx, tx, 7.5, dt);
    forkGalSpring(entry.alpha, gone || hiding || entry.cropped ? 0 : 1, hiding ? 18 : gone ? 10 : 8, dt);
    entry.alpha.v = forkGalClamp01(entry.alpha.v);
    forkGalSpring(entry.shade, figure.shade != null ? figure.shade : 1, 10, dt);
    forkGalSpring(entry.flip, figure.gaze === -1 ? -1 : 1, 9, dt);
    forkGalSpring(entry.lift, figure.close ? 1 : 0, 7, dt);
    entry.look += ((figure.gaze == null ? 0 : figure.gaze) - entry.look) * (1 - Math.exp(-5.4 * dt));
    entry.lookOn = figure.gaze != null || Math.abs(entry.look) > 0.02;
    return entry;
}
// A leaving figure can be destroyed once it is transparent or off screen.
function forkGalFigureGone(entry) { return !entry.started || entry.alpha.v < 0.01 || entry.cx.v < -0.25 || entry.cx.v > 1.25; }
// Visibility only: film bars and the normal topbar never change figure size or the ground line.
function forkGalVisibleFrame(W, H, film, uiTop) {
    // Same as the CSS --film-bar: the cinema bar, but never shorter than two subtitle lines plus the name.
    const filmFont = Math.min(22, Math.max(16, W * 0.015));
    const bar = Math.max(Math.min(H * 0.16, Math.max(H * 0.08, (H - W / 2.35) / 2)), filmFont * 3.4 + 58.25);
    const mix = forkGalClamp01(Number(film) || 0), ui = Math.min(H * 0.2, uiTop == null ? 52 : uiTop);
    const top = ui * (1 - mix) + bar * mix, bottom = H - bar * mix;
    return { top, bottom, height: Math.max(1, bottom - top), margin: (bottom - top) * (0.015 + 0.015 * mix) };
}
// Ease the frame itself, not a lagging safety clamp: every intermediate layout remains safe.
function forkGalFrameMix(from, to, elapsed) {
    const t = forkGalClamp01(elapsed / 700);
    if (t === 0 || t === 1) return t === 0 ? from : to;
    // Invert CSS cubic-bezier(.65, 0, .35, 1), shared with the 700ms letterbox transition.
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
        const p = (lo + hi) / 2, x = 3 * (1 - p) * (1 - p) * p * 0.65 + 3 * (1 - p) * p * p * 0.35 + p * p * p;
        if (x < t) lo = p; else hi = p;
    }
    const p = (lo + hi) / 2;
    return from + (to - from) * p * p * (3 - 2 * p);
}
// private fork: a close shot frames a face and upper body, not a fixed enlargement of the ruler.
function forkGalCloseFrame(head, frame, occluderTop, W, H) {
    const top = frame.top + frame.margin, available = Math.max(1, occluderTop - H * 0.02 - top);
    return { x: head.x / W, y: ((head.top + head.chin) / 2 - frame.top) / frame.height,
        zoom: Math.max(1.35, available * 0.55 / Math.max(1, head.chin - head.top)),
        ay: (top + available * 0.35 - frame.top) / frame.height };
}
function forkGalFrameCameraTarget(target, frame, H) {
    return Object.assign({}, target, { fy: (frame.top + target.fy * frame.height) / H, ay: (frame.top + target.ay * frame.height) / H });
}
// Alpha bbox in the central third. A short, opaque run keeps real ahoge but rejects isolated noise.
function forkGalEstimateHeadTop(rgba, width, height) {
    const left = Math.floor(width / 3), right = Math.ceil(width * 2 / 3);
    const needed = Math.max(2, Math.ceil(width * 0.003));
    let previous = false;
    for (let y = 0; y < height; y++) {
        let count = 0;
        for (let x = left; x < right; x++) if (rgba[(y * width + x) * 4 + 3] >= 64) count++;
        const opaque = count >= needed;
        if (opaque && previous) return (y - 1) / height;
        previous = opaque;
    }
    return 0; // Empty, tainted or unavailable images must not invent transparent headroom.
}
// Rest head endpoints transformed through the final camera, before transient act offsets.
// Return a WORLD-space downward shift; scale and head matching are never changed here.
function forkGalHeadroomShift(head, camera, frame, W, H) {
    const z = camera.zoom || 1, r = camera.rotation || 0, cos = Math.cos(r), sin = Math.sin(r);
    const screenTop = camera.ay * H + z * ((head.top - camera.fy * H) * cos +
        (head.x - camera.fx * W) * sin - Math.abs(sin) * (head.width || 0) / 2);
    return Math.max(0, (frame.top + frame.margin - screenTop) / (z * Math.max(0.1, cos)));
}
// Face visibility is a REST placement decision, independent of focus, speech and acts.
function forkGalFaceRest(head, supportY, safeTop, occluderTop, H, body) {
    // private fork: small figures get an independent presentation ledge, never a new ruler.
    // Include visible ink below the feet; never shrink a figure to qualify for full-body framing.
    const ledge = occluderTop - H * 12 / 900;
    if (body && Number.isFinite(body.top + body.bottom) && body.bottom > body.top) {
        const lift = Math.max(0, body.bottom - ledge);
        if (body.top - lift >= safeTop + H * 20 / 900) return { lift, scale: 1, warning: null, fullBody: true };
    }
    const bottom = occluderTop - H * 0.02, span = head.chin - head.top;
    const scale = Math.min(1, Math.max(0.001, bottom - safeTop) / Math.max(0.001, span));
    const top = supportY + (head.top - supportY) * scale;
    const chin = supportY + (head.chin - supportY) * scale;
    const lift = Math.max(0, chin - bottom);
    // A pre-existing top overflow belongs to headroom; a lift must not introduce one.
    return { lift: Math.min(lift, Math.max(0, top - safeTop)), scale, warning: scale < 1 ? "face-visibility-shrink" : null };
}
function forkGalFaceRestFrame(state, now) {
    const mix = forkGalFrameMix(0, 1, now - state.start);
    return { lift: state.from.lift + (state.to.lift - state.from.lift) * mix,
        scale: state.from.scale + (state.to.scale - state.from.scale) * mix };
}
function forkGalFaceRestUpdate(state, key, head, supportY, safeTop, occluderTop, H, now, snap, body) {
    if (state?.key === key) return state;
    const to = forkGalFaceRest(head, supportY, safeTop, occluderTop, H, body);
    return { key, from: !state || snap ? to : forkGalFaceRestFrame(state, now), to, start: now, computations: (state?.computations || 0) + 1 };
}
function forkGalFaceUnion(heads) {
    const points = [];
    for (const head of heads.filter(Boolean)) {
        const cy = (head.top + head.chin) / 2, c = Math.cos(head.rotation || 0), s = Math.sin(head.rotation || 0);
        for (const x of [-head.width / 2, head.width / 2]) for (const y of [head.top - cy, head.chin - cy]) points.push(head.x + c * x - s * y, cy + s * x + c * y);
    }
    return forkGalMeshHead([points], { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, 0);
}
// C1 soft hinge anticipates contact instead of easing an unsafe correction behind the chin.
function forkGalFaceClamp(head, camera, W, H, occluderTop, previous = 0, dt = 0) {
    const z = camera.zoom || 1, r = camera.rotation || 0, angle = r + (head.rotation || 0);
    const cy = (head.top + head.chin) / 2;
    const chin = camera.ay * H + (camera.shakeY || 0) + z * ((cy - camera.fy * H) * Math.cos(r) +
        (head.x - camera.fx * W) * Math.sin(r) + Math.abs(Math.cos(angle)) * (head.chin - head.top) / 2 + Math.abs(Math.sin(angle)) * head.width / 2);
    const needed = chin - (occluderTop - H * 0.02), band = H * 0.005;
    const soft = needed <= -band ? 0 : needed >= band ? needed : (needed + band) ** 2 / (4 * band);
    const target = soft / (z * Math.max(0.1, Math.cos(r)));
    const lift = Math.max(target, previous * Math.exp(-12 * Math.max(0, dt)));
    return { lift, active: needed > 0, chin, needed };
}
const forkGalHeadTopCache = new Map();
function forkGalTextureHeadTop(url, texture) {
    if (forkGalHeadTopCache.has(url)) return forkGalHeadTopCache.get(url);
    let top = 0;
    try {
        const image = texture.baseTexture.resource.source, canvas = document.createElement("canvas");
        const ratio = Math.min(1, 2048 / Math.max(texture.width, texture.height));
        canvas.width = Math.max(1, Math.round(texture.width * ratio)); canvas.height = Math.max(1, Math.round(texture.height * ratio));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        top = forkGalEstimateHeadTop(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    } catch (_) { /* Cross-origin textures use the conservative canvas-top fallback. */ }
    if (forkGalHeadTopCache.size >= 256) forkGalHeadTopCache.delete(forkGalHeadTopCache.keys().next().value);
    forkGalHeadTopCache.set(url, top);
    return top;
}
// Static portrait placement (bottom-anchored): up to 88% of the stage tall and 40% wide (× size, for
// small card pictures used as stand-ins); action zoom scales from the feet
// so the face comes into frame (lift 0..1).
// ground: the feet stand this fraction of the stage above the bottom (small full-body pictures stand on
// the floor line above the text box instead of sinking behind it).
function forkGalFlatLayout(texW, texH, W, H, cx, focus, lift, size, ground) {
    const base = Math.min(H * 0.88 / (texH || 1), W * 0.4 / (texW || 1)) * (size || 1);
    return { x: W * cx, y: H * (1 - (ground || 0)) + (lift || 0) * 0.3 * 0.88 * H, scale: base * (focus || 1), width: texW * base * (focus || 1), height: texH * base * (focus || 1) };
}
// Staged actions of a static portrait: dx/dy as fractions of the picture, px in pixels, flip the mirror factor.
const FORK_GAL_HOP_MS = 740;
const FORK_GAL_FLAT_ACTS = { nod: 650, shake: 850, jump: FORK_GAL_HOP_MS, tremble: 1000, turn: 1300, bow: 1300, lean: 1400, "step-back": 1300 };
// Normalized act time; displacement is a fraction of the un-stretched figure height.
function forkGalHopAt(t, reduced) {
    const rest = { dy: 0, scaleX: 1, scaleY: 1 };
    if (!Number.isFinite(t) || t <= 0 || t >= 1) return rest;
    const ms = t * FORK_GAL_HOP_MS;
    const arc = s => 4 * s * (1 - s);
    if (reduced) return ms < 360 ? { dy: -0.015 * arc(ms / 360), scaleX: 1, scaleY: 1 } : rest;
    const squash = (s, depth) => {
        const k = s < 0.35 ? s / 0.35 : (1 - s) / 0.65;
        const eased = k * k * (3 - 2 * k);
        return { dy: 0, scaleX: 1 + depth * 0.75 * eased, scaleY: 1 - depth * eased };
    };
    const air = (s, height) => {
        const k = arc(s);
        return { dy: -height * k, scaleX: 1 - 0.01 * k, scaleY: 1 + 0.02 * k };
    };
    // Crouch, ballistic hop, rebound, smaller hop, then a soft landing.
    if (ms < 70) return squash(ms / 70, 0.04);
    if (ms < 350) return air((ms - 70) / 280, 0.045);
    if (ms < 440) return squash((ms - 350) / 90, 0.035);
    if (ms < 660) return air((ms - 440) / 220, 0.027);
    return squash((ms - 660) / 80, 0.025);
}
let forkGalHopMedia, forkGalHopPrefersReduced = false;
function forkGalHopReduced(quality) {
    if (quality === "low") return true;
    if (!forkGalHopMedia && typeof window !== "undefined" && typeof window.matchMedia === "function") {
        forkGalHopMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
        forkGalHopPrefersReduced = forkGalHopMedia.matches;
        forkGalHopMedia.addEventListener?.("change", event => { forkGalHopPrefersReduced = event.matches; });
    }
    return forkGalHopPrefersReduced;
}
// private fork: blinking follows CONFIG 「减少动态」 or the OS preference (not stage quality); eyes stay open.
function forkGalBlinkCalm() {
    forkGalHopReduced("high");
    return forkGalHopPrefersReduced || (typeof forkStageReading !== "undefined" && forkStageReading.get().reducedMotion === true);
}
function forkGalShiverAt(t) { return 1.25 * Math.sin(12 * Math.PI * t) * Math.pow(Math.sin(Math.PI * t), 2); }
// bow / lean / step-back (shared with Live2D, fork-live2d.js): dy and zoom over t (0..1).
function forkGalBodyActAt(name, t) {
    const E = forkGalEase, frame = { dy: 0, zoom: 1, angleY: 0, dx: 0 };
    const hold = (a, b) => t < a ? E.inOutSine(t / a) : t < b ? 1 : 1 - E.inOutSine((t - b) / (1 - b));
    if (name === "bow") { const k = hold(0.32, 0.6); frame.dy = 0.035 * k; frame.angleY = -24 * k; frame.zoom = 1 - 0.01 * k; }
    else if (name === "lean") { const k = hold(0.28, 0.7); frame.zoom = 1 + 0.045 * k; frame.dy = 0.012 * k; frame.angleY = -6 * k; }
    else if (name === "step-back") { const k = t < 0.22 ? E.outCubic(t / 0.22) : t < 0.5 ? 1 : 1 - E.inOutSine((t - 0.5) / 0.5); frame.zoom = 1 - 0.06 * k; frame.dy = -0.012 * k; }
    return frame;
}
function forkGalFlatActAt(name, ms, reduced) {
    const frame = { dx: 0, dy: 0, px: 0, flip: 1, zoom: 1, scaleX: 1, scaleY: 1, done: true };
    const duration = FORK_GAL_FLAT_ACTS[name];
    if (!duration || ms < 0 || ms >= duration) return frame;
    const t = ms / duration;
    frame.done = false;
    if (name === "nod") frame.dy = t < 0.5 ? 0.016 * Math.sin(Math.PI * t / 0.5) : 0.01 * Math.sin(Math.PI * (t - 0.5) / 0.5);
    else if (name === "shake") frame.dx = -0.01 * Math.sin(4 * Math.PI * t) * Math.pow(Math.sin(Math.PI * t), 2);
    else if (name === "jump") Object.assign(frame, forkGalHopAt(t, reduced));
    else if (name === "tremble") frame.px = forkGalShiverAt(t);
    else if (name === "turn") frame.flip = t < 0.25 ? Math.cos(Math.PI * t / 0.25) : t < 0.75 ? -1 : -Math.cos(Math.PI * (t - 0.75) / 0.25);
    else { const body = forkGalBodyActAt(name, t); frame.dy = body.dy; frame.zoom = body.zoom; }
    return frame;
}
// Debug override (window.forkGalDebug.override): objects merge one level deep, arrays replace.
function forkGalSceneMerge(base, patch) {
    if (!patch) return base;
    const out = Object.assign({}, base, patch);
    ["background", "camera", "figureLight"].forEach(function (key) { if (patch[key] && base[key] && typeof patch[key] === "object") out[key] = Object.assign({}, base[key], patch[key]); });
    return out;
}
// ---------- Scene runtime (pixi) ----------

// Machine preference: stage effects quality, "high" (default) or "low".
const forkStageQuality = (function () {
    const KEY = "fork-stage-quality";
    const listeners = new Set();
    function get() { try { return localStorage.getItem(KEY) === "low" ? "low" : "high"; } catch (_) { return "high"; } }
    return {
        get,
        set(value) { try { localStorage.setItem(KEY, value === "low" ? "low" : "high"); } catch (_) {} listeners.forEach(fn => fn()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useForkStageQuality() { return React.useSyncExternalStore(forkStageQuality.subscribe, forkStageQuality.get); }

// Ordered, named filter slots on one container: set(name, filter) adds or replaces (null removes);
// disabled filters (filter.enabled = false) are skipped; no filters at all means no render pass.
// order: slot names in render order (unlisted names go last, in insertion order).
function forkGalFilterChain(container, area, order) {
    const slots = [];
    let signature = "";
    const rank = name => { const at = order ? order.indexOf(name) : -1; return at < 0 ? 1e6 : at; };
    const chain = {
        container,
        set(name, filter, options) {
            const at = slots.findIndex(slot => slot.name === name);
            if (at >= 0) slots.splice(at, 1);
            if (filter) {
                const before = options && options.before ? slots.findIndex(slot => slot.name === options.before) : slots.findIndex(slot => rank(slot.name) > rank(name));
                if (before >= 0) slots.splice(before, 0, { name, filter }); else slots.push({ name, filter });
            }
            chain.refresh(true);
            return filter;
        },
        get(name) { const slot = slots.find(item => item.name === name); return slot ? slot.filter : null; },
        all() { return slots.map(slot => slot.filter); },
        refresh(force) {
            const active = slots.filter(slot => slot.filter.enabled !== false);
            const next = active.map(slot => slot.name).join(",");
            if (!force && next === signature) return;
            signature = next;
            container.filters = active.length ? active.map(slot => slot.filter) : null;
            if (area) container.filterArea = active.length ? area : null;
        }
    };
    return chain;
}
// A filter created on first use (make), disabled while inactive and destroyed after 3 s idle, so effects
// that are off cost nothing. store: { [key]: slot }; returns the live filter or null.
function forkGalUseFilter(store, chain, name, make, active, now, tune) {
    let slot = store[name];
    if (active) {
        if (!slot) {
            let filter = null;
            try { filter = make(); } catch (error) { console.warn("[fork-gal-scene] filter", name, error); }
            if (!filter) return null;
            tune(filter);
            slot = store[name] = { chain, name, filter, idle: now };
            chain.set(name, filter);
        }
        slot.idle = now;
        if (slot.filter.enabled === false) { slot.filter.enabled = true; chain.refresh(); }
        return slot.filter;
    }
    if (slot) {
        if (slot.filter.enabled !== false) { slot.filter.enabled = false; chain.refresh(); }
        if (now - slot.idle > 3000 || now < slot.idle) { chain.set(name, null); slot.filter.destroy(); delete store[name]; }
    }
    return null;
}

// Generated textures: vignette, the empty stage gradient and the transition mask shapes.
function forkGalCanvasTexture(PIXI, width, height, paint) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    paint(canvas.getContext("2d"), width, height);
    return PIXI.Texture.from(canvas);
}
function forkGalMakeTextures(PIXI, host) {
    return {
        vignette: forkGalCanvasTexture(PIXI, 640, 360, function (ctx, w, h) {
            ctx.save(); ctx.translate(w / 2, h * 0.4); ctx.scale(1.2, 1);
            const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.hypot(w / 2, h * 0.6) / 1.2);
            radial.addColorStop(0, "rgba(0,0,0,0)"); radial.addColorStop(0.55, "rgba(0,0,0,0)"); radial.addColorStop(1, "rgba(0,0,0,.45)");
            ctx.fillStyle = radial; ctx.fillRect(-w, -h, w * 2, h * 2); ctx.restore();
            const floor = ctx.createLinearGradient(0, 0, 0, h);
            floor.addColorStop(0.58, "rgba(8,5,14,0)"); floor.addColorStop(1, "rgba(8,5,14,.55)");
            ctx.fillStyle = floor; ctx.fillRect(0, 0, w, h);
        }),
        empty: forkGalCanvasTexture(PIXI, 640, 360, function (ctx, w, h) {
            forkStagePaintEmpty(ctx, w, h, forkStageEmptyPalette(host));
        }),
        wipe: forkGalCanvasTexture(PIXI, 1024, 4, function (ctx, w, h) {
            const edge = ctx.createLinearGradient(0, 0, w, 0);
            edge.addColorStop(0, "rgba(255,255,255,1)"); edge.addColorStop(1 / 1.25, "rgba(255,255,255,1)"); edge.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
        }),
        iris: forkGalCanvasTexture(PIXI, 512, 512, function (ctx, w, h) {
            const disc = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
            disc.addColorStop(0, "rgba(255,255,255,1)"); disc.addColorStop(0.78, "rgba(255,255,255,1)"); disc.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = disc; ctx.fillRect(0, 0, w, h);
        })
    };
}

const forkGalLive2dTextures = forkGalTextureOwners();

// The scene runtime: creates the pixi Application in host and follows set(description).
// private fork: follow rendered orientation, not a separate portrait-facing rule.
// Per-layer aliases keep outgoing speakers independent during face crossfades.
function forkGalSyncFaceOrientation(root, figures) {
    if (!root) return;
    const scales = new Map();
    figures.forEach(entry => {
        const image = entry.kind === "live2d" ? entry.model : entry.sprite;
        if (image) scales.set(entry.figure.alias, image.scale.x < 0 ? "-1" : "1");
    });
    root.querySelectorAll("[data-face-actor]").forEach(node => {
        const flip = scales.get(node.getAttribute("data-face-actor")) || "1";
        if (node.style.getPropertyValue("--face-flip") !== flip) node.style.setProperty("--face-flip", flip);
    });
}
function forkGalCreateScene(host, options) {
    const PIXI = window.PIXI;
    const onError = options.onError || function () {};
    const onDebug = options.onDebug || function () {};
    let quality = options.quality === "low" ? "low" : "high";
    const refreshRate = options.refreshRate || window.screen && window.screen.refreshRate;
    const app = new PIXI.Application({ resizeTo: host, backgroundColor: 0x0b0812, backgroundAlpha: 1, antialias: true, autoDensity: true,
        resolution: forkGalResolution(quality, window.devicePixelRatio), powerPreference: "high-performance" });
    host.appendChild(app.view);
    const gl = app.renderer.gl;
    app.renderer.on("prerender", () => forkLive2dUseContext(app.renderer.gl));
    // private fork (owner 2026-10): resizeTo resizes - and so clears - the canvas in its own animation frame; the paced
    // ticker may skip that vsync, which then shows an empty scene for a frame (leaving full screen flashed). Redraw now.
    app.renderer.on("resize", () => { if (!state.destroyed && state.desc) app.render(); });
    app.ticker.maxFPS = forkGalFrameRate(quality, true, refreshRate, forkStageReading.get().frameCap);
    const tickerUpdate = app.ticker.update;
    const pace = { last: 0, next: 0, fps: 0, vsync: 0 };
    const generated = forkGalMakeTextures(PIXI, host);
    const world = new PIXI.Container(), backdrop = new PIXI.Container(), layersBox = new PIXI.Container();
    const vignette = new PIXI.Sprite(generated.vignette);
    const backFx = new PIXI.Container(), figuresBox = new PIXI.Container(), frontFx = new PIXI.Container(), emotesBox = new PIXI.Container(), overlay = new PIXI.Container();
    figuresBox.sortableChildren = true;
    backdrop.addChild(layersBox, vignette);
    world.addChild(backdrop, backFx, figuresBox, frontFx, emotesBox);
    const cover = new PIXI.Sprite(PIXI.Texture.WHITE);
    cover.alpha = 0; cover.visible = false;
    overlay.addChild(cover);
    app.stage.addChild(world, overlay);
    // Filter attachment points (render order within each chain).
    const filters = {
        world: forkGalFilterChain(world, app.screen, ["timeGrade", "grade", "bloom", "screen", "film", "beatBlur", "glitch", "shock"]), backdrop: forkGalFilterChain(backdrop, app.screen, ["blur"]),
        backFx: forkGalFilterChain(backFx), figures: forkGalFilterChain(figuresBox), frontFx: forkGalFilterChain(frontFx), overlay: forkGalFilterChain(overlay, app.screen)
    };
    function tune(filter) {
        filter.resolution = filter.forkLowRes ? 1 : app.renderer.resolution;
        filter.multisample = quality === "low" ? PIXI.MSAA_QUALITY.NONE : PIXI.MSAA_QUALITY.MEDIUM;
        return filter;
    }
    // pixi-filters (post effects) load in the background; until then grading and particles still work.
    forkLoadPixiFilters().catch(error => console.warn("[fork-gal-scene] pixi-filters", error));

    const state = {
        desc: null, override: null, debugEffects: [], destroyed: false,
        textures: new Map(),           // url → { promise, texture, dead }
        layers: [],                    // backdrop layers, bottom → top: { url, time, texture, sprite, plan, start, mask, owned, standIn, correction }
        bg: { target: null, pending: "" },
        grade: { name: null, start: 0, duration: 0, current: null, version: 0 },
        figures: new Map(),            // key → entry
        seen: new Set(),
        camera: { key: null, from: null, current: null, start: 0, ms: 0, ease: "inOutCubic" },
        dof: forkGalSpringValue(0),
        live2d: { core: "", ready: Boolean(PIXI.live2d), loading: false },
        frames: [], lastPrune: 0, clock: performance.now(), timeScale: 1, preview: null, previewCount: 0
    };
    // A debug light override of day or a time look (dusk, night …) drives the time-of-day grade, as the
    // stage does for commands.
    function describe() {
        const light = state.override && state.override.light;
        const registry = registryOf();
        const base = state.desc || {};
        const lighting = light ? forkStageApplyLight(forkStageLighting(state.override.lighting || base.lighting || base.light, registry.list), light, registry.list) : state.override && state.override.lighting;
        const extra = lighting ? { lighting, grade: forkGalLookResolve(registry, lighting, base.autoGrade || base.grade || "").grade } : null;
        const desc = forkGalSceneMerge(state.desc || {}, extra ? Object.assign({}, state.override, extra) : state.override);
        if (desc.background && desc.background.variantUrls) {
            const background = desc.background, time = desc.grade || "day";
            const variant = background.variantUrls[time];
            desc.background = { ...background, url: variant || background.baseUrl || background.url, time: variant ? time : background.baseTime || "" };
        }
        return state.preview ? Object.assign({}, desc, { looks: registry }) : desc;
    }
    // forkGalDebug.preview(params) adds a temporary look "preview" to the loaded ones (for tuning looks).
    function registryOf() {
        const base = state.desc && state.desc.looks || FORK_GAL_LOOKS_EMPTY;
        if (!state.preview) return base;
        if (state.preview.base !== base) {
            const list = base.list.filter(entry => entry.id !== "preview").concat([{ id: "preview", label: "预览", meaning: "", time: false, params: state.preview.params, source: "debug" }]);
            state.preview.base = base; state.preview.registry = forkGalLookRegistry(list, base.version * 1000 + (++state.previewCount));
        }
        return state.preview.registry;
    }
    const effects = forkGalCreateEffects({ PIXI, app, world, backdrop, backFx, frontFx, emotes: emotesBox, overlay, filters, tune, quality: () => quality, headOf, cheekOf });

    // ---- textures (backgrounds and static portraits): decoded off the main thread, uploaded before use.
    function loadTexture(url, bundle) {
        let record = state.textures.get(url);
        if (record) return record.promise;
        record = { url, texture: null, promise: null, dead: false };
        state.textures.set(url, record);
        // private fork (layered pilot): the rest picture of a parts 差分 is composed from its (shared, URL-keyed) part
        // textures once, then behaves like any loaded figure texture (fade, measure, prune).
        if (bundle && bundle.parts && url === bundle.view.src) record.promise = Promise.all(forkSpriteUrls(bundle).map(part => loadTexture(part).then(texture => [part, texture.baseTexture.resource.source]))).then(function (images) {
            if (record.dead || state.destroyed) throw new Error("cancelled");
            const canvas = document.createElement("canvas");
            forkSpritePaint(canvas, bundle, new Map(images), "initial", "open");
            record.texture = PIXI.Texture.from(canvas);
            const prepare = app.renderer.plugins.prepare;
            return prepare ? prepare.upload(record.texture) : null;
        }).then(function () {
            if (record.dead || state.destroyed) throw new Error("cancelled");
            record.ready = true;
            return record.texture;
        }).catch(function (error) {
            if (state.textures.get(url) === record && !record.texture) state.textures.delete(url);
            throw error;
        });
        else record.promise = new Promise(function (resolve, reject) {
            const image = new Image();
            image.decoding = "async";
            image.src = url;
            (image.decode ? image.decode() : new Promise((ok, fail) => { image.onload = ok; image.onerror = fail; })).then(function () {
                if (record.dead || state.destroyed) throw new Error("cancelled");
                record.texture = new PIXI.Texture(new PIXI.BaseTexture(image));
                const prepare = app.renderer.plugins.prepare;
                return prepare ? prepare.upload(record.texture) : null;
            }).then(function () {
                if (record.dead || state.destroyed) throw new Error("cancelled");
                record.ready = true;
                resolve(record.texture);
            }).catch(function (error) {
                if (state.textures.get(url) === record && !record.texture) state.textures.delete(url);
                reject(error);
            });
        });
        record.promise.catch(() => {});
        return record.promise;
    }
    function pruneTextures() {
        const keep = new Set(describe().preload || []);
        state.layers.forEach(layer => keep.add(layer.url));
        if (state.bg.pending) keep.add(state.bg.pending);
        state.figures.forEach(function (entry) { if (entry.src) keep.add(entry.src); if (entry.pendingSrc) keep.add(entry.pendingSrc); if (entry.figure.talkSrc) keep.add(entry.figure.talkSrc); forkGalMouthUrls(entry.figure.mouthBundle).forEach(url => keep.add(url)); forkSpriteUrls(entry.figure.spriteBundle).forEach(url => keep.add(url)); forkBlinkUrls(entry.figure.blinkBundle).forEach(url => keep.add(url)); (entry.fading || []).forEach(item => keep.add(item.url)); });
        state.textures.forEach(function (record, url) {
            if (keep.has(url) || !record.texture) return;
            record.dead = true; record.texture.destroy(true); state.textures.delete(url);
        });
    }

    // ---- backdrop
    function startLayer(url, texture, kind, grade, now) {
        const desc = describe();
        const previous = state.layers[state.layers.length - 1];
        const plan = forkGalBackgroundTransition(kind, desc, previous);
        const sprite = new PIXI.Sprite(texture);
        const layer = { identity:describe().background?.identity, url, scene: desc.background && desc.background.scene, time: url && desc.background ? desc.background.time || "" : "", texture, sprite, plan, start: now, mask: null, owned: url !== "", standIn: null, correction: null };
        setStandIn(layer, grade, now, 0);
        if (plan.kind === "wipe" || plan.kind === "iris") {
            layer.mask = new PIXI.Sprite(plan.kind === "wipe" ? generated.wipe : generated.iris);
            if (plan.kind === "iris") layer.mask.anchor.set(0.5);
            layersBox.addChild(layer.mask);
            sprite.mask = layer.mask;
        }
        layersBox.addChild(sprite);
        state.layers.push(layer);
        // The figures' grade travels with the picture: it changes during the transition, not before it.
        const duration = desc.snap ? 0 : describe().timeFadeMs === 2500 ? 2500 : plan.kind === "black" || plan.kind === "white" ? 0 : Math.max(plan.duration, 360);
        const gradeStart = plan.kind === "black" ? now + plan.duration * 0.42 : plan.kind === "white" ? now + plan.duration * 0.36 : now;
        setGrade(grade, gradeStart, state.layers.length === 1 ? 0 : duration);
        paintLayer(layer, now);
    }
    // Per-picture correction (forkGalLayerCorrection); eases when the time of day changes on the same picture.
    function setStandIn(layer, grade, now, duration) {
        const to = describe().packLayers?.backgroundGrade || forkGalLayerCorrection(registryOf(), grade, layer.time), from = layer.standIn ? layer.standIn.current : to;
        layer.standIn = { grade, from, to, start: now, duration, current: from, settled: false, version: registryOf().version };
    }
    function paintStandIn(layer, now) {
        const s = layer.standIn;
        if (s.settled) return;
        const t = s.duration > 0 ? forkGalClamp01((now - s.start) / s.duration) : 1;
        s.current = forkGalMatrix.mix(s.from, s.to, forkGalEase.inOutSine(t));
        s.settled = t >= 1;
        if (forkGalMatrix.isIdentity(s.current)) { if (layer.correction) { layer.sprite.filters = null; layer.correction.destroy(); layer.correction = null; } return; }
        if (!layer.correction) { layer.correction = tune(new PIXI.filters.ColorMatrixFilter()); layer.sprite.filters = [layer.correction]; }
        layer.correction.matrix = s.current.slice();
    }
    function paintLayer(layer, now) {
        const W = app.screen.width, H = app.screen.height;
        paintStandIn(layer, now);
        const texture = layer.sprite.texture;
        const settle = 1 + 0.03 * (1 - forkGalEase.outCubic(forkGalClamp01((now - layer.start) / 8000)));
        const fit = forkGalCover(texture.width, texture.height, W, H, 1.04 * settle);
        layer.sprite.scale.set(fit.scale); layer.sprite.position.set(fit.x, fit.y);
        let frame = null;
        if (layer.plan) {
            frame = forkGalTransitionFrame(layer.plan, layer.plan.duration ? (now - layer.start) / layer.plan.duration : 1);
            layer.sprite.alpha = frame.incoming;
            if (layer.mask && frame.mask >= 0) {
                if (layer.plan.kind === "wipe") {
                    const rect = forkGalWipeRect(frame.mask, W, 0.25, layer.plan.direction);
                    layer.mask.position.set(rect.x, -H * 0.1);
                    layer.mask.scale.set(rect.flip * rect.width / generated.wipe.width, H * 1.2 / generated.wipe.height);
                } else {
                    const cx = W / 2, cy = H * 0.42, size = Math.max(1, forkGalIrisSize(frame.mask, W, H, cx, cy, 0.78));
                    layer.mask.position.set(cx, cy); layer.mask.width = size; layer.mask.height = size;
                }
            }
        } else layer.sprite.alpha = 1;
        return frame;
    }
    function destroyLayer(layer) { if (layer.mask) layer.mask.destroy(); if (layer.correction) layer.correction.destroy(); layer.sprite.destroy(); }
    function tickBackdrop(now) {
        const desc = describe();
        const gradeMs = desc.snap ? 0 : desc.timeFadeMs === 2500 ? 2500 : FORK_GAL_ZOOM_MS;
        const background = desc.background || null;
        const url = background && background.url || "", identity = background?.identity;
        // private fork: an initial scene.clear still needs the empty backdrop that releases figure entry.
        if (state.bg.target === null || background?.identity !== state.bg.identity || !background && state.bg.target) {
            state.bg.identity = background?.identity; state.bg.failed = false;
            state.bg.target = url;
            const kind = background && background.transition || "fade", grade = desc.grade || "";
            const top = state.layers[state.layers.length - 1];
            if (top && top.url && top.identity === background?.identity) { state.bg.pending = ""; top.time = background && background.time || ""; setGrade(grade, now, gradeMs); setStandIn(top, grade, now, gradeMs); }
            else if (!url) { state.bg.pending = ""; startLayer("", generated.empty, kind, grade, now); }
            else {
                state.bg.pending = url;
                loadTexture(url).then(function (texture) {
                    if (state.destroyed || state.bg.identity !== identity) return;
                    state.bg.pending = "";
                    startLayer(url, texture, kind, describe().grade || "", state.clock);
                }, function (error) {
                    if (state.destroyed || String(error && error.message) === "cancelled") return;
                    if (state.bg.identity !== identity) return;
                    state.bg.pending = ""; state.bg.failed = true;
                    if (typeof forkRecordAssetWarning === "function") forkRecordAssetWarning({ code: "missing-asset", module: "backgrounds", url });
                    // private fork: a failed candidate never removes the last-good background.
                });
            }
        } else if (!state.bg.pending && ((desc.grade || "") !== state.grade.name || registryOf().version !== state.grade.version0)) {
            setGrade(desc.grade || "", now, gradeMs);
            const top = state.layers[state.layers.length - 1];
            if (top) { top.time = background && background.time || ""; setStandIn(top, desc.grade || "", now, gradeMs); }
        }
        // private fork: wait for the incoming texture, then share its transition clock. A director
        // cut on the same background still gets the selected transition rather than a visible size jump.
        if (state.figureCut && !state.bg.pending) {
            const cut = state.figureCut;
            if (!cut.layer) {
                let top = state.layers[state.layers.length - 1];
                if (top && top.start < cut.since) {
                    startLayer(top.url, top.texture, background?.transition || "fade", desc.grade || "", now);
                    top = state.layers[state.layers.length - 1];
                }
                cut.layer = top;
            }
            const layer = cut.layer, plan = layer?.plan;
            const progress = plan?.duration ? (now - layer.start) / plan.duration : 1;
            const frame = forkGalFigureCutFrame(plan, progress);
            state.figureCutAlpha = frame.alpha;
            if (frame.swap) state.figureScale = forkFigureSceneUpdate(state.figureScale, cut.snapshot, now, true);
            if (progress >= 1) { state.figureCut = null; state.figureCutAlpha = 1; }
        }
        let coverAlpha = 0, coverColor = 0;
        for (let i = 0; i < state.layers.length; i++) {
            const layer = state.layers[i];
            const frame = paintLayer(layer, now);
            if (!frame) continue;
            if (frame.cover > coverAlpha) { coverAlpha = frame.cover; coverColor = frame.color; }
            if (frame.done) {
                layer.plan = null;
                if (layer.mask) { layer.sprite.mask = null; layer.mask.destroy(); layer.mask = null; }
                // Everything under a finished layer is hidden: release it.
                state.layers.splice(0, i).forEach(destroyLayer);
                i = 0;
                state.lastPrune = 0;
            }
        }
        cover.tint = coverColor; cover.alpha = coverAlpha; cover.visible = coverAlpha > 0.002;
        vignette.width = app.screen.width * 1.04; vignette.height = app.screen.height * 1.04;
        vignette.position.set(-app.screen.width * 0.02, -app.screen.height * 0.02);
    }
    // The figures' time grade blends from whatever is on screen now (also mid-blend) to the new one.
    // The looks arriving (or reloading) re-grade to the same name with the new matrices.
    function setGrade(name, start, duration) {
        const grade = state.grade, version = registryOf().version;
        if (grade.name === name && grade.version0 === version) return;
        grade.from = grade.current || forkGalMatrix.identity(); grade.to = describe().packLayers?.figureGrade || forkGalTimeGrade(registryOf(), name).grade; grade.start = start; grade.duration = duration; grade.name = name; grade.version0 = version;
    }
    function tickGrade(now) {
        const grade = state.grade;
        if (!grade.to) return;
        const t = grade.duration > 0 ? forkGalClamp01((now - grade.start) / grade.duration) : now >= grade.start ? 1 : 0;
        const next = forkGalMatrix.mix(grade.from, grade.to, forkGalEase.inOutSine(t));
        if (!grade.current || next.some((value, i) => Math.abs(value - grade.current[i]) > 1e-4)) { grade.current = next; grade.version++; }
    }

    // ---- figures
    function entryList() { return Array.from(state.figures.values()).map(entry => ({ key: entry.key, kind: entry.kind, url: entry.url, identity:entry.identity, leaving: entry.leaving })); }
    function addFigure(figure, attach = true) {
        const container = new PIXI.Container();
        container.visible = false;
        const entry = { key: figure.key, kind: figure.kind, identity:figure.identity, url: figure.url || "", src: "", pendingSrc: "", container, figure, leaving: false, leavingSince: 0,
            model: null, loading: false, sprite: null, fading: [], mood: null, mouth: 0, param: null, act: null, actNonce: null, flatAct: null, started: false,
            breath: Math.random() * Math.PI * 2, filters: forkGalFilterChain(container, null, ["shade", "rim", "dof"]), shadeFilter: tune(new PIXI.filters.ColorMatrixFilter()),
            slots: {}, glow: forkGalSpringValue(0), shadow: forkGalSpringValue(0), blur: forkGalSpringValue(0) };
        entry.filters.set("shade", entry.shadeFilter);
        figuresBox.addChild(container);
        if (attach) state.figures.set(figure.key, entry); else entry.swap = true;
        return entry;
    }
    function commitFigureReplacement(entry) {
        const previous = entry.previous;
        if (!previous) return;
        if (state.figures.get(entry.key) !== previous || previous.replacement !== entry) { destroyFigure(entry); return; }
        previous.replacement = null; entry.previous = null;
        destroyFigure(previous);
        state.figures.set(entry.key, entry);
    }
    function destroyFigure(entry) {
        if (state.figures.get(entry.key) === entry) state.figures.delete(entry.key);
        if (entry.replacement) { destroyFigure(entry.replacement); entry.replacement = null; }
        entry.dead = true;
        clearBlink(entry);
        forkSpriteClearScene(entry);
        Object.values(entry.slots).forEach(slot => slot.filter.destroy());
        if (entry.model) {
            entry.model.destroy({ children: true });
            entry.releaseTextures();
            entry.model = null;
        }
        entry.container.destroy({ children: true });
        if (entry.spineFigure) { entry.spineFigure.destroy(); entry.spineFigure = null; }
        state.lastPrune = 0;
    }
    // private fork (docs/fork/spine-figures.md): the runtime loads with the first Spine figure; the figure then becomes a
    // sprite-like body (entry.sprite) placed and sized by the static path, from its rest-pose frame and pack anatomy.
    function loadSpine(entry) {
        if (entry.loading || entry.sprite || entry.failed || !entry.url) return;
        entry.loading = true;
        const identity = entry.figure.identity, config = entry.figure.spine || {};
        forkSpineLoadData(entry.url).then(function (loaded) {
            const figure = forkSpineFigure(PIXI, loaded, config);
            if (entry.dead || state.destroyed) { figure.destroy(); return; }
            entry.loading = false; entry.spineFigure = figure;
            const frame = forkSpineFrame(figure.spine, config.frame), canvas = [frame[2], frame[3]];
            const input = entry.figure.figureSizing, anatomy = input?.pack && input.anatomy;
            const measured = anatomy ? null : forkSpineMeasure(figure.spine, frame, identity, app.renderer, PIXI);
            const fade = packSpineBottomFade(config.bottomFade, anatomy, measured && measured.candidate.auto, frame[3]);
            if (fade) forkSpineBottomFade(PIXI, figure, frame, fade);
            const body = forkSpineBody(PIXI, figure.spine, frame);
            body.forkHeadTop = anatomy ? anatomy.headTop : measured.headTop;
            body.forkFigureInput = null;
            if (input?.pack && input.source) {
                entry.figureCandidate = measured ? measured.candidate : null;
                body.forkFigureInput = {...input,metrics:forkPackFigureRecord(input,canvas,entry.figureCandidate)};
                const sizing = resolveFigureSizing({ ...body.forkFigureInput, W: app.screen.width, H: app.screen.height, canvas });
                if (sizing.mode === "physical") body.anchor.set(sizing.supportX / canvas[0], sizing.feet / canvas[1]);
            }
            figure.mood(entry.figure.animation);
            entry.container.addChildAt(body, 0);
            entry.sprite = body; entry.loadedIdentity = identity;
            commitFigureReplacement(entry);
        }, function (error) {
            entry.loading = false; entry.failed = true;
            if (!entry.dead) onError("Spine 模型加载失败：" + String(error && error.message || error));
        });
    }
    // Emotion → track 0, audible voice → track 1; the skeleton only advances while visible.
    function tickSpine(entry, figure, desc) {
        const model = entry.spineFigure;
        model.mood(figure.animation);
        const level = figure.speaking && !desc.skipping && !document.hidden ? forkLipSync.level(figure.audio) : 0;
        model.voice(level, figure.talk, performance.now());
        if (entry.container.visible) model.update(app.ticker.deltaMS * state.timeScale / 1000);
    }
    function loadLive2d(entry) {
        if (entry.loading || entry.model || entry.failed || !state.live2d.ready) return;
        entry.loading = true;
        forkGalLive2dTextures.begin();
        PIXI.live2d.Live2DModel.from(entry.url, { autoInteract: false, autoUpdate: false, idleMotionGroup: "__none__" }).then(function (model) {
            const release = forkGalLive2dTextures.retain(model.textures);
            forkGalLive2dTextures.end();
            if (entry.dead || state.destroyed) { model.destroy({ children: true }); release(); return; }
            entry.model = model;
            // private fork: freeze calibration at entry; candidates never switch a running figure.
            entry.figureSizing = entry.figure.figureSizing;
            if (entry.figureSizing?.source) {
                entry.figureCandidate = entry.figureSizing.pack
                    ? (entry.figureSizing.anatomy ? null : forkFigureMeasurePackLive2d(model, entry.figureSizing.source + ':' + entry.figureSizing.outfitKey, app.renderer, PIXI))
                    : forkFigureMeasureLive2d(model, entry.figureSizing.source);
                if (entry.figureSizing.pack) entry.figureSizing = {...entry.figureSizing,metrics:forkPackFigureRecord(entry.figureSizing,[model.internalModel.originalWidth,model.internalModel.originalHeight],entry.figureCandidate)};
            }
            entry.releaseTextures = release;
            forkGalMotionTransitions(model.internalModel);
            // Models without metadata are sampled once in their untransformed canvas bounds.
            const declared = model.internalModel.settings.json && model.internalModel.settings.json.ForkStage;
            if (!entry.figureSizing?.pack && !(declared && declared.Chin > declared.HeadTop && declared.HeadTop >= 0)) {
                let texture;
                try {
                    const im = model.internalModel, Wm = im.originalWidth, Hm = im.originalHeight;
                    model.update(0);
                    texture = app.renderer.generateTexture(model, { region: new PIXI.Rectangle(0, 0, Wm, Hm), resolution: Math.min(1, 1024 / Math.max(Wm, Hm)) });
                    const canvas = app.renderer.plugins.extract.canvas(texture), ctx = canvas.getContext("2d");
                    const top = forkGalEstimateHeadTop(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
                    model.forkStageHeadFrame = { HeadTop: top, Chin: Math.min(1, top + (Hm / Wm < 1.15 ? 0.38 : 0.15)) };
                } catch (_) {
                    const im = model.internalModel;
                    model.forkStageHeadFrame = { HeadTop: 0, Chin: im.originalHeight / im.originalWidth < 1.15 ? 0.38 : 0.15 };
                } finally { if (texture) texture.destroy(true); }
            }
            model.update(0);
            entry.face = forkGalInitFace(model);
            forkLive2dStartIdle(model, () => entry.updateSeconds || 0);
            model.internalModel.on("afterMotionUpdate", () => forkGalApplyStageHead(model.internalModel.coreModel, entry.lookOn ? entry.look : 0, entry.param));
            // Lip sync, including silent syllables (zero), wins over motion/expression mouth curves.
            const lipSyncIds = forkGalLipSyncIds(model.internalModel.settings);
            model.internalModel.on("beforeModelUpdate", function () {
                const core = model.internalModel.coreModel;
                forkGalApplyLipSync(core, lipSyncIds, entry);
                entry.faceAngles = Object.fromEntries(["ParamAngleX", "ParamAngleY", "ParamAngleZ", "ParamBodyAngleX", "ParamBodyAngleZ"].map(id => [id, core.getParameterValueById(id)]));
                const cheek = entry.face.cheek, amount = effects.blush(model, state.clock);
                // This event follows expressions/saveParameters, so the overlay never
                // accumulates or overwrites the expression's own blush on the next frame.
                if (cheek >= 0 && amount > 0) core.setParameterValueByIndex(cheek, forkGalCheekValue(core.getParameterValueByIndex(cheek), amount, core.getParameterMinimumValue(cheek), core.getParameterMaximumValue(cheek)));
            });
            entry.container.addChild(model);
            entry.mood = null;
            forkLive2dExpress(entry, entry.figure);
            commitFigureReplacement(entry);
        }, function (error) {
            forkGalLive2dTextures.end();
            entry.loading = false; entry.failed = true;
            if (!entry.dead) onError(forkLive2dLoadError(error));
        });
    }
    function showStatic(entry, src) {
        if (!src) return;
        const identity = entry.figure.identity;
        if (entry.sprite && identity === entry.loadedIdentity) { entry.pendingSrc = ""; return; }
        if (entry.pendingSrc && identity === entry.pendingIdentity) return;
        entry.pendingSrc = src; entry.pendingIdentity = identity;
        loadTexture(src, entry.figure.spriteBundle).then(function (texture) {
            if (entry.dead || state.destroyed || entry.pendingIdentity !== identity || entry.figure.identity !== identity) return;
            entry.pendingSrc = "";
            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5, 1);
            sprite.forkHeadTop = forkGalTextureHeadTop(src, texture);
            // private fork: the old fading sprite keeps its own metric snapshot and pivot.
            sprite.forkFigureInput = entry.figure.figureSizing;
            if (sprite.forkFigureInput?.source && (sprite.forkFigureInput.sourceUrl ? sprite.forkFigureInput.sourceUrl === src : sprite.forkFigureInput.source === forkFigureSource(src))) {
                entry.figureCandidate = sprite.forkFigureInput.pack && sprite.forkFigureInput.anatomy ? null : forkFigureMeasureTexture(sprite.forkFigureInput.source, texture);
                if (sprite.forkFigureInput.pack) sprite.forkFigureInput = {...sprite.forkFigureInput,metrics:forkPackFigureRecord(sprite.forkFigureInput,[texture.width,texture.height],entry.figureCandidate)};
                const sizing = resolveFigureSizing({ ...sprite.forkFigureInput, W: app.screen.width, H: app.screen.height, canvas: [texture.width, texture.height] });
                if (sizing.mode === "physical") sprite.anchor.set(sizing.supportX / texture.width, sizing.feet / texture.height);
            } else sprite.forkFigureInput = null;
            // Mood change: the new picture goes underneath at full strength and the old one fades out
            // on top of it, so the figure never turns see-through.
            if (entry.sprite) { entry.sprite.texture = entry.baseTexture; clearMouth(entry); clearBlink(entry); entry.fading.push({ sprite: entry.sprite, url: entry.src, start: state.clock }); }
            entry.container.addChildAt(sprite, 0);
            entry.sprite = sprite; entry.src = src; entry.loadedIdentity = identity; entry.baseTexture = texture; entry.flap = null;
            commitFigureReplacement(entry);
        }, function (error) { if (String(error && error.message) !== "cancelled") console.warn("[fork-gal-scene] portrait failed", src, error); if (entry.pendingIdentity === identity) entry.pendingSrc = ""; });
    }
    // private fork: authored blink overlay. Steady state is two comparisons per frame; the
    // scheduler runs on (foreground-paused) timers and only flips child visibility.
    function clearBlink(entry) {
        if (entry.blink) entry.blink.stop();
        for (const name of ["blinkClosed", "blinkHalf"]) if (entry[name]) { entry[name].destroy(); entry[name] = null; }
        if (entry.blinkReplacement) for (const [base, frames] of entry.blinkReplacement) {
            if (entry.sprite && Object.values(frames).includes(entry.sprite.texture)) entry.sprite.texture = base;
            for (const texture of Object.values(frames)) texture.destroy(true);
        }
        entry.blinkReplacement = null;
        entry.blink = null; entry.blinkKey = ""; entry.spriteBlink = "open";
    }
    function blinkAllowed(entry) {
        return !state.destroyed && !entry.dead && !entry.leaving && entry.container.visible && world.visible && !document.hidden && !forkGalBlinkCalm();
    }
    function tickBlink(entry) {
        // private fork (layered pilot): a parts 差分 blinks by switching its face group frame; the scheduler only sets the
        // phase, forkSpriteTickScene repaints the face region on the next frame.
        const parts = entry.figure.spriteBundle && entry.figure.spriteBundle.parts;
        if (parts) {
            const key = "parts:" + parts.revision, eyes = parts.blinkFrames || {};
            if (!eyes.closed || !entry.sprite || entry.loadedIdentity !== entry.figure.identity) { if (entry.blinkKey) clearBlink(entry); return; }
            if (entry.blinkKey === key) return;
            clearBlink(entry); entry.blinkKey = key;
            entry.blink = createForkBlinkScheduler({ setTimeout: forkForeground.setTimeout, clearTimeout: forkForeground.clearTimeout, hasHalf: Boolean(eyes.half),
                allowed: () => blinkAllowed(entry), apply: phase => { entry.spriteBlink = phase; } });
            entry.blink.start();
            return;
        }
        const bundle = entry.figure.blinkBundle, sprite = entry.sprite;
        if (!bundle || !sprite || entry.loadedIdentity !== entry.figure.identity) { if (entry.blinkKey) clearBlink(entry); return; }
        if (entry.blinkKey === bundle.key && bundle.blend === 'replace') {
            if (entry.figure.mouthBundle?.set.blends) {
                if (entry.blinkReplacement) for (const frames of entry.blinkReplacement.values()) for (const texture of Object.values(frames)) texture.destroy(true);
                entry.blinkReplacement = null;
                return;
            }
            if (!entry.figure.spriteBundle) entry.blinkReplacement ||= new Map();
            if (entry.blinkReplacement) {
                const phase = entry.spriteBlink;
                let base = sprite.texture;
                for (const [original, frames] of entry.blinkReplacement) if (Object.values(frames).includes(base)) { base = original; break; }
                let frames = entry.blinkReplacement.get(base);
                if (!frames && (phase === 'closed' || phase === 'half')) {
                    frames = {};
                    for (const [name, url] of [['closed', bundle.closed], ['half', bundle.half]]) if (url) {
                        const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height;
                        const ctx = canvas.getContext('2d'); ctx.drawImage(base.baseTexture.resource.source, 0, 0);
                        forkSpriteReplacePatch(ctx, state.textures.get(url).texture.baseTexture.resource.source, bundle.rect);
                        frames[name] = PIXI.Texture.from(canvas);
                    }
                    entry.blinkReplacement.set(base, frames);
                }
                sprite.texture = frames?.[phase] || base;
            }
            return;
        }
        if (entry.blinkKey === bundle.key && entry.blinkClosed && entry.blinkClosed.parent === sprite) return;
        const records = forkBlinkUrls(bundle).map(url => state.textures.get(url));
        if (!records.every(record => record && record.ready && record.texture)) { if (entry.blinkKey) clearBlink(entry); return; }
        const [closed, half] = records.map(record => record.texture);
        const at = forkBlinkPlacement(bundle, entry.baseTexture.width, entry.baseTexture.height, sprite.anchor);
        if (!at || closed.width !== at.w || closed.height !== at.h || half && (half.width !== at.w || half.height !== at.h)) {
            if (entry.blinkFault !== bundle.key) console.warn("[fork-gal-scene] blink patch ignored", bundle.rect);
            entry.blinkFault = bundle.key; if (entry.blinkKey) clearBlink(entry); return;
        }
        clearBlink(entry); entry.blinkKey = bundle.key;
        if (bundle.blend === 'replace') {
            // Layered mouths paint after eyes on their shared canvas; flat mouths remain children.
            if (!entry.figure.spriteBundle && !entry.figure.mouthBundle?.set.blends) entry.blinkReplacement = new Map();
            entry.blink = createForkBlinkScheduler({ setTimeout: forkForeground.setTimeout, clearTimeout: forkForeground.clearTimeout, hasHalf: Boolean(half),
                allowed: () => blinkAllowed(entry), apply: phase => { entry.spriteBlink = phase; } });
            entry.blink.start();
            return;
        }
        const overlay = texture => { const child = new PIXI.Sprite(texture); child.position.set(at.x, at.y); child.visible = false; sprite.addChild(child); return child; };
        entry.blinkClosed = overlay(closed); entry.blinkHalf = half ? overlay(half) : null;
        entry.blink = createForkBlinkScheduler({ setTimeout: forkForeground.setTimeout, clearTimeout: forkForeground.clearTimeout, hasHalf: Boolean(half),
            allowed: () => blinkAllowed(entry),
            apply: phase => { if (entry.blinkClosed) entry.blinkClosed.visible = phase === "closed"; if (entry.blinkHalf) entry.blinkHalf.visible = phase === "half"; } });
        entry.blink.start();
    }
    function clearMouth(entry) {
        forkSpriteClearScene(entry);
        if (entry.mouthSprite) entry.mouthSprite.destroy();
        if (entry.mouthCover) entry.mouthCover.destroy();
        if (entry.mouthTexture) entry.mouthTexture.destroy(true);
        entry.mouthTexture = entry.mouthCanvas = null; entry.mouthPaintKey = "";
        entry.mouthSprite = entry.mouthCover = null; entry.mouthBundleKey = ""; entry.mouthState = null;
    }
    function tickMouth(entry, voiced, level, real) {
        const bundle = entry.figure.mouthBundle, sprite = entry.sprite;
        if (!bundle || entry.loadedIdentity !== entry.figure.identity) { clearMouth(entry); return false; }
        const key = JSON.stringify(bundle), b = bundle.binding, set = bundle.set;
        const records = forkGalMouthUrls(bundle).map(url => state.textures.get(url));
        const valid = b.imageSha === entry.src && b.canvas[0] === entry.baseTexture.width && b.canvas[1] === entry.baseTexture.height && records.every(r => r && r.ready && r.texture);
        if (!valid) { clearMouth(entry); return false; }
        const frames = Object.fromEntries(Object.entries(set.frames).map(([name, url]) => [name, state.textures.get(url).texture]));
        const cover = b.mouth.cover && state.textures.get(b.mouth.cover.sha).texture;
        if (Object.values(frames).some(t => t.width !== set.canvas[0] || t.height !== set.canvas[1]) || cover && (cover.width !== b.mouth.cover.rect[2] || cover.height !== b.mouth.cover.rect[3])) { clearMouth(entry); return false; }
        if (set.blends) {
            if (entry.mouthBundleKey !== key) { clearMouth(entry); entry.mouthBundleKey = key; }
            const time = entry.figure.audio?.currentTime;
            if (Number.isFinite(time) && time + 0.02 < entry.mouthAudioTime) entry.mouthState = null;
            entry.mouthAudioTime = time;
            entry.mouthState = forkGalMouthStep(entry.mouthState, level, voiced, real, entry.figure.audio);
            const phase = entry.spriteBlink || 'open', paintKey = entry.mouthState.frame + '|' + phase + '|' + Boolean(voiced && level > 0.01);
            if (entry.mouthPaintKey !== paintKey) {
                const images = new Map(forkGalMouthUrls(bundle).map(url => [url, state.textures.get(url).texture.baseTexture.resource.source]));
                entry.mouthCanvas ||= document.createElement('canvas');
                forkGalMouthPaint(entry.mouthCanvas, entry.baseTexture.baseTexture.resource.source, bundle, images, entry.mouthState.frame, voiced && level > 0.01);
                const eyes = entry.figure.blinkBundle;
                if (eyes?.blend === 'replace' && (phase === 'closed' || phase === 'half') && eyes[phase]) {
                    const image = state.textures.get(eyes[phase])?.texture?.baseTexture?.resource?.source;
                    if (image) forkSpriteReplacePatch(entry.mouthCanvas.getContext('2d'), image, eyes.rect);
                }
                if (!entry.mouthTexture) entry.mouthTexture = PIXI.Texture.from(entry.mouthCanvas);
                else entry.mouthTexture.baseTexture.update();
                entry.mouthPaintKey = paintKey;
            }
            sprite.texture = entry.mouthTexture;
            return true;
        }
        if (entry.mouthBundleKey !== key) {
            clearMouth(entry); entry.mouthBundleKey = key;
            const t = forkGalMouthTransform(b, set, sprite.anchor);
            if (cover) { entry.mouthCover = new PIXI.Sprite(cover); entry.mouthCover.position.set(t.cover.x, t.cover.y); sprite.addChild(entry.mouthCover); }
            entry.mouthSprite = new PIXI.Sprite(frames.closed);
            entry.mouthSprite.pivot.set(t.pivot[0], t.pivot[1]); entry.mouthSprite.position.set(t.x, t.y);
            entry.mouthSprite.scale.set(t.scale); entry.mouthSprite.rotation = t.rotation;
            sprite.addChild(entry.mouthSprite);
        }
        const audioTime = entry.figure.audio && entry.figure.audio.currentTime;
        if (Number.isFinite(audioTime) && audioTime + 0.02 < entry.mouthAudioTime) entry.mouthState = null;
        entry.mouthAudioTime = audioTime;
        entry.mouthState = forkGalMouthStep(entry.mouthState, level, voiced, real, entry.figure.audio);
        const layers = forkGalMouthLayers(b.mouth.surface, entry.mouthState.frame, voiced && level > 0.01);
        if (entry.mouthCover) entry.mouthCover.visible = layers.includes("cover");
        entry.mouthSprite.visible = layers.includes("mouth"); entry.mouthSprite.texture = frames[entry.mouthState.frame];
        sprite.texture = entry.baseTexture;
        return true;
    }
    function syncFigures(desc, now) {
        // private fork: replay owns scene timing; previews without a director get one fixed scene.
        const snapshot = desc.figureScale || state.figureSnapshot || (() => {
            const cast = (desc.figures || []).map(f => resolveFigureSizing({ ...f.figureSizing, canvas: f.figureSizing?.metrics?.canvas, W: 1, H: 1 })).filter(r => r.mode === "physical");
            const hMax = Math.max(0, ...cast.map(r => r.heightCm)) || FORK_FIGURE_DISPLAY.REF_MIN_CM;
            const groundRatio = Math.max(0, ...cast.filter(r => r.heightCm === hMax).map(r => r.restHead ? (r.support.y - r.restHead.top) / r.displayPx : 1)) || 1;
            return { version: FORK_FIGURE_DISPLAY.version, scene: 0, hMax, groundRatio, rescales: 0 };
        })();
        state.figureSnapshot = snapshot;
        const previousScale = state.figureScale;
        if (previousScale && previousScale.scene !== snapshot.scene && (previousScale.to !== snapshot.hMax || previousScale.groundTo !== (snapshot.groundRatio ?? 1)) && !desc.snap && !desc.skipping) {
            if (state.figureCut?.snapshot.scene !== snapshot.scene) state.figureCut = { snapshot, since: now, layer: null };
            else state.figureCut.snapshot = snapshot;
        } else {
            state.figureScale = forkFigureSceneUpdate(previousScale, snapshot, now, desc.snap || desc.skipping);
            if (desc.snap || desc.skipping) { state.figureCut = null; state.figureCutAlpha = 1; }
            if (state.figureScale !== previousScale && state.figureScale.warning) console.warn("[fork-gal-scene] mid-scene rescale");
        }
        const figures = (desc.figures || []).filter(figure => figure && figure.key && (figure.kind === "live2d" || figure.kind === "static" || figure.kind === "spine"));
        const plan = forkGalFigurePlan(entryList(), figures);
        plan.retire.forEach(function (key) {
            const entry = state.figures.get(key), last = entry.figure;
            if (entry.replacement) { destroyFigure(entry.replacement); entry.replacement = null; }
            entry.leaving = true; entry.leavingSince = now;
            entry.figure = Object.assign({}, last, { visible: false, exit: last.visible === false ? last.exit : "soft", speaking: false, talking: false, audio: null, act: null });
        });
        plan.revive.forEach(key => { state.figures.get(key).leaving = false; });
        figures.forEach(function (figure) {
            let entry = state.figures.get(figure.key);
            // private fork: retain the last-good GPU object until its replacement loads.
            if (entry && plan.replace.includes(figure.key)) {
                if (entry.replacement && entry.replacement.identity !== figure.identity) { destroyFigure(entry.replacement); entry.replacement = null; }
                if (!entry.replacement) { entry.replacement = addFigure(figure, false); entry.replacement.previous = entry; }
                const candidate = entry.replacement;
                candidate.figure = figure;
                if (figure.kind === 'live2d') loadLive2d(candidate);
                else if (figure.kind === 'spine') { candidate.url = figure.url || ""; loadSpine(candidate); }
                else showStatic(candidate, figure.src);
                return;
            }
            if (!entry) entry = addFigure(figure);
            if (entry.replacement) { destroyFigure(entry.replacement); entry.replacement = null; }
            // private fork: renewing a lease keeps all loaded sprite resources in place.
            if (entry.sprite && entry.figure.identity === figure.identity) {
                const old = entry.figure;
                figure = {...figure,src:old.src,talkSrc:old.talkSrc,spriteBundle:old.spriteBundle,mouthBundle:old.mouthBundle,blinkBundle:old.blinkBundle};
            }
            entry.figure = figure;
            if (!entry.model && !entry.loading) entry.url = figure.url || "";
            if (figure.kind === "static") {
                showStatic(entry, figure.src);
                const mouthKey = JSON.stringify([figure.mouthBundle || null, figure.spriteBundle || null]);
                if (entry.preloadMouth !== mouthKey) {
                    entry.preloadMouth = mouthKey;
                    forkSpriteUrls(figure.spriteBundle).forEach(url => loadTexture(url).catch(error => console.warn("[layered-sprite] asset failed", url, error)));
                    forkGalMouthUrls(figure.mouthBundle).forEach(url => loadTexture(url).catch(error => console.warn("[fork-gal-scene] mouth layer failed", url, error)));
                }
                if (entry.preloadBlink !== (figure.blinkBundle?.key || "")) {
                    entry.preloadBlink = figure.blinkBundle?.key || "";
                    forkBlinkUrls(figure.blinkBundle).forEach(url => loadTexture(url).catch(error => console.warn("[fork-gal-scene] blink layer failed", url, error)));
                }
                // Upload the matching talk texture ahead of the first voiced frame.
                if (entry.preloadTalk !== figure.talkSrc) {
                    entry.preloadTalk = figure.talkSrc;
                    if (figure.talkSrc) loadTexture(figure.talkSrc).catch(() => {});
                }
            }
        });
    }
    // Emote-layer pixels: a deforming face with rotation, or the rendered portrait's alpha-top box.
    // Camera/headroom callers request the independent rest pose to avoid chasing a gesture.
    function entryOf(alias) {
        let found = null;
        state.figures.forEach(function (entry) { if (!found && alias && entry.figure && (entry.figure.alias === alias || entry.key === alias) && !entry.leaving && entry.started && entry.figure.visible !== false) found = entry; });
        return found;
    }
    function headOf(alias, rest, exact) {
        const entry = typeof alias === "object" ? alias : entryOf(alias);
        if (!entry) return null;
        if (rest && entry.restHead) return entry.restHead;
        if (entry.model) {
            const model = entry.model, im = model.internalModel, face = entry.face;
            forkGalFlushFace(model);
            const Wm = im.originalWidth || 2400, Hm = im.originalHeight || 3100, frame = forkLive2dHeadFrame(model);
            const local = im.localTransform.clone();
            const matrix = forkGalDisplayMatrix(model, emotesBox, local);
            let head;
            if (face && face.indices.length) {
                const arrays = face.indices.map(i => im.coreModel.getDrawableVertices(i));
                const unit = im.pixelsPerUnit;
                const meshMatrix = { a: matrix.a * unit, b: matrix.b * unit, c: -matrix.c * unit, d: -matrix.d * unit,
                    tx: matrix.a * Wm / 2 + matrix.c * Hm / 2 + matrix.tx, ty: matrix.b * Wm / 2 + matrix.d * Hm / 2 + matrix.ty };
                const angle = forkGalMeshRotation(face.reference, arrays), x = Math.cos(angle), y = Math.sin(angle);
                let rotation = Math.atan2(meshMatrix.b * x + meshMatrix.d * y, meshMatrix.a * x + meshMatrix.c * y);
                if (rotation > Math.PI / 2) rotation -= Math.PI;
                if (rotation < -Math.PI / 2) rotation += Math.PI;
                head = forkGalMeshHead(arrays, meshMatrix, rotation);
            }
            if (!head) {
                const hh = (frame.Chin - frame.HeadTop) * Hm;
                const fallback = forkGalFallbackHead({ x: Wm / 2, top: frame.HeadTop * Hm, chin: frame.Chin * Hm, width: hh * 0.95 }, entry.faceAngles);
                const cy = (fallback.top + fallback.chin) / 2, c = Math.cos(fallback.rotation), s = Math.sin(fallback.rotation);
                const vertices = [];
                for (const x of [-fallback.width / 2, fallback.width / 2]) for (const y of [-hh / 2, hh / 2]) vertices.push(fallback.x + c * x - s * y, cy + s * x + c * y);
                const rotation = Math.atan2(-matrix.c, matrix.d) + fallback.rotation * Math.sign(matrix.a * matrix.d - matrix.b * matrix.c || 1);
                head = forkGalMeshHead([vertices], matrix, rotation);
            }
            if (exact && entry.figureResolved?.mode === "physical") {
                const record = entry.figureSizing?.metrics, m = { ...record?.auto, ...record?.override };
                const top = m.headTop ?? m.faceRect?.[1], chin = m.chin ?? (m.faceRect && m.faceRect[1] + m.faceRect[3]);
                if (chin > top) {
                    const left = m.faceRect ? m.faceRect[0] : Wm / 2 - (chin - top) / 2, right = left + (m.faceRect ? m.faceRect[2] : chin - top);
                    const restMatrix = forkGalDisplayMatrix(model, emotesBox, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
                    head = forkGalFaceUnion([head, forkGalMeshHead([[left, top, right, top, left, chin, right, chin]], restMatrix, 0)]);
                }
            }
            head = head && face && !exact ? forkGalSmoothHead(face, head, state.clock) : head;
            const metrics = entry.figureSizing?.metrics, anatomy = { ...metrics?.auto, ...metrics?.override };
            return forkGalHeadCheeks(head, anatomy.cheeks, forkGalDisplayMatrix(model, emotesBox, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }));
        }
        if (entry.sprite) {
            const sprite = entry.sprite, height = sprite.texture.height, width = sprite.texture.width;
            const metrics = sprite.forkFigureInput?.metrics, m = { ...metrics?.auto, ...metrics?.override };
            const calibrated = entry.figureResolved?.mode === "physical";
            const ht = calibrated ? m.headTop ?? m.faceRect?.[1] : null, ch = calibrated ? m.chin ?? (m.faceRect && m.faceRect[1] + m.faceRect[3]) : null;
            const top = (ht ?? height * (sprite.forkHeadTop || 0)) - height * sprite.anchor.y;
            const chin = (ch ?? (ht ?? height * (sprite.forkHeadTop || 0)) + height * 0.17) - height * sprite.anchor.y;
            const left = (calibrated && m.faceRect ? m.faceRect[0] : width / 2 - height * 0.08) - width * sprite.anchor.x;
            const right = left + (calibrated && m.faceRect ? m.faceRect[2] : height * 0.16);
            const matrix = forkGalDisplayMatrix(sprite, emotesBox, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
            const head = forkGalMeshHead([[left, top, right, top, left, chin, right, chin]], matrix, Math.atan2(-matrix.c, matrix.d));
            return exact ? forkGalFaceUnion([head, ...(entry.fading || []).map(item => headOf({ ...entry, sprite: item.sprite }, false, false))]) : forkGalHeadCheeks(head, m.cheeks, matrix, width * sprite.anchor.x, height * sprite.anchor.y);
        }
        return null;
    }
    function cheekOf(alias) {
        const entry = entryOf(alias);
        return entry && entry.model && entry.face && entry.face.cheek >= 0 ? entry.model : null;
    }
    // Figure light (glow / shadow) and depth of field: filters on the figure's own container.
    function tickFigureLook(entry, desc, now, dt, dofTarget) {
        const figure = entry.figure;
        const mode = (desc.figureLight && figure.alias && desc.figureLight[figure.alias]) || figure.light || "";
        forkGalSpring(entry.glow, mode === "glow" ? 1 : 0, 6, dt);
        forkGalSpring(entry.shadow, mode === "shadow" ? 1 : 0, 6, dt);
        forkGalSpring(entry.blur, dofTarget && dofTarget !== entry && quality === "high" ? 2 : 0, 6, dt);
        const glow = entry.glow.v, shadow = entry.shadow.v;
        const hasFilters = Boolean(PIXI.filters.GlowFilter);
        const rimDistance = quality === "low" ? 8 : 14;
        if (entry.slots.rim && entry.slots.rim.distance !== rimDistance) { entry.filters.set("rim", null); entry.slots.rim.filter.destroy(); delete entry.slots.rim; }
        const rim = forkGalUseFilter(entry.slots, entry.filters, "rim", function () {
            if (!hasFilters) return null;
            const filter = new PIXI.filters.GlowFilter({ distance: rimDistance, outerStrength: 0, innerStrength: 0, color: 0xffcf8a, quality: quality === "low" ? 0.1 : 0.18 });
            return filter;
        }, glow + shadow > 0.01, now, tune);
        if (rim) {
            if (entry.slots.rim) entry.slots.rim.distance = rimDistance;
            const warm = glow >= shadow;
            rim.color = warm ? 0xffcf8a : 0x9ab6ff;
            rim.outerStrength = warm ? glow * (2.4 + 0.35 * Math.sin(2 * Math.PI * now / 2400)) : shadow * 1.5;
            rim.innerStrength = warm ? glow * 0.7 : shadow * 0.25;
        }
        const blur = forkGalUseFilter(entry.slots, entry.filters, "dof", () => hasFilters ? Object.assign(new PIXI.filters.KawaseBlurFilter(0, 3, false), { forkLowRes: true }) : null, entry.blur.v > 0.05, now, tune);
        if (blur) blur.blur = entry.blur.v;
        return { glow, shadow };
    }
    function tickFigures(desc, now, dt, W, H) {
        const sceneFrame = forkFigureSceneFrame(state.figureScale, now);
        state.figureScale = sceneFrame.state;
        // private fork: normal and film use the same stable occluder contract as REST.
        const framing = { sceneHMax: sceneFrame.hMax, sceneGroundRatio: sceneFrame.groundRatio,
            groundHMax: state.figureScale?.to, groundRatio: state.figureScale?.groundTo,
            occluderTop: faceEnvironment(desc, W, H).occluderTop };
        const reducedHop = forkGalHopReduced(quality);
        const mouthSamples = new Map();
        const dofTarget = desc.dof ? entryOf(desc.dof) : null;
        state.figures.forEach(function (entry) {
            const figure = entry.figure;
            if (entry.kind === "live2d") loadLive2d(entry);
            else if (entry.kind === "spine") loadSpine(entry);
            if (!(entry.kind === "live2d" ? entry.model : entry.sprite)) { if (entry.leaving) destroyFigure(entry); return; }
            // Figures arrive with the first picture (and its grade), never over an empty, ungraded stage.
            if (!entry.started && !state.layers.length) return;
            // private fork (perf r5): a figure still loading when the entry revealed fades in where it stands, even on a
            // reopened page that otherwise restores without entrances. Outfit swaps keep their in-place replacement.
            if (!entry.started && desc.lateFade && !entry.swap && figure.enter === "none") forkGalFigureInit(entry, { ...figure, enter: "soft" });
            const closeOn = state.camera.closeOn;
            entry.cropped = Boolean(closeOn && figure.alias !== closeOn && !entry.leaving && forkGalCropHidden(entry.restBody, state.camera.goal, W, H));
            forkGalFigureStep(entry, figure, now, dt);
            if (entry.leaving && (forkGalFigureGone(entry) || now - entry.leavingSince > 2500)) { destroyFigure(entry); return; }
            entry.container.position.set(0, 0);
            entry.container.scale.set(1);
            const alpha = entry.alpha.v, shade = entry.shade.v;
            entry.container.visible = alpha > 0.003;
            entry.container.zIndex = entry.leaving ? 0 : figure.close ? 3 : figure.speaking ? 2 : 1;
            const look = tickFigureLook(entry, desc, now, dt, dofTarget);
            const key = shade.toFixed(3) + ":" + alpha.toFixed(3) + ":" + look.glow.toFixed(3) + ":" + look.shadow.toFixed(3) + ":" + state.grade.version;
            if (entry.shadeKey !== key) {
                entry.shadeKey = key;
                entry.shadeFilter.matrix = forkGalFigureMatrix(shade, alpha, look.glow, look.shadow, state.grade.current);
            }
            if (entry.kind === "live2d") {
                const model = entry.model;
                if (figure.act && figure.act.nonce !== entry.actNonce) { entry.actNonce = figure.act.nonce; if (!desc.skipping) forkLive2dStartAct(entry, figure.act.name, now); }
                const act = forkLive2dActFrame(entry, now, reducedHop);
                entry.param = act;
                const sizingInput = entry.figureSizing ? { ...entry.figureSizing, ...framing } : null;
                const physical = forkLive2dPlace(model, W, H, entry.cx.v, false, false, 1, 1, sizingInput);
                entry.figureResolved = model.forkFigureSizing || { mode: "legacy" };
                const im = model.internalModel, hf = forkLive2dHeadFrame(model), mh = im.originalHeight || 3100, s = Math.abs(model.scale.y);
                entry.restBody = { x: model.x, y: model.y, width: (im.originalWidth || 2400) * s, height: mh * s };
                entry.restHead = { x: W * entry.cx.v, top: model.y + hf.HeadTop * mh * s, chin: model.y + hf.Chin * mh * s, width: (hf.Chin - hf.HeadTop) * mh * s };
                if (physical?.restHead) entry.restHead = physical.restHead;
                // REST bounds in model pixels; the clamp applies the actual act/focus/container
                // transforms without forcing another walk of Cubism's deforming drawables.
                const head = entry.restHead;
                entry.clampLocalHead = { x: (head.x - model.x) / model.scale.x, top: (head.top - model.y) / model.scale.y,
                    chin: (head.chin - model.y) / model.scale.y, width: head.width / Math.abs(model.scale.x) };
                const live = forkLive2dPlace(model, W, H, entry.cx.v + (physical ? 0 : act.dx), false, false, (act.zoom || 1), act.flip, sizingInput);
                model.x += act.px;
                if (live?.mode === "physical") {
                    // All physical action displacement uses the pose span, not canvas padding or stage H.
                    model.x += act.dx * physical.poseSpan + live.supportX * model.scale.x * (1 - (act.scaleX || 1));
                    model.y += act.dy * physical.poseSpan + live.feet * model.scale.y * (1 - (act.scaleY || 1));
                    model.scale.set(model.scale.x * (act.scaleX || 1), model.scale.y * (act.scaleY || 1));
                } else if (act.hop) forkLive2dApplyHop(model, act);
                else model.y += act.dy * H;
                forkGalPlayMoodMotion(entry, figure, now, desc.snap || desc.skipping);
                forkLive2dExpress(entry, figure);
                // Audio pauses must close the mouth, not fall back to synthetic speech.
                const voiced = figure.speaking ? forkLipSync.level(figure.audio) : 0;
                entry.mouthActive = figure.speaking && (Boolean(figure.audio) || figure.talking);
                entry.mouth = figure.audio ? voiced : figure.speaking && figure.talking ? forkSyntheticMouth(entry, now) : 0;
                if (entry.container.visible) { entry.updateSeconds = app.ticker.deltaMS * state.timeScale / 1000; model.update(entry.updateSeconds * 1000); }
                return;
            }
            if (entry.kind === "spine") tickSpine(entry, figure, desc);
            else {
                const talkRecord = figure.talkSrc && state.textures.get(figure.talkSrc);
                const talkTexture = talkRecord && talkRecord.ready && talkRecord.texture;
                const ready = entry.loadedIdentity === figure.identity && talkTexture && talkTexture.width === entry.baseTexture.width && talkTexture.height === entry.baseTexture.height;
                if (entry.flapAudio !== figure.audio || entry.flapTalk !== figure.talkSrc) { entry.flap = null; entry.flapAudio = figure.audio; entry.flapTalk = figure.talkSrc; }
                const mixer = typeof forkStageAudio !== "undefined" ? forkStageAudio.get() : null;
                const audible = !mixer || mixer.master > 0 && mixer.voice > 0 && !mixer.muted.master && !mixer.muted.voice;
                const voiced = Boolean(forkGalStaticVoiced(figure) && audible && !document.hidden && !desc.skipping);
                const real = performance.now();
                if (voiced && !figure.spriteBundle && !mouthSamples.has(figure.audio)) mouthSamples.set(figure.audio, voiced ? forkLipSync.level(figure.audio) : 0);
                const level = voiced ? mouthSamples.get(figure.audio) : 0;
                if (!forkSpriteTickScene(entry, state.textures, PIXI, !desc.skipping && figure.speaking) && !tickMouth(entry, voiced, level, real)) {
                    entry.flap = forkGalFlapStep(entry.flap, level, Boolean(ready && voiced), real);
                    entry.sprite.texture = entry.flap.open ? talkTexture : entry.baseTexture;
                }
                tickBlink(entry);
            }
            // Static portrait: bottom-anchored sprite, gentle breathing, mirrored when looking left.
            if (figure.act && figure.act.nonce !== entry.actNonce) { entry.actNonce = figure.act.nonce; entry.flatAct = desc.skipping ? null : { name: figure.act.name, start: now }; }
            const act = entry.flatAct ? forkGalFlatActAt(entry.flatAct.name, now - entry.flatAct.start, reducedHop) : forkGalFlatActAt("", 0);
            if (act.done) entry.flatAct = null;
            // A Spine rig breathes in its own idle animation.
            const breath = entry.kind === "spine" ? 1 : 1 + 0.008 * (1 - Math.cos(2 * Math.PI * now / 4500 + entry.breath)) / 2;
            entry.restHead = null;
            entry.restBody = null;
            const place = function (sprite) {
                // private fork: metrics are in base-image pixels; talk frames and mouth children reuse the pivot.
                const input = sprite.forkFigureInput;
                if (input) {
                    const rest = resolveFigureSizing({ ...input, ...framing, W, H, stageX: W * entry.cx.v, canvas: [sprite.texture.width, sprite.texture.height], flip: entry.flip.v });
                    if (sprite === entry.sprite) entry.figureResolved = rest;
                    if (rest.mode === "physical") {
                        const body = { x: Math.min(rest.x, rest.x + sprite.texture.width * rest.scale * entry.flip.v), y: rest.y, width: sprite.texture.width * rest.scale, height: sprite.texture.height * rest.scale };
                        if (!entry.restBody) entry.restBody = body;
                        else { const old = entry.restBody, x = Math.min(old.x, body.x), y = Math.min(old.y, body.y); entry.restBody = { x, y, width: Math.max(old.x + old.width, body.x + body.width) - x, height: Math.max(old.y + old.height, body.y + body.height) - y }; }
                        const head = rest.restHead || { x: rest.support.x, top: rest.y + (sprite.forkHeadTop || 0) * sprite.texture.height * rest.scale, chin: rest.y + ((sprite.forkHeadTop || 0) + 0.17) * sprite.texture.height * rest.scale, width: rest.poseSpan * 0.16 };
                        if (!entry.restHead || head.top < entry.restHead.top) entry.restHead = head;
                        sprite.position.set(rest.support.x + act.dx * rest.poseSpan + act.px, rest.support.y + act.dy * rest.poseSpan);
                        sprite.scale.set(rest.scale * act.zoom * entry.flip.v * act.flip * act.scaleX, rest.scale * act.zoom * breath * act.scaleY);
                        return;
                    }
                }
                const rest = forkGalFlatLayout(sprite.texture.width, sprite.texture.height, W, H, entry.cx.v, 1, 0, entry.figure.size, entry.figure.ground);
                const body = { x: rest.x - rest.width / 2, y: rest.y - rest.height * 1.008, width: rest.width, height: rest.height * 1.008 };
                if (!entry.restBody) entry.restBody = body;
                else {
                    const old = entry.restBody, x = Math.min(old.x, body.x), y = Math.min(old.y, body.y);
                    entry.restBody = { x, y, width: Math.max(old.x + old.width, body.x + body.width) - x, height: Math.max(old.y + old.height, body.y + body.height) - y };
                }
                const top = rest.y - rest.height * 1.008 * (1 - (sprite.forkHeadTop || 0));
                if (!entry.restHead || top < entry.restHead.top) entry.restHead = { x: rest.x, top, chin: top + rest.height * 0.17, width: rest.height * 0.16 };
                const L = forkGalFlatLayout(sprite.texture.width, sprite.texture.height, W, H, entry.cx.v, act.zoom, entry.lift.v, entry.figure.size, entry.figure.ground);
                sprite.position.set(L.x + act.dx * L.width + act.px, L.y + act.dy * L.height);
                sprite.scale.set(L.scale * entry.flip.v * act.flip * act.scaleX, L.scale * breath * act.scaleY);
            };
            place(entry.sprite);
            entry.fading = entry.fading.filter(function (item) {
                const t = (now - item.start) / 260;
                if (t >= 1) { item.sprite.destroy(); state.lastPrune = 0; return false; }
                item.sprite.alpha = 1 - forkGalEase.inOutSine(t);
                place(item.sprite);
                return true;
            });
        });
        forkGalSyncFaceOrientation(stageHost, state.figures);
        return dofTarget;
    }

    function faceEnvironment(desc, W, H) {
        const theme = stageHost?.dataset.theme || "classic", key = [W, H, !!desc.film, theme].join(":");
        if (state.faceEnvironment?.key === key) return state.faceEnvironment;
        const box = stageHost?.querySelector(".fork-gal-box");
        let normalTop = H * 0.72;
        const rise = box ? parseFloat(getComputedStyle(box).getPropertyValue("--gal-box-safe-rise")) || 0 : 0;
        if (box) {
            // Resolve the normal-mode tokens even when first opened in film mode. No text measurement.
            const probe = document.createElement("i");
            probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:var(--gal-box-normal-bottom);height:var(--gal-box-normal-height)";
            box.appendChild(probe);
            const rect = probe.getBoundingClientRect();
            if (rect.height > 0) normalTop = H - rect.height - rect.width;
            probe.remove();
        }
        const header = stageHost?.querySelector(".fork-gal-topbar")?.offsetHeight || 52;
        const frame = forkGalVisibleFrame(W, H, desc.film ? 1 : 0, header);
        faceBoxObserver?.disconnect();
        if (box) faceBoxObserver?.observe(box);
        return state.faceEnvironment = { key, rise, box, boxDirty: true,
            top: frame.top + H * 0.02, occluderTop: desc.film ? frame.bottom - rise : normalTop - rise };
    }
    function tickFaceRest(desc, now, W, H) {
        const env = faceEnvironment(desc, W, H);
        const closeShot = desc.camera?.shot === "close";
        const layoutKey = [state.figureScale?.scene, state.figureScale?.rescales, env.key, closeShot].join(":");
        state.figures.forEach(entry => {
            if (!entry.restHead) return;
            const input = entry.figureSizing || entry.sprite?.forkFigureInput;
            const key = [layoutKey, input?.source || entry.figure.url || entry.figure.modelId, entry.figure.close || false].join(":");
            const supportY = entry.figureResolved?.support?.y ?? H * (1 - (entry.figure.ground || 0));
            const old = entry.faceRest;
            let lockHead = entry.restHead, lockSupportY = supportY;
            let lockBody = entry.figureResolved?.restBounds || (entry.restBody && { top: entry.restBody.y, bottom: entry.restBody.y + entry.restBody.height });
            if (old?.key !== key && entry.figureResolved?.mode === "physical") {
                // A rare scene rescale locks against its destination ruler, not the first tween frame.
                const target = resolveFigureSizing({ ...input, canvas: input?.metrics?.canvas, W, H, stageX: W * entry.cx.v, sceneHMax: state.figureScale?.to,
                    sceneGroundRatio: state.figureScale?.groundTo, occluderTop: env.occluderTop });
                if (target.restHead) { lockHead = target.restHead; lockSupportY = target.support.y; lockBody = target.restBounds; }
            }
            entry.faceRest = forkGalFaceRestUpdate(old, key, lockHead, lockSupportY, env.top, env.occluderTop, H, now,
                !old || old.scene !== state.figureScale?.scene, !closeShot && !entry.figure.close ? lockBody : null);
            entry.faceRest.scene = state.figureScale?.scene;
            if (old !== entry.faceRest && entry.faceRest.to.warning) console.warn("[fork-gal-scene] face-visibility-shrink", entry.figure.alias, entry.faceRest.to);
            const rest = forkGalFaceRestFrame(entry.faceRest, now), x = W * entry.cx.v;
            entry.container.scale.set(rest.scale);
            entry.container.position.set(x * (1 - rest.scale), supportY * (1 - rest.scale) - rest.lift);
            const pointX = v => x + (v - x) * rest.scale, pointY = v => supportY + (v - supportY) * rest.scale - rest.lift;
            const head = entry.restHead, body = entry.restBody;
            entry.restHead = { ...head, x: pointX(head.x), top: pointY(head.top), chin: pointY(head.chin), width: head.width * rest.scale };
            if (body) entry.restBody = { x: pointX(body.x), y: pointY(body.y), width: body.width * rest.scale, height: body.height * rest.scale };
            entry.faceRestCurrent = rest;
        });
    }
    function clampHeadOf(entry) {
        if (!entry.model || !entry.clampLocalHead) return headOf(entry, false, true);
        const head = entry.clampLocalHead, left = head.x - head.width / 2, right = head.x + head.width / 2;
        const matrix = forkGalDisplayMatrix(entry.model, emotesBox, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
        return forkGalMeshHead([[left, head.top, right, head.top, left, head.chin, right, head.chin]], matrix, Math.atan2(-matrix.c, matrix.d));
    }
    function tickFaceClamp(dt, W, H, frame) {
        const env = state.faceEnvironment;
        // ResizeObserver invalidates animated height too; settled reading does no style reads.
        if (env.boxDirty) {
            const style = env.box && getComputedStyle(env.box);
            env.boxTop = style ? H - parseFloat(style.bottom) - parseFloat(style.height) - env.rise : env.occluderTop;
            env.boxDirty = false;
        }
        const boxTop = env.boxTop;
        const camera = { ...state.camera.safe, shakeY: world.position.y - state.camera.safe.ay * H };
        // UI shake is a 0..1 gain of this camera shake; reserve its entire upward excursion.
        const occluderTop = Math.min(boxTop + Math.min(0, camera.shakeY), frame.bottom);
        state.faceOccluderTop = occluderTop;
        state.figures.forEach(entry => {
            if (!entry.restHead || !entry.container.visible) return;
            const head = clampHeadOf(entry);
            if (!head) return;
            const clamp = forkGalFaceClamp(head, camera, W, H, occluderTop, entry.faceClamp?.lift || 0, dt);
            entry.faceClampActivations = (entry.faceClampActivations || 0) + (clamp.active && !entry.faceClamp?.active ? 1 : 0);
            entry.faceClamp = clamp;
            entry.container.y -= clamp.lift;
        });
    }

    // ---- one-shot effects (beats, emotes; legacy shake / flash / fade) and the camera
    function tickEffects(desc, now) {
        const list = (desc.effects || []).concat(state.debugEffects);
        list.forEach(function (effect) {
            if (!effect || effect.nonce == null || state.seen.has(effect.nonce)) return;
            state.seen.add(effect.nonce);
            const debug = String(effect.nonce).startsWith("debug:");
            if (desc.skipping && !debug) return;
            const played = effects.trigger(effect, now);
            // A debug emote for someone not on stage goes to the face window (the stage decides).
            if (!played && debug && effect.op === "emote") onDebug(effect);
        });
        if (state.seen.size > 400) state.seen = new Set(Array.from(state.seen).slice(-200));
    }
    function tickCamera(desc, now, W, H, frame) {
        const camera = state.camera, spec = desc.camera || {};
        let target, key, ms, ease;
        if (!spec.shot && typeof spec.zoom === "number") {
            // Plain numbers (debug override): zoom / pan / rotation around the default focus.
            const t = forkGalCameraTarget(spec);
            target = { zoom: t.zoom, fx: 0.5 + t.panX, fy: 0.42 + t.panY, ax: 0.5, ay: 0.42, rotation: t.rotation };
            key = "manual:" + [t.zoom, t.panX, t.panY, t.rotation].join(","); ms = FORK_GAL_ZOOM_MS; ease = "inOutCubic";
        } else {
            const shot = spec.shot || "", head = shot === "close" ? headOf(spec.target, true) : null;
            const plan = forkGalShotTarget(shot, head ? forkGalCloseFrame(head, frame, state.faceEnvironment.occluderTop, W, H) : null);
            target = plan.target; key = shot + ":" + (head ? spec.target : ""); ms = plan.ms; ease = plan.ease;
        }
        target = forkGalFrameCameraTarget(target, frame, H);
        // Where the shot settles, for close-up crop fades (read by the next figure tick).
        camera.closeOn = spec.shot === "close" && key !== "close:" ? spec.target : "";
        camera.goal = forkGalCameraClamp(target, W, H, 0.018);
        if (desc.skipping) ms = Math.min(ms, 200);
        if (desc.snap) ms = 0;
        if (camera.key !== key) { camera.from = camera.current || target; camera.key = key; camera.start = now; camera.ms = camera.current ? ms : 0; camera.ease = ease; }
        const k = camera.ms > 0 ? forkGalEase[camera.ease](forkGalClamp01((now - camera.start) / camera.ms)) : 1;
        const current = {};
        ["zoom", "fx", "fy", "ax", "ay", "rotation"].forEach(name => { current[name] = camera.from[name] + (target[name] - camera.from[name]) * k; });
        camera.current = current;
        const kick = effects.zoomKick(now), shake = effects.shakeOffset(now);
        const safe = forkGalCameraClamp(Object.assign({}, current, { zoom: current.zoom * (1 + kick) }), W, H, 0.018);
        camera.safe = safe;
        world.pivot.set(safe.fx * W, safe.fy * H);
        world.position.set(safe.ax * W + shake.x, safe.ay * H + shake.y);
        world.scale.set(safe.zoom);
        world.rotation = safe.rotation;
    }

    function applyQuality(next) {
        quality = next === "low" ? "low" : "high";
        const resolution = forkGalResolution(quality, window.devicePixelRatio);
        app.ticker.maxFPS = forkGalFrameRate(quality, true, refreshRate, forkStageReading.get().frameCap);
        if (app.renderer.resolution !== resolution) { app.renderer.resolution = resolution; app.resize(); }
        const all = [].concat(...Object.values(filters).map(chain => chain.all()));
        state.figures.forEach(entry => all.push(...entry.filters.all()));
        state.layers.forEach(layer => { if (layer.correction) all.push(layer.correction); });
        all.forEach(tune);
    }
    function tick() {
        if (state.destroyed || !state.desc) return;
        // Scene clock (ms): real time, or slowed down by forkGalDebug.slow(). Everything animates on it.
        state.clock += app.ticker.deltaMS * state.timeScale;
        const now = state.clock, dt = Math.min(0.25, app.ticker.deltaMS * state.timeScale / 1000);
        const real = performance.now();
        state.frames.push(real);
        while (state.frames.length && state.frames[0] < real - 1000) state.frames.shift();
        const desc = describe();
        if (desc.holding) { world.visible = overlay.visible = false; return; }
        const newVisit = desc.snap && desc.visit !== state.visit;
        if (newVisit) { state.visit = desc.visit; state.camera.key = null; state.camera.current = null; }
        const W = app.screen.width, H = app.screen.height;
        if ((desc.quality === "low" ? "low" : "high") !== quality) applyQuality(desc.quality);
        if (desc.core && desc.core !== state.live2d.core) {
            state.live2d.core = desc.core;
            if (!state.live2d.ready && !state.live2d.loading) {
                state.live2d.loading = true;
                forkLoadLive2dRuntime(desc.core).then(() => { state.live2d.ready = true; state.live2d.loading = false; }, error => { state.live2d.loading = false; onError(String(error && error.message || error)); });
            }
        }
        // private fork: CG gates the whole figure layer, including pending Live2D arrivals and exit fades.
        // Keep directed state/resources current so clearing CG reveals the latest outfit and cast.
        // private fork (owner 2026-10): an open phone fades the figures out (240 ms) and back in the same way when it is put
        // away; skip and history snap. CG still hides them at once. The scene-change figure cut multiplies in.
        const figureAway = desc.figuresAway ? 0 : 1;
        state.figureFade = desc.snap || desc.skipping || state.figureFade === undefined || state.figureFade === figureAway ? figureAway : figureAway > state.figureFade ? Math.min(1, state.figureFade + dt / 0.24) : Math.max(0, state.figureFade - dt / 0.24);
        figuresBox.alpha = (state.figureCutAlpha ?? 1) * state.figureFade;
        emotesBox.alpha = state.figureFade;
        figuresBox.visible = emotesBox.visible = !desc.hideFigures && state.figureFade > 0;
        syncFigures(desc, now);
        if (newVisit) state.figures.forEach(entry => {
            if (entry.leaving || entry.figure.visible === false) destroyFigure(entry);
            else forkGalFigureInit(entry, { ...entry.figure, enter: "none" });
        });
        tickBackdrop(now);
        tickGrade(now);
        tickEffects(desc, now);
        const wantedFilm = desc.film ? 1 : 0;
        if (!state.frameBlend) state.frameBlend = { from: wantedFilm, to: wantedFilm, start: real, value: wantedFilm };
        const blend = state.frameBlend;
        if (blend.to !== wantedFilm) { blend.from = blend.value; blend.to = wantedFilm; blend.start = real; }
        blend.value = forkGalFrameMix(blend.from, blend.to, real - blend.start);
        const visibleFrame = forkGalVisibleFrame(W, H, blend.value);
        state.visibleFrame = visibleFrame;
        const dofTarget = tickFigures(desc, now, dt, W, H);
        tickFaceRest(desc, now, W, H);
        tickCamera(desc, now, W, H, visibleFrame);
        state.figures.forEach(function (entry) {
            if (!entry.restHead || !entry.container.visible) return;
            const target = forkGalHeadroomShift(entry.restHead, state.camera.safe, visibleFrame, W, H);
            // Camera, focus and frame targets already ease. Ease release too, without ever lagging safety.
            entry.headroom = Math.max(target, (entry.headroom || 0) + (target - (entry.headroom || 0)) * (1 - Math.exp(-12 * dt)));
            entry.container.y += entry.headroom;
        });
        tickFaceClamp(dt, W, H, visibleFrame);
        forkGalSpring(state.dof, dofTarget && quality === "high" ? 1 : 0, 6, dt);
        effects.tick(desc, now, dt, state.dof.v);
        // private fork: accepted groups reveal independently, including historical entry.
        // The resource runner already gates each element; a slow model must not hide the backdrop.
        world.visible = overlay.visible = true;
        if (options.onUi) options.onUi(effects.ui(state.grade.current));
        // private fork (perf r5): the entry gate may reveal the backdrop and text box before slow figures are built.
        if (options.onBackdrop && !state.bg.pending && state.layers.length <= 1) options.onBackdrop(desc.presentationRevision);
        if (options.onPresented && !state.bg.pending && state.layers.length <= 1 &&
            Array.from(state.figures.values()).every(entry => !entry.leaving && !entry.replacement && !entry.pendingSrc &&
                !entry.fading.length && (entry.model || entry.sprite))) options.onPresented(desc.presentationRevision);
        cover.width = W; cover.height = H;
        if (now - state.lastPrune > 1500) { state.lastPrune = now; pruneTextures(); }
        const preload = desc.preload || [];
        if (preload.join("\n") !== state.preloadKey) { state.preloadKey = preload.join("\n"); preload.slice(0, 8).forEach(url => loadTexture(url)); }
    }
    // A failing frame is reported once and the next frame tries again (the stage never freezes silently).
    function frame() { try { tick(); } catch (error) { if (!state.tickError) { state.tickError = String(error && error.stack || error); console.error("[fork-gal-scene] frame failed", error); } } }
    // Be deliberately conservative: even flat figures can breathe, blink or gesture. Only a
    // settled, empty, neutral stage without DOM animations qualifies for the idle rate.
    function frameRate() {
        const desc = describe(), plan = effects.looks.plan();
        const neutral = plan && !plan.grade && !plan.bloom && !plan.screen && !plan.film && !plan.backBlur && !plan.motes.length && !plan.vignette && !plan.haze && !plan.leaks.length && !plan.flare;
        const idle = !state.figures.size && !(desc.figures || []).length && !desc.animatedUi && !desc.weather && !(desc.effects || []).length && !state.debugEffects.length && !state.override && !state.preview && neutral && state.layers.length <= 1 && !state.bg.pending && performance.now() - state.changedAt > 4000 && state.clock >= state.camera.start + state.camera.ms;
        return forkGalFrameRate(quality, !idle, refreshRate, forkStageReading.get().frameCap);
    }
    // The wrapper restores the requested cap after Pixi dispatches its listeners.
    app.ticker.update = function (now) {
        now = now == null ? performance.now() : now;
        const fps = frameRate();
        if (!forkGalFrameDue(pace, now, fps)) return;
        this.maxFPS = 0;
        try { tickerUpdate.call(this, now); } finally { this.maxFPS = fps; }
    };
    app.ticker.add(frame);
    const releaseForeground = forkForeground.application(app);
    // A backgrounded stage never freezes mid-blink: eyes open now, a fresh interval on return.
    const releaseBlinkForeground = forkForeground.subscribe(active => { if (!active) state.figures.forEach(entry => { if (entry.blink) entry.blink.restart(); }); });

    // Verification hook (docs/fork/galgame-stage.md), present only while the stage is open.
    let debugNonce = 0;
    const round = (value, digits) => Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits);
    const debug = {
        assetWarnings() { return typeof forkAssetDiagnostics === "function" ? forkAssetDiagnostics() : []; },
        override(patch) {
            const current = describe();
            state.override = patch ? Object.assign({}, patch, patch.light ? { lighting: forkStageApplyLight(forkStageLighting(current.lighting || current.light, registryOf().list), patch.light, registryOf().list) } : {}) : null;
            return describe();
        },
        // The loaded stage looks (docs/fork/stage-looks.md): id, label, meaning, time, source.
        looks() { return registryOf().list.map(entry => ({ id: entry.id, label: entry.label, meaning: entry.meaning, time: entry.time, layer: entry.layer, source: entry.source })); },
        // preview(params): shows a look from raw params (asset paths as URLs); preview(null) ends it.
        preview(params) {
            state.preview = params ? { params, base: null } : null;
            state.override = params ? Object.assign({}, state.override, { light: "preview" }) : state.override && state.override.light === "preview" ? null : state.override;
            return describe().light;
        },
        // trigger('beat', 'glitch'), trigger('shake', 2), trigger('emote', { id, value }), trigger('title', text)
        trigger(op, value) {
            if (op === "title") { onDebug({ op: "title", value: String(value || "") }); return; }
            let effect = { op, value, nonce: "debug:" + (++debugNonce) };
            if (op === "emote" && value && typeof value === "object") effect = Object.assign({}, value, { op, nonce: effect.nonce });
            if (op === "emote" && !effect.color) { const entry = entryOf(effect.id); effect.color = entry && entry.figure.color || ""; }
            if (op === "beat" && effect.value === "shock" && !effect.id) { const speaker = Array.from(state.figures.values()).find(entry => entry.figure.speaking); if (speaker) effect.id = speaker.figure.alias; }
            state.debugEffects.push(effect);
            if (state.debugEffects.length > 20) state.debugEffects.shift();
        },
        transition(kind, url) { const base = state.desc && state.desc.background || {}; state.override = forkGalSceneMerge(state.override || {}, { background: Object.assign({}, base, { url: url || base.url || "", transition: kind }) }); },
        error() { return state.tickError || ""; },
        probe() { let render = "ok"; try { app.render(); } catch (error) { render = String(error && error.stack || error); } let step = "ok"; try { tick(); } catch (error) { step = String(error && error.stack || error); } return { started: app.ticker.started, count: app.ticker.count, desc: Boolean(state.desc), render, step }; },
        fps() { return { measured: state.frames.length, ticker: Math.round(app.ticker.FPS * 10) / 10, maxFPS: app.ticker.maxFPS, resolution: app.renderer.resolution, quality }; },
        blinks() { return Array.from(state.figures.values()).filter(entry => entry.blinkKey).map(entry => ({ key: entry.key, phase: entry.blink ? entry.blink.phase() : "open", rect: entry.figure.blinkBundle && entry.figure.blinkBundle.rect, half: Boolean(entry.blinkHalf), allowed: blinkAllowed(entry) })); },
        textures() {
            return { gpu: app.renderer.texture.managedTextures.length, cached: state.textures.size, layers: state.layers.length,
                cachedUrls: Array.from(state.textures.keys()), baseTextureCache: Object.keys(PIXI.utils.BaseTextureCache).length };
        },
        stats() {
            const safe = state.camera.safe || { zoom: 1, fx: 0.5, fy: 0.42, rotation: 0 };
            const shake = { x: round(world.position.x - (safe.ax || 0.5) * app.screen.width, 1), y: round(world.position.y - (safe.ay || 0.42) * app.screen.height, 1) };
            return { quality, grade: state.grade.name, look: effects.looks.stats(), camera: { shot: state.camera.key, zoom: round(safe.zoom, 3), fx: round(safe.fx, 3), fy: round(safe.fy, 3), rotation: round(safe.rotation * 180 / Math.PI, 2) },
                scale: round(world.scale.x, 3), shake, frame: state.visibleFrame, figureLayer: { visible: figuresBox.visible, alpha: round(figuresBox.alpha, 3) }, dof: round(state.dof.v, 2), effects: effects.stats(),
                layers: state.layers.map(layer => ({ url: layer.url, time: layer.time, transition: layer.plan ? layer.plan.kind : "", corrected: Boolean(layer.correction) })),
                figures: Array.from(state.figures.values()).map(entry => ({ key: entry.key, kind: entry.kind, leaving: entry.leaving, ready: Boolean(entry.model || entry.sprite),
                    x: entry.started ? round(entry.cx.v, 3) : null, alpha: entry.started ? round(entry.alpha.v, 3) : null, shade: entry.started ? round(entry.shade.v, 2) : null,
                    glow: round(entry.glow.v, 2), shadow: round(entry.shadow.v, 2), blur: round(entry.blur.v, 2), filters: entry.filters.all().length,
                    ...(entry.spineFigure ? { spine: entry.spineFigure.debug() } : {}) })),
                filters: Object.fromEntries(Object.entries(filters).map(([name, chain]) => [name, chain.container.filters ? chain.container.filters.length : 0])) };
        },
        // private fork: read-only calibration seam; no candidate is persisted by this runtime.
        figureCalibration() {
            return Array.from(state.figures.values()).map(entry => {
                const sizing = entry.figureResolved || { mode: "legacy" }, warnings = [...(sizing.warnings || [])];
                if (entry.faceRest?.to.warning) warnings.push(entry.faceRest.to.warning);
                const clamp = entry.faceClamp, head = entry.restHead && headOf(entry, false, true);
                let screenChin = null;
                if (head) {
                    const cy = (head.top + head.chin) / 2, c = Math.cos(head.rotation || 0), s = Math.sin(head.rotation || 0), ys = [];
                    for (const x of [-head.width / 2, head.width / 2]) for (const y of [head.top - cy, head.chin - cy]) {
                        ys.push(world.toGlobal(new PIXI.Point(head.x + c * x - s * y, cy + s * x + c * y)).y);
                    }
                    screenChin = Math.max(...ys);
                }
                return { key: entry.key, alias: entry.figure.alias, candidate: entry.figureCandidate || null, sizing: { ...sizing, warnings },
                    restHead: entry.restHead, headroom: entry.headroom, occluderTop: state.faceOccluderTop,
                    faceVisibility: { rest: entry.faceRestCurrent, target: entry.faceRest?.to, computations: entry.faceRest?.computations,
                        clamp, activations: entry.faceClampActivations || 0, screenChin } };
            });
        },
        figureScale() { return { ...state.figureScale, hMax: forkFigureSceneFrame(state.figureScale, state.clock).hMax }; },
        figureWarnings() { return forkFigureMixedWarning(Array.from(state.figures.values()).filter(e => !e.leaving && e.figure.visible !== false).map(e => e.figureResolved || { mode: "legacy" })); },
        head(alias) { return headOf(alias); },
        description() { return JSON.parse(JSON.stringify(describe(), (key, value) => key === "audio" ? (value ? "audio" : null) : value)); },
        quality(value) { forkStageQuality.set(value); },
        slow(scale) { state.timeScale = Math.max(0.01, Math.min(4, Number(scale) || 1)); return state.timeScale; },
        // Keeps frames coming while the window is hidden (occluded or on another desktop, where the browser
        // pauses animation frames), for screenshots from automation. Not for FPS measurements.
        pump(on) {
            if (state.pump) { state.pump.stop = true; state.pump.off(); state.pump = null; }
            if (!on) return false;
            const channel = new MessageChannel(), pump = { stop: false, last: 0 };
            state.pump = pump;
            channel.port1.onmessage = function () {
                if (pump.stop || state.destroyed || !forkForeground.isForeground()) return;
                const t = performance.now();
                if (forkForeground.isForeground() && document.hidden && t - pump.last >= 15) { pump.last = t; app.ticker.update(t); }
                channel.port2.postMessage(0);
            };
            pump.off = forkForeground.subscribe(active => { if (active) channel.port2.postMessage(0); });
            return true;
        }
    };
    function figureRects() {
        return forkGalFigureRects(Array.from(state.figures.values(), entry => ({ id: entry.figure.alias, visible: entry.container.visible,
            body: entry.restBody, head: entry.restHead, shift: entry.headroom })), state.camera.safe, app.screen.width, app.screen.height);
    }
    const stageHost = host.closest('.fork-gal-stage');
    // Refresh only the shared empty texture; keep figures, transitions and configured backgrounds intact.
    const emptyThemeObserver = new MutationObserver(() => {
        const canvas = generated.empty.baseTexture.resource.source;
        forkStagePaintEmpty(canvas.getContext('2d'), canvas.width, canvas.height, forkStageEmptyPalette(host));
        generated.empty.baseTexture.update();
        state.changedAt = performance.now();
    });
    if (stageHost) emptyThemeObserver.observe(stageHost, {attributes:true, attributeFilter:['data-theme']});
    const faceBoxObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
        if (state.faceEnvironment) state.faceEnvironment.boxDirty = true;
    }) : null;
    if (stageHost) forkGalFigureSources.set(stageHost, figureRects);
    return {
        figureRects,
        app, filters, layers: { world, backdrop, backFx, figures: figuresBox, frontFx, emotes: emotesBox, overlay }, debug,
        set(desc) { state.desc = desc; state.changedAt = performance.now(); },
        destroy() {
            state.destroyed = true;
            releaseForeground();
            releaseBlinkForeground();
            faceBoxObserver?.disconnect();
            emptyThemeObserver.disconnect();
            if (stageHost && forkGalFigureSources.get(stageHost) === figureRects) forkGalFigureSources.delete(stageHost);
            if (state.pump) { state.pump.stop = true; state.pump.off(); }
            app.ticker.remove(frame);
            effects.destroy();
            state.figures.forEach(destroyFigure);
            state.layers.forEach(layer => { if (layer.correction) layer.correction.destroy(); });
            state.textures.forEach(record => { record.dead = true; if (record.texture) record.texture.destroy(true); });
            state.textures.clear();
            app.destroy(true, { children: true });
            Object.values(generated).forEach(texture => texture.destroy(true));
            forkLive2dDropContext(gl);
        }
    };
}

// The stage's scene layer (behind the DOM text box, top bar and choices). props.scene is the description
// built by ForkGalStage: { core, quality, background: { url, name, time, transition }, grade (time of day),
// light (a stage look id), looks (the look registry), weather, camera: { shot, target }, dof, figures (…
// light, color), effects, skipping, preload }.
// props.onDebug receives debug-hook effects the stage renders itself (title cards, face-window emotes);
// props.onUi receives the UI-follow frame every scene frame (forkGalLookUi).
function ForkGalScene(props) {
    const h = React.createElement;
    // private fork: install only changes runtime availability, never persistent stage state.
    useForkCubismRevision();
    const host = React.useRef(null);
    const scene = React.useRef(null);
    const latest = React.useRef(props.scene);
    const debugHandler = React.useRef(props.onDebug);
    const uiHandler = React.useRef(props.onUi);
    const presentedHandler = React.useRef(props.onPresented);
    const backdropHandler = React.useRef(props.onBackdrop);
    const [error, setError] = React.useState("");
    latest.current = forkCubismCore.core && !props.scene?.core ? { ...props.scene, core: forkCubismCore.core } : props.scene;
    debugHandler.current = props.onDebug;
    uiHandler.current = props.onUi;
    presentedHandler.current = props.onPresented;
    backdropHandler.current = props.onBackdrop;
    if (scene.current) scene.current.set(latest.current);
    React.useEffect(function () {
        let live = true;
        forkLoadPixiRuntime().then(function () {
            if (!live || !host.current) return;
            try {
                scene.current = forkGalCreateScene(host.current, { quality: latest.current && latest.current.quality, onError: message => { if (live) setError(message); },
                    onDebug: effect => { if (live && debugHandler.current) debugHandler.current(effect); },
                    onUi: frame => { if (live && uiHandler.current) uiHandler.current(frame); },
                    onPresented: revision => { if (live) presentedHandler.current?.(revision); },
                    onBackdrop: revision => { if (live) backdropHandler.current?.(revision); } });
                scene.current.set(latest.current);
                window.forkGalDebug = scene.current.debug;
            } catch (err) { setError(String(err && err.message || err)); }
        }, function (err) { if (live) setError(String(err && err.message || err)); });
        return function () {
            live = false;
            if (scene.current) {
                if (window.forkGalDebug === scene.current.debug) delete window.forkGalDebug;
                scene.current.destroy(); scene.current = null;
            }
        };
    }, []);
    // private fork: the stage shows scene failures in its own notice stack, clear of the HUD.
    const errorHandler = props.onError;
    React.useEffect(() => { if (errorHandler) errorHandler(error); }, [error, errorHandler]);
    return h("div", { className: "fork-gal-scene", ref: host, "aria-hidden": true },
        error && !errorHandler ? h("p", { className: "fork-live2d-error", role: "alert" }, error) : null);
}
