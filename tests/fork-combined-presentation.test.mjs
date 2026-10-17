// private fork: assert the extracted native service/retained stage owner contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assembleTavernClient } from '../bin/build-tavern-client.mjs'
const client = await assembleTavernClient()
test('combined bundle has both source modules and both stylesheet layers exactly once', () => {
  for (const marker of ['function useForkWidgetStage(', 'function forkSpriteBundle(', 'function forkSpriteManifest(']) {
    assert.equal(client.split(marker).length - 1, 1, marker)
  }
  assert.doesNotMatch(client, /function forkSpriteImport\(/)
  // private fork: the generic source widget replaces the built-in phone renderer.
  assert.doesNotMatch(client, /function useForkGalPhone\(/)
  assert.ok(client.includes('.fork-widget-source-controls'))
  assert.ok(client.includes('.fork-sprite-surface {'))
  assert.doesNotMatch(client, /^<{7}|^={7}|^>{7}/m)
})
test('committed generated target equals the joint normal build output', async () => {
  assert.equal(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), client)
})
