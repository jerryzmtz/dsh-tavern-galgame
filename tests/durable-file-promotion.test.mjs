import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDurableFilePromotion } from '../tavern-plugin/lib/durable-file-promotion.js'

test('任意文件在 Windows promotion 失败后都从 pending 恢复最新内容', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'bindings.json')
  await createDurableFilePromotion().write(target, 'old')
  const locked = createDurableFilePromotion({
    platform: 'win32',
    rename: async function () { const error = new Error('locked'); error.code = 'EPERM'; throw error },
    sleep: async function () {}
  })

  const result = await locked.write(target, 'new')

  assert.equal(result.status, 'deferred')
  assert.equal((await readFile(target, 'utf8')), 'old')
  assert.equal((await createDurableFilePromotion().read(target)).toString('utf8'), 'new')
  assert.equal((await readdir(root)).some(function (name) { return name.startsWith('bindings.json.pending-') }), true)
})

test('结构损坏的写入锁不会永久阻断资源', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'card.json')
  await writeFile(target + '.write-lock', JSON.stringify({ kind: 'mistaken-card-workspace', raw: { pid: process.pid } }))

  await createDurableFilePromotion().write(target, 'recovered')

  assert.equal(await readFile(target, 'utf8'), 'recovered')
  assert.equal((await readdir(root)).includes('card.json.write-lock'), false)
})

test('超过安全期限的写锁即使 PID 存活也会被回收', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'card.json')
  await writeFile(target, '{}')
  await writeFile(target + '.write-lock', JSON.stringify({ pid: process.pid, writerId: 'old-writer', createdAt: Date.now() - 120_000 }) + '\n')

  await createDurableFilePromotion({ writerId: 'writer-b' }).write(target, '{"saved":true}')

  assert.equal((await readFile(target, 'utf8')), '{"saved":true}')
})
