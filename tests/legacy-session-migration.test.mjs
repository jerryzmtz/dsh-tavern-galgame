import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import { accessSync, readFileSync } from 'node:fs'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { decodeSessionLog, migrateLegacySessionDirectory, prepareLegacySessionBuffer } from '../tavern-plugin/lib/domain/legacy-session-migration.js'

const hostRoot = '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai'
const archiveRoot = path.join(homedir(), // private fork: HOME is absent on Windows.
 '.dsh-tavern/profile-data/tavern/sessions')
const hostReady = readable(path.join(hostRoot, 'dsh-session/package.json'))
const archiveReady = readable(archiveRoot)

test('存档副本迁移后能用 0.1.5-rc.2 打开，原档不变', { skip: !hostReady || !archiveReady, timeout: 180000 }, async t => {
  const require = createRequire(path.join(hostRoot, 'dsh-session/package.json'))
  const version = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8')).version
  assert.equal(version, '0.1.5-rc.2')
  const { sessionFormatCatalog } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-format-catalog')).href)
  const allSources = await walk(archiveRoot)
  const sources = allSources.filter(file => path.basename(file) === 'session.jsonl.zstd')
  const generations = allSources.filter(file => ['session.jsonl.zstd','session.v3.jsonl.zstd'].includes(path.basename(file)))
  assert.ok(sources.length > 0)
  const sourceHashes = new Map(await Promise.all(sources.map(async file => [file, hash(await readFile(file))])))
  const copyRoot = await mkdtemp(path.join(tmpdir(), 'tavern-legacy-sessions-'))
  t.after(() => rm(copyRoot, { recursive: true, force: true }))
  await cp(archiveRoot, copyRoot, { recursive: true })
  // Re-exercise migration even when the live profile has already migrated.
  for (const source of sources) {
    const copied = path.join(copyRoot, path.relative(archiveRoot, source))
    if (readable(copied + '.bak-tavern-premigrate')) await cp(copied + '.bak-tavern-premigrate', copied)
    await rm(path.join(path.dirname(copied), 'session.v3.jsonl.zstd'), { force: true })
  }
  const copyHashes = new Map(await Promise.all(sources.map(async source => {
    const file = path.join(copyRoot, path.relative(archiveRoot, source))
    return [file, hash(await readFile(file))]
  })))
  const summary = await migrateLegacySessionDirectory(copyRoot, sessionFormatCatalog)
  assert.ok(summary.migrated > 0, '没有任何副本完成迁移')
  const copies = (await walk(copyRoot)).filter(file => path.basename(file) === 'session.jsonl.zstd')
  let reopened = 0
  let cleanedUnopenable = 0
  for (const file of copies) {
    const bytes = await readFile(file)
    const prepared = prepareLegacySessionBuffer(bytes, sessionFormatCatalog)
    if (!prepared.ok) {
      assert.equal(hash(bytes), copyHashes.get(file), 'refused archive must retain its exact original bytes')
      assert.equal(readable(path.join(path.dirname(file), 'session.v3.jsonl.zstd')), false, 'unsafe current generation must not be published')
      assert.match(prepared.reason, /压缩摘要和上下文边界/)
      continue
    }
    assert.equal(prepared.changed, false)
    if (!prepared.artifact) {
      // Issue #72 C: illegal source keys stripped, host still cannot open.
      assert.ok(prepared.reason)
      cleanedUnopenable += 1
      continue
    }
    assert.equal(prepared.artifact.header.version, 3)
    reopened += 1
    if (readable(file + '.bak-tavern-premigrate')) {
      const backup = await readFile(file + '.bak-tavern-premigrate')
      const original = prepareLegacySessionBuffer(backup, sessionFormatCatalog)
      assert.equal(original.ok, true)
      if (original.artifact) assert.equal(original.artifact.header.version, 3)
    }
  }
  assert.ok(reopened > 0)
  assert.ok(cleanedUnopenable >= 0)
  // v3-only archives also participate in header repair; do not count them as v0 reopens.
  assert.equal(summary.seen, summary.migrated + summary.unchanged + summary.refused)
  for (const [file, digest] of sourceHashes) assert.equal(hash(await readFile(file)), digest)
  assert.equal(summary.seen, new Set(generations.map(file=>path.dirname(file))).size)
})

function readable(file) {
  try { accessSync(file); return true } catch { return false }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await walk(target, files)
    else files.push(target)
  }
  return files
}

function v0Log(events) {
  return JSON.stringify({ version: 0, id: 'issue-72', createdAt: 1, cwd: '/tmp', isSeeded: false }) + '\n' +
    events.map(event => JSON.stringify(event)).join('\n') + '\n'
}

function chronologyCatalog() {
  const surface = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])
  return {
    createRestore(header) {
      const rows = []
      return {
        decodeRow(event) { rows.push(event) },
        finish() {
          const step = rows.findIndex(event => event.type === 'step/start')
          if (step >= 0 && rows.slice(0, step).some(event => surface.has(event.type))) {
            throw new Error('format v2 surface before first step cannot acquire a system head without changing chronology')
          }
          if (rows.some(event => String(event.type).startsWith('compaction/'))) {
            throw new Error('compaction/summary shadowedRange start must identify an earlier event')
          }
          if (rows.some(event => event.type === 'assistant/message' && event.surfaceOp?.op === 'replace')) {
            throw new Error('assistant/message chunk provenance is not one complete ordered attempt')
          }
          return { header: { ...header, version: 3 }, events: rows, inheritedEventCount: 0 }
        },
      }
    },
  }
}

test('issue #94: unsafe compaction conflicts refuse migration instead of resurrecting history', () => {
  const text = v0Log([
    { type: 'permission/preset', seq: 0, time: 1, data: {} },
    { type: 'user/message', seq: 1, time: 1, surfaceOp: { op: 'append' }, data: { id: 'u0', role: 'user', content: [{ type: 'text', text: '开场' }], source: { kind: 'user', fixedSystemText: 'illegal' } } },
    { type: 'assistant/message', seq: 2, time: 1, surfaceOp: { op: 'append' }, data: { turn: 1, step: 1, message: { id: 'a0', role: 'assistant', content: [{ type: 'text', text: '开场答' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } } },
    { type: 'turn/start', seq: 3, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 4, time: 1, data: { turn: 1, step: 1 } },
    { type: 'user/message', seq: 5, time: 1, surfaceOp: { op: 'append' }, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 6, time: 1, surfaceOp: { op: 'append' }, data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '正文' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } } },
    { type: 'compaction/summary', seq: 7, time: 1, data: { compactionId: 'c1', shadowedRange: { start: 99, end: 99 }, shadowedSeqs: [99] } },
    { type: 'step/end', seq: 8, time: 1, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 9, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  const prepared = prepareLegacySessionBuffer(zstdCompressSync(Buffer.from(text)), chronologyCatalog())
  assert.equal(prepared.ok, false)
  assert.equal(prepared.changed, false)
  assert.match(prepared.reason, /压缩摘要和上下文边界/)
})

test('legacy archives either open safely or refuse without publishing lost compaction boundaries', { skip: !hostReady || !archiveReady, timeout: 120000 }, async () => {
  const require = createRequire(path.join(hostRoot, 'dsh-session/package.json'))
  const { sessionFormatCatalog: catalog } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-format-catalog')).href)
  const surface = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])
  const sources = (await walk(archiveRoot)).filter(file => path.basename(file) === 'session.jsonl.zstd')
  let seen = 0, opened = 0, safelyRefused = 0
  for (const file of sources) {
    const candidate = readable(file + '.bak-tavern-premigrate') ? file + '.bak-tavern-premigrate' : file
    let text
    try { text = decodeSessionLog(await readFile(candidate)) } catch { continue }
    const rows = text.split('\n').filter(Boolean).slice(1).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    const step = rows.findIndex(event => event.type === 'step/start')
    if (step < 0 || !rows.slice(0, step).some(event => surface.has(event.type))) continue
    seen += 1
    const prepared = prepareLegacySessionBuffer(await readFile(candidate), catalog)
    if (prepared.artifact?.header?.version === 3) opened += 1
    else {
      assert.equal(prepared.ok, false)
      assert.equal(prepared.changed, false)
      assert.equal(prepared.artifact, undefined)
      assert.match(prepared.reason, /压缩摘要和上下文边界/)
      assert.ok(rows.some(row => row.type === 'compaction/summary'))
      safelyRefused += 1
    }
  }
  assert.ok(seen > 0, '本地没有 surface-before-step 旧档样本')
  assert.equal(opened + safelyRefused, seen)
})
