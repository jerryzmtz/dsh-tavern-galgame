// private fork: an upstream merge once left two identical slot registrations
// (same slot, id and priority), which makes DSH refuse to boot the plugin.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('client registers each slot entry (name, id, priority) only once', () => {
  const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8') + readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-ui/lib/client.js', import.meta.url), 'utf8')
  const seen = new Map()
  for (const match of source.matchAll(/slots\.register\(\s*\{\s*name:\s*"([^"]+)",\s*id:\s*"([^"]+)"([^}]*)\}/g)) {
    const priority = /priority:\s*(-?\d+)/.exec(match[3])?.[1] ?? '0'
    const key = `${match[1]} | ${match[2]} | ${priority}`
    seen.set(key, (seen.get(key) || 0) + 1)
  }
  assert.ok(seen.size > 0)
  const duplicates = [...seen].filter(([, count]) => count > 1).map(([key]) => key)
  assert.deepEqual(duplicates, [])
})
