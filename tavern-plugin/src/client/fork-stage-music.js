// private fork: pack-projected audio; no catalogue owner.
// One page-wide player: two <audio> elements, looped, crossfaded. Volume and mute persist.
const forkStageMusic = (function () {
    let a = null, b = null, current = "", currentIdentity = null, fade = 0, handoff = null;
    // private fork (new-user journey 2026-10): the browser's autoplay policy refused the track (play() → NotAllowedError);
    // cleared by the next play() that starts. The stage shows 「点任意处开启声音」 while it holds.
    let blocked = false;
    const listeners = new Set();
    const emit = () => listeners.forEach(fn => fn());
    const setBlocked = value => { if (blocked !== value) { blocked = value; emit(); } };
    const playNode = node => {
        const started = node.play();
        if (started && typeof started.then === "function") started.then(() => { if (node === a && !node.paused) setBlocked(false); }, error => { if (node === a && error && error.name === "NotAllowedError") setBlocked(true); });
    };
    // A play deferred while the page was in the background (forkForeground) is refused later: "fork-play-blocked".
    const watch = node => {
        node.addEventListener("fork-play-blocked", () => { if (node === a) setBlocked(true); });
        node.addEventListener("playing", () => { if (node === a) setBlocked(false); });
    };
    const level = (node, value) => forkStageAudio.level(node, value);
    function ensure() {
        if (a) return;
        a = new Audio(); b = new Audio();
        [a, b].forEach(node => { node.loop = true; node.preload = "auto"; node.volume = 0; if (typeof node.addEventListener === "function") watch(node); });
    }
    function settle() {
        forkForeground.clearTimeout(fade);
        if (b) { b.pause(); b.removeAttribute("src"); level(b, 0); }
        handoff?.(); handoff = null;
    }
    return {
        subscribe(fn) { listeners.add(fn); const off = forkStageAudio.subscribe(fn); return () => { listeners.delete(fn); off(); }; },
        get: () => { const prefs = forkStageAudio.get(); return { current, identity: currentIdentity, paused: !a || a.paused, volume: prefs.music, muted: !!prefs.muted.music }; },
        ready: () => !!a && a.readyState >= 3,
        blocked: () => blocked,
        // Only the blocked flag's changes (no mixer subscription).
        subscribeBlocked(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        // private fork (audio editor): `volume` is the track entry's authored 音量 (mixer gain, not the fade envelope).
        play(url, snap = false, identity, {fadeMs = 1200, volume} = {}) {
            ensure();
            if (!url) { this.stop(); return; }
            // private fork: transport renewal never seeks or recreates a live track; a paused one resumes.
            if (identity === currentIdentity && current) { this.trim(volume); this.resume(); return; }
            settle();
            const previous = a, next = b, from = level(previous);
            next.src = url; forkStageAudio.bind(next, "music", url, { volume }); level(next, 0);
            a = next; b = previous; current = url; currentIdentity = identity;
            playNode(next);
            if (snap || fadeMs === 0) { level(next, 1); previous.pause(); previous.removeAttribute("src"); level(previous, 0); emit(); return; }
            const complete = new Promise(resolve => { handoff = resolve; });
            const start = forkForeground.now();
            function step(now) {
                const t = Math.min(1, (now - start) / Math.max(1, fadeMs));
                level(previous, from * (1 - t)); level(next, t);
                if (t < 1) fade = forkForeground.setTimeout(() => step(forkForeground.now()), 16);
                else { previous.pause(); previous.removeAttribute("src"); handoff?.(); handoff = null; }
            }
            // private fork: audio envelopes must advance even when visual RAF sleeps.
            fade = forkForeground.setTimeout(() => step(forkForeground.now()), 16); emit(); return complete;
        },
        // private fork: the BGM player's pause keeps the track and its position (fork-bgm-player.cjs).
        pause() { if (!current) return; settle(); level(a, 1); a.pause(); emit(); },
        resume() { if (current && a.paused) { playNode(a); emit(); } },
        trim(volume) { if (current && a) forkStageAudio.trim?.(a, volume); },
        stop() {
            forkForeground.clearTimeout(fade);
            [a, b].forEach(node => { if (node) { node.pause(); node.removeAttribute("src"); level(node, 0); } });
            current = ""; currentIdentity = null; blocked = false; handoff?.(); handoff = null; emit();
        },
        setVolume(value) { forkStageAudio.setVolume("music", value); },
        toggleMute() { forkStageAudio.toggleMute("music"); }
    };
})();
// private fork (UI standard phase 2 batch 13): the old top-bar music control was removed (the BGM player owns it).
// Settings: global library of tracks (links or uploads), filterable by tag.
