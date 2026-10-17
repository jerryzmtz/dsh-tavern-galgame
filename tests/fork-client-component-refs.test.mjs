import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Every Fork* component rendered in the bundle must be declared at statement level (a named class expression inside a factory does not count); a rename that misses a
// call site only fails at render time (the stage then crashes on entry and its slot stays dead).
test('Fork* components rendered by the client bundle are all declared', () => {
  const src = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const used = new Set([...src.matchAll(/\b(?:h|createElement)\((Fork[A-Z]\w*)\s*,/g)].map(match => match[1]))
  const missing = [...used].filter(name => !new RegExp('(?:^|\\n)\\s*(?:export\\s+)?(?:function|class|const|let|var)\\s+' + name + '\\b').test(src))
  assert.deepEqual(missing, [])
})
