// The host logo row (brand + collapse toggle) is otherwise empty; host the theme menu there.
function ForkThemeMenuDock(props) {
    const [host, setHost] = React.useState(null);
    React.useLayoutEffect(function () {
        if (!ReactDOM || typeof ReactDOM.createPortal !== "function") return;
        const row = document.querySelector('[data-slot="sidebar"] [class*="_logoRow"]');
        if (!row) return;
        const node = document.createElement("span");
        node.className = "dsh-fork-theme-dock";
        const toggle = Array.from(row.children).find(function (child) { return child.tagName === "BUTTON" && !/_brand/.test(String(child.className)); });
        row.insertBefore(node, toggle || null);
        setHost(node);
        return function () { node.remove(); setHost(null); };
    }, []);
    return host ? ReactDOM.createPortal(React.createElement(ForkThemeMenu, { theme: props.theme }), host) : null;
}

// Quick skin picker in the sidebar head. Skins go through Dream Skin's own persisted
// selection (window.__dshDreamSkin, a private fork hook); built-in light/dark/system
// first return Dream Skin to its Default skin, then set the host preference.
const FORK_BUILTIN_THEMES = [["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]];
function ForkThemeMenu(props) {
    const h = React.createElement;
    const theme = props.theme;
    const [open, setOpen] = React.useState(false);
    const [, setRevision] = React.useState(0);
    const root = React.useRef(null);
    const menuRef = React.useRef(null);
    const [position, setPosition] = React.useState(null);
    React.useLayoutEffect(function () {
        if (!open || !root.current) return;
        const rect = root.current.getBoundingClientRect();
        setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.left - 8) });
    }, [open]);
    React.useEffect(function () {
        if (!open) return;
        function outside(event) { if ((!root.current || !root.current.contains(event.target)) && (!menuRef.current || !menuRef.current.contains(event.target))) setOpen(false); }
        function escape(event) { if (event.key === "Escape") setOpen(false); }
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", escape);
        return function () { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
    }, [open]);
    if (!theme || typeof theme.getTheme !== "function") return null;
    const skinApi = window.__dshDreamSkin;
    const skins = skinApi ? skinApi.skins() : [];
    const currentSkin = skinApi ? skinApi.current() : "";
    const preference = theme.getTheme().preference;
    const activeSkin = skinApi && currentSkin !== skinApi.defaultSkin ? currentSkin : "";
    function pickBuiltin(id) {
        try {
            forkSelectBuiltinTheme(theme, id);
        } catch (error) { console.warn("dsh-tavern: 切换主题失败", error); }
        setOpen(false); setRevision(function (value) { return value + 1; });
    }
    function pickSkin(id) {
        try { skinApi.select(id); } catch (error) { console.warn("dsh-tavern: 切换皮肤失败", error); }
        setOpen(false); setRevision(function (value) { return value + 1; });
    }
    function openSettings() {
        setOpen(false);
        openForkAppearanceSettings();
    }
    return h("div", { className: "dsh-fork-theme", ref: root },
        h("button", { type: "button", className: "dsh-tavern-side-icon dsh-fork-theme-trigger", title: "切换主题", "aria-label": "切换主题", "aria-haspopup": "menu", "aria-expanded": open,
            onClick: function () { setOpen(function (value) { return !value; }); } }),
        open && position ? forkPortal(h("div", { className: "dsh-fork-theme-menu", role: "menu", ref: menuRef, style: { top: position.top + "px", left: position.left + "px" } },
            h("div", { className: "dsh-fork-theme-heading" }, "默认"),
            FORK_BUILTIN_THEMES.map(function (entry) {
                const selected = !activeSkin && preference === entry[0];
                return h("button", { key: entry[0], type: "button", role: "menuitemradio", "aria-checked": selected, onClick: function () { pickBuiltin(entry[0]); } },
                    h("span", { className: "dsh-fork-theme-swatch", "data-builtin": entry[0] }), entry[1]);
            }),
            skins.length ? h("div", { className: "dsh-fork-theme-heading" }, "皮肤") : null,
            skins.map(function (skin) {
                return h("button", { key: skin.id, type: "button", role: "menuitemradio", "aria-checked": activeSkin === skin.id, onClick: function () { pickSkin(skin.id); } },
                    h("span", { className: "dsh-fork-theme-swatch", style: { "--swatch-base": skin.base || undefined, "--swatch-brand": skin.brand || undefined } }), skin.label);
            }),
            h("button", { type: "button", className: "dsh-fork-theme-more", onClick: openSettings }, "更多外观设置…"))) : null);
}
// The sidebar clips overflow; float menus over the page instead.
function forkPortal(node) {
    return ReactDOM && typeof ReactDOM.createPortal === "function" && document.body ? ReactDOM.createPortal(node, document.body) : node;
}
// Marks the conversation root with the session mode so fork CSS can scope
// play-only presentation without touching host components.
function ForkSessionMarker(props) {
    const anchor = React.useRef(null);
    const mode = React.useSyncExternalStore(
        React.useCallback(fn => props.view.subscribe(props.sessionId, fn), [props.view, props.sessionId]),
        React.useCallback(() => props.view.getMode(props.sessionId), [props.view, props.sessionId]));
    React.useLayoutEffect(function () {
        const root = anchor.current && anchor.current.closest('[data-slot="main.conversation"]');
        if (!root) return;
        if (mode) root.setAttribute("data-dsh-fork-session", mode);
        else root.removeAttribute("data-dsh-fork-session");
        return function () { root.removeAttribute("data-dsh-fork-session"); };
    }, [mode]);
    return React.createElement("span", { ref: anchor, hidden: true, "data-dsh-fork-session-anchor": "" });
}
