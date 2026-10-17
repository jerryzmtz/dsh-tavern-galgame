import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/client.js', import.meta.url), 'utf8');
const start = source.indexOf('// The host ui-theme.preference scope only persists');
const end = source.indexOf('// Wallpaper bookkeeping.', start);
assert.ok(start >= 0 && end > start);
// private fork: include upstream family/scheme mapping used by the restore policy.
const schemeStart = source.indexOf("function nativeScheme(");
const schemeEnd = source.indexOf("function rawActiveTheme(", schemeStart);
const restoreSource = source.slice(schemeStart, schemeEnd) + source.slice(start, end);

function harness({ saved = 'rose', preference = saved, packs = [] } = {}) {
    const listeners = new Map(), timers = new Map(), microtasks = [], cleanups = [];
    const changes = [];
    let builtinLast = null, timerId = 0, presented = preference;
    const ctx = {
        theme: {
            getTheme: () => ({ preference }),
            setTheme(next) {
                preference = next;
                changes.push(next);
                const snapshot = { preference };
                for (const listener of listeners.get('theme/change') || []) listener(snapshot);
            },
        },
        on(name, fn) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(fn);
        },
        effect(setup) { cleanups.push(setup()); },
    };
    vm.runInNewContext(restoreSource, {
        ctx, DEFAULT_SKIN: 'system', SKINS: [{ id: 'rose' }, { id: 'mist' }], importedPacks: packs,
        readSavedSkin: () => saved,
        readSavedSkinValid: () => saved !== 'system' && (['rose', 'mist'].includes(saved) || packs.some(p => p.id === saved)),
        readBuiltinLast: () => builtinLast,
        writeBuiltinLast: value => { builtinLast = value; },
        composerMarkerDispose: null,
        setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
        clearTimeout(id) { timers.delete(id); },
        queueMicrotask(fn) { microtasks.push(fn); },
    });
    // The host presenter may run AFTER the plugin. Synchronous nested restores
    // would leave this presenter with the stale outer (built-in) snapshot.
    ctx.on('theme/change', snapshot => { presented = snapshot.preference; });
    return {
        ctx, changes,
        save(value) { saved = value; },
        beforePaint() {
            let budget = 100;
            while (microtasks.length) {
                assert.ok(budget-- > 0, 'restore loop must be bounded');
                microtasks.shift()();
            }
            return presented;
        },
        dispose() { for (const cleanup of cleanups) cleanup(); },
        get pendingTimers() { return timers.size; },
    };
}

test('private fork: repeated settings adoption restores the skin before paint', () => {
    const h = harness();
    h.beforePaint();
    for (let i = 0; i < 12; i++) {
        h.ctx.theme.setTheme(['dark', 'system', 'light'][i % 3]);
        assert.equal(h.beforePaint(), 'rose');
        assert.equal(h.ctx.theme.getTheme().preference, 'rose');
    }
    h.dispose();
    assert.equal(h.pendingTimers, 0);
});

test('private fork: pending restores coalesce and use the latest saved selection', () => {
    const h = harness();
    h.beforePaint();
    h.ctx.theme.setTheme('dark');
    h.ctx.theme.setTheme('system');
    h.save('mist');
    h.ctx.theme.setTheme('light');
    assert.equal(h.beforePaint(), 'mist');
    assert.equal(h.changes.filter(id => id === 'mist').length, 1);
    h.dispose();
});

test('private fork: deliberate Default selection cancels a pending skin restore', () => {
    const h = harness();
    h.beforePaint();
    h.ctx.theme.setTheme('dark');
    h.save('system');
    h.ctx.theme.setTheme('light');
    assert.equal(h.beforePaint(), 'light');
    assert.deepEqual(h.changes, ['dark', 'light']);
    h.dispose();
});

test('private fork: imported skins restore before paint; unknown skins do not', () => {
    for (const known of [true, false]) {
        const h = harness({ saved: 'custom', packs: known ? [{ id: 'custom' }] : [] });
        h.beforePaint();
        h.ctx.theme.setTheme('dark');
        assert.equal(h.beforePaint(), known ? 'custom' : 'dark');
        h.dispose();
    }
});

test('private fork: a different active third-party skin is not overwritten', () => {
    const h = harness();
    h.ctx.theme.setTheme('dark');
    h.ctx.theme.setTheme('mist');
    assert.equal(h.beforePaint(), 'mist');
    h.dispose();
});

test('private fork: teardown invalidates an already queued restore', () => {
    const h = harness();
    h.beforePaint();
    h.ctx.theme.setTheme('dark');
    h.dispose();
    assert.equal(h.beforePaint(), 'dark');
    assert.deepEqual(h.changes, ['dark']);
    assert.equal(h.pendingTimers, 0);
});

test('private fork: a rejected restore cannot starve rendering with microtasks', () => {
    const h = harness();
    h.beforePaint();
    const adopt = h.ctx.theme.setTheme;
    let attempts = 0;
    h.ctx.theme.setTheme = () => {
        attempts++;
        // The host rejects the skin and publishes another built-in snapshot.
        adopt('dark');
    };
    adopt('dark');
    assert.equal(h.beforePaint(), 'dark');
    assert.equal(attempts, 8);
    h.dispose();
});
