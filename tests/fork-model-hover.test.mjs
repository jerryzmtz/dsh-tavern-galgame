import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-ui/src/fork-model-control.js', import.meta.url), 'utf8');
function setup() {
    const timers = new Map(); let next = 0, opened = false, shows = 0;
    const install = vm.runInNewContext(source + '\ninstallForkModelHover', {
        setTimeout(fn, delay) { assert.equal(delay, 250); timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); }
    });
    function node() {
        const listeners = new Map();
        return { listeners, addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
            emit(type, extra = {}) { listeners.get(type)?.({ currentTarget: this, pointerType: 'mouse', buttons: 0, ...extra }); } };
    }
    const trigger = node(), panel = node(), doc = node();
    panel.matches = () => opened;
    panel.hidePopover = () => { opened = false; panel.emit('toggle', { newState: 'closed' }); };
    const control = install(trigger, panel, () => { opened = true; shows++; }, doc);
    return { trigger, panel, doc, control, timers, open: () => opened, shows: () => shows,
        flush() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } } };
}
test('mouse hover opens once and bridges the trigger-to-panel gap before closing', () => {
    const h = setup();
    h.trigger.emit('pointerenter'); assert.equal(h.open(), true);
    h.trigger.emit('pointerleave'); assert.equal(h.timers.size, 1);
    h.panel.emit('pointerenter'); h.flush(); assert.equal(h.open(), true);
    assert.equal(h.shows(), 1);
    h.panel.emit('pointerleave'); h.flush(); assert.equal(h.open(), false);
    h.control.dispose();
});
test('touch, pen and a held mouse button do not hover-open', () => {
    const h = setup();
    for (const extra of [{ pointerType: 'touch' }, { pointerType: 'pen' }, { buttons: 1 }]) h.trigger.emit('pointerenter', extra);
    assert.equal(h.open(), false); h.control.dispose();
});
test('dragging outside keeps the slider open until pointer release', () => {
    const h = setup(); h.trigger.emit('pointerenter'); h.trigger.emit('pointerleave'); h.panel.emit('pointerenter');
    h.panel.emit('pointerdown'); h.panel.emit('pointerleave'); h.flush(); assert.equal(h.open(), true);
    h.doc.emit('pointerup'); h.flush(); assert.equal(h.open(), false); h.control.dispose();
});
test('click pinning and keyboard interaction prevent hover dismissal', () => {
    for (const keyboard of [false, true]) {
        const h = setup(); h.trigger.emit('pointerenter');
        if (keyboard) h.panel.emit('keydown'); else h.control.pin();
        h.trigger.emit('pointerleave'); h.flush(); assert.equal(h.open(), true); assert.equal(h.control.isHoverOpen(), false);
        h.control.dispose();
    }
});
test('disposal cancels pending dismissal and removes all listeners', () => {
    const h = setup(); h.trigger.emit('pointerenter'); h.trigger.emit('pointerleave'); h.control.dispose(); h.flush();
    assert.equal(h.open(), true); assert.equal(h.timers.size, 0);
    for (const node of [h.trigger, h.panel, h.doc]) assert.equal(node.listeners.size, 0);
});
