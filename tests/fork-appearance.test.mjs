import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-ui/src/fork-appearance.js', import.meta.url), 'utf8');

test('choosing a built-in theme clears the saved skin before setting the host preference', () => {
    const calls = [], window = { __dshDreamSkin: { current: () => 'rose', defaultSkin: 'system', select: id => calls.push(['skin', id]) } };
    const api = vm.runInNewContext(source + '\n({forkSelectBuiltinTheme})', { window });
    api.forkSelectBuiltinTheme({ setTheme: id => calls.push(['theme', id]) }, 'dark');
    assert.deepEqual(calls, [['skin', 'system'], ['theme', 'dark']]);
    delete window.__dshDreamSkin;
    api.forkSelectBuiltinTheme({ setTheme: id => calls.push(['theme', id]) }, 'light');
    assert.deepEqual(calls.at(-1), ['theme', 'light']);
});

test('appearance only shadows the general row while the destination slot exists', () => {
    let activate; const registrations = [], disposed = [];
    const api = vm.runInNewContext(source + '\n({installForkAppearance})');
    const ctx = { slots: {
        inject(name, fn) {
            if (name === 'settings.dreamSkin.item') { activate = fn; return () => disposed.push('watch'); }
            const cleanup = fn(); return () => { cleanup(); disposed.push(name); };
        },
        register(options) { registrations.push(options); return () => disposed.push(options.id); },
    } };
    const stop = api.installForkAppearance(ctx);
    assert.equal(registrations.length, 0);
    const release = activate();
    assert.equal(registrations[0].id, 'appearance'); assert.equal(registrations[0].priority, -1);
    assert.equal(registrations[1].name, 'settings.dreamSkin.item');
    release(); stop();
    assert.ok(disposed.includes('appearance')); assert.ok(disposed.includes('fork-appearance-modes'));
});

test('completed status has no header, while errors and retry remain visible', () => {
    const source = readFileSync(new URL('../tavern-plugin/src/client/fork-status-panel.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fork-status-head|已结算/);
    assert.match(source, /settle === "running"[\s\S]*fork-status-tab-spinner/);
    assert.match(source, /settle === "error"[\s\S]*fork-status-tab-error/);
    assert.match(source, /p\.retrySettlement/);
    assert.match(source, /TavernBackgroundWait/);
});
