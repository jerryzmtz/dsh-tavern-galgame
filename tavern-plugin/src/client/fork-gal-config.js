// Private fork (docs/fork/galgame-stage.md): the stage's CONFIG screen, visual-novel style. The gear in the
// control row opens a full-screen overlay over the blurred stage with left tabs: 音量 (the mixer rows, larger,
// with previews), 文字 (the card's box style and face window — saved to the card like the settings tab — and
// this machine's text speed / auto wait) and 画面 (film mode, effects quality). The stage owns the open state
// (auto / skip pause while it is open, like the backlog). Styled only through the stage UI tokens (--gal-ui-*).

// @include fork-gal-mixer.js
// The font picker (舞台字体 / 字幕字体 here, 正文字体 on the 外观 settings page — fork-appearance.js, same closure).
// @include fork-font-picker.js

// Card-scoped stage fields changed from the stage: serialized per session, shown at once, rolled back on
// failure. Same RPC and store as the settings tab (saveDialogueBubbles → forkBubbleStore).
const forkGalConfigSaves = new Map();
function forkBubbleSaveStage(sessionId, patch) {
    const previous = forkGalConfigSaves.get(sessionId) || Promise.resolve();
    const run = previous.catch(() => {}).then(async function () {
        const data = forkBubbleStore.get(sessionId);
        if (!data || !data.cardPath || !data.config) throw new Error("没有可保存的人物卡设置");
        const current=await rpc('getCardAssetBindings',{path:data.cardPath},sessionId);
        await rpc('saveCardAssetBindings',{path:data.cardPath,expectedRevision:current.revision,patch:{stage:{...current.extension.stage,defaultSkin:patch.defaultSkin ?? patch.theme}}},sessionId);
        const result=await rpc('getDialogueBubbles',{},sessionId);
        forkBubbleStore.set(sessionId,result);
        return result;
    });
    forkGalConfigSaves.set(sessionId, run);
    return run;
}

// The gear in the stage's control row. props: { open, onOpen() }.
function ForkGalConfig(props) {
    const h = React.createElement;
    return h("button", { type: "button", className: "fork-gal-control fork-gal-config-toggle" + (props.open ? " is-active" : ""), title: "设置", "aria-label": "设置", "aria-haspopup": "dialog", "aria-expanded": Boolean(props.open),
        onClick: event => { event.stopPropagation(); props.onOpen(); } }, h(ForkIcon, { name: "gear", size: 17 }));
}

// Application-owned slots; imported mods cannot register executable client code.
const FORK_STAGE_CONFIG_SECTIONS = {};
const FORK_STAGE_QUICK_ENTRIES = {};
function useForkStageMods(sessionId) {
    const [mods, setMods] = React.useState([]);
    React.useEffect(() => {
        let live = true, ticket = 0;
        const refresh = async () => {
            const own = ++ticket;
            try { const value = await rpc('listMods', {}, sessionId); if (live && own === ticket) setMods(value.mods); }
            catch (_) { if (live && own === ticket) setMods([]); }
        };
        refresh(); window.addEventListener('dsh-tavern-mods-changed', refresh);
        return () => { live = false; window.removeEventListener('dsh-tavern-mods-changed', refresh); };
    }, [sessionId]);
    return mods;
}
const FORK_GAL_CONFIG_TABS = [["sound", "声音", "SOUND"], ["text", "文字", "TEXT"], ["screen", "画面", "SCREEN"]];
// The last tab stays selected while the page lives (reopening returns to it).
let forkGalConfigLastTab = "sound";
const FORK_GAL_CONFIG_SAMPLE = "夕阳把走廊染成了橘色。她停下脚步，回头看了你一眼。";
const FORK_GAL_CONFIG_FILM_SAMPLE = "今天……可以一起回去吗？";

// private fork: phones get a dedicated compact layout (docs/fork/galgame-stage.md): a full-bleed sheet, a one-line
// title with the ✕ inside the header, the tabs as a horizontal bar and the rows stacked (label above control). Narrow
// viewports, and short touch screens (a phone held sideways). Wide screens keep the two-column sheet unchanged.
const FORK_GAL_CONFIG_COMPACT = "(max-width: 640px), (max-height: 520px) and (pointer: coarse)";
function useForkGalConfigCompact() {
    const has = typeof matchMedia === "function";
    const [compact, setCompact] = React.useState(() => has && matchMedia(FORK_GAL_CONFIG_COMPACT).matches);
    React.useEffect(function () {
        if (!has) return undefined;
        const list = matchMedia(FORK_GAL_CONFIG_COMPACT), changed = () => setCompact(list.matches);
        changed();
        if (list.addEventListener) list.addEventListener("change", changed);
        return () => { if (list.removeEventListener) list.removeEventListener("change", changed); };
    }, []);
    return compact;
}

// Full-screen Config. props: { sessionId, data, names: { music, ambience }, tests: { voice(), sfx() }, onClose() }.
// Esc, right click or the ✕ close it; focus stays inside while open and goes back to the opener afterwards (stage).
function ForkGalConfigScreen(props) {
    const h = React.createElement;
    const compact = useForkGalConfigCompact();
    const mods = useForkStageMods(props.sessionId);
    const tabs = [...FORK_GAL_CONFIG_TABS, ...mods.filter(row => row.scope === 'global' && FORK_STAGE_CONFIG_SECTIONS[row.id]).map(row => {
        const section = FORK_STAGE_CONFIG_SECTIONS[row.id]; return ['mod:' + row.id, section.label, section.en];
    })];
    const [selected, setTab] = React.useState(() => forkGalConfigLastTab);
    const tab = tabs.some(([id]) => id === selected) ? selected : 'sound';
    const root = React.useRef(null);
    const tabRefs = React.useRef({});
    // private fork: galgame UI cues (fork-ui-sfx.js) for tabs, switches and slider releases; the stage cues open / close.
    useForkUiSfxControls(root);
    function choose(id, focus) { forkGalConfigLastTab = id; setTab(id); if (focus && tabRefs.current[id]) tabRefs.current[id].focus(); }
    React.useEffect(function () {
        const active = tabRefs.current[tab];
        if (active) active.focus({ preventScroll: true });
        // Esc closes before the stage sees it; an open ? tip closes first.
        function onKey(event) {
            if (event.key !== "Escape") return;
            // A held Esc (auto-repeat) is not a new press: it must not close Config and then reach the stage.
            if (event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            if (event.target && event.target.closest && event.target.closest(".fork-help-tip.is-open")) return;
            // An open font picker or skin select (their lists are portaled to <body>) takes Esc first too.
            if (event.target && event.target.closest && event.target.closest(".fork-font-pick.is-open, .fork-font-pop, .fork-gal-skin-pick.is-open, .fork-gal-skin-pop")) return;
            event.preventDefault(); event.stopImmediatePropagation(); props.onClose();
        }
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);
    // Tab cycles inside the screen; the stage never sees keys typed here.
    function onKeyDown(event) {
        event.stopPropagation();
        if (event.key !== "Tab" || !root.current) return;
        const items = Array.from(root.current.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")).filter(node => node.offsetParent !== null || node === document.activeElement);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    function onTabKey(event) {
        const at = tabs.findIndex(([id]) => id === tab);
        const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? at + 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        forkUiSfx.play("move");
        choose(tabs[(next + tabs.length) % tabs.length][0], true);
    }
    // Mount only the active tab: hidden font pickers/previews would still load fonts and run effects.
    const section = tab.startsWith('mod:') && FORK_STAGE_CONFIG_SECTIONS[tab.slice(4)];
    const page = section ? h(section.Component, {rpc, sessionId:props.sessionId, compact}) : tab === "sound" ? h(ForkGalConfigSound, props) : tab === "text" ? h(ForkGalConfigText, props) : h(ForkGalConfigScreenTab, props);
    // private fork (owner 2026-10): one small, quiet ✕ at the end of the header row, inside the sheet, in both layouts.
    const close = h("button", { type: "button", className: "fork-gal-config-close", title: "关闭（Esc / 右键）", "aria-label": "关闭设置", onClick: props.onClose }, h(ForkIcon, { name: "close", size: compact ? 22 : 20 }));
    return h("div", { ref: root, className: "fork-gal-config", "data-layout": compact ? "compact" : "wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "fork-gal-config-title",
        onClick: event => event.stopPropagation(), onWheel: event => event.stopPropagation(), onKeyDown,
        onContextMenu: event => { event.preventDefault(); event.stopPropagation(); props.onClose(); } },
        h("div", { className: "fork-gal-config-sheet" },
            h("i", { className: "fork-gal-config-ornament", "aria-hidden": true }),
            // private fork (owner 2026-10): no inner frame line (no box in box); this layer only carries the corner sparkles.
            h("i", { className: "fork-gal-config-frame", "aria-hidden": true }),
            h("header", { className: "fork-gal-config-head" },
                h("h2", { id: "fork-gal-config-title", className: "fork-gal-config-title" }, h("i", { className: "fork-gal-config-gem", "aria-hidden": true }), h("b", null, "CONFIG"), h("span", null, "设置")),
                close),
            h("nav", { className: "fork-gal-config-tabs", style:compact ? {gridTemplateColumns:'repeat(' + tabs.length + ', minmax(0, 1fr))'} : undefined, role: "tablist", "aria-orientation": compact ? "horizontal" : "vertical", "aria-label": "设置分类" },
                tabs.map(([id, label, en]) => h("button", { key: id, ref: node => { tabRefs.current[id] = node; }, type: "button", role: "tab", id: "fork-gal-config-tab-" + id,
                    "aria-selected": tab === id, "aria-controls": "fork-gal-config-page", tabIndex: tab === id ? 0 : -1, className: "fork-gal-config-tab" + (tab === id ? " is-on" : ""),
                    onClick: () => choose(id), onKeyDown: onTabKey },
                    h("i", { className: "fork-gal-config-gem", "aria-hidden": true }), h("b", null, label), h("span", null, en)))),
            h("section", { id: "fork-gal-config-page", className: "fork-gal-config-page", role: "tabpanel", "aria-labelledby": "fork-gal-config-tab-" + tab, "data-tab": tab }, page)));
}

// Building blocks: a titled group, a label / control row, segmented choices.
function forkGalConfigGroup(title, tip, ...children) {
    const h = React.createElement;
    const head = Array.isArray(title) ? title : [title];
    return h("div", { className: "fork-gal-config-group" },
        h("div", { className: "fork-gal-config-caption" }, h("b", null, head[0]), tip ? h(ForkHelpTip, { label: head[0] + "说明" }, tip) : null, head[1] || null),
        ...children);
}
function forkGalConfigRow(label, control, tip, extra) {
    const h = React.createElement;
    return h("div", { className: "fork-gal-config-row" + (extra ? " " + extra : "") },
        h("div", { className: "fork-gal-config-label" }, h("b", null, label), tip ? h(ForkHelpTip, { label: label + "说明" }, tip) : null),
        h("div", { className: "fork-gal-config-control" }, control));
}
// private fork (UI standard phase 2 batch 4): multi-way rows are the shared ForkSegmented (fork-inline-field.js) in the stage
// skin; ← → choose with the tabs' move cue. Sliders are the shared ForkSlider in the stage skin (.fork-gal-slider).
function forkGalConfigSegmented(props) {
    const keys = event => { if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) forkUiSfx.play("move"); };
    return React.createElement(ForkSegmented, { ...props, base: "fork-gal-config-seg", onKeyDown: keys });
}
function forkGalConfigSlider(ends, slider) {
    const h = React.createElement, { output, ...rest } = slider;
    return h("div", { className: "fork-gal-config-slider" },
        h("span", { className: "fork-gal-config-end" }, ends[0]),
        h(ForkSlider, { skin: "fork-gal-slider", ...rest }),
        h("span", { className: "fork-gal-config-end" }, ends[1]),
        h("output", { className: "fork-gal-config-value" }, output));
}

// 音量: the mixer rows, larger, with ▶ previews where cheap (a built-in one-shot, the current voice line).
function ForkGalConfigSound(props) {
    const h = React.createElement;
    const state = useForkStageAudioState();
    const reading = useForkStageReading();
    const [rateMin, rateMax, rateStep] = FORK_STAGE_READING_LIMITS.voiceRate;
    return h(React.Fragment, null,
        forkGalConfigGroup(["音量", h("span", { key: "hint", className: "fork-gal-config-caption-rest" }, "本机")],
            h(React.Fragment, null, h("span", null, "每层各自静音，静音时滑块保留原值。"), h("span", null, "▶ 试听：配音播放当前这一句，音效播放一个短提示音。")),
            h(ForkGalMixerRows, { state, names: props.names, tests: props.tests, large: true })),
        forkGalConfigGroup(["配音", h("span", { key: "hint", className: "fork-gal-config-caption-rest" }, "本机")], null,
            forkGalConfigRow("配音倍速", forkGalConfigSlider(["慢", "快"], { min: rateMin, max: rateMax, step: rateStep, value: reading.voiceRate, label: "配音倍速",
                    valueText: reading.voiceRate.toFixed(1) + " 倍", output: reading.voiceRate.toFixed(1) + "×", onChange: value => forkStageReading.set({ voiceRate: value }) }),
                "所有配音按这个倍率播放，音调不变；舞台和聊天气泡都生效，正在播放的这一句也立即变速。默认 1.0 倍。")));
}

// private fork (owner 2026-10): an on / off switch drawn in the stage tokens (track + knob), the same geometry as the stage
// settings' switches; a button with role="switch", never a native checkbox. No state word beside it (UI standard §三.7,
// phase 2 batch 4).
function ForkGalConfigSwitch(props) {
    const h = React.createElement;
    const on = Boolean(props.checked);
    return h("button", { type: "button", role: "switch", className: "fork-gal-config-switch", "aria-label": props.label, "aria-checked": on, "aria-busy": props.busy || undefined,
        disabled: Boolean(props.disabled), onClick: () => props.onChange(!on) },
        h("span", { className: "fork-gal-config-switch-track", "aria-hidden": true }, h("i", null)));
}

// 文字: the card's box style (cards with a mini preview in that style) and face window, saved to the card; this
// machine's text speed and auto-mode wait, the stage / subtitle fonts (fork-font-picker.js, applied at once), and a
// live preview that types and waits like the stage, in the stage font, with a subtitle line in the film font.
function ForkGalConfigText(props) {
    const h = React.createElement;
    const stage = props.data && props.data.config && props.data.config.stage || {};
    const reading = useForkStageReading();
    const [state, setState] = React.useState(""); // "" | saving | saved | error text
    async function saveStage(patch) {
        setState("saving");
        try { await forkBubbleSaveStage(props.sessionId, patch); setState("saved"); }
        catch (error) { setState(String(error && error.message || error)); }
    }
    const theme = stage.theme || "classic";
    const skinChoices=stage.skinChoices || FORK_STAGE_THEMES.map(([value,label])=>({value,label}));
    const saved = h("span", { key: "saved", className: "fork-gal-config-saved", role: "status", "data-state": state === "saving" || state === "saved" || !state ? state || "idle" : "error", title: state && state !== "saving" && state !== "saved" ? state : undefined },
        state === "saving" ? "保存中…" : state === "saved" ? h(React.Fragment, null, h(ForkIcon, { name: "check", size: 14 }), "已保存到本卡") : state ? "未保存" : "");
    const [speedMin, speedMax, speedStep] = FORK_STAGE_READING_LIMITS.textSpeed, [waitMin, waitMax, waitStep] = FORK_STAGE_READING_LIMITS.autoWait;
    // Speed reads left = slow, right = fast (instant at the far right); stored as milliseconds per character.
    const speedValue = speedMax - reading.textSpeed;
    const fonts = typeof forkFonts !== "undefined" && typeof ForkFontPicker === "function";
    const preview = h(ForkGalConfigPreview, { reading, film: fonts });
    // private fork (owner 2026-10 global-first): settings for every card (本机 阅读 / 字体) come first, the 本卡 group last.
    const cardGroup = forkGalConfigGroup(["本卡", saved], "与舞台设置中的默认皮肤一致，随人物卡保存和导出。",
        forkGalConfigRow("默认舞台皮肤", h(ForkGalConfigSkinSelect, { label: "默认舞台皮肤", choices: skinChoices, value: stage.defaultSkin || theme, stage, theme, reducedMotion: reading.reducedMotion === true,
            onChange: id => saveStage({ defaultSkin: id }) })));
    return h(React.Fragment, null,
        forkGalConfigGroup(["阅读", h("span", { key: "rest", className: "fork-gal-config-caption-rest" }, "本机")], null,
            forkGalConfigRow("文字速度", forkGalConfigSlider(["慢", "快"], { min: 0, max: speedMax - speedMin, step: speedStep, value: speedValue, label: "文字速度",
                    valueText: reading.textSpeed === 0 ? "瞬间显示" : reading.textSpeed + " 毫秒每字", output: reading.textSpeed === 0 ? "瞬间" : reading.textSpeed + " ms/字", onChange: value => forkStageReading.set({ textSpeed: speedMax - value }) }),
                "打字机效果每个字的间隔；拉到最右边整句直接出现。默认 " + FORK_STAGE_READING_DEFAULTS.textSpeed + " 毫秒。"),
            forkGalConfigRow("自动阅读速度", forkGalConfigSlider(["慢", "快"], { min: 0.5, max: 3, step: 0.1, value: reading.autoSpeed, label: "自动阅读速度",
                    valueText: reading.autoSpeed.toFixed(1) + " 倍", output: reading.autoSpeed.toFixed(1) + "×", onChange: value => forkStageReading.set({ autoSpeed: value }) }),
                "按倍率缩放无配音页的阅读时间（含最短停留）和配音结束后的等待；不会截断正在播放的配音。默认 1.3 倍，比原来的节奏稍快。立即生效。"),
            forkGalConfigRow("自动模式等待", forkGalConfigSlider(["短", "长"], { min: waitMin, max: waitMax, step: waitStep, value: reading.autoWait, label: "自动模式等待",
                    valueText: (reading.autoWait / 1000).toFixed(1) + " 秒", output: (reading.autoWait / 1000).toFixed(1) + " 秒", onChange: value => forkStageReading.set({ autoWait: value }) }),
                h(React.Fragment, null, h("span", null, "配音结束后的基础停顿，再除以自动阅读速度；不会截断配音。"), h("span", null, "无配音页按字数阅读，再加入相对 0.7 秒的等待增减，最后按速度缩放。等待控制停顿，速度控制整体阅读节奏。"))),
            fonts ? null : preview),
        fonts ? forkGalConfigGroup(["字体", h("span", { key: "rest", className: "fork-gal-config-caption-rest" }, "本机")], null,
            // private fork (docs/fork/fonts.md): no context, so 「跟随样式」 follows the active stage's skin declaration
            // (fork-fonts.js) and updates when the skin switches. 千禧晴空 (aero) declares no stage font: system 微软雅黑.
            forkGalConfigRow("舞台字体", h(ForkFontPicker, { role: "stage", label: "舞台字体", follow: "跟随样式", builtin: theme === "aero" ? "微软雅黑" : undefined, theme, variant: "stage" }),
                h(React.Fragment, null, h("span", null, "文本框、姓名牌、候选项和这个设置画面用的字体，选中立刻生效。"),
                    h("span", null, "跟随样式：用当前舞台皮肤指定的字体；皮肤没有指定就用内置字体（千禧晴空是系统的微软雅黑）。"), h("span", null, "只保存在这台电脑上，所有人物卡通用。"))),
            forkGalConfigRow("字幕字体", h(ForkFontPicker, { role: "film", label: "字幕字体", follow: "跟随样式", theme, variant: "stage" }),
                h(React.Fragment, null, h("span", null, "电影模式下字幕用的字体。"), h("span", null, "跟随样式：用皮肤指定的字幕字体，没有就用皮肤的舞台字体。"), h("span", null, "只保存在这台电脑上，所有人物卡通用。"))),
            preview) : null,
        cardGroup);
}
// private fork (owner 2026-10): 默认舞台皮肤 as a compact select instead of a grid of preview cards. The trigger shows a
// small preview of the chosen skin and its name; the list (portaled like the font picker's, in the stage tokens) shows
// every skin with its preview, the chosen one marked. Keys: ↓ / ↑ on the trigger open it; ↑ ↓ Home End move,
// Enter / Space choose, Esc / Tab close (Esc does not reach the CONFIG screen).
// Built-in ids compare by id; pack skins by all three identity fields (storage may reorder the keys).
function forkGalSkinKey(value) { return typeof value === "string" ? value : value ? JSON.stringify([value.packId, value.kind, value.assetId]) : ""; }
// What a choice's thumbnail paints: a built-in renders its own theme scope; a pack skin uses the palette the host
// sent with the choice (choice.preview) or, when it is the card's current skin, that skin document; else unknown.
function forkGalSkinPreview(choice, stage) {
    const value = choice && choice.value;
    if (typeof value === "string") return { theme: value };
    const current = stage && stage.skin && stage.skin.ref && stage.skin.document && forkGalSkinKey(stage.skin.ref) === forkGalSkinKey(value) ? stage.skin.document : null;
    const paint = choice && choice.preview || current && { ...current.textbox && current.textbox.paint, ...current.ui };
    if (!paint || !paint.bg) return { unknown: true };
    const radius = current && (current.ui && current.ui.radius != null ? current.ui.radius : current.textbox && current.textbox.shape && current.textbox.shape.radius);
    return { style: { "--gal-ui-surface-2": paint.bg, "--gal-ui-ink": paint.fg || paint.bg, "--gal-ui-accent": paint.accent || paint.fg, "--gal-ui-line": paint.border || paint.fgMuted || paint.fg,
        // A pack skin has no gem of its own: the neutral caret, not the current theme's shape.
        "--gal-ui-gem": "polygon(0 0, 100% 0, 50% 100%)", "--gal-ui-gem-width": "9px", "--gal-ui-gem-height": "7px",
        "--gal-ui-gem-fill": paint.accent || paint.fg, ...(radius != null ? { "--gal-ui-radius": radius + "px" } : {}) } };
}
function ForkGalConfigSkinThumb(props) {
    const h = React.createElement;
    const look = forkGalSkinPreview(props.choice, props.stage);
    const label = String(props.choice && props.choice.label || "");
    if (look.unknown) return h("span", { className: "fork-gal-config-theme-art is-unknown", "aria-hidden": true }, h("b", null, Array.from(label)[0] || "?"));
    return h("span", { className: "fork-gal-config-theme-art" + (look.theme ? " fork-gal-theme-scope" : ""), "data-theme": look.theme, style: look.style, "aria-hidden": true },
        h("i", { className: "art-name" }), h("i", { className: "art-line" }), h("i", { className: "art-line is-short" }), h("i", { className: "art-gem" }));
}
// props: { label, choices [{ value, label, preview? }], value, stage, theme, reducedMotion, onChange(value) }
function ForkGalConfigSkinSelect(props) {
    const h = React.createElement;
    const [open, setOpen] = React.useState(false);
    const wrap = React.useRef(null), trigger = React.useRef(null), pop = React.useRef(null);
    const key = forkGalSkinKey(props.value);
    const choices = props.choices || [];
    const current = choices.find(choice => forkGalSkinKey(choice.value) === key) || null;
    const name = current ? current.label : "未选择";
    function close(refocus) {
        setOpen(false);
        if (refocus && trigger.current && typeof trigger.current.focus === "function") trigger.current.focus({ preventScroll: true });
    }
    function choose(choice) {
        forkUiSfx.play("toggle");
        close(true);
        if (forkGalSkinKey(choice.value) !== key) props.onChange(choice.value);
    }
    // Open: focus the chosen option; Esc (capture, before the CONFIG screen) and a press outside close it.
    React.useEffect(function () {
        if (!open || typeof window === "undefined" || typeof document === "undefined") return undefined;
        const root = pop.current;
        const chosen = root && root.querySelector ? root.querySelector('[role="option"][aria-selected="true"]') || root.querySelector('[role="option"]') : null;
        if (chosen && typeof chosen.focus === "function") chosen.focus({ preventScroll: false });
        function outside(event) {
            const target = event.target;
            if (wrap.current && wrap.current.contains(target) || pop.current && pop.current.contains(target)) return;
            setOpen(false);
        }
        function escape(event) {
            if (event.key !== "Escape") return;
            event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation();
            close(true);
        }
        document.addEventListener("pointerdown", outside, true);
        window.addEventListener("keydown", escape, true);
        return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", escape, true); };
    }, [open]);
    function onListKey(event) {
        event.stopPropagation();
        if (event.key === "Tab") { event.preventDefault(); close(true); return; }
        const items = pop.current && pop.current.querySelectorAll ? Array.from(pop.current.querySelectorAll('[role="option"]')) : [];
        if (!items.length) return;
        const at = items.indexOf(typeof document !== "undefined" ? document.activeElement : null);
        const next = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? (at < 0 ? items.length - 1 : at - 1) : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        items[(next + items.length) % items.length].focus();
    }
    // Presses on the list's padding keep focus on an option (Esc then still reaches the select).
    function keepFocus(event) { if (!(event.target && event.target.closest && event.target.closest('[role="option"]'))) event.preventDefault(); }
    // The list is portaled outside the stage: it re-derives the stage tokens (theme scope) and keeps the current skin's.
    const stageTokens = {};
    if (open && trigger.current && typeof getComputedStyle === "function") {
        const style = getComputedStyle(trigger.current);
        for (const prop of style) if (prop.startsWith("--gal-")) stageTokens[prop] = style.getPropertyValue(prop);
    }
    const list = h("div", { className: "fork-gal-skin-list", role: "listbox", "aria-label": props.label, onKeyDown: onListKey },
        choices.map(choice => {
            const selected = forkGalSkinKey(choice.value) === key;
            return h("button", { key: forkGalSkinKey(choice.value), type: "button", role: "option", "aria-selected": selected, className: "fork-gal-skin-option" + (selected ? " is-on" : ""),
                "data-value": typeof choice.value === "string" ? choice.value : choice.value.assetId, onClick: () => choose(choice) },
                h(ForkGalConfigSkinThumb, { choice, stage: props.stage }),
                h("b", { className: "fork-gal-skin-option-name" }, choice.label),
                selected ? h("span", { className: "fork-gal-skin-option-check", "aria-hidden": true }, h(ForkIcon, { name: "check", size: 16 })) : null);
        }));
    // The portaled list carries the stage's skin font declaration so fork-fonts.js resolves the same faces there.
    const skinFonts = open && trigger.current && trigger.current.closest && trigger.current.closest("[data-fk-fonts]");
    const popover = open ? h(ForkPopover, { anchor: trigger, popRef: pop, className: "fork-gal-skin-pop fork-gal-theme-scope", style: stageTokens, "data-theme": props.theme || "", "data-fk-fonts": skinFonts ? skinFonts.getAttribute("data-fk-fonts") : undefined, "data-reduced-motion": props.reducedMotion || undefined,
        gap: 8, minWidth: trigger.current ? trigger.current.offsetWidth : 0, onMouseDown: keepFocus }, list) : null;
    return h("div", { ref: wrap, className: "fork-gal-skin-pick" + (open ? " is-open" : "") },
        h("button", { ref: trigger, type: "button", className: "fork-gal-skin-trigger", "aria-haspopup": "listbox", "aria-expanded": open, "aria-label": props.label + "：" + name,
            onClick: () => setOpen(value => !value),
            onKeyDown: event => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); } } },
            current ? h(ForkGalConfigSkinThumb, { choice: current, stage: props.stage }) : null,
            h("span", { className: "fork-gal-skin-trigger-name" }, name),
            h(ForkIcon, { name: "chevron", size: 16 })),
        popover);
}

// A sample line typed at the chosen speed, then held for the auto wait (as a silent page would be), then again.
function ForkGalConfigPreview(props) {
    const h = React.createElement;
    const reading = props.reading;
    const [round, setRound] = React.useState(0);
    const [done, setDone] = React.useState(false);
    React.useEffect(function () { setDone(false); setRound(n => n + 1); }, [reading.textSpeed, reading.autoWait, reading.autoSpeed]);
    React.useEffect(function () {
        if (!done) return undefined;
        const timer = forkForeground.setTimeout(() => { setDone(false); setRound(n => n + 1); }, Math.min(6000, forkGalAutoDelay(reading, false, FORK_GAL_CONFIG_SAMPLE)));
        return () => forkForeground.clearTimeout(timer);
    }, [done]);
    return h("div", { className: "fork-gal-config-preview", "aria-hidden": true },
        h("span", { className: "fork-gal-config-preview-name" }, "预览"),
        h("div", { className: "fork-gal-config-preview-text" }, h(ForkGalTypewriter, { key: round, text: FORK_GAL_CONFIG_SAMPLE, speed: reading.textSpeed, onDone: () => setDone(true) }), done ? h("i", { className: "fork-gal-config-preview-next" }) : null),
        // Film subtitles use their own font (--gal-film-font); a still line on a letterbox strip.
        props.film ? h("div", { className: "fork-gal-config-preview-film" }, h("span", { className: "fork-gal-config-preview-name" }, "字幕"), h("p", null, FORK_GAL_CONFIG_FILM_SAMPLE)) : null);
}

// 画面: film mode and effects quality (this machine).
function ForkGalConfigScreenTab() {
    const h = React.createElement;
    const film = useForkStageFilm();
    const quality = useForkStageQuality();
    const reading = useForkStageReading();
    return forkGalConfigGroup(["画面", h("span", { key: "rest", className: "fork-gal-config-caption-rest" }, "本机")], null,
        // private fork (owner 2026-10): on / off rows share one switch (ForkGalConfigSwitch); multi-way rows stay segmented.
        forkGalConfigRow("电影模式", h(ForkGalConfigSwitch, { label: "电影模式", checked: film === true, onChange: on => forkStageFilm.set(on) }),
            "上下黑边，台词变成字幕，隐藏文本框和头像框。顶栏的胶片图标是同一个开关。"),
        forkGalConfigRow("帧率上限", forkGalConfigSegmented({ label: "帧率上限", value: String(reading.frameCap), options: [["30", "30"], ["60", "60"], ["120", "120"], ["0", "跟随屏幕"]], onChange: value => forkStageReading.set({ frameCap: Number(value) }) }),
            "上限越高越流畅，但会增加 GPU 负载和耗电。跟随屏幕不额外限帧；静止场景自动降至 30 帧。低特效质量仍限制为 30 帧。"),
        forkGalConfigRow("减少动态", h(ForkGalConfigSwitch, { label: "减少动态", checked: reading.reducedMotion === true, onChange: on => forkStageReading.set({ reducedMotion: on }) }), "演出装饰保持静态并关闭震动；系统的减少动态设置同样生效。"),
        forkGalConfigRow("光敏保护", h(ForkGalConfigSwitch, { label: "光敏保护", checked: reading.photosensitive === true, onChange: on => forkStageReading.set({ photosensitive: on }) }), "默认开启：闪光改为半透明暗脉冲。所有演出共用每秒最多三次闪光的限制。"),
        forkGalConfigRow("特效质量", forkGalConfigSegmented({ label: "特效质量", value: quality, options: [["high", "高"], ["low", "低"]], onChange: value => forkStageQuality.set(value) }),
            "低：分辨率和帧率降低，粒子减少，去掉颗粒、泛光、景深等重滤镜，更省电。"));
}
