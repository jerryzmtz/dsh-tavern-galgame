// Private fork (docs/fork/galgame-stage.md, docs/fork/stage-audio.md): the stage mixer. One speaker icon in the
// top bar (its glyph says muted / partial / normal) opens a compact popover listing every audio layer. The
// state is forkStageAudio (fork-stage-audio.js), shared with the Config screen's 音量 tab, which renders the
// same rows larger (ForkGalMixerRows). Styled only through the stage UI tokens (--gal-ui-*).

if (typeof FORK_ICON_PATHS === "object" && !FORK_ICON_PATHS["speaker-low"]) FORK_ICON_PATHS["speaker-low"] = "M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5H4zM15.5 9a4.2 4.2 0 0 1 0 6";

// ui (界面音效, fork-ui-sfx.js) is listed but stays out of forkGalMixLevel: the icon speaks for the story's sound.
const FORK_GAL_MIX_LAYERS = [["master", "总音量"], ["voice", "配音"], ["music", "背景音乐"], ["sfx", "音效"], ["ambience", "环境音"], ["ui", "界面音效"]];
// The whole mix at a glance: "muted" when nothing can be heard (master muted / zero, or every layer muted /
// zero), "partial" when some layer is silenced, else "normal". Pure; tests/fork-gal-config.test.mjs.
function forkGalMixLevel(state) {
    const heard = layer => !(state && state.muted && state.muted[layer]) && Number(state && state[layer]) > 0;
    if (!heard("master")) return "muted";
    const on = ["voice", "music", "sfx", "ambience"].filter(heard).length;
    return on === 0 ? "muted" : on < 4 ? "partial" : "normal";
}
function forkGalMixIcon(level) { return level === "muted" ? "speaker-off" : level === "partial" ? "speaker-low" : "speaker"; }

// One row per layer: mute toggle, label (with the ambience playing; the track title lives in the HUD only — private
// fork), slider and value; a mute keeps the
// slider's value, unmuting restores it (forkStageAudio keeps volume and mute apart; moving the slider unmutes).
// props: { state (forkStageAudio.get()), names: { music, ambience }, tests: { voice(), sfx() } (large only), large }.
function ForkGalMixerRows(props) {
    const h = React.createElement;
    const state = props.state, names = props.names || {}, tests = props.tests || {}, large = Boolean(props.large);
    return h("div", { className: "fork-gal-mix" + (large ? " is-large" : ""), role: "group", "aria-label": "各层音量" },
        FORK_GAL_MIX_LAYERS.map(function ([layer, label]) {
            const muted = Boolean(state.muted && state.muted[layer]);
            const value = Number(state[layer]) || 0, percent = Math.round(value * 100);
            const name = layer === "music" ? "" : names[layer] || "";
            const test = large && layer !== "master" && layer !== "music" && layer !== "ambience" ? layer === "ui" ? () => forkUiSfx.play("confirm") : tests[layer] || null : null;
            return h("div", { key: layer, className: "fork-gal-mix-row" + (layer === "master" ? " is-master" : "") + (muted ? " is-muted" : ""), "data-layer": layer },
                h("button", { type: "button", className: "fork-gal-mix-mute", "aria-pressed": muted, "aria-label": muted ? "取消" + label + "静音" : label + "静音", title: muted ? "取消静音" : "静音",
                    onClick: () => forkStageAudio.toggleMute(layer) }, h(ForkIcon, { name: muted ? "speaker-off" : "speaker", size: large ? 20 : 16 })),
                h("span", { className: "fork-gal-mix-label" }, h("b", null, label), name ? h("span", { className: "fork-gal-mix-name", title: name }, name) : null),
                // private fork (UI standard §三.8, phase 2 batch 4): the shared ForkSlider (fork-inline-field.js) in the stage skin.
                h(ForkSlider, { skin: "fork-gal-slider", className: "fork-gal-mix-slider", min: 0, max: 1, step: 0.01, value,
                    label: layer === "master" ? label : label + "音量", valueText: muted ? "静音（" + percent + "）" : String(percent),
                    onChange: next => forkStageAudio.setVolume(layer, next) }),
                h("output", { className: "fork-gal-mix-value", "aria-hidden": true }, percent),
                large ? (layer === "master" || layer === "music" || layer === "ambience" ? h("span", { className: "fork-gal-mix-test is-none", "aria-hidden": true })
                    : h("button", { type: "button", className: "fork-gal-mix-test", disabled: !test, title: test ? (layer === "voice" ? "试听本句配音" : layer === "ui" ? "试听界面音效" : "试听音效") : layer === "voice" ? "这一页没有配音" : "没有可试听的音效",
                        "aria-label": layer === "voice" ? "试听配音" : layer === "ui" ? "试听界面音效" : "试听音效", onClick: () => { if (test) test(); } }, h(ForkIcon, { name: "play", size: 18 }))) : null);
        }));
}

// Top-bar button + popover. Esc or a click outside closes it (that click does not also turn the page).
// props: { names, tests }.
function ForkGalMixer(props) {
    const h = React.createElement;
    const [open, setOpen] = React.useState(false);
    const button = React.useRef(null), panel = React.useRef(null);
    const state = useForkStageAudioState();
    const level = forkGalMixLevel(state);
    useForkUiSfxControls(panel, open); // private fork: fork-ui-sfx.js
    React.useEffect(function () {
        if (!open) return undefined;
        const first = panel.current && panel.current.querySelector("input, button");
        if (first) first.focus({ preventScroll: true });
        function close(refocus) { forkUiSfx.play("close"); setOpen(false); if (refocus && button.current) button.current.focus(); }
        // Esc closes the popover before the stage sees it (the stage would open its menu on Esc).
        function onKey(event) { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(true); } }
        function swallow(event) { event.stopPropagation(); event.preventDefault(); }
        let timer = 0;
        function outside(event) {
            if ((panel.current && panel.current.contains(event.target)) || (button.current && button.current.contains(event.target))) return;
            close(false);
            // A click on the bare stage only dismisses; controls elsewhere still work.
            if (!(event.target && event.target.closest && event.target.closest("button, input, select, textarea, a"))) {
                document.addEventListener("click", swallow, { capture: true, once: true });
                timer = setTimeout(() => document.removeEventListener("click", swallow, true), 600);
            }
        }
        window.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", outside, true);
        return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", outside, true); clearTimeout(timer); };
    }, [open]);
    const stop = event => event.stopPropagation();
    const said = level === "muted" ? "已静音" : level === "partial" ? "部分静音" : "";
    return h("div", { className: "fork-gal-mixer" + (open ? " is-open" : ""), onClick: stop },
        h("button", { ref: button, type: "button", className: "fork-gal-mixer-toggle", "data-level": level, "aria-haspopup": "dialog", "aria-expanded": open,
            "aria-label": "混音" + (said ? "（" + said + "）" : ""), title: "混音" + (said ? " · " + said : ""), onClick: () => { forkUiSfx.play(open ? "close" : "open"); setOpen(!open); } },
            h(ForkIcon, { name: forkGalMixIcon(level), size: 16 })),
        open ? h("div", { ref: panel, className: "fork-gal-mixer-panel", role: "dialog", "aria-label": "混音", onWheel: stop, onContextMenu: stop, onKeyDown: stop },
            h("div", { className: "fork-gal-mixer-head" }, h("i", { className: "fork-gal-mixer-gem", "aria-hidden": true }), h("b", null, "混音")),
            h(ForkGalMixerRows, { state, names: props.names })) : null);
}
