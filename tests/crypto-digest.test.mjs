import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { createHash } from 'node:crypto'

import { helperClient } from './fixtures/helper-host-harness.mjs'

for (const [name, html] of [
  ['display', helperClient.buildTavernFrameDocument({ token: 'test', content: '<script>window.cardLoaded=true</script>' })],
  ['executor', helperClient.buildTavernHelperScriptDocument({ token: 'test', scripts: [], context: {} })]
]) test(`${name} frame installs digest before card scripts/dependencies`, async () => {
  const script = html.match(/<script data-dsh-tavern-crypto>([\s\S]*?)<\/script>/)
  assert.ok(script)
  assert.equal(html.indexOf('<script'), html.indexOf('<script data-dsh-tavern-crypto>'))
  const window = { crypto: {} }
  vm.runInNewContext(script[1], { window, ArrayBuffer, Uint8Array, DataView })
  assert.equal(Buffer.from(await window.crypto.subtle.digest('SHA-256', Buffer.from('abc'))).toString('hex'), createHash('sha256').update('abc').digest('hex'))
})
