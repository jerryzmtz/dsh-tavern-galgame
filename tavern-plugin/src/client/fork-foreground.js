// private fork: presentation time stops; transport, synthesis and director work do not.
function createForkForeground(host, doc) {
    const listeners = new Set(), timers = new Map(), frames = new Map(), media = new Map(), contexts = new Set();
    const animations = new Set();
    const rawNow = () => host.performance.now();
    let foreground = doc.visibilityState === 'visible' && doc.hasFocus();
    let blurredAt = foreground ? null : rawNow(), elapsed = 0, debounce = null, serial = 0, picker = null;
    const now = () => (foreground ? rawNow() : blurredAt) - elapsed;
    function subscribe(fn) { listeners.add(fn); fn(foreground); return () => listeners.delete(fn); }
    function arm(timer) {
        timer.at = now();
        timer.native = host.setTimeout(() => {
            timer.native = null;
            if (!foreground) return;
            if (!timer.repeat) timers.delete(timer.id);
            else { timer.remaining = timer.delay; arm(timer); }
            timer.fn();
        }, timer.remaining);
    }
    function schedule(fn, delay, repeat) {
        const id = ++serial, timer = { id, fn, delay: Math.max(0, Number(delay) || 0), repeat, native: null };
        timer.remaining = timer.delay; timers.set(id, timer);
        if (foreground) arm(timer);
        return id;
    }
    function cancel(id) { const timer = timers.get(id); if (timer) { host.clearTimeout(timer.native); timers.delete(id); } }
    function set(value) {
        if (foreground === value) return;
        if (!value) blurredAt = rawNow();
        else { elapsed += rawNow() - blurredAt; blurredAt = null; }
        foreground = value;
        for (const timer of timers.values()) {
            if (value) arm(timer);
            else { timer.remaining = Math.max(0, timer.remaining - (now() - timer.at)); host.clearTimeout(timer.native); timer.native = null; }
        }
        for (const frame of frames.values()) {
            if (value) armFrame(frame); else { host.cancelAnimationFrame(frame.native); frame.native = null; }
        }
        if (value) { for (const animation of animations) if (animation.playState === 'paused') animation.play(); animations.clear(); }
        else pauseAnimations();
        for (const record of media.values()) {
            if (value) record.resume(); else record.freeze();
        }
        for (const record of contexts) record.sync(value);
        for (const fn of listeners) { try { fn(value); } catch (error) { host.console?.error('[fork-foreground]', error); } }
    }
    function refresh() {
        host.clearTimeout(debounce); debounce = null;
        // hasFocus remains true for a focused descendant frame (including cross-origin frames).
        // Unlike activeElement === iframe, it does not mistake an alt-tab for internal focus.
        const value = Boolean(picker) || (doc.visibilityState === 'visible' && doc.hasFocus());
        if (value) set(true);
        else if (doc.visibilityState !== 'visible') set(false);
        else debounce = host.setTimeout(() => { debounce = null; set(Boolean(picker) || (doc.visibilityState === 'visible' && doc.hasFocus())); }, 300);
    }
    function pauseAnimations() {
        for (const animation of doc.getAnimations?.() || []) {
            // private fork: the document also owns native thinking/status UI.
            // Only stage/Live2D presentation belongs to this controller.
            const target = animation.effect?.target;
            const element = target?.element || target;
            if (!element?.closest?.('.fork-gal-stage, .fork-live2d-preview')) continue;
            if (animation.playState === 'running') { animations.add(animation); animation.pause(); }
        }
    }
    if (host.MutationObserver) {
        const observer = new host.MutationObserver(() => { if (!foreground) pauseAnimations(); });
        observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    }
    function armFrame(frame) {
        frame.native = host.requestAnimationFrame(() => {
            if (!foreground) return;
            frames.delete(frame.id); frame.fn(now());
        });
    }
    function endPicker() { picker = null; refresh(); }
    function pickerClick(event) {
        const input = event.target;
        if (input?.tagName !== 'INPUT' || input.type !== 'file' || input.disabled) return;
        picker = input;
        input.addEventListener('change', endPicker, { once: true });
        input.addEventListener('cancel', endPicker, { once: true });
        refresh();
    }
    host.addEventListener('blur', refresh);
    host.addEventListener('focus', endPicker);
    doc.addEventListener('visibilitychange', refresh);
    doc.addEventListener('click', pickerClick, true);
    if (!foreground) pauseAnimations();
    function trackMedia(node, graph = false) {
        if (node.__forkForeground) { node.__forkForeground.graph ||= graph; return node; }
        const play = node.play.bind(node), pause = node.pause.bind(node);
        const record = {
            graph, epoch: 0, fade: null, target: null,
            settle() { if (this.fade !== null) { cancel(this.fade); this.fade = null; node.volume = this.target; } },
            freeze() { this.epoch++; this.settle(); pause(); },
            resume() {
                if (!media.has(node)) return;
                if (!this.graph) {
                    this.target = node.volume; node.volume = 0;
                    const started = now();
                    const step = () => {
                        const t = Math.min(1, (now() - started) / 150);
                        node.volume = this.target * t;
                        this.fade = t < 1 ? schedule(step, 16, false) : null;
                    };
                    this.fade = schedule(step, 16, false);
                }
                const epoch = this.epoch;
                play().catch(error => {
                    if (epoch !== this.epoch && media.get(node) === this && error.name === 'AbortError') return;
                    this.settle(); media.delete(node);
                    // private fork (new-user journey 2026-10): a deferred play the autoplay policy refuses is told to its owner
                    // (forkStageMusic shows 「点任意处开启声音」), not only swallowed.
                    if (error.name === 'NotAllowedError') node.dispatchEvent(new Event('fork-play-blocked'));
                });
            }
        };
        node.__forkForeground = record;
        node.play = function () {
            media.set(node, record);
            const epoch = record.epoch;
            return foreground ? play().catch(error => {
                // pause() rejects an in-flight native play promise. This is suspension, not an SFX/voice failure.
                if (epoch !== record.epoch && media.get(node) === record && error.name === 'AbortError') return;
                media.delete(node); throw error;
            }) : Promise.resolve();
        };
        node.pause = function () { record.settle(); media.delete(node); return pause(); };
        const done = () => { record.settle(); media.delete(node); };
        node.addEventListener('ended', done); node.addEventListener('error', done);
        if (!node.paused) { media.set(node, record); if (!foreground) record.freeze(); }
        return node;
    }
    function trackContext(context, gain) {
        const resume = context.resume.bind(context);
        // Analysis may call ensure() while hidden. It may decode but must not wake the speakers.
        context.resume = () => foreground ? resume() : Promise.resolve();
        const record = { context, sync(value) {
            if (context.state === 'closed') { contexts.delete(record); return; }
            if (!value) { context.suspend().catch(() => {}); return; }
            if (gain) {
                const t = context.currentTime;
                gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(1, t + 0.15);
            }
            resume().catch(() => {});
        } };
        contexts.add(record);
        if (!foreground) record.sync(false);
        return () => contexts.delete(record);
    }
    function trackApplication(app) {
        const update = app.ticker.update, render = app.renderer.render;
        let running = app.ticker.started;
        app.ticker.update = function (...args) { if (foreground) return update.apply(this, args); };
        app.renderer.render = function (...args) { if (foreground) return render.apply(this, args); };
        const off = subscribe(value => {
            if (!value) { running = app.ticker.started; app.stop(); }
            else if (running) {
                app.ticker.lastTime = rawNow(); app.ticker._lastFrame = rawNow();
                app.start();
            }
        });
        return () => { off(); app.ticker.update = update; app.renderer.render = render; };
    }
    return {
        state: () => ({ foreground, visibility: doc.visibilityState, focused: doc.hasFocus(), picker: Boolean(picker), timers: timers.size, frames: frames.size, media: media.size, contexts: contexts.size, audioContexts: [...contexts].map(record => record.context.state) }),
        isForeground: () => foreground, subscribe, now, refresh,
        setTimeout: (fn, ms) => schedule(fn, ms, false), clearTimeout: cancel,
        setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: cancel,
        requestAnimationFrame(fn) { const frame = { id: ++serial, fn, native: null }; frames.set(frame.id, frame); if (foreground) armFrame(frame); return frame.id; },
        cancelAnimationFrame(id) { const frame = frames.get(id); if (frame) { host.cancelAnimationFrame(frame.native); frames.delete(id); } },
        media: trackMedia, context: trackContext, application: trackApplication,
        isPlaying: node => Boolean(node && (media.has(node) || !node.paused)),
        picker(open) { picker = open ? true : null; refresh(); }
    };
}
const forkForeground = window.forkForeground || (window.forkForeground = createForkForeground(window, document));
