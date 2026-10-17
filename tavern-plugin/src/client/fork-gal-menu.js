// Private fork (docs/fork/galgame-stage.md「系统菜单」): the stage's system menu, galgame style. Esc on the stage
// (after any inner overlay has taken its own Esc) opens it: a centred opaque panel over the dimmed stage with
// 回到舞台 / 履历 / 回想 (the CG gallery) / 重新生成 (latest only) / 设置 / 跳到最新一轮 (only while reading an earlier turn) / 返回主页面. The stage owns the open state and
// pauses auto / skip while it is open, like the backlog. Styled only through the stage UI tokens (--gal-ui-*,
// fork-theme.css「stage system menu」).

// private fork (reading controls §2.4, owner 2026-10): options.narrow (phones, forkGalControlIds in fork-gal-stage.js)
// adds the controls the phone's control row leaves out; 设置 and 返回主页面 are items here already.
// Items in display order. options: { historical, latestTurn, busy, narrow, backDisabled }.
function forkGalMenuItems(options) {
    const items = [
        { id: "resume", label: "回到舞台", sub: "RESUME", title: "回到舞台（Esc）" },
        { id: "backlog", label: "履历", sub: "BACKLOG", title: "履历（L / 滚轮向上）" },
        // private fork (owner 2026-10): the CG gallery lives here, not as a text button in the control row.
        { id: "gallery", label: "回想", sub: "RECOLLECTION", title: "回想（CG 图库）" }
    ];
    // private fork: regeneration is a latest-turn action, not historical editing.
    if (!options?.historical) items.push({ id: "regenerate", label: "重新生成", sub: "REGENERATE", disabled: Boolean(options?.busy) });
    // private fork (§2.4): the controls a phone's control row leaves out.
    if (options?.narrow) items.push({ id: "hide", label: "隐藏文本框", sub: "HIDE", title: "隐藏文本框（H / 右键）" },
        { id: "back", label: "上一页", sub: "BACK", title: "上一页（左箭头 / PageUp）", disabled: Boolean(options.backDisabled) });
    items.push({ id: "config", label: "设置", sub: "CONFIG", title: "设置" });
    // private fork (B2 O43): the first-run key list again (useForkGalFirstRunHints showKeys).
    items.push({ id: "keys", label: "快捷键", sub: "SHORTCUTS", title: "快捷键" });
    if (options && options.historical) items.push({ id: "latest", label: "跳到最新一轮", sub: "LATEST",
        note: Number.isInteger(options.latestTurn) && options.latestTurn > 0 ? "第 " + options.latestTurn + " 轮" : "", title: "回到最新一轮上次读到的地方" });
    items.push({ id: "leave", label: "返回主页面", sub: "TITLE", title: "离开舞台，回到聊天（保留阅读位置）", separated: true });
    return items;
}
// Roving focus: ↑/↓ and Tab / Shift+Tab wrap (focus stays in the menu), Home / End jump. Other keys: null.
function forkGalMenuStep(index, count, key, shift) {
    if (!(count > 0)) return null;
    const at = Number.isInteger(index) && index >= 0 && index < count ? index : 0;
    if (key === "ArrowDown" || key === "Tab" && !shift) return (at + 1) % count;
    if (key === "ArrowUp" || key === "Tab" && shift) return (at - 1 + count) % count;
    if (key === "Home" || key === "PageUp") return 0;
    if (key === "End" || key === "PageDown") return count - 1;
    return null;
}

// Read only the existing runtime's activity; presentation remains owned by the Phase F cutover.
function useForkGalMenuDirectorBusy(sessionId, turn) {
    const store = forkStageSessions.get(sessionId);
    const selection = React.useMemo(() => store ? store.select(state => state.source?.turn === turn && ["running", "partial"].includes(state.director.phase))
        : { subscribe: () => () => {}, getSnapshot: () => false, dispose() {} }, [store, turn]);
    React.useEffect(() => () => selection.dispose(), [selection]);
    return React.useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot);
}

// props: { sessionId, Regenerate, busy, historical, latestTurn, narrow, backDisabled, onClose(), onBacklog(), onGallery(), onHide(), onBack(),
// onConfig(), onLatest(), onLeave() }.
// Focus moves to the first item on open and back to the opener on close (not when leaving the stage, which restores
// its own opener). Esc, right click or a click on the dimmed stage close it; the stage never sees keys typed here.
function ForkGalMenu(props) {
    const h = React.createElement;
    const directorBusy = useForkGalMenuDirectorBusy(props.sessionId, props.latestTurn);
    const busy = props.busy || directorBusy;
    // private fork (owner 2026-10): props.regenerate opens straight into the 重新生成 dialog (the turn-end menu's
    // 「重新生成正文」); backing out of it then closes the whole menu instead of revealing the list.
    const [regenerateOpen, setRegenerateOpen] = React.useState(() => Boolean(props.regenerate && props.Regenerate));
    const closeRegenerate = () => { if (props.regenerate) props.onClose(); else setRegenerateOpen(false); };
    const [regenerateBusy, setRegenerateBusy] = React.useState(false);
    const items = forkGalMenuItems({ historical: props.historical, latestTurn: props.latestTurn, busy: busy || regenerateBusy, narrow: props.narrow, backDisabled: props.backDisabled });
    const [active, setActive] = React.useState(0);
    const refs = React.useRef([]);
    const live = React.useRef(null);
    const leaving = React.useRef(false);
    live.current = { props, items, active, regenerateOpen };
    // Taken at the first render: an opening dialog (props.regenerate) moves focus in its own layout effect, before ours.
    const firstOpener = React.useRef(typeof document !== "undefined" ? document.activeElement : null);
    function focusItem(index) {
        setActive(index);
        const node = refs.current[index];
        if (node && node.focus) node.focus({ preventScroll: true });
    }
    // A user move (hover, arrows) ticks; the programmatic focus on open / after the dialog does not.
    function moveTo(index) {
        if (index !== live.current.active) forkUiSfx.play("move");
        focusItem(index);
    }
    function activate(index) {
        const current = live.current, item = current.items[index];
        if (!item || item.disabled) return;
        const p = current.props;
        forkUiSfx.play(item.id === "resume" ? "close" : "confirm");
        if (item.id === "resume") p.onClose();
        else if (item.id === "backlog") p.onBacklog();
        else if (item.id === "gallery") p.onGallery();
        else if (item.id === "regenerate") { setActive(index); setRegenerateOpen(true); }
        // The stage moves focus to its root: the opener (≡) is inside the hidden box.
        else if (item.id === "hide") { leaving.current = true; p.onHide(); }
        else if (item.id === "back") p.onBack();
        else if (item.id === "config") p.onConfig();
        else if (item.id === "keys") { if (p.onKeys) p.onKeys(); else p.onClose(); }
        else if (item.id === "latest") p.onLatest();
        else if (item.id === "leave") { leaving.current = true; p.onLeave(); }
    }
    function focusedIndex() {
        const focused = typeof document !== "undefined" ? document.activeElement : null;
        const at = refs.current.indexOf(focused);
        return at >= 0 && at < live.current.items.length ? at : live.current.active;
    }
    // Layout effect: the focus hand-back runs before an overlay opened from here (the backlog) takes focus.
    React.useLayoutEffect(function () {
        const opener = firstOpener.current;
        if (!live.current.regenerateOpen) focusItem(0);
        forkUiSfx.play("open");
        function onKey(event) {
            if (event.isComposing || live.current.regenerateOpen) return;
            const key = event.key;
            // A held Esc (auto-repeat) is not a new press (the hold that leaves full screen must not toggle the menu).
            if (key === "Escape" && event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            if (key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); forkUiSfx.play("close"); live.current.props.onClose(); return; }
            const next = forkGalMenuStep(focusedIndex(), live.current.items.length, key, event.shiftKey);
            if (next !== null) { event.preventDefault(); event.stopImmediatePropagation(); moveTo(next); return; }
            if (key === "Enter" || key === " " || key === "Spacebar") {
                if (event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return; }
                event.preventDefault(); event.stopImmediatePropagation(); activate(focusedIndex());
            }
        }
        window.addEventListener("keydown", onKey, true);
        return function () {
            window.removeEventListener("keydown", onKey, true);
            if (!leaving.current && opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
        };
    }, []);
    // The opener is hidden during the dialog's cleanup; restore it after the menu is visible again.
    React.useLayoutEffect(function () { if (!regenerateOpen) focusItem(active); }, [regenerateOpen]);
    // The historical item can come or go while open (a new turn arrives); keep the highlight on a real item.
    React.useEffect(function () { if (active >= items.length) setActive(items.length - 1); }, [items.length]);
    // A click on the dimmed stage or a right click: back out of the dialog first, else close the menu.
    function dismiss() {
        if (regenerateOpen) { forkUiSfx.play("cancel"); closeRegenerate(); } else { forkUiSfx.play("close"); props.onClose(); }
    }
    const children = [];
    items.forEach(function (item, index) {
        if (item.separated) children.push(h("div", { key: item.id + ":sep", className: "fork-gal-menu-sep", role: "separator" }));
        children.push(h("button", { key: item.id, ref: node => { refs.current[index] = node; }, type: "button", role: "menuitem", tabIndex: index === active ? 0 : -1,
            className: "fork-gal-menu-item" + (index === active ? " is-active" : "") + (item.id === "leave" ? " is-leave" : ""), "data-item": item.id, title: item.title,
            style: { "--i": index }, "aria-disabled": item.disabled || undefined,
            onClick: event => { event.stopPropagation(); activate(index); },
            onPointerMove: () => { if (live.current.active !== index) moveTo(index); } },
            h("i", { className: "fork-gal-menu-gem", "aria-hidden": true }),
            h("b", null, item.label),
            h("span", { className: "fork-gal-menu-sub", "aria-hidden": true }, item.sub),
            item.note ? h("small", { className: "fork-gal-menu-note" }, item.note) : null));
    });
    return h("div", { className: "fork-gal-menu", role: "presentation",
        onClick: event => { event.stopPropagation(); if (event.target === event.currentTarget) dismiss(); },
        onWheel: event => event.stopPropagation(),
        onContextMenu: event => { event.preventDefault(); event.stopPropagation(); dismiss(); } },
        regenerateOpen && props.Regenerate ? h(props.Regenerate, { sessionId: props.sessionId, turn: props.latestTurn, busy, historical: props.historical, onBusy: setRegenerateBusy, onClose: closeRegenerate }) : null,
        h("div", { hidden: regenerateOpen, className: "fork-gal-menu-panel fk-surface", "data-level": "stage-panel", role: "menu", "aria-orientation": "vertical", "aria-label": "舞台菜单", onClick: event => event.stopPropagation() },
            h("i", { className: "fork-gal-menu-ornament", "aria-hidden": true }),
            h("i", { className: "fork-gal-menu-frame", "aria-hidden": true }),
            h("div", { className: "fork-gal-menu-head", "aria-hidden": true },
                h("i", { className: "fork-gal-menu-gem is-title" }), h("b", null, "MENU"), h("span", null, "菜单")),
            h("div", { className: "fork-gal-menu-list", role: "presentation" }, children)));
}
