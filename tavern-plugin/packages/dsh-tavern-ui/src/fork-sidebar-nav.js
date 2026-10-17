// Private fork (docs/fork/ui-design.md): right sidebar start page as a launcher grid,
// plus browser-style back/forward inside a tab (mouse side buttons, Alt+←/→).
// The host guide page keeps its tab; we only replace its body through the
// `sidebar.right.tab.guide` chain seat and drive navigation via ctx.sidebarRight.

const FORK_GUIDE_GROUPS = [
    ["本局", ["dsh-tavern:status", "dsh-tavern:conversation-settings", "dsh-tavern:bubbles"]],
    ["资料库", ["dsh-asset-library:library", "dsh-tavern:cards", "dsh-tavern:worldbooks", "dsh-tavern:presets", "dsh-tavern:resources", "dsh-tavern:skills", "dsh-tavern:system-prompts"]],
    ["偏好", ["dsh-tavern:user-profile"]]
];
// Workspace file browser is coding tooling.
const FORK_GUIDE_HIDDEN = new Set(["files"]);

// Per-tab navigation stacks, keyed by session + tab id. A tab id changes every time
// its content is replaced, so each replacement re-keys the entry onto the new tab.
const forkSidebarHistory = new Map();
function forkHistoryKey(sessionId, tabId) { return String(sessionId || "") + "\n" + String(tabId || ""); }

function createForkSidebarNav(ctx, controller) {
    const pending = new Set();
    function sessionId() { try { return ctx.sessions.list.getSnapshot().current || ""; } catch (_) { return ""; } }
    function active() { try { return controller.active(); } catch (_) { return undefined; } }
    // The layout commits after openTab returns; attach the stacks to whichever tab now
    // shows `kind` (a replacement may or may not mint a new tab id).
    function settle(session, fromId, kind, stacks) {
        let tries = 0;
        (function check() {
            const next = active();
            if (next && next.kind === kind) {
                if (next.id !== fromId) forkSidebarHistory.delete(forkHistoryKey(session, fromId));
                const key = forkHistoryKey(session, next.id);
                forkSidebarHistory.delete(key); forkSidebarHistory.set(key, stacks);
                while (forkSidebarHistory.size > 64) forkSidebarHistory.delete(forkSidebarHistory.keys().next().value);
            } else if (++tries < 20) {
                const timer = window.setTimeout(() => { pending.delete(timer); check(); }, 25);
                pending.add(timer);
            }
        })();
    }
    // Replace the active tab's content with `kind`, then hand the stacks to it.
    function replaceActive(kind, stacks) {
        const current = active();
        if (!current) return false;
        const session = sessionId();
        controller.openTab(kind, { replaceTab: current.id });
        settle(session, current.id, kind, stacks);
        return true;
    }
    // Called by the launcher grid: open `kind` in place of the guide, remembering the guide.
    function navigate(fromTab, kind, open) {
        const session = sessionId();
        const fromId = fromTab && fromTab.id, fromKind = fromTab && fromTab.kind || "guide";
        const previous = forkSidebarHistory.get(forkHistoryKey(session, fromId)) || { back: [], forward: [] };
        open();
        settle(session, fromId, kind, { back: previous.back.concat([fromKind]).slice(-30), forward: [] });
    }
    function step(direction) {
        let expanded = false;
        try { expanded = controller.isExpanded(); } catch (_) {}
        const current = expanded ? active() : undefined;
        if (!current) return false;
        const stacks = forkSidebarHistory.get(forkHistoryKey(sessionId(), current.id));
        if (!stacks) return false;
        if (direction < 0 && stacks.back.length) {
            const back = stacks.back.slice(0, -1), target = stacks.back[stacks.back.length - 1];
            return replaceActive(target, { back, forward: [current.kind].concat(stacks.forward) });
        }
        if (direction > 0 && stacks.forward.length) {
            const target = stacks.forward[0];
            return replaceActive(target, { back: stacks.back.concat([current.kind]), forward: stacks.forward.slice(1) });
        }
        return false;
    }
    function onMouse(event) {
        if (event.button !== 3 && event.button !== 4) return;
        // Handle on mouseup; swallow the paired mousedown too so the page does not
        // run its own history navigation for the same press.
        if (event.type === "mousedown") { if (canStep(event.button === 3 ? -1 : 1)) { event.preventDefault(); } return; }
        if (step(event.button === 3 ? -1 : 1)) { event.preventDefault(); event.stopPropagation(); }
    }
    function canStep(direction) {
        const current = active();
        const stacks = current && forkSidebarHistory.get(forkHistoryKey(sessionId(), current.id));
        return Boolean(stacks && (direction < 0 ? stacks.back.length : stacks.forward.length));
    }
    function onKey(event) {
        if (!event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        if (!event.target || !event.target.closest || !event.target.closest('[data-slot="rightbar"]')) return;
        if (event.target.closest("input, textarea, [contenteditable='true']")) return;
        if (step(event.key === "ArrowLeft" ? -1 : 1)) event.preventDefault();
    }
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("mouseup", onMouse, true);
    window.addEventListener("keydown", onKey, true);
    return {
        navigate,
        dispose() {
            for (const timer of pending) window.clearTimeout(timer);
            pending.clear(); forkSidebarHistory.clear();
            window.removeEventListener("mousedown", onMouse, true);
            window.removeEventListener("mouseup", onMouse, true);
            window.removeEventListener("keydown", onKey, true);
        }
    };
}

function ForkGuideGrid(props) {
    const h = React.createElement;
    const info = props.useTabInfo();
    const tab = info && info.tab;
    const entries = React.useSyncExternalStore(props.tabs.subscribe.bind(props.tabs), function () { return props.tabs.guide(); });
    const visible = entries.filter(function (entry) { return !FORK_GUIDE_HIDDEN.has(entry.kind); });
    const placed = new Set();
    const groups = FORK_GUIDE_GROUPS.map(function (group) {
        const items = group[1].map(function (kind) { return visible.find(function (entry) { return entry.kind === kind; }); }).filter(Boolean);
        items.forEach(function (entry) { placed.add(entry.kind); });
        return [group[0], items];
    });
    groups.push(["其他", visible.filter(function (entry) { return !placed.has(entry.kind); })]);
    function open(entry) {
        props.nav.navigate(tab, entry.kind, function () { tab.actions.openTab(entry.kind, { replaceTab: true }); });
    }
    return h("div", { className: "fork-guide" },
        groups.filter(function (group) { return group[1].length; }).map(function (group) {
            return h("section", { key: group[0], className: "fork-guide-group" },
                h("h3", null, group[0]),
                h("div", { className: "fork-guide-grid" }, group[1].map(function (entry) {
                    const title = typeof entry.title === "function" ? entry.title() : String(entry.title || entry.kind);
                    return h("button", { key: entry.kind, type: "button", className: "fork-guide-tile", "data-sidebar-right-guide-entry": entry.kind, title: title, onClick: function () { open(entry); } },
                        h("span", { className: "fork-guide-icon", "aria-hidden": true }, entry.icon ? h(entry.icon, { size: 22 }) : null),
                        h("span", { className: "fork-guide-title" }, title));
                })));
        }));
}

function installForkSidebarNav(ctx) {
    if (typeof ctx.inject !== "function" || typeof window === "undefined") return function () {};
    const scope = ctx.inject(["sidebarRight", "sidebarRightTabs"], function (injected) {
        const controller = injected.get("sidebarRight");
        const tabs = injected.get("sidebarRightTabs");
        if (!controller || !tabs) return;
        const nav = createForkSidebarNav(ctx, controller);
        const scoped = typeof injected.effect === "function" ? injected : ctx;
        scoped.effect(function () { return function () { nav.dispose(); }; }, "dsh-tavern: sidebar back/forward");
        scoped.effect(function () {
            return ctx.slots.inject("sidebar.right.tab.guide", function () {
                return ctx.slots.register({ name: "sidebar.right.tab.guide", id: "dsh-tavern:launcher-grid", select: function () { return true; } },
                    function (props) { return React.createElement(ForkGuideGrid, Object.assign({}, props, { tabs: tabs, nav: nav })); });
            });
        }, "dsh-tavern: right sidebar launcher grid");
    });
    return typeof scope === "function" ? scope : (scope && typeof scope.dispose === "function" ? function () { scope.dispose(); } : function () {});
}
