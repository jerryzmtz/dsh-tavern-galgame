import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../tavern-plugin/src/client/fork-font-wheel.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-ui/src/fork-font-wheel.js', import.meta.url), 'utf8');
function target() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(type, fn, options) { listeners.set(type, { fn, options }); },
        removeEventListener(type, fn) { if (listeners.get(type)?.fn === fn) listeners.delete(type); },
        emit(type, event) { listeners.get(type)?.fn(event); },
    };
}
function wheel(values = {}) {
    return {
        ctrlKey: true, deltaX: 0, deltaY: -100, cancelable: true, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        ...values,
    };
}
function harness(initial = 21) {
    const document = target(), window = target(), frames = new Map(), writes = [], relayed = [];
    let size = initial, id = 0;
    document.documentElement = { style: { removeProperty() {}, setProperty() {} } }; // private fork
    window.document = document;
    window.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
    window.cancelAnimationFrame = key => frames.delete(key);
    const theme = { getTheme: () => ({ fontSize: size }), setFontSize: value => { size = value; writes.push(value); } };
    const context = vm.createContext({ window, document, theme, parent: { postMessage: data => relayed.push(data) } });
    const run = code => vm.runInContext(code, context);
    run(source);
    return {
        document, window, theme, writes, frames, relayed, run,
        install() { run('var release = installForkFontWheel(theme)'); },
        dispose() { run('release()'); },
        size: () => size,
        flush() { for (const [key, fn] of frames) { frames.delete(key); fn(); } },
        wheel(values) { const event = wheel(values); document.emit('wheel', event); return event; },
    };
}

test('Ctrl+vertical wheel uses the host font setting and suppresses page zoom', () => {
    const h = harness(); h.install();
    assert.deepEqual({ ...h.document.listeners.get('wheel').options }, { capture: true, passive: false });
    const event = h.wheel();
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    h.flush(); assert.equal(h.size(), 22);
    h.wheel({ deltaY: 100 }); h.flush(); assert.equal(h.size(), 21);
    assert.deepEqual(h.writes, [22, 21]);
});

test('ordinary, horizontal, modified and already-handled scrolling is untouched', () => {
    const h = harness(); h.install();
    for (const values of [
        { ctrlKey: false }, { deltaY: 0 }, { deltaX: 120 }, { deltaX: -100 },
        { deltaY: NaN }, { deltaX: Infinity }, { altKey: true }, { metaKey: true },
        { shiftKey: true }, { defaultPrevented: true }, { cancelable: false },
    ]) {
        const event = h.wheel(values);
        assert.equal(event.defaultPrevented, !!values.defaultPrevented);
        assert.equal(event.stopped, undefined);
    }
    h.flush(); assert.deepEqual(h.writes, []);
});

test('wheel steps coalesce per frame, clamp at 12..32 and reverse at the boundary', () => {
    const h = harness(31); h.install();
    for (let i = 0; i < 20; i++) assert.equal(h.wheel().defaultPrevented, true);
    assert.equal(h.frames.size, 1);
    h.flush(); assert.deepEqual(h.writes, [32]);
    assert.equal(h.wheel().defaultPrevented, true);
    h.flush(); assert.deepEqual(h.writes, [32]);
    for (let i = 0; i < 30; i++) h.wheel({ deltaY: 100 });
    h.wheel(); h.flush(); assert.equal(h.size(), 13);
    assert.deepEqual(h.writes, [32, 13]);
});

test('reads the current settings value and avoids writes for cancelling gestures', () => {
    const h = harness(); h.install();
    h.wheel(); h.wheel({ deltaY: 100 }); h.flush();
    assert.deepEqual(h.writes, []);
    h.theme.setFontSize(16);
    h.wheel({ deltaY: -3, deltaMode: 1 }); h.flush();
    assert.equal(h.size(), 17);
    h.wheel({ deltaY: 1, deltaMode: 2 }); h.flush();
    assert.equal(h.size(), 16);
});

// private fork: obsolete frame-to-reading relay must remain disconnected.
test('frame steps cannot change host reading settings', () => {
    const h = harness(); h.install();
    h.window.emit('dsh-fork-font-step', { detail: 1 }); h.flush();
    assert.equal(h.size(), 21);
    assert.deepEqual(h.writes, []);
});

test('unmount removes both listeners and cancels pending settings writes', () => {
    const h = harness(); h.install(); h.wheel(); h.dispose(); h.flush();
    assert.equal(h.document.listeners.size, 0);
    assert.equal(h.window.listeners.size, 0);
    assert.deepEqual(h.writes, []);
    h.install(); h.wheel(); h.flush(); assert.equal(h.size(), 22);
    h.dispose();
});

test('missing theme service leaves native scrolling available', () => {
    const h = harness();
    h.run('installForkFontWheel(null)()');
    h.run('installForkFontWheel({getTheme(){}})()');
    assert.equal(h.document.listeners.size, 0);
});

test('serialized frame relay includes its token, preserves scrolling and cleans up', () => {
    const h = harness();
    h.run('installForkFrameFontWheel("frame-token", forkFontWheelStep)');
    assert.equal(h.wheel({ ctrlKey: false }).defaultPrevented, false);
    assert.equal(h.relayed.length, 0);
    assert.equal(h.wheel().defaultPrevented, true);
    assert.deepEqual({ ...h.relayed[0] }, { type: 'dsh-fork-font-wheel', token: 'frame-token', step: 1 });
    // private fork: reset is a request, never an unauthenticated local zoom write.
    const reset = wheel({ key: '0' }); h.document.emit('keydown', reset);
    assert.equal(reset.defaultPrevented, true);
    assert.deepEqual({ ...h.relayed[1] }, { type: 'dsh-fork-font-wheel', token: 'frame-token', reset: true });
    h.run('window.emit("message", { source: {}, data: { type: "dsh-fork-frame-zoom", token: "frame-token", zoom: 1.4 } })');
    assert.equal(h.document.documentElement.style.zoom, undefined);
    h.run('window.emit("message", { source: parent, data: { type: "dsh-fork-frame-zoom", token: "wrong", zoom: 1.4 } })');
    assert.equal(h.document.documentElement.style.zoom, undefined);
    h.run('window.emit("message", { source: parent, data: { type: "dsh-fork-frame-zoom", token: "frame-token", zoom: 1.4 } })');
    assert.equal(h.document.documentElement.style.zoom, '1.4');
    h.window.emit('pagehide', {});
    assert.equal(h.document.listeners.size, 0);
});
