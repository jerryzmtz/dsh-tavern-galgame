import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const source = read('tavern-plugin/packages/dsh-tavern-ui/src/fork-model-control.js');
const api = vm.runInNewContext(source + '\n({forkModelChoices,forkModelSelection,forkEffortOptions,createForkModelSelectionQueue,installForkModelControl})');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const select = (model = 'opus', reasoningEffort = 'max') => ({ provider: 'router', model, reasoningEffort });

test('effort choices come only from exact model metadata; no synthetic default stop is added', () => {
    assert.deepEqual(plain(api.forkEffortOptions(undefined)), []);
    assert.deepEqual(plain(api.forkEffortOptions({ efforts: [] })), []);
    const reasoning = { efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }] };
    assert.deepEqual(plain(api.forkEffortOptions(reasoning)), [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }, { value: 'max', label: 'Max' }]);
    assert.equal(api.forkEffortOptions({ ...reasoning, defaultEffort: 'high' }).length, 3);
});

test('switching model uses its own default and never carries unsupported prior effort', () => {
    const state = { groups: [{ id: 'router', models: [{ id: 'flash', reasoning: { defaultEffort: 'medium' } }, { id: 'opus' }] }] };
    const choices = api.forkModelChoices(state);
    assert.deepEqual(plain(api.forkModelSelection(choices[0])), { provider: 'router', model: 'flash', reasoningEffort: 'medium' });
    assert.deepEqual(plain(api.forkModelSelection(choices[1])), { provider: 'router', model: 'opus' });
});

test('declared Low reset is explicit, with no extra default stop or decorative glyph', () => {
    for (const id of ['opus', 'gemini-3.8-flash']) {
        const reasoning = { defaultEffort: 'low', efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }] };
        assert.equal(api.forkModelSelection({ group: { id: 'nienrouter' }, model: { id, reasoning } }).reasoningEffort, 'low');
        assert.equal(api.forkEffortOptions(reasoning)[0].label, 'Low');
        assert.equal(api.forkEffortOptions(reasoning).length, 3);
    }
    assert.doesNotMatch(source, /fork-model-bolt|ϟ|↶|label: "默认"/);
    assert.match(source, /className: "fork-model-reset"[\s\S]+h\("svg"/);
    assert.match(source, /reasoning\.defaultEffort === undefined, onClick: reset/);
});

test('rapid selection serializes host writes and retains only the latest complete pair', async () => {
    const calls = [], updates = [], pending = [];
    const queue = api.createForkModelSelectionQueue(value => { calls.push(plain(value)); const d = deferred(); pending.push(d); return d.promise; }, value => updates.push(plain(value)));
    queue.select(select('opus', 'low'));
    queue.select(select('opus', 'max'));
    queue.select(select('flash', 'high'));
    queue.select(select('flash', 'high'));
    assert.deepEqual(calls, [select('opus', 'low')]);
    assert.equal(updates.length, 3);
    pending[0].resolve(true); await tick();
    assert.deepEqual(calls, [select('opus', 'low'), select('flash', 'high')]);
    assert.equal(updates.at(-1).pending, true);
    pending[1].resolve(true); await tick();
    assert.equal(updates.at(-1).pending, false);
    assert.equal(updates.at(-1).selection, null);
});

test('failed selection reports an actionable error, permits retry, and does not interrupt later choices', async () => {
    const updates = [], first = deferred(); let count = 0;
    const queue = api.createForkModelSelectionQueue(() => ++count === 1 ? first.promise : Promise.resolve(true), value => updates.push(plain(value)));
    queue.select(select()); first.reject(new Error('connection lost')); await tick();
    assert.match(updates.at(-1).error, /connection lost/);
    assert.deepEqual(updates.at(-1).retry, select());
    queue.select(updates.at(-1).retry); await tick();
    assert.equal(updates.at(-1).error, '');
    const next = api.createForkModelSelectionQueue(() => Promise.resolve(false), value => updates.push(plain(value)));
    next.select(select()); await tick();
    assert.match(updates.at(-1).error, /重试/);
});

test('disposed session drops queued writes and ignores an old request result', async () => {
    const pending = deferred(), calls = [], updates = [];
    const queue = api.createForkModelSelectionQueue(value => { calls.push(value); return pending.promise; }, value => updates.push(value));
    queue.select(select('opus', 'low')); queue.select(select('flash', 'high'));
    queue.dispose(); const count = updates.length; pending.resolve(true); await tick();
    queue.select(select());
    assert.equal(calls.length, 1); assert.equal(updates.length, count);
});

test('model seat reuses host directory and declines addressed subagent writes', async () => {
    let registration, registeredComponent, available = true; const calls = [];
    const directory = { store: {}, load: () => Promise.resolve(), select: value => { calls.push(value); return Promise.resolve(); } };
    const scope = { slots: { inject: (_, fn) => fn(), register: (options, component) => { registration = options; registeredComponent = component; return () => {}; } },
        sessions: { subagentAddress: () => available ? undefined : {} }, modelDirectories: { directoryFor: () => directory } };
    api.installForkModelControl(scope);
    assert.equal(registration.name, 'conversation.input.model'); assert.equal(registration.priority, -1);
    assert.equal(registeredComponent.name, 'ForkModelControl');
    const props = registration.inject('session');
    assert.equal(props.directory, directory.store);
    await props.select(select()); assert.equal(calls.length, 1);
    available = false;
    assert.equal(await registration.inject('child').select(select()), false); assert.equal(calls.length, 1);
    const main = read('tavern-plugin/src/client/main.js');
    assert.match(main, /const inject = \[[^\n]*"remote.session"[^\n]*"modelDirectories"/);
});

test('highest effort animates on the track and remains animated with reduced motion', () => {
    const css = read('tavern-plugin/packages/dsh-tavern-ui/src/shell.css');
    assert.match(css, /fork-effort-slider\[data-max="true"\]::before[^\n]*linear-gradient[^\n]*animation: fork-effort-flow/);
    assert.match(css, /prefers-reduced-motion: reduce[^\n]*animation-duration: 6s/);
    assert.match(source, /onPointerCancel/); assert.match(source, /onKeyUp/);
    assert.doesNotMatch(source, /abort\(|\.stop\(/);
});
