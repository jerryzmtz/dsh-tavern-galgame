// private fork: pack-projected audio; no catalogue owner.
// One page-wide one-shot player, with at most six concurrent sounds.
const forkStageSfx = (function () {
    const listeners = new Set(), shots = new Set();
    const emit = () => listeners.forEach(fn => fn());
    const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
    const level = (node, value) => forkStageAudio.level(node, value);
    let thunderUrl = "", lastThunder = 0;
    function oneShot(url, gain, identity, ref, token, authored) {
        if (!url || shots.size >= 6) return Promise.resolve();
        let finish;
        const completion = new Promise(resolve => { finish = resolve; });
        const node = new Audio(url);
        node.resourceIdentity = identity; node.resourceRef = ref; node.eventToken = token;
        forkStageAudio.bind(node, "sfx", url, authored); level(node, gain == null ? 1 : gain);
        shots.add(node);
        const done = () => {
            if (!shots.delete(node)) return;
            node.removeEventListener("ended", done); node.removeEventListener("error", done);
            forkStageAudio.release(node);
            node.pause(); node.removeAttribute("src"); finish();
        };
        node.releaseShot = done;
        node.addEventListener("ended", done, { once: true }); node.addEventListener("error", done, { once: true });
        node.play().catch(done);
        return completion;
    }
    return {
        subscribe(fn) { listeners.add(fn); const off = forkStageAudio.subscribe(fn); return () => { listeners.delete(fn); off(); }; },
        get: () => { const prefs = forkStageAudio.get(); return { volume: prefs.sfx, muted: !!prefs.muted.sfx }; },
        // private fork: media identity is distinct from each legitimate event/play.
        play(url, identity, ref, token, gain = 1, authored) { return oneShot(url, gain, identity, ref, token, authored); },
        stopToken(token) { shots.forEach(node => { if (node.eventToken === token) node.releaseShot(); }); },
        setThunder(url) { thunderUrl = url || ""; },
        thunder(strength) {
            const now = forkForeground.now();
            if (!thunderUrl || now - lastThunder < 2500) return;
            lastThunder = now;
            const url = thunderUrl;
            forkForeground.setTimeout(() => { if (url === thunderUrl) oneShot(url, 0.55 + 0.35 * clamp(strength)); }, 250 + Math.random() * 900);
        },
        stop(scope) {
            shots.forEach(node => { if (!scope || stageResourceMatches(node.resourceRef,scope)) node.releaseShot(); });
            if (!scope || scope.authority) thunderUrl = ""; emit();
        },
        setVolume(value) { forkStageAudio.setVolume("sfx", value); },
        toggleMute() { forkStageAudio.toggleMute("sfx"); }
    };
})();
// private fork (UI standard phase 2 batch 13): the old top-bar sound control was removed (CONFIG / mixer own it).
