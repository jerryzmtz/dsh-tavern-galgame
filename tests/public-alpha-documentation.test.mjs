import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'

const root = new URL('../', import.meta.url)
test('public alpha documentation declares external runtime/voice boundaries and publication status', () => {
  const readme = readFileSync(new URL('README.md', root), 'utf8')
  assert.ok(readme.startsWith('# DSH Tavern Galgame'))
  for (const term of ['kousakayou', 'AGPL', 'Cubism Core', 'Fish', 'Live2D']) assert.ok(readme.includes(term), term)
  assert.equal(JSON.parse(readFileSync(new URL('PUBLIC-EXPORT.json', root), 'utf8')).published, false)
  assert.ok(existsSync(new URL('NOTICE', root)))
  assert.ok(existsSync(new URL('LICENSE', root)))
})

test('public alpha does not include legacy downloadable sample cards or private pack sources', () => {
  for (const name of ['examples/manual-demo/resources.mjs', 'examples/airline-mvu/card.json', 'assets/packs', 'docs/manual/package.mjs']) {
    assert.equal(existsSync(new URL(name, root)), false, name)
  }
  assert.ok(existsSync(new URL('examples/tavern-plugin-hello/index.mjs', root)))
})
