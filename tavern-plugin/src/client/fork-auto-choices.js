// private fork: the global candidateAutoGenerate preference (tavern-settings.json), independent of stage/bubble features.
// Its one switch is 舞台设置 › 基础设置 「自动生成选项」 (fork-asset-pack-card-ui.js StageAutoChoicesSwitch, injected through
// createForkAssetPackUI({autoChoices})); every mount stays in sync through the window event.
function useForkAutoChoicesPreference(readMethod = "getTavernSettings") {
    const [enabled, setEnabled] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    React.useEffect(function () {
        let active = true;
        let changed = false;
        function update(event) { changed = true; setEnabled(event.detail === true); setLoading(false); setError(""); }
        window.addEventListener("dsh-tavern-auto-choices-preference", update);
        rpc(readMethod).then(function (result) {
            const settings = readMethod === "getTavernSettings" ? result.settings : result;
            if (active && !changed) { setEnabled(settings.candidateAutoGenerate === true); setLoading(false); }
        }, function (err) {
            if (active && !changed) { setError(String(err.message || err)); setLoading(false); }
        });
        return function () { active = false; window.removeEventListener("dsh-tavern-auto-choices-preference", update); };
    }, []);
    async function save(value) {
        if (busy || loading) return;
        setBusy(true); setError("");
        try {
            const result = await rpc("updateTavernSettings", { patch: { candidateAutoGenerate: value } });
            window.dispatchEvent(new CustomEvent("dsh-tavern-auto-choices-preference", { detail: result.settings.candidateAutoGenerate === true }));
        } catch (err) { setError("保存失败：" + String(err.message || err)); }
        finally { setBusy(false); }
    }
    return { enabled, loading, busy, error, save };
}
