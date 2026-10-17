// Private fork shell helpers (docs/fork/ui-design.md).
// Debug view: developer chrome (trajectory tabs, token stats, reasoning,
// version/update block) is hidden in play sessions unless this is on.
const FORK_DEBUG_KEY = "dsh-tavern-fork-debug";
// private fork: retain the legacy key only until its server write succeeds.
function createForkDebugMigration(win) {
    let pending;
    return function migrate(save) {
        if (!pending) pending = (async function () {
            let legacy;
            try { legacy = win.localStorage.getItem(FORK_DEBUG_KEY); } catch (_) { return; }
            if (legacy === "1") await save(false);
            try { win.localStorage.removeItem(FORK_DEBUG_KEY); } catch (_) {}
        })().catch(function (error) { pending = null; throw error; });
        return pending;
    };
}
function applyForkDebug(doc, enabled) {
    if (doc && doc.body) doc.body.classList.toggle("dsh-fork-debug", Boolean(enabled));
}
// private fork: one server-backed switch drives both the host and fork display classes.
function ForkDebugSetting() {
    const h = React.createElement;
    const hidden = React.useSyncExternalStore(displayPreferences.subscribe, displayPreferences.snapshot, displayPreferences.snapshot);
    const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
    async function change(next) {
        if (busy) return;
        setBusy(true); setNotice("");
        try { await displayPreferences.save(!next); setNotice("已保存"); }
        catch (error) { setNotice("保存失败：" + String(error.message || error)); }
        finally { setBusy(false); }
    }
    // No grey description (panel-ui-design.md §一.5): the explanation sits behind a 「?」, which must stay outside
    // any <label> (a button would become the label's control), so the title and the switch are separate labels.
    const id = React.useId ? React.useId() : "fork-debug-setting";
    return h("div", { className: "dsh-tavern-settings-group dsh-tavern-settings-row dsh-fork-debug-setting" },
        h("span", { className: "dsh-tavern-settings-copy" },
            h("span", { className: "dsh-tavern-settings-title" }, h("label", { htmlFor: id }, "调试视图"),
                typeof ForkHelpTip === "function" ? h(ForkHelpTip, { label: "调试视图说明" }, "显示上下文、推理、轨迹、Token 统计、子代理入口与版本信息。设置保存在服务端，对所有对话生效。") : null)),
        // private fork (UI standard phase 2 batch 7): the one switch (fork-inline-field.js ForkSwitch).
        h(ForkSwitch, { id, label: "调试视图", checked: hidden === false, disabled: hidden === null || busy, onChange: change }),
        notice ? h("span", { className: "dsh-tavern-settings-desc", role: "status" }, notice) : null);
}


// Feature-owned dialogs use the host portal without depending on the shell plugin.
function forkPortal(node) { return ReactDOM && document.body ? ReactDOM.createPortal(node, document.body) : node; }
