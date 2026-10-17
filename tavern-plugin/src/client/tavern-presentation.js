// Public client contracts. The shell never receives the live store or font disposal rights.
function installTavernPresentation(ctx) {
    // Stage palette and shared surface primitives survive disabling the outer UI.
    ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.tavernSurfaceDefaults = "";
        // Low-specificity defaults keep feature surfaces readable with the shell disabled.
        style.textContent = forkSurfaces.css().replace('[data-fk-context="chat-light"]', ':where(body),[data-fk-context="chat-light"]');
        document.head.appendChild(style);
        return () => style.remove();
    });
    ctx.provide("tavernFonts", Object.freeze({
        list: forkFonts.list,
        get: forkFonts.get,
        ensureLoaded: forkFonts.ensure,
        subscribe: forkFonts.subscribe
    }));
    ctx.provide("tavernView", Object.freeze({
        getSessionId: () => ctx.sessions.list.getSnapshot().current || "",
        getMode(sessionId) {
            const view = liveTavernView.getSnapshot(sessionId).view;
            return view ? (isPlayMode(view.mode) ? "play" : "card") : "";
        },
        subscribe: (sessionId, listener) => liveTavernView.subscribe(sessionId, listener, [["mode"]])
    }));
    // Host palette refreshes (page opens touch <head>) mostly repeat the current palette.
    let surfaceKey = null, surfaceResult = null;
    ctx.provide("tavernPresentation", Object.freeze({
        // The existing picker owns preference writes; the shell only mounts it.
        getFontPicker: () => ForkFontPicker,
        getHelpTip: () => ForkHelpTip,
        getSpinner: () => ForkSpinner,
        getModelPricing: sessionId => rpc("getModelPricing", { sessionId }, sessionId),
        getSurfaceStyles(host) {
            const key = JSON.stringify(host);
            if (key === surfaceKey) return surfaceResult;
            let dark = host.dark;
            try { dark = forkSurfaces.contrast(forkSurfaces.color(host.bg), [255, 255, 255, 1]) > 4.5; } catch (_) {}
            const context = dark ? "chat-dark" : "chat-light";
            const table = forkSurfaces.build({ [context]: host });
            surfaceResult = Object.freeze({ context, css: forkSurfaces.css(Object.fromEntries(Object.entries(table).filter(([name]) => name.startsWith("chat-")))) });
            surfaceKey = key;
            return surfaceResult;
        }
    }));
}
