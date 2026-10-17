// Private fork (docs/fork/dialogue-bubbles.md): host side of the director prompt preview.
// private fork (owner 2026-10 r3): the old 「本轮输入」 view (ForkDirectorInput, its section names and the
// 「其余提示词」 / 「对白格式注入」 folds) is replaced by 舞台设置 › 提示词 (fork-asset-pack-card-ui.js StagePrompts), which shows
// each stage in order; this file only fetches the director's half for it.

// previewStageDirectorPrompt for the session: refetched on mount (the settings may have changed) and on refresh, while
// the session's last answer stays visible. Returns [{ loading, error, result }, refresh].
let forkDirectorPreviewLast = { sessionId: null, result: null };
function useForkDirectorPreview(sessionId) {
    const [state, setState] = React.useState(() => ({ loading: true, error: "", result: forkDirectorPreviewLast.sessionId === sessionId ? forkDirectorPreviewLast.result : null }));
    const [nonce, setNonce] = React.useState(0);
    React.useEffect(function () {
        let live = true;
        setState(current => ({ ...current, loading: true, error: "" }));
        rpc("previewStageDirectorPrompt", { sessionId }, sessionId).then(
            result => { forkDirectorPreviewLast = { sessionId, result }; if (live) setState({ loading: false, error: "", result }); },
            error => { if (live) setState({ loading: false, error: String(error && error.message || error), result: null }); });
        return () => { live = false; };
    }, [sessionId, nonce]);
    return [state, () => setNonce(n => n + 1)];
}
