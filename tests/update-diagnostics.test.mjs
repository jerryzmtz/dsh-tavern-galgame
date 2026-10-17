import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { recordUpdateDiagnostic, readUpdateDiagnostics } from '../bin/update-diagnostics.mjs'

test('更新诊断轮转保留上一份，屏蔽 URL 凭据，写入失败不阻断更新', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-journal-'))
  try {
    await writeFile(path.join(root, 'update-diagnostics.jsonl'), JSON.stringify({ event: 'old', padding: 'x'.repeat(1024 * 1024) }) + '\n')
    recordUpdateDiagnostic(root, { event: 'new', output: 'https://user:secret@example.com/a?token=secret password=secret' })
    const records = readUpdateDiagnostics(root).records
    assert.deepEqual(records.map(r => r.event), ['old', 'new'])
    assert.ok(!JSON.stringify(records).includes('secret'))
    assert.ok((await stat(path.join(root, 'update-diagnostics.jsonl'))).size < 1000)
    const file = path.join(root, 'not-a-directory')
    await writeFile(file, '')
    assert.doesNotThrow(() => recordUpdateDiagnostic(file, { event: 'failed-write' }))
  } finally { await rm(root, { recursive: true, force: true }) }
})
