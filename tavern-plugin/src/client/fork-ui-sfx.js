// Private fork (docs/fork/panel-ui-design.md「界面音效」): galgame UI cues for the stage — menu / CONFIG / backlog /
// dialogs / choices. Eight Kenney CC0 one-shots (tavern-plugin/lib/client-assets/ui-sfx/CREDITS.md), a few KB each,
// fetched once and decoded once into AudioBuffers; each play is a fresh BufferSource on a tiny AudioContext of
// its own (created on the first cue, which always runs inside a user gesture). Volume: the mixer's 「界面音效」
// layer × 总音量 (forkStageAudio); silent when either is muted or zero. Stage-only: nothing outside the stage calls it.

const FORK_UI_SFX_BASE = "/api/dsh-tavern/client-assets/ui-sfx/";
// cue -> [relative gain, minimum interval between two plays of this cue in ms]. The files are levelled to the same
// RMS; the relative gain only keeps the frequent cues (hover, toggles) further back.
const FORK_UI_SFX_CUES = Object.freeze({
    open: [0.9, 120], close: [0.9, 120], move: [0.4, 70], confirm: [1, 90],
    cancel: [0.9, 90], toggle: [0.7, 60], choice: [0.8, 600]
});
// The audible gain of a cue for the mixer state (forkStageAudio.get()). Pure.
function forkUiSfxGain(prefs, cue) {
    const spec = FORK_UI_SFX_CUES[cue];
    if (!spec || !prefs) return 0;
    const level = layer => prefs.muted && prefs.muted[layer] ? 0 : Math.max(0, Math.min(1, Number(prefs[layer]) || 0));
    return spec[0] * level("ui") * level("master") * 0.25;
}
// Rate limit; mutates gate = { at: {}, last }. A cue repeated inside its own interval is dropped. One gesture often
// reaches two handlers (menu 「设置」 confirms, then CONFIG opens): the first non-hover cue wins for 60 ms. A hover
// right after any other cue (150 ms) is dropped, so moving onto a control never stacks on its click. Pure.
function forkUiSfxAllow(gate, cue, now) {
    const spec = FORK_UI_SFX_CUES[cue];
    if (!spec) return false;
    if (now - (gate.at[cue] ?? -Infinity) < spec[1]) return false;
    if (now - (gate.last ?? -Infinity) < (cue === "move" ? 150 : 60)) return false;
    gate.at[cue] = now;
    if (cue !== "move") gate.last = now;
    return true;
}
// The cue a click on a stage panel control makes, for delegated panels (CONFIG, mixer, BGM player, dialogs).
// An explicit data-ui-sfx wins ("" = none); tabs confirm; radios / switches / pressed toggles toggle (not when
// already on). Native inputs are left to their change event (forkUiSfxBind). Pure apart from the DOM reads.
function forkUiSfxControlCue(target) {
    const control = target && target.closest ? target.closest("button, input, [role=tab], [role=radio], [role=switch], [data-ui-sfx]") : null;
    if (!control || control.disabled || control.getAttribute("aria-disabled") === "true") return null;
    const explicit = control.getAttribute("data-ui-sfx");
    if (explicit !== null) return Object.hasOwn(FORK_UI_SFX_CUES, explicit) ? explicit : null;
    if (control.tagName === "INPUT") return null;
    const role = control.getAttribute("role");
    if (role === "tab") return control.getAttribute("aria-selected") === "true" ? null : "confirm";
    if (role === "radio" || role === "switch") return role === "radio" && control.getAttribute("aria-checked") === "true" ? null : "toggle";
    return control.hasAttribute("aria-pressed") ? "toggle" : null;
}
// private fork (UI standard phase 2 batch 4): the shared ForkSlider (role=slider) fires `change` on release / key step too.
function forkUiSfxChangeCue(target) {
    const slider = Boolean(target && target.getAttribute && target.getAttribute("role") === "slider");
    if (!target || (target.tagName !== "INPUT" && !slider) || target.disabled || (slider && target.getAttribute("aria-disabled") === "true")) return null;
    const explicit = target.getAttribute("data-ui-sfx");
    if (explicit !== null) return Object.hasOwn(FORK_UI_SFX_CUES, explicit) ? explicit : null;
    if (slider) return "toggle";
    // A range's change fires on release (pointer) or per step (keys): the release cue doubles as a level preview.
    return ["range", "radio", "checkbox"].includes(target.type) ? "toggle" : null;
}

function forkCreateUiSfx(env) {
    const gate = { at: {}, last: -Infinity }, buffers = new Map(), voices = new Set();
    let context = null, loading = null;
    function load() {
        if (loading) return loading;
        const Offline = env.OfflineAudioContext;
        if (!Offline || typeof env.fetch !== "function") return (loading = Promise.resolve());
        // Decode off the real context: no AudioContext before a gesture; AudioBuffers play in any context.
        const decoder = new Offline(1, 1, 48000);
        loading = Promise.all(Object.keys(FORK_UI_SFX_CUES).map(cue => env.fetch(FORK_UI_SFX_BASE + cue + ".ogg")
            .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
            .then(bytes => decoder.decodeAudioData(bytes)).then(buffer => { buffers.set(cue, buffer); }, () => {})));
        return loading;
    }
    let foregroundGain = null;
    function ensure() {
        if (!context && env.AudioContext) { try { context = new env.AudioContext(); if (env.foreground) { foregroundGain = context.createGain(); foregroundGain.connect(context.destination); env.foreground.context(context, foregroundGain); } } catch (_) { context = null; } }
        if (context && context.state === "suspended") context.resume().catch(() => {});
        return context;
    }
    function start(cue, gain) {
        const buffer = buffers.get(cue);
        if (!buffer || !context || voices.size >= 4) return false;
        const source = context.createBufferSource(), level = context.createGain();
        source.buffer = buffer; level.gain.value = gain;
        source.connect(level); level.connect(foregroundGain || context.destination);
        voices.add(source);
        source.onended = () => { voices.delete(source); source.disconnect(); level.disconnect(); };
        source.start();
        return true;
    }
    const api = {
        preload: load,
        // Plays a cue now (or as soon as the files arrive, if that is within 250 ms). Returns whether it was accepted.
        play(cue) {
            if (env.foreground && !env.foreground.isForeground()) return false;
            const gain = forkUiSfxGain(env.prefs(), cue);
            if (!(gain > 0)) return false;
            const now = env.now();
            if (!forkUiSfxAllow(gate, cue, now) || !ensure()) return false;
            if (!start(cue, gain)) void load().then(() => { if (env.now() - now < 250) start(cue, gain); });
            return true;
        },
        bind(node) {
            if (!node || !node.addEventListener) return () => {};
            // After the control's own handler: a cue for un-muting 界面音效 is heard, one for muting 总音量 is not,
            // and an explicit cue from that handler (a panel closing) wins the gesture.
            const later = cue => { if (cue) setTimeout(() => api.play(cue), 0); };
            const click = event => later(forkUiSfxControlCue(event.target));
            const change = event => later(forkUiSfxChangeCue(event.target));
            node.addEventListener("click", click, true);
            node.addEventListener("change", change, true);
            return () => { node.removeEventListener("click", click, true); node.removeEventListener("change", change, true); };
        }
    };
    return api;
}
const forkUiSfx = forkCreateUiSfx({
    foreground: typeof forkForeground !== "undefined" ? forkForeground : null,
    AudioContext: typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : undefined,
    OfflineAudioContext: typeof window !== "undefined" ? window.OfflineAudioContext || window.webkitOfflineAudioContext : undefined,
    fetch: typeof fetch === "function" ? (...args) => fetch(...args) : undefined,
    prefs: () => forkStageAudio.get(),
    now: () => typeof performance !== "undefined" ? performance.now() : Date.now()
});
// Delegated cues for a stage panel's controls while it is mounted (forkUiSfxControlCue / forkUiSfxChangeCue).
function useForkUiSfxControls(ref, active) {
    React.useEffect(() => active === false ? undefined : forkUiSfx.bind(ref.current), [active]);
}
