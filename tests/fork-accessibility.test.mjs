import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-ui/src/fork-accessibility.js', import.meta.url), 'utf8');
function harness(saved, shown = []) {
    const properties = {}, listeners = new Map();
    const context = vm.createContext({
        localStorage: { getItem: () => saved },
        document: { querySelectorAll: () => shown, body: { style: { setProperty: (key, value) => properties[key] = value, getPropertyValue: key => properties[key] || "", removeProperty: key => delete properties[key] }, dataset: {}, getAttribute: () => null, removeAttribute() {} },
            addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) },
        cancelAnimationFrame() {}, requestAnimationFrame() {},
        MutationObserver: class { observe() {} disconnect() {} },
    });
    vm.runInContext(source, context);
    return { context, properties, listeners, run: code => vm.runInContext(code, context) };
}
test('UI size defaults safely and restores each persisted preset', () => {
    for (const [saved, expected] of [[null, 13], ['invalid', 13], ['compact', 12], ['standard', 13], ['comfortable', 15], ['large', 17]]) {
        const h = harness(saved); h.run('applyForkUiSize(forkUiSize())');
        assert.equal(h.properties['--fork-ui-size'], expected + 'px');
        assert.equal(h.properties['--dsh-content-font-size'], undefined);
    }
});
test('compaction caption labels original estimates, not savings', () => {
    const h = harness();
    assert.equal(h.run('forkCompactionCaption("已压缩 55 条历史记录（约 11725 tokens）")'), '已压缩 55 条历史记录（原文约 11,725 tokens）');
    assert.equal(h.run('forkCompactionCaption("已压缩 1 条历史记录（约 650 tokens）")'), '已压缩 1 条历史记录（原文约 650 tokens）');
    const caption = '已压缩 55 条历史记录（原文约 11,725 tokens）';
    assert.equal(h.run('forkCompactionCaption(' + JSON.stringify(caption) + ')'), caption);
});
test('inaccessible storage falls back without breaking the shell', () => {
    const h = harness(); h.context.localStorage.getItem = () => { throw Error('denied'); };
    assert.equal(h.run('forkUiSize()'), 'standard');
});
test('a rewritten compaction caption is restored on release while still shown', () => {
    const text = { nodeType: 3, nodeValue: '已压缩 55 条历史记录（约 11725 tokens）' };
    const span = { firstChild: text, childNodes: [text], get textContent() { return text.nodeValue; }, matches: () => true, querySelectorAll: () => [] };
    const h = harness(null, [span]); h.run('var release = installForkCompactionCaptions()');
    assert.equal(text.nodeValue, '已压缩 55 条历史记录（原文约 11,725 tokens）');
    h.run('release()');
    assert.equal(text.nodeValue, '已压缩 55 条历史记录（约 11725 tokens）');
});
test('scroll anchoring listeners are released with the shell', () => {
    const h = harness(); h.run('var release = installForkAccessibility()');
    assert.equal(h.listeners.size, 5);
    h.run('release()'); assert.equal(h.listeners.size, 0);
});
