// Asset-only phase 0 contracts. The image-generation extraction was cancelled.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, relative, dirname } from 'node:path'
import { parse } from 'acorn'

import { ZIP_LIMITS, zipPath } from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
const root = resolve('tavern-plugin')
async function files(dir) {
  return (await Promise.all((await readdir(dir, {withFileTypes:true})).filter(e => !['node_modules', '.git', 'vendor'].includes(e.name)).map(e => e.isDirectory() ? files(resolve(dir, e.name)) : resolve(dir, e.name)))).flat()
}
function importSpecifiers(node) {
  if (!node || typeof node !== 'object') return []
  const source = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) ? node.source
    : node.type === 'CallExpression' && node.callee.name === 'require' ? node.arguments[0] : null
  return [...(typeof source?.value === 'string' ? [source.value] : []), ...Object.values(node).flatMap(importSpecifiers)]
}
test('asset package cannot import Tavern or another package private implementation', async () => {
  for (const file of await files(root)) {
    if (!/\.(?:[cm]?js|tsx?)$/.test(file) || /[\\/](tests|lib[\\/]types)[\\/]/.test(file)) continue
    const own = relative(root, file).replaceAll('\\', '/'), owner = own.match(/^packages\/([^/]+)/)?.[1] || 'tavern'
    const source = await readFile(file, 'utf8')
    // Build transforms may contain require literals; only actual JS imports/calls cross a boundary.
    const specs = /\.[cm]?js$/.test(file)
      ? importSpecifiers(parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true }))
      : [...source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map(match => match[1])
    for (const spec of specs) {
      const target = spec.startsWith('.') ? relative(root, resolve(dirname(file), spec)).replaceAll('\\', '/') : spec
      if (owner === 'dsh-asset-library' && spec.startsWith('.')) assert.ok(target.startsWith('packages/dsh-asset-library/'), `${own}: ${spec}`)
      const privateOwner = target.match(/^(?:packages\/)?(dsh-[^/]+)\/src\//)?.[1]
      if (privateOwner === 'dsh-asset-library' || owner === 'dsh-asset-library' && privateOwner) assert.equal(privateOwner, owner, `${own}: ${spec}`)
    }
  }
})

test('portable paths and ZIP limits freeze before transport extraction', () => {
  assert.deepEqual(ZIP_LIMITS, {entries:20000, entrySize:512 * 1024 ** 2, totalSize:2 * 1024 ** 3, ratio:200})
  for (const name of ['CREDITS.md', 'voices/v/voice.json', 'voices/v/default.wav', 'voices/v/default.txt', 'voices/readings.json']) assert.equal(zipPath(name), name)
  for (const name of ['../card.json', 'voices/CON.txt', 'a:b', 'a\\b', '/a', 'a.']) assert.throws(() => zipPath(name))
})
