import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { INVENTORY, pruneInstalledFiles } from '../bin/prune-installed-files.mjs'

async function tree(root, files) {
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), text)
  }
}

test('损坏或恶意的清单不能删到程序目录之外或用户数据', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prune-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = path.join(root, 'app'), source = path.join(root, 'src')
  await tree(source, { 'package.json': '1' })
  await tree(root, { 'outside.txt': 'keep' })
  await tree(app, { 'data/x.json': 'keep', 'node_modules/y.js': 'keep', [INVENTORY]: ['../outside.txt', '/etc/hosts', 'data/x.json', 'node_modules/y.js', 'a/../../outside.txt', 'C:/x', 'bin\\x'].join('\n') })
  assert.deepEqual(pruneInstalledFiles(source, app), [])
  for (const kept of ['outside.txt', 'app/data/x.json', 'app/node_modules/y.js']) assert.ok(existsSync(path.join(root, kept)), kept)
})
