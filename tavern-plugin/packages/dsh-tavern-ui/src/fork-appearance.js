// Private fork: a single complete Appearance page, plus the sidebar shortcut.
function forkSelectBuiltinTheme(theme, id) {
    const api = window.__dshDreamSkin;
    if (api && api.current() !== api.defaultSkin) api.select(api.defaultSkin);
    theme.setTheme(id);
}
function ForkAppearanceModes(props) {
    const h = React.createElement;
    const state = React.useSyncExternalStore(props.subscribe, props.snapshot);
    return h("section", { className: "fork-appearance-modes", "aria-label": "明暗模式" },
        h("h3", null, "明暗模式"),
        h("div", { role: "group", "aria-label": "明暗模式" }, FORK_BUILTIN_THEMES.map(function (entry) {
            return h("button", { key: entry[0], type: "button", "aria-pressed": state.preference === entry[0], onClick: function () { forkSelectBuiltinTheme(props.theme, entry[0]); } }, entry[1]);
        })));
}
// 正文字体 (docs/fork/fonts.md, reading role): right after the skin picker, since the default follows the skin's
// optional `font`. 「跟随皮肤（name）」 clears this machine's override. props: { subscribe, snapshot, api? }.
function forkReadingSkinFont(snapshot) {
    const skin = typeof window !== "undefined" ? window.__dshDreamSkin : null;
    if (skin && typeof skin.readingFont === "function") return skin.readingFont() || null;
    return snapshot && snapshot.active && typeof snapshot.active.font === "string" ? snapshot.active.font : null;
}
function ForkReadingFontRow(props) {
    const h = React.createElement;
    const snapshot = React.useSyncExternalStore(props.subscribe, props.snapshot);
    return h("section", { className: "fork-reading-font", "aria-label": "正文字体" },
        h("div", { className: "fork-reading-font-title" }, h("span", null, "正文字体"),
            h(ForkHelpTip, { label: "正文字体说明" },
                h("span", null, "故事正文、对白和你发出的消息用的字体，选中立刻生效。"),
                h("span", null, "跟随皮肤：用当前皮肤指定的字体，没有指定就用界面字体。"),
                h("span", null, "只保存在这台电脑上；舞台和字幕字体在舞台的设置（文字）里选。"))),
        h(ForkFontPicker, { role: "reading", label: "正文字体", follow: "跟随皮肤", builtin: "界面字体", context: { skinFont: forkReadingSkinFont(snapshot) }, variant: "settings", api: props.api }));
}
let releaseForkAppearanceNavigation = () => {};
function installForkAppearance(ctx) {
    const release = [];
    // Only hide the native row while the destination section actually exists.
    release.push(ctx.slots.inject("settings.dreamSkin.item", function () {
        const hide = ctx.slots.inject("settings.general.item", function () {
            return ctx.slots.register({ name: "settings.general.item", id: "appearance", priority: -1 }, function () { return null; });
        });
        const row = ctx.slots.register({ name: "settings.dreamSkin.item", id: "fork-appearance-modes", order: 0,
            inject: function () { return { theme: ctx.theme, subscribe: function (fn) { return ctx.on("theme/change", fn); }, snapshot: function () { return ctx.theme.getTheme(); } }; }
        }, ForkAppearanceModes);
        // Order 21: directly under Dream Skin's skin cards (20), above the wallpaper rows.
        const font = ctx.slots.register({ name: "settings.dreamSkin.item", id: "fork-reading-font", order: 21,
            inject: function () { return { subscribe: function (fn) { return ctx.on("theme/change", fn); }, snapshot: function () { return ctx.theme.getTheme(); } }; }
        }, ForkReadingFontRow);
        return function () { font(); row(); hide(); };
    }));
    return function () { releaseForkAppearanceNavigation(); release.forEach(function (dispose) { dispose(); }); };
}
function openForkAppearanceSettings() {
    releaseForkAppearanceNavigation();
    function select() {
        const button = Array.from(document.querySelectorAll('[role="dialog"] nav button')).find(function (node) { return /^(外观|Theme \/ 外观)$/.test(node.textContent.trim()); });
        if (!button) return false;
        button.click(); return true;
    }
    if (select()) return;
    const entry = Array.from(document.querySelectorAll('[data-slot^="sidebar"] button, [data-slot^="sidebar"] a')).find(function (node) { return node.textContent.trim() === "设置"; });
    if (!entry) return;
    const observer = new MutationObserver(function () { if (select()) releaseForkAppearanceNavigation(); });
    const timer = setTimeout(function () { observer.disconnect(); }, 2000);
    releaseForkAppearanceNavigation = () => { observer.disconnect(); clearTimeout(timer); };
    observer.observe(document.body, { subtree: true, childList: true });
    entry.click();
}
