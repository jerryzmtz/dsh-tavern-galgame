import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { auditUpstream } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/audit.mjs'

test('上游文件遭修改时校验失败，不接受修改后的文件', async t => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-upstream-audit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'source')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(directory)
  await writeFile(join(directory, 'LICENSE'), 'original')
  const lockFile = join(root, 'lock.json')
  await writeFile(lockFile, JSON.stringify({ files: { LICENSE: createHash('sha256').update('original').digest('hex') } }))
  await auditUpstream({ directory, lockFile })
  await writeFile(join(directory, 'LICENSE'), 'changed')
  await assert.rejects(auditUpstream({ directory, lockFile }), /integrity mismatch/)
})
