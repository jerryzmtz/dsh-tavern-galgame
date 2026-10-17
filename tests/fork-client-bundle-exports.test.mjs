import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
// private fork: moved includes must retain the same browser export guard.
import { presentationSourceUrl } from './helpers/presentation-sources.mjs'

// Shared .cjs helpers are inlined into the client bundle, whose plugin factory has its own `module`.
// A bare `module.exports = …` there replaces the plugin's exports (apply/inject) and the client never mounts.
test('shared .cjs helpers only assign module.exports outside the browser', () => {
  const dir = new URL('../tavern-plugin/src/client/', import.meta.url)
  for (const name of readdirSync(dir).filter(name => name.endsWith('.cjs'))) {
    const source = readFileSync(presentationSourceUrl(name), 'utf8')
    for (const line of source.split('\n').filter(line => /module\.exports\s*=/.test(line))) {
      assert.match(line, /typeof window === ['"]undefined['"]/, name + ': ' + line.trim())
    }
  }
})

test('the built client returns the plugin exports (apply) from its factory', () => {
  const src = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const tail = src.slice(src.lastIndexOf('exports.apply = apply'))
  assert.ok(tail.includes('return module.exports'))
  const between = src.slice(src.indexOf('var module = { exports: {} };'), src.lastIndexOf('return module.exports'))
  for (const line of between.split('\n').filter(line => /module\.exports\s*=/.test(line))) {
    assert.match(line, /typeof window === ['"]undefined['"]/, line.trim().slice(0, 120))
  }
})
