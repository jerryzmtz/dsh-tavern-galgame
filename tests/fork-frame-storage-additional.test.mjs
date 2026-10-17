// private fork: guard the production owner's capability plumbing (AR-001).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from './fixtures/client-vm.mjs' // private fork: foreground document fixture

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
let descriptor
vm.runInNewContext(source, { window: { __ModuleLoader__: { load(d) { descriptor = d } } } })
const client = descriptor.factory(() => ({}))

test('AR-001 both document builders inject only the supplied capability and no ambient storage', () => {
  const cap = { namespace: 'dsh-card:%5B%22card%22%2C%22s%22%5D:', token: 'a'.repeat(64), seed: { theme: 'light' } }
  const message = client.buildTavernFrameDocument({ content: '', token: 'helper', frameStorage: cap })
  const script = client.buildTavernHelperScriptDocument({ token: 'helper', scripts: [], context: {}, frameStorage: cap })
  assert.ok(message.includes(JSON.stringify(cap)))
  assert.ok(script.includes('"frameStorage":' + JSON.stringify(cap)))
  assert.doesNotMatch(message.match(/<script data-dsh-tavern-storage>([\s\S]*?)<\/script>/)[1], /parent\.__dshForkFrameStorage/)
  const noGrant = client.buildTavernFrameDocument({ content: '', token: 'helper' })
  assert.doesNotMatch(noGrant, /"token":"a{64}"/)
})
