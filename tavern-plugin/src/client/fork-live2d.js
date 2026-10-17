// @include fork-layered-sprite.cjs
// @include fork-layered-sprite-render.js

// Private fork (docs/fork/galgame-stage.md): Live2D portraits for the galgame stage.
// Runtime: pixi.js 6 + pixi-live2d-display (cubism4; it embeds the Live2D Cubism Framework) and the proprietary Cubism
// Core. The user imports both (fork-cubism-core.js); the host serves them from the data directory, never from git.
// The card's portrait library (its asset pack) lists model folders and their mood → expression map
// (host: lib/domain/live2d-library.js).

// Scripts load once per page, in order: Cubism Core → pixi → pixi-live2d-display. The stage scene
// needs pixi alone even without a Cubism Core (backgrounds, static portraits); the Live2D plugin can
// still be added later because it only has to come after the core.
let forkLive2dRuntime = null, forkPixiRuntime = null;
const FORK_LIVE2D_VENDOR = "/api/dsh-tavern/vendor/runtime-assets/live2d/";
function forkLoadScript(src) {
    return new Promise(function (resolve, reject) {
        const node = document.createElement("script");
        node.src = src; node.async = false;
        node.onload = resolve; node.onerror = () => reject(new Error("加载失败：" + src));
        document.head.appendChild(node);
    });
}
function forkLoadPixiRuntime() {
    if (window.PIXI) return Promise.resolve(window.PIXI);
    if (forkPixiRuntime) return forkPixiRuntime;
    forkPixiRuntime = forkLoadScript(FORK_LIVE2D_VENDOR + "pixi.min.js")
        .then(() => { if (!window.PIXI) throw new Error("pixi 运行库不可用"); return window.PIXI; })
        .catch(error => { forkPixiRuntime = null; throw error; });
    return forkPixiRuntime;
}
function forkLoadLive2dRuntime(coreUrl) {
    // private fork: absence is a capability state, not a failed model load.
    coreUrl = coreUrl || forkCubismCore.core;
    if (!coreUrl) return Promise.resolve(null);
    if (forkLive2dRuntime) return forkLive2dRuntime;
    const script = forkLoadScript, vendor = FORK_LIVE2D_VENDOR;
    forkLive2dRuntime = (window.Live2DCubismCore ? Promise.resolve() : script(coreUrl))
        .then(() => window.PIXI ? null : forkLoadPixiRuntime())
        .then(() => window.PIXI && window.PIXI.live2d ? null : script(forkCubismCore.display || vendor + "pixi-live2d-display-cubism4.min.js"))
        .then(() => {
            if (!window.PIXI || !window.PIXI.live2d) throw new Error("Live2D 运行库不可用");
            const settings = window.PIXI.live2d.ModelSettings.prototype, resolve = settings.resolveURL;
            // Pixi's legacy URL resolver corrupts blob:http:// into blob:http//.
            // Owned bundle dependencies are already absolute; keep their opaque URLs intact.
            if (!resolve.forkBlobURLs) {
                settings.resolveURL = function (url) { return url.startsWith("blob:") ? url : resolve.call(this, url); };
                settings.resolveURL.forkBlobURLs = true;
            }
            return window.PIXI;
        })
        .catch(error => { forkLive2dRuntime = null; throw error; });
    return forkLive2dRuntime;
}

function forkLive2dLoadError(error) {
    const detail = String(error?.message || error);
    return "模型加载失败：" + (/^(Network error\.?|Failed to fetch|Load failed)$/i.test(detail) ? "资源读取失败，请重试" : detail);
}

// Mouth level of the voice clip that is playing now (0–1). The clip element is routed
// through one AudioContext analyser; its sound still reaches the speakers.
const forkLipSync = (function () {
    const taps = new WeakMap();
    function tap(audio) {
        if (!audio) return null;
        if (taps.has(audio)) return taps.get(audio);
        try {
            // Reuse the mixer's source: a media element can only be connected once.
            const analyser = forkStageAudio.analyser(audio);
            if (!analyser) return null;
            const entry = { analyser, data: new Float32Array(analyser.fftSize), level: 0, peak: 0.06 };
            taps.set(audio, entry);
            return entry;
        } catch (_) { taps.set(audio, null); return null; }
    }
    return {
        wake() { forkStageAudio.wake(); },
        level(audio) {
            const entry = audio && !audio.paused ? tap(audio) : null;
            if (!entry) return 0;
            entry.analyser.getFloatTimeDomainData(entry.data);
            let sum = 0; for (let i = 0; i < entry.data.length; i++) sum += entry.data[i] * entry.data[i];
            const rms = Math.sqrt(sum / entry.data.length);
            // Automatic gain: loudness relative to this clip's recent peak, so quiet synthesized
            // voices still open the mouth fully on stressed syllables and close it in pauses.
            entry.peak = Math.max(rms, entry.peak * 0.995, 0.02);
            const relative = rms / entry.peak;
            const target = relative < 0.12 ? 0 : Math.min(1, Math.pow((relative - 0.12) / 0.7, 0.75));
            entry.level += (target - entry.level) * (target > entry.level ? 0.7 : 0.35);
            return entry.level < 0.05 ? 0 : entry.level;
        }
    };
})();

// Placement: x as a fraction of the stage width. The figure canvas of these models is
// 2400×3100 with the head near the top; frame head-to-waist.
function forkLive2dSlots(count) { return count <= 1 ? [0.5] : count === 2 ? [0.33, 0.67] : [0.2, 0.5, 0.8]; }
// flip: horizontal
// scale sign (-1 mirrored, in between while turning). x is always the figure's centre.
function forkLive2dPlace(model, width, height, x, speaking, preview, focus, flip, figureSizing) {
    focus = focus || 1;
    if (flip == null) flip = 1;
    // Canvas size of this model (Magia Record: 2400×3100 full figure; AI-built busts are squarer).
    const W = model.internalModel.originalWidth || 2400, H = model.internalModel.originalHeight || 3100;
    // private fork: avatar previews retain head-fit; only calibrated stage entries use centimeters.
    if (!preview && figureSizing) {
        const physical = resolveFigureSizing({ ...figureSizing, canvas: [W, H], W: width, H: height, stageX: width * x, speaking, focus, flip });
        model.forkFigureSizing = physical;
        if (physical.mode === "physical") {
            model.scale.set(physical.scale * flip, physical.scale);
            model.position.set(physical.x, physical.y);
            return physical;
        }
    }
    const bust = H / W < 1.15;
    let scale;
    // Models may declare where their head sits ("ForkStage": { "HeadTop", "Chin" } in model3.json,
    // fractions of the canvas height). They are then sized so their head matches a Magia Record
    // figure's (top at 13% of the stage, 19% tall), whatever the canvas framing.
    const settings = model.internalModel.settings && model.internalModel.settings.json;
    // Sampled head bounds are for visibility, not a new sizing/ground calibration.
    const frame = settings && settings.ForkStage;
    if (!preview && frame && frame.Chin > frame.HeadTop && frame.HeadTop >= 0) {
        scale = Math.min(height * 0.19 / ((frame.Chin - frame.HeadTop) * H), width * 0.6 / W);
        const s = scale * (speaking ? 1.03 : 1) * focus;
        model.scale.set(s * flip, s);
        model.x = width * x - W / 2 * model.scale.x;
        const top = 0.13 + (focus < 1 ? (1 - focus) * 0.3 : -(focus - 1) * 0.1);
        model.y = height * top - H * frame.HeadTop * s;
        return;
    }
    if (bust) {
        // A bust fills the lower part of the stage, its bottom edge hidden behind the text box.
        scale = preview ? Math.min(width / W, height / H) : Math.min(height * 0.8 / H, width * 0.36 / W);
        const s = scale * (speaking ? 1.03 : 1) * focus;
        model.scale.set(s * flip, s);
        model.x = width * x - W / 2 * model.scale.x;
        // A close-up grows downwards from near the top instead of pushing the head off screen.
        const y = preview ? (height - H * s) / 2 : height - H * s + height * 0.04;
        model.y = !preview && focus > 1 ? Math.max(y, height * 0.02) : y;
        return;
    }
    // Full figure: head near the top, body down to the thighs behind the text box; never wider than a slot.
    // Closer figures lift a little so the face fills more; farther ones stand lower.
    scale = preview ? height / (H * 0.484) : Math.min(height / (H * 0.758), width / (W * 1.083));
    const s = scale * (speaking ? 1.03 : 1) * focus;
    model.scale.set(s * flip, s);
    model.x = width * x - W / 2 * model.scale.x;
    const top = preview ? 0.02 : 0.06 + (focus < 1 ? (1 - focus) * 0.3 : -(focus - 1) * 0.1);
    model.y = height * top - H * (preview ? 0.0645 : 0.055) * s;
}
// Head frame from the model's "ForkStage" { HeadTop, Chin } (fractions of the canvas height), the stage's
// sampled head, or a default for Magia Record full figures / square busts.
function forkLive2dHeadFrame(model) {
    const settings = model.internalModel.settings && model.internalModel.settings.json;
    const frame = settings && settings.ForkStage;
    if (frame && frame.Chin > frame.HeadTop && frame.HeadTop >= 0) return frame;
    if (model.forkStageHeadFrame) return model.forkStageHeadFrame;
    const W = model.internalModel.originalWidth || 2400, H = model.internalModel.originalHeight || 3100;
    return H / W < 1.15 ? { HeadTop: 0.12, Chin: 0.5 } : { HeadTop: 0.085, Chin: 0.235 };
}
// Staged actions without a matching motion group: head params and transform offsets over time.
// Nod/Shake play the model's own motion group when it has one (Magia Record models name theirs
// motion_000…, so they always use these).
const FORK_LIVE2D_ACTS = { nod: 700, shake: 850, jump: 740, tremble: 1000, turn: 1400, bow: 1300, lean: 1400, "step-back": 1300 };
function forkLive2dStartAct(entry, name, now) {
    if (!FORK_LIVE2D_ACTS[name]) return;
    const groups = entry.model.internalModel.settings.motions || {};
    const own = (name === "nod" || name === "shake") && Object.keys(groups).find(group => group.toLowerCase() === name);
    if (own) { entry.model.motion(own, 0, 3); return; }
    entry.act = { name, start: now, duration: FORK_LIVE2D_ACTS[name] };
}
function forkLive2dActFrame(entry, now, reduced) {
    const frame = { dx: 0, dy: 0, px: 0, flip: 1, angleX: 0, angleY: 0, zoom: 1, scaleX: 1, scaleY: 1 };
    const act = entry.act;
    if (!act) return frame;
    const t = (now - act.start) / act.duration;
    if (t >= 1 || t < 0) { entry.act = null; return frame; }
    // Nod: one deep dip and a small second one.
    if (act.name === "nod") { frame.angleY = t < 0.6 ? -18 * Math.sin(Math.PI * t / 0.6) : -8 * Math.sin(Math.PI * (t - 0.6) / 0.4); frame.dy = 0.008 * Math.sin(Math.PI * t); }
    else if (act.name === "shake") frame.angleX = 10 * Math.sin(Math.PI * 4 * t) * Math.pow(Math.sin(Math.PI * t), 2);
    else if (act.name === "jump") { Object.assign(frame, forkGalHopAt(t, reduced)); frame.hop = true; }
    else if (act.name === "tremble") frame.px = forkGalShiverAt(t);
    else if (act.name === "turn") frame.flip = t < 0.2 ? Math.cos(Math.PI * t / 0.2) : t < 0.8 ? -1 : -Math.cos(Math.PI * (t - 0.8) / 0.2);
    // Bow / lean / step-back: body moves shared with static portraits (fork-gal-scene.js forkGalBodyActAt).
    else { const body = forkGalBodyActAt(act.name, t); frame.dy = body.dy; frame.zoom = body.zoom; frame.angleY = body.angleY; }
    return frame;
}

// Scale the whole model around its bottom center, not its top-left origin.
function forkLive2dApplyHop(model, act) {
    const im = model.internalModel;
    const width = (im.originalWidth || 2400) * model.scale.x;
    const height = (im.originalHeight || 3100) * model.scale.y;
    model.x += width * (1 - act.scaleX) / 2;
    model.y += height * (1 - act.scaleY) + Math.abs(height) * act.dy;
    model.scale.set(model.scale.x * act.scaleX, model.scale.y * act.scaleY);
}

// pixi-live2d-display 0.4 keeps Cubism's shader programs in one singleton bound to one WebGL
// context, so a second canvas (a settings preview next to the stage) breaks
// both. Each renderer swaps its own programs in right before it draws.
const forkLive2dShaders = new Map();
function forkLive2dUseContext(gl) {
    const Shader = window.PIXI && window.PIXI.live2d && window.PIXI.live2d.CubismShader_WebGL;
    if (!Shader || !gl) return;
    const shader = Shader.getInstance();
    if (shader.gl === gl) return;
    if (shader.gl) forkLive2dShaders.set(shader.gl, shader._shaderSets);
    shader._shaderSets = forkLive2dShaders.get(gl) || [];
    shader.gl = gl;
}
function forkLive2dDropContext(gl) {
    forkLive2dShaders.delete(gl);
    const Shader = window.PIXI && window.PIXI.live2d && window.PIXI.live2d.CubismShader_WebGL;
    if (Shader && Shader.getInstance().gl === gl) { Shader.getInstance().gl = null; Shader.getInstance()._shaderSets = []; }
}
// Syllable-like flapping for lines without audio: a new target every ~70–130 ms, eased.
function forkSyntheticMouth(entry, now) {
    if (!entry.flap || now >= entry.flap.next) entry.flap = { target: Math.random() < 0.18 ? 0.1 : 0.45 + Math.random() * 0.55, next: now + 70 + Math.random() * 60, value: entry.flap ? entry.flap.value : 0 };
    entry.flap.value += (entry.flap.target - entry.flap.value) * 0.45;
    return entry.flap.value;
}
function forkLive2dExpress(entry, figure) {
    if (!entry || !entry.model || !figure) return;
    let expression = figure.expression !== undefined ? figure.expression : (figure.moods && figure.moods[figure.mood]) || "";
    // private fork: a pack emotionMap entry ({expression, motion}) selects by name, never by object identity.
    if (expression && typeof expression === "object") expression = typeof expression.expression === "string" ? expression.expression : "";
    if (entry.mood === expression) return;
    entry.mood = expression;
    const manager = entry.model.internalModel.motionManager.expressionManager;
    // Prefer the model's own neutral expression; pixi-live2d-display 0.4 ignores re-selecting the
    // expression that was active before resetExpression(), so clear its memory of it too.
    const neutral = (entry.model.internalModel.settings.expressions || []).some(item => item.Name === "neutral") ? "neutral" : "";
    if (expression || neutral) entry.model.expression(expression || neutral);
    else if (manager) { manager.resetExpression(); manager.currentExpression = manager.defaultExpression; }
}

// Static portrait: name + a default picture + one picture per mood (transparent PNG/WebP recommended).
