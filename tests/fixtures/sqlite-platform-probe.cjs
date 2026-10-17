// Standalone compatibility probe: no dependencies and no access to Tavern data.
// Run with the SAME executable/environment that hosts Tavern:
//   node tests/fixtures/sqlite-platform-probe.cjs [writable-directory]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { Worker } = require('node:worker_threads')

const payload = JSON.stringify({ text: '中文 🐉 café', variables: { hp: 42 }, large: '变量'.repeat(100000) })
const hash = value => createHash('sha256').update(value).digest('hex')
const runtime = { node: process.versions.node, electron: process.versions.electron || null,
  sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch }

function open(filename) {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=100; PRAGMA synchronous=FULL;')
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2)
  return db
}

function child(phase, filename, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [__filename, '--phase', phase, filename], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
  })
  assert.ifError(result.error)
  assert.equal(result.status, expectedStatus, `${phase}: ${result.stderr}\n${result.stdout}`)
  return result.stdout.trim()
}

function phase(name, filename) {
  const db = open(filename)
  if (name === 'write') {
    assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal')
    db.exec('CREATE TABLE chat(id TEXT PRIMARY KEY, body TEXT NOT NULL, bytes BLOB, big INTEGER) STRICT; CREATE TABLE floor(id INTEGER PRIMARY KEY, chat_id TEXT REFERENCES chat(id)) STRICT; PRAGMA user_version=1;')
    db.exec('BEGIN IMMEDIATE')
    db.prepare('INSERT INTO chat VALUES (?, ?, ?, ?)').run('中文/聊天', payload, Buffer.from([0, 127, 255]), 9007199254740993n)
    db.prepare('INSERT INTO floor VALUES (?, ?)').run(1, '中文/聊天')
    db.exec('COMMIT')
    assert.throws(() => db.prepare('INSERT INTO floor VALUES (?, ?)').run(2, 'missing'), /FOREIGN KEY/)
    db.exec('BEGIN IMMEDIATE')
    db.prepare('UPDATE chat SET body=?').run('rolled back')
    db.exec('ROLLBACK')
    assert.equal(db.prepare('SELECT body FROM chat').get().body, payload)
  } else if (name === 'locked') {
    assert.throws(() => db.prepare('UPDATE chat SET body=?').run('conflicting writer'), /locked/)
    assert.equal(db.prepare('SELECT body FROM chat').get().body, payload)
  } else if (name === 'crash') {
    // A committed WAL write must survive process exit without db.close().
    db.prepare('INSERT INTO floor VALUES (?, ?)').run(3, '中文/聊天')
    db.exec('BEGIN IMMEDIATE')
    db.prepare('UPDATE chat SET body=?').run('uncommitted at process exit')
    process.exit(23)
  } else if (name === 'read') {
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1)
    const query = db.prepare('SELECT * FROM chat')
    query.setReadBigInts(true)
    const row = query.get()
    assert.equal(row.body, payload)
    assert.equal(row.big, 9007199254740993n)
    assert.deepEqual(Buffer.from(row.bytes), Buffer.from([0, 127, 255]))
    assert.equal(db.prepare('SELECT count(*) AS n FROM floor').get().n, 2)
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    console.log(hash(row.body))
  } else throw new Error(`Unknown phase: ${name}`)
  db.close()
}

async function main() {
  if (process.argv[2] === '--phase') return phase(process.argv[3], process.argv[4])
  const checks = []
  let directory
  try {
    directory = fs.mkdtempSync(path.join(path.resolve(process.argv[2] || os.tmpdir()), 'tavern-sqlite-'))
    const filename = path.join(directory, '中文 database.sqlite')
    child('write', filename)
    checks.push('wal-file-write', 'unicode-json-blob-bigint', 'foreign-key', 'transaction-rollback')
    const db = open(filename)
    try {
      db.exec('BEGIN IMMEDIATE')
      child('locked', filename)
      db.exec('ROLLBACK')
    } finally { db.close() }
    checks.push('cross-process-lock-and-reader')
    child('crash', filename, 23)
    assert.equal(child('read', filename), hash(payload))
    checks.push('reopen-persistence', 'exit-without-close-recovery', 'integrity-check')
    await new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { argv: ['--phase', 'read', filename], stdout: true, stderr: true })
      let output = '', errors = ''
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker timed out')) }, 30000)
      worker.stdout.on('data', chunk => { output += chunk })
      worker.stderr.on('data', chunk => { errors += chunk })
      worker.on('error', error => { clearTimeout(timer); reject(error) })
      worker.on('exit', code => {
        clearTimeout(timer)
        try { assert.equal(code, 0, errors); assert.equal(output.trim(), hash(payload)); resolve() }
        catch (error) { reject(error) }
      })
    })
    checks.push('worker-thread')
    console.log(JSON.stringify({ ok: true, runtime, checks, payloadSha256: hash(payload),
      probeSha256: hash(fs.readFileSync(__filename)) }, null, 2))
  } catch (error) {
    console.log(JSON.stringify({ ok: false, runtime, checks, error: error.stack }, null, 2))
    process.exitCode = 1
  } finally {
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
