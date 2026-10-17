import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../tavern-plugin/src/client/runtime/helper-generation-api.js', import.meta.url), 'utf8')
const install = vm.runInNewContext(source + '\ninstallTavernHelperGenerationApi')
function fixture() {
    const calls = [], events = [], w = {eventEmit: async (...args) => {events.push(args)}, console: {error(){}}}
    install({window: w, copy: structuredClone, request(method, args) {return new Promise((resolve, reject) => calls.push({method, args, resolve, reject}))}})
    return {w, calls, events}
}
for (const name of ['generate', 'generateRaw']) test(name + ' returns host result and simulated stream events with one stable ID', async () => {
    const {w, calls, events} = fixture(), config = {user_input: 'hi', generation_id: 'g', should_stream: true}
    const pending = w.TavernHelper[name](config)
    assert.equal(calls[0].method, name === 'generate' ? 'generateTavernHelper' : 'generateTavernHelperRaw')
    assert.deepEqual(calls[0].args.config, config)
    calls[0].resolve({text: 'answer'})
    assert.equal(await pending, 'answer')
    assert.deepEqual(events, [['js_generation_started', 'g'], ['js_stream_token_received_fully', 'answer', 'g'], ['js_stream_token_received_incrementally', 'answer', 'g'], ['js_generation_ended', 'answer', 'g']])
    assert.equal(config.generation_id, 'g')
})

test('cancel APIs dispatch immediately and failed generation settles with end notification', async () => {
    const {w, calls, events} = fixture()
    const pending = w.generate({generation_id: 'g'}), cancel = w.stopGenerationById('g')
    assert.equal(calls[1].method, 'stopTavernHelperGeneration')
    calls[1].resolve({stopped: true}); calls[0].reject(new Error('cancelled'))
    assert.equal(await cancel, true)
    await assert.rejects(pending, /取消/)
    assert.deepEqual(events.at(-1), ['js_generation_ended', '', 'g'])
    const all = w.stopAllGeneration()
    assert.equal(calls[2].method, 'stopAllTavernHelperGeneration')
    calls[2].resolve({stopped: false})
    assert.equal(await all, false)
})
