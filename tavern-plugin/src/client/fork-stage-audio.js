// Page-wide mixer. Element.volume remains the crossfade envelope; normalization is a GainNode.
function forkMeasureAudioBuffer(buffer) {
    // The FIR true-peak scan is CPU-heavy: never run it on the UI thread.
    return new Promise((resolve, reject) => {
        const source = "const measure = " + forkMeasureLoudness.toString() + "; onmessage = e => { try { postMessage({value: measure(e.data.channels, e.data.rate)}); } catch (error) { postMessage({error: String(error)}); } };";
        const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        let worker, timer;
        const finish = (error, value) => { clearTimeout(timer); if (worker) worker.terminate(); URL.revokeObjectURL(url); if (error) reject(error); else resolve(value); };
        try {
            worker = new Worker(url); timer = setTimeout(() => finish(new Error("Audio analysis timeout")), 180000);
            worker.onmessage = event => finish(event.data.error, event.data.value); worker.onerror = error => finish(error);
            const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice());
            worker.postMessage({ channels, rate: buffer.sampleRate }, channels.map(channel => channel.buffer));
        } catch (error) { finish(error); }
    });
}
function forkAudioPreferences(storage) {
    // private fork: quarter-strength UI cues; migrate the saved slider once, in the same record.
    const defaults = { v: 1, uiGainVersion: 1, master: 0.8, voice: 0.8, music: 0.8, sfx: 0.8, ambience: 0.8, ui: 0.5, muted: {} };
    try {
        const saved = JSON.parse(storage.getItem("fork-stage-audio") || "null");
        if (!saved || saved.v !== 1) {
            // One-time reset of the old compensating gains, not the voice enable/roster settings.
            for (const key of ["fork-stage-music", "fork-stage-sfx"]) storage.setItem(key, JSON.stringify({ volume: 0.8, muted: false }));
            storage.setItem("fork-stage-audio", JSON.stringify(defaults)); return defaults;
        }
        for (const key of ["master", "voice", "music", "sfx", "ambience", "ui"]) if (Number.isFinite(saved[key])) defaults[key] = Math.max(0, Math.min(1, saved[key]));
        defaults.muted = saved.muted && typeof saved.muted === "object" ? saved.muted : {};
        if (saved.uiGainVersion !== 1) {
            if (Number.isFinite(saved.ui)) defaults.ui = Math.min(1, defaults.ui * 4);
            storage.setItem("fork-stage-audio", JSON.stringify({ ...saved, ui: defaults.ui, uiGainVersion: 1 }));
        }
    } catch (_) {}
    return defaults;
}
const forkStageAudio = (function () {
    let storage = null;
    // Even reading the getter (including typeof) throws on opaque origins.
    try { storage = localStorage; } catch (_) {}
    const prefs = forkAudioPreferences(storage);
    const listeners = new Set(), nodes = new WeakMap(), active = new Set(), catalogue = new Map(), queued = new Set(), queue = [];
    const voicePeaks = new WeakMap(), voiceQueue = [], failed = new Map();
    function remember(item) {
        catalogue.delete(item.url); catalogue.set(item.url, item);
        for (const key of catalogue.keys()) {
            if (catalogue.size <= 1024) break;
            if (![...active].some(record => record.url === key)) catalogue.delete(key);
        }
    }
    function known(url) {
        const item = catalogue.get(url);
        if (item) { catalogue.delete(url); catalogue.set(url, item); }
        return item;
    }
    function enqueue(item) {
        if (item && !forkAudioMeasurement(item.loudness) && !queued.has(item.url) && !(failed.get(item.url) > Date.now()) && queued.size < 256) { queued.add(item.url); queue.push(item); }
    }
    let context = null, master = null, buses = {}, working = false, speaking = false, preparingVoice = false;
    const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
    const volume = layer => prefs.muted[layer] ? 0 : prefs[layer];
    function ensure() {
        if (context) { if (context.state === "suspended") context.resume().catch(() => {}); return context; }
        const Constructor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
        if (!Constructor) return null;
        try {
            context = new Constructor(); master = context.createGain(); master.gain.value = volume("master"); const foregroundGain = context.createGain(); master.connect(foregroundGain); foregroundGain.connect(context.destination);
            if (typeof forkForeground !== "undefined") forkForeground.context(context, foregroundGain);
            for (const layer of Object.keys(FORK_AUDIO_TARGETS)) {
                const gain = context.createGain(), duck = context.createGain(); gain.gain.value = volume(layer); duck.gain.value = forkAudioDuck(layer, speaking);
                gain.connect(duck); duck.connect(master); buses[layer] = { gain, duck, from: duck.gain.value, to: duck.gain.value, at: context.currentTime, attack: false };
            }
            if (context.state === "suspended") context.resume().catch(() => {});
        } catch (_) { context = null; }
        return context;
    }
    const installedHosts = new WeakSet();
    function install(host) {
        if (!host || !host.addEventListener || installedHosts.has(host)) return;
        const resume = () => { if (context && context.state === "suspended") context.resume().catch(() => {}); };
        installedHosts.add(host);
        host.addEventListener("pointerdown", resume, { passive: true });
        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;
            host.removeEventListener("pointerdown", resume);
            installedHosts.delete(host);
        };
    }
    function measured(record) { return record.layer === "voice" ? voicePeaks.get(record.node) || FORK_AUDIO_VOICE : record.loudness || known(record.url)?.loudness; }
    async function prepareVoices() {
        if (preparingVoice) return; preparingVoice = true;
        while (voiceQueue.length) {
            const { node, blob } = voiceQueue.shift();
            try {
                const ctx = ensure(); if (!ctx || blob.size > 8 * 1024 * 1024) continue;
                const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
                if (buffer.duration > 120 || buffer.numberOfChannels > 2) continue;
                const value = await forkMeasureAudioBuffer(buffer);
                // Speech already has voiced-RMS normalization; only actual peak headroom varies.
                voicePeaks.set(node, { ...FORK_AUDIO_VOICE, peak: value.peak });
                const record = nodes.get(node); if (record) update(record);
            } catch (_) { /* No peak estimate: retain the provider's conservative nominal ceiling. */ }
        }
        preparingVoice = false;
    }
    // private fork (audio editor): an entry's authored 音量 (0..1) multiplies its normalized gain.
    const trimOf = value => Number.isFinite(value) ? clamp(value) : 1;
    function update(record) {
        if (record.released) return;
        const gain = forkAudioGain(record.layer, measured(record), record.gainDb) * record.trim;
        if (record.gain) { record.gain.gain.cancelScheduledValues(context.currentTime); record.gain.gain.setTargetAtTime(gain, context.currentTime, 0.05); }
        else record.node.volume = clamp(record.envelope * gain * volume(record.layer) * volume("master") * forkAudioDuck(record.layer, speaking));
    }
    function bind(node, layer, url, authored = {}) {
        if (typeof forkForeground !== "undefined") forkForeground.media(node);
        let record = nodes.get(node);
        if (record?.released) throw new Error("Cannot bind a released audio element; create a new element");
        if (layer !== "voice") { enqueue(known(url) || { url }); void pump(); }
        const waiting = queue.findIndex(item => item.url === url);
        if (waiting > 0) queue.unshift(queue.splice(waiting, 1)[0]);
        if (!record) {
            record = { node, layer, url, envelope: node.volume, gain: null, gainDb: authored.gainDb ?? 0, loudness: authored.loudness, trim: trimOf(authored.volume), released: false }; nodes.set(node, record);
            if (ensure()) {
                try { const source = context.createMediaElementSource(node), gain = context.createGain(); source.connect(gain); gain.connect(buses[layer].gain); record.source = source; record.gain = gain; gain.gain.value = forkAudioGain(layer, measured(record), record.gainDb) * record.trim; }
                catch (_) { /* Unsupported media stays on the conservative element-volume path. */ }
            }
            const activate = () => { if (!record.released) { active.add(record); update(record); } };
            const deactivate = () => active.delete(record);
            record.handlers = { play: activate, pause: deactivate, ended: deactivate, error: deactivate };
            for (const [event, handler] of Object.entries(record.handlers)) node.addEventListener(event, handler);
        }
        if (record.layer !== layer) { if (record.gain) { record.gain.disconnect(); record.gain.connect(buses[layer].gain); } record.layer = layer; }
        if (typeof forkForeground !== "undefined") forkForeground.media(node, Boolean(record.source));
        // A reused element (the music crossfade pair) takes the volume of the track it now plays.
        record.url = url; record.trim = trimOf(authored.volume); if (!node.paused) active.add(record); update(record); return record;
    }
    function save() {
        try { localStorage.setItem("fork-stage-audio", JSON.stringify(prefs)); } catch (_) {}
        if (context) { master.gain.setTargetAtTime(volume("master"), context.currentTime, 0.015); for (const layer of Object.keys(buses)) buses[layer].gain.gain.setTargetAtTime(volume(layer), context.currentTime, 0.015); }
        active.forEach(update); listeners.forEach(fn => fn());
    }
    async function pump() {
        if (working) return; working = true;
        while (queue.length) {
            const item = queue.shift();
            let complete = false;
            try {
                const answer = await rpc("measureStageAudio", { url: item.url });
                let value = answer.loudness;
                if (!forkAudioMeasurement(value)) {
                    const ctx = ensure(); if (!ctx) continue;
                    const response = await fetch(item.url); if (!response.ok) continue;
                    const bytes = await response.arrayBuffer(); if (bytes.byteLength > 60 * 1024 * 1024) continue;
                    const buffer = await ctx.decodeAudioData(bytes);
                    // Bound decoded memory and CPU; unsupported layouts stay conservative.
                    if (buffer.duration > 900 || buffer.numberOfChannels > 2) continue;
                    value = await forkMeasureAudioBuffer(buffer);
                    await rpc("measureStageAudio", { url: item.url, sha: answer.sha, loudness: value });
                }
                remember({ ...item, loudness: value }); complete = true; failed.delete(item.url);
                active.forEach(record => { if (record.url === item.url) update(record); });
            } catch (_) { /* Decode/network failures never stop playback or retry in a tight loop. */ }
            finally {
                queued.delete(item.url);
                if (!complete) {
                    failed.delete(item.url); failed.set(item.url, Date.now() + 300000);
                    while (failed.size > 256) failed.delete(failed.keys().next().value);
                }
            }
        }
        working = false;
    }
    return {
        install,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get() { return { ...prefs, muted: { ...prefs.muted } }; },
        setVolume(layer, value) { if (!Object.hasOwn(prefs, layer) || layer === "muted" || layer === "v") return; prefs[layer] = clamp(value); prefs.muted[layer] = false; save(); },
        toggleMute(layer) { prefs.muted[layer] = !prefs.muted[layer]; save(); },
        register(items) {
            for (const item of items) if (item.url) {
                const previous = known(item.url);
                if (!forkAudioMeasurement(item.loudness) && forkAudioMeasurement(previous?.loudness)) continue;
                remember(item);
                enqueue(item);
            }
            active.forEach(update); void pump();
        }, bind,
        // Terminal opt-in teardown. Retain the WeakMap tombstone: a media element may only
        // have one MediaElementSource, even after that source has been disconnected.
        release(node) {
            const record = nodes.get(node);
            if (!record || record.released) return;
            record.released = true; active.delete(record);
            if (typeof node.removeEventListener === "function") {
                for (const [event, handler] of Object.entries(record.handlers)) node.removeEventListener(event, handler);
            }
            for (const part of [record.source, record.analyser, record.filter, record.gain]) {
                if (part) { try { part.disconnect(); } catch (_) {} }
            }
            record.filterActive = false;
        },
        // private fork (audio editor): retune a bound element's authored 音量 (an edit while it plays).
        trim(node, value) {
            const record = nodes.get(node);
            if (!record || record.released || record.trim === trimOf(value)) return;
            record.trim = trimOf(value); update(record);
        },
        prepareVoice(node, blob) { if (voiceQueue.length < 32) { voiceQueue.push({ node, blob }); void prepareVoices(); } },
        wake() { ensure(); },
        analyser(node) {
            const record = nodes.get(node) || bind(node, "voice", node.src);
            if (record.released || !record.source) return null;
            if (!record.analyser) {
                record.analyser = context.createAnalyser(); record.analyser.fftSize = 1024;
                record.source.disconnect(); record.source.connect(record.analyser); record.analyser.connect(record.filterActive ? record.filter : record.gain);
            }
            return record.analyser;
        },
        // Opt-in only: source -> optional analyser -> optional lowpass -> normalization -> bus.
        // Never create a second MediaElementSource or disturb the existing envelope/duck chain.
        filter(node, cutoffHz) {
            const record = nodes.get(node);
            if (!record || record.released || !record.source || !record.gain) return false;
            if (cutoffHz != null && (!Number.isFinite(cutoffHz) || cutoffHz < 0)) return false;
            const upstream = record.analyser || record.source;
            if (!cutoffHz) {
                if (record.filterActive) {
                    upstream.disconnect(); record.filter.disconnect(); upstream.connect(record.gain);
                    record.filterActive = false;
                }
                return true;
            }
            if (!record.filter) {
                if (typeof context.createBiquadFilter !== "function") return false;
                record.filter = context.createBiquadFilter(); record.filter.type = "lowpass";
                record.filter.Q.value = 0;
            }
            if (!record.filterActive) {
                const frequency = record.filter.frequency, time = context.currentTime;
                if (typeof frequency.cancelScheduledValues === "function") frequency.cancelScheduledValues(time);
                if (typeof frequency.setValueAtTime === "function") frequency.setValueAtTime((context.sampleRate || 48000) / 2, time);
                else frequency.value = (context.sampleRate || 48000) / 2;
                upstream.disconnect(); upstream.connect(record.filter); record.filter.connect(record.gain);
                record.filterActive = true;
            }
            const frequency = record.filter.frequency, time = context.currentTime;
            const cutoff = Math.max(20, Math.min((context.sampleRate || 48000) / 2, cutoffHz));
            if (typeof frequency.setTargetAtTime === "function") {
                // Hold an in-progress target where supported before retargeting it.
                if (typeof frequency.cancelAndHoldAtTime === "function") frequency.cancelAndHoldAtTime(time);
                else if (typeof frequency.cancelScheduledValues === "function") frequency.cancelScheduledValues(time);
                frequency.setTargetAtTime(cutoff, time, 0.05);
            } else frequency.value = cutoff;
            return true;
        },
        level(node, value) {
            const record = nodes.get(node);
            if (value === undefined) return record ? record.envelope : node.volume;
            if (record?.released) return;
            if (!record) { node.volume = clamp(value); return; }
            record.envelope = clamp(value);
            if (record.gain) node.volume = record.envelope; else update(record);
        },
        voice(activeVoice) {
            const next = !!activeVoice; if (speaking === next) return; speaking = next;
            if (context) for (const layer of ["music", "ambience"]) {
                const bus = buses[layer], now = context.currentTime;
                const current = forkAudioEnvelope(bus.from, bus.to, now - bus.at, bus.attack);
                bus.from = current; bus.to = forkAudioDuck(layer, speaking); bus.at = now; bus.attack = speaking;
                bus.duck.gain.cancelScheduledValues(now); bus.duck.gain.setValueAtTime(current, now); bus.duck.gain.linearRampToValueAtTime(bus.to, now + (speaking ? 0.15 : 0.4));
            }
            active.forEach(record => { if (!record.gain) update(record); });
        }
    };
})();
function useForkStageAudioState() {
    const [, redraw] = React.useState(0);
    React.useEffect(() => forkStageAudio.subscribe(() => redraw(n => n + 1)), []);
    return forkStageAudio.get();
}
// private fork (UI standard phase 2 batch 13): the old top-bar mixer sliders were removed (the stage mixer is fork-gal-mixer.js).
