// private fork: the BGM player (docs/fork/panel-ui-design.md §七). One panel, two placements: in the stage the
// HUD track label is its chip; in chat a header chip opens the same panel. State: forkBgm (fork-bgm-player.cjs);
// volume: the mixer's music layer (forkStageAudio), never a second volume. Styles: .fork-bgm-* on --bgm-* tokens,
// mapped from the stage theme (--gal-ui-*) or the chat theme (--fork-*) in fork-theme.css.
// @include fork-bgm-player.cjs
const forkBgm = createForkBgm({
    music: forkStageMusic,
    session: id => forkStageSessions.get(id),
    owner: () => forkStageSessions.resourceOwner,
    read: id => rpc("getStageMusicTracks", {}, id),
    storage: (() => { try { return localStorage; } catch (_) { return null; } })(),
    authority: source => stageResourceAuthority(source)
});
function useForkBgm() { return React.useSyncExternalStore(forkBgm.subscribe, forkBgm.get); }
// The card's BGM switch (舞台设置 → BGM), turned back on from the player.
async function forkBgmEnableMusic(sessionId) {
    try {
        const path = forkBubbleStore.get(sessionId)?.cardPath;
        if (!path) return;
        const card = await rpc("getCardAssetBindings", { path }, sessionId);
        await rpc("saveCardAssetBindings", { path, expectedRevision: card.revision, patch: forkPackUi.stage.stagePatch(card.extension, { music: true }) }, sessionId);
        forkBubbleStore.load(sessionId, true);
        const store = forkStageSessions.get(sessionId), source = store?.getSnapshot().source;
        if (source) store.dispatch({ type: "REFRESH_BEGIN", source });
    } catch (error) { forkNavFailed("开启 BGM", error); }
}
// As the stage mixer: focus moves in on open; Esc or a click outside closes (on the bare stage that click
// only dismisses, it does not also turn the page).
function useForkBgmPopover(open, close, chip, panel, stage) {
    React.useEffect(function () {
        if (!open) return undefined;
        const first = panel.current && panel.current.querySelector(".fork-bgm-play:not(:disabled), input, button");
        if (first) first.focus({ preventScroll: true });
        function done(refocus) { close(); if (refocus && chip.current) chip.current.focus(); }
        function onKey(event) { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); done(true); } }
        function swallow(event) { event.stopPropagation(); event.preventDefault(); }
        let timer = 0;
        function outside(event) {
            if ((panel.current && panel.current.contains(event.target)) || (chip.current && chip.current.contains(event.target))) return;
            done(false);
            if (stage && !(event.target && event.target.closest && event.target.closest("button, input, select, textarea, a"))) {
                document.addEventListener("click", swallow, { capture: true, once: true });
                timer = setTimeout(() => document.removeEventListener("click", swallow, true), 600);
            }
        }
        window.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", outside, true);
        return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", outside, true); clearTimeout(timer); };
    }, [open]);
}
// The player: now playing + 导演选曲, transport and volume, a searchable list (the card's bound packs, in order).
function ForkBgmPanel(props) {
    const h = React.createElement, s = useForkBgm(), audio = useForkStageAudioState();
    const [query, setQuery] = React.useState("");
    const list = forkBgmSearch(s.tracks, query), playing = Boolean(s.current && !s.paused);
    const muted = Boolean(audio.muted.music), volume = Number(audio.music) || 0;
    const stop = event => event.stopPropagation();
    const control = (icon, label, action, disabled, className) => h("button", { type: "button", className: "fork-bgm-button" + (className ? " " + className : ""),
        title: label, "aria-label": label, disabled: Boolean(disabled), onClick: action }, h(ForkIcon, { name: icon, size: 18 }));
    function arrows(event) {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const rows = Array.from(event.currentTarget.querySelectorAll("button")), at = rows.indexOf(document.activeElement);
        const next = rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
        if (next) { event.preventDefault(); next.focus(); }
    }
    return h("div", { ref: props.panelRef, "data-level": "popover", className: "fk-surface fork-bgm fork-bgm-panel" + (props.chat ? " is-chat" : ""), style: props.style, role: "dialog", "aria-label": "BGM",
        onClick: stop, onWheel: stop, onContextMenu: stop, onKeyDown: stop },
        h("div", { className: "fork-bgm-head" },
            h("i", { className: "fork-bgm-gem", "aria-hidden": true }),
            h("b", { className: "fork-bgm-title", title: s.current ? s.current.name : "" }, s.current ? s.current.name : "BGM"),
            h("label", { className: "fork-bgm-follow", title: "导演选曲" },
                h(ForkSwitch, { bare: true, checked: s.follow, disabled: !s.enabled, onChange: on => forkBgm.follow(on) }), // private fork (UI standard phase 2 batch 8): the one switch
                h(ForkIcon, { name: "stage", size: 15 }), h("span", null, "导演选曲"))),
        !s.enabled ? h("div", { className: "fork-bgm-off" }, h("span", null, "BGM 已关闭"),
            h("button", { type: "button", className: "fork-bgm-link", onClick: () => forkBgmEnableMusic(s.sessionId) }, "开启")) :
        h(React.Fragment, null,
            h("div", { className: "fork-bgm-controls" },
                control("prev", "上一首", () => forkBgm.step(-1), !s.tracks.length),
                control(playing ? "pause" : "play", playing ? "暂停" : "播放", () => forkBgm.pause(playing), !s.current, "fork-bgm-play fk-on-accent"),
                control("next", "下一首", () => forkBgm.step(1), !s.tracks.length),
                h("span", { className: "fork-bgm-volume" + (muted ? " is-muted" : "") },
                    control(muted ? "speaker-off" : "speaker", muted ? "取消静音" : "静音", () => forkStageAudio.toggleMute("music")),
                    // private fork (UI standard §三.8, phase 2 batch 4): the shared ForkSlider in the --bgm-* skin.
                    h(ForkSlider, { skin: "fork-bgm-slider", min: 0, max: 1, step: 0.01, value: volume, label: "背景音乐音量", valueText: String(Math.round(volume * 100)),
                        onChange: next => forkStageAudio.setVolume("music", next) }))),
            h(ForkSearchBox, { className: "fork-bgm-search", icon: h(ForkIcon, { name: "search", size: 15 }), value: query, placeholder: "搜索", label: "搜索曲目", onChange: setQuery }),
            s.error ? h("p", { className: "fork-bgm-error", role: "alert" }, "载入失败") : null,
            list.length ? h("ul", { className: "fork-bgm-list", "aria-label": "曲目", onKeyDown: arrows },
                list.map(track => h("li", { key: track.key },
                    h("button", { type: "button", className: "fork-bgm-track", "aria-current": s.current && s.current.key === track.key ? "true" : undefined,
                        title: track.pack || track.name, onClick: () => forkBgm.pick(track.key) },
                        h("span", null, track.name),
                        s.cue && s.cue.key === track.key ? h("span", { className: "fork-bgm-cue", role: "img", title: "导演选曲", "aria-label": "导演选曲" }, h(ForkIcon, { name: "stage", size: 13 })) : null))))
                : h("p", { className: "fork-bgm-empty" }, s.loading ? "正在载入…" : query ? "无匹配" : "暂无曲目")));
}
// Stage placement: the HUD track label (with its change moment) is the chip; the panel drops below the HUD.
function ForkBgmStage(props) {
    const h = React.createElement, s = useForkBgm();
    const [open, setOpen] = React.useState(false);
    const chip = React.useRef(null), panel = React.useRef(null);
    // private fork: galgame UI cues (fork-ui-sfx.js), stage placement only; the chat placement stays silent.
    useForkBgmPopover(open, () => { forkUiSfx.play("close"); setOpen(false); }, chip, panel, true);
    useForkUiSfxControls(panel, open);
    return h(React.Fragment, null,
        h(ForkGalHudLabels, { place: props.place, track: s.current, scope: props.sessionId, live: props.live,
            music: { ref: chip, open, paused: s.paused || !s.enabled, toggle: () => { forkUiSfx.play(open ? "close" : "open"); setOpen(!open); } } }),
        open ? h(ForkBgmPanel, { panelRef: panel }) : null);
}
// Chat placement: a header chip (only for a card with the stage) and the same panel, anchored under it.
function ForkBgmChat(props) {
    const h = React.createElement, s = useForkBgm();
    const [open, setOpen] = React.useState(false), [place, setPlace] = React.useState(null);
    const chip = React.useRef(null), panel = React.useRef(null);
    useForkBgmPopover(open, () => setOpen(false), chip, panel, false);
    React.useLayoutEffect(function () {
        if (!open || !chip.current) { setPlace(null); return; }
        const rect = chip.current.getBoundingClientRect(), width = Math.min(340, window.innerWidth - 16);
        setPlace({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: rect.bottom + 6, width, maxHeight: window.innerHeight - rect.bottom - 18 });
    }, [open]);
    if (s.sessionId !== props.sessionId || !s.available) return null;
    return h(React.Fragment, null,
        h("button", { ref: chip, type: "button", className: "dsh-tavern-btn fork-bgm fork-bgm-chip is-chat" + (s.paused || !s.enabled || !s.current ? " is-paused" : ""),
            title: "BGM", "aria-label": "BGM" + (s.current ? "：" + s.current.name : ""), "aria-haspopup": "dialog", "aria-expanded": open, onClick: () => setOpen(!open) },
            h(ForkIcon, { name: "music", size: 15 }), s.current ? h("span", null, s.current.name) : null),
        open && place ? ReactDOM.createPortal(h(ForkBgmPanel, { chat: true, panelRef: panel, style: place }), document.body) : null);
}
