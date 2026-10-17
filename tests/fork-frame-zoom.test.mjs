// private fork: card-wide zoom uses the existing file-backed storage queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8');
function harness(disk) {
    const frames = [], sent = [], window = { setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame(fn) { frames.push(fn); } };
    const context = vm.createContext({ window, console, TextEncoder, rpc: async (method, args) => {
        if (method === 'getFrameStorage') return { values: { ...disk } };
        for (const op of args.ops) disk[op.key] = op.value;
        return { ok: true, applied: args.ops.length };
    } });
    vm.runInContext(read('fork-frame-storage.js') + '\n' + read('fork-frame-zoom.js') + '\nglobalThis.api = {forkFrameStorage, forkFrameZoom};', context);
    const { forkFrameStorage: storage, forkFrameZoom: zoom } = context.api;
    return { storage, zoom, window, sent, frames, flush() { frames.splice(0).forEach(fn => fn()); },
        register(token, card) { return zoom.register({ contentWindow: { postMessage(data) { sent.push({ ...data }); } } }, token, card); } };
}
test('card zoom batches, clamps, resets, broadcasts only to that card and survives a new host', async () => {
    const disk = {}, h = harness(disk);
    await h.storage.load();
    h.register('message', 'cards/a.png'); h.register('sidebar', 'cards/a.png'); h.register('other', 'cards/b.png');
    for (let i = 0; i < 30; i++) h.zoom.adjust('cards/a.png', { step: 1 }, h.window);
    assert.equal(h.frames.length, 1); h.flush();
    assert.deepEqual(h.sent.map(x => [x.token, x.zoom]), [['message', 2], ['sidebar', 2]]);
    for (let i = 0; i < 30; i++) h.zoom.adjust('cards/a.png', { step: -1 }, h.window);
    h.flush(); assert.equal(h.zoom.seed('cards/a.png').value, 0.6);
    h.zoom.adjust('cards/a.png', { step: 1 }, h.window); h.flush();
    assert.equal(await h.storage.flush(), true);
    const next = harness(disk); await next.storage.load();
    assert.deepEqual({ ...next.zoom.seed('cards/a.png') }, { value: 0.7, ready: true });
    assert.equal(next.zoom.seed('cards/b.png').value, 1);
    next.zoom.adjust('cards/a.png', { reset: true }, next.window); next.flush();
    assert.equal(next.zoom.seed('cards/a.png').value, 1);
    for (const step of [0, 3, NaN, '1', null]) next.zoom.adjust('cards/a.png', { step }, next.window);
    assert.equal(next.frames.length, 0);
});
test('load-time seed and detached peers respect their lifetime', async () => {
    const h = harness({ 'dsh-card-zoom:cards%2Fa.png': '1.4' });
    assert.equal(h.zoom.seed('cards/a.png').ready, false);
    const stop = h.register('removed', 'cards/a.png'); h.zoom.ready('removed'); stop();
    await h.storage.load(); await Promise.resolve(); assert.deepEqual(h.sent, []);
    h.register('new', 'cards/a.png'); h.zoom.ready('new'); await Promise.resolve();
    assert.equal(h.sent[0].zoom, 1.4);
});
