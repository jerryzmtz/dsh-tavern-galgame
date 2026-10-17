import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const modulePath = fileURLToPath(new URL('../bin/installation-state.cjs', import.meta.url))
const { acquireInstallation, readInstallation, requestCancellation, cancellationRequested, releaseStoppedInstallation } = createRequire(import.meta.url)(modulePath)
const root = fileURLToPath(new URL('..', import.meta.url))
function home(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'tavern-install-owner-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}
function child(code, args = []) {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['-e', code, modulePath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    process.stdout.on('data', data => { stdout += data })
    process.stderr.on('data', data => { stderr += data })
    process.on('error', reject)
    process.on('close', status => resolve({ status, stdout, stderr, pid: process.pid }))
  })
}

test('explicit same-token nesting joins without releasing or changing the outer owner', t => {
  const dshHome = home(t)
  const outer = acquireInstallation({ dshHome, sourceRoot: '/source', statusFile: '/status' })
  const nested = acquireInstallation({ dshHome, attemptId: outer.attemptId, pid: process.pid + 1 })
  assert.equal(nested.joined, true)
  assert.equal(nested.created, false)
  assert.equal(nested.owner.pid, process.pid)
  nested.update({ state: 'profile', pid: 123, attemptId: 'wrong', generation: 'wrong' })
  assert.equal(outer.owner.pid, process.pid)
  assert.equal(outer.owner.attemptId, outer.attemptId)
  assert.equal(nested.release(), false)
  assert.ok(readInstallation(dshHome))
  assert.equal(outer.release(), true)
  assert.equal(outer.release(), false)
  assert.equal(readInstallation(dshHome), null)
})

test('cancellation survives concurrent progress without metadata read-modify-write loss', async t => {
  const dshHome = home(t)
  const owner = acquireInstallation({ dshHome })
  const progress = child("const m=require(process.argv[1]),h=m.acquireInstallation({dshHome:process.argv[2],attemptId:process.argv[3]});for(let i=0;i<40;i++)h.update({progress:i})", [dshHome, owner.attemptId])
  const cancel = child("const m=require(process.argv[1]);m.requestCancellation(process.argv[2],process.argv[3])", [dshHome, owner.attemptId])
  for (const result of await Promise.all([progress, cancel])) assert.equal(result.status, 0, result.stderr)
  assert.equal(cancellationRequested(dshHome, owner.attemptId), true)
  assert.equal(owner.owner.progress, 39)
  owner.release()
  const successor = acquireInstallation({ dshHome })
  assert.equal(cancellationRequested(dshHome, owner.attemptId), false)
  assert.equal(cancellationRequested(dshHome, successor.attemptId), false)
  assert.throws(() => requestCancellation(dshHome, owner.attemptId), { code: 'INSTALLATION_OWNERSHIP_LOST' })
  assert.throws(() => owner.update({ progress: 99 }), { code: 'INSTALLATION_OWNERSHIP_LOST' })
  assert.equal(successor.owner.progress, undefined)
  successor.release()
})

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`mutation gate retries transient ${code} before recording cancellation`, t => {
    const dshHome = home(t)
    const owner = acquireInstallation({ dshHome })
    const gate = path.join(owner.lockDir, '.mutation')
    const mkdir = fs.mkdirSync
    let attempts = 0
    const mock = t.mock.method(fs, 'mkdirSync', function (directory, ...args) {
      if (directory === gate && ++attempts <= 2) throw Object.assign(new Error('transient gate contention'), { code })
      return mkdir.call(this, directory, ...args)
    })
    requestCancellation(dshHome, owner.attemptId)
    assert.equal(attempts, 3)
    assert.equal(cancellationRequested(dshHome, owner.attemptId), true)
    assert.equal(existsSync(gate), false)
    mock.mock.restore()
    owner.update({ progress: 1 })
    assert.equal(cancellationRequested(dshHome, owner.attemptId), true)
    owner.release()
  })

  test(`persistent mutation gate ${code} remains bounded and preserves its cause`, t => {
    const dshHome = home(t)
    const owner = acquireInstallation({ dshHome })
    const before = readFileSync(path.join(owner.lockDir, 'owner.json'), 'utf8')
    const gate = path.join(owner.lockDir, '.mutation')
    const denied = Object.assign(new Error('persistent gate failure'), { code, path: gate, syscall: 'mkdir' })
    const mkdir = fs.mkdirSync
    let now = Date.now(), attempts = 0
    t.mock.method(Date, 'now', () => now)
    t.mock.method(fs, 'mkdirSync', function (directory, ...args) {
      if (directory === gate) { attempts++; now += 2000; throw denied }
      return mkdir.call(this, directory, ...args)
    })
    assert.throws(() => requestCancellation(dshHome, owner.attemptId), error => error === denied)
    assert.equal(attempts, 3)
    assert.equal(cancellationRequested(dshHome, owner.attemptId), false)
    assert.equal(readFileSync(path.join(owner.lockDir, 'owner.json'), 'utf8'), before)
    assert.equal(existsSync(gate), false)
  })
}

test('mutation gate contention never evicts another holder or runs an unguarded callback', t => {
  const dshHome = home(t)
  const owner = acquireInstallation({ dshHome })
  const gate = path.join(owner.lockDir, '.mutation')
  fs.mkdirSync(gate)
  writeFileSync(path.join(gate, 'token'), 'other-holder')
  const mkdir = fs.mkdirSync
  let now = Date.now(), attempts = 0, called = false
  t.mock.method(Date, 'now', () => now)
  t.mock.method(fs, 'mkdirSync', function (directory, ...args) {
    if (directory === gate) { attempts++; now += 2000 }
    return mkdir.call(this, directory, ...args)
  })
  assert.throws(() => owner.withOwnership(() => { called = true }), { code: 'INSTALLATION_STATE_BUSY' })
  assert.equal(attempts, 3)
  assert.equal(called, false)
  assert.equal(readFileSync(path.join(gate, 'token'), 'utf8'), 'other-holder')
})

test('mutation gate retries recheck ownership before writing after contention', t => {
  const dshHome = home(t)
  const owner = acquireInstallation({ dshHome })
  const gate = path.join(owner.lockDir, '.mutation')
  const filename = path.join(owner.lockDir, 'owner.json')
  const successor = { ...JSON.parse(readFileSync(filename, 'utf8')), generation: 'successor-generation' }
  const mkdir = fs.mkdirSync
  let attempts = 0
  t.mock.method(fs, 'mkdirSync', function (directory, ...args) {
    if (directory === gate) {
      attempts++
      writeFileSync(filename, JSON.stringify(successor))
      throw Object.assign(new Error('transient contention during ownership change'), { code: 'EPERM' })
    }
    return mkdir.call(this, directory, ...args)
  })
  assert.throws(() => owner.update({ progress: 99 }), { code: 'INSTALLATION_OWNERSHIP_LOST' })
  assert.equal(attempts, 1)
  assert.deepEqual(JSON.parse(readFileSync(filename, 'utf8')), successor)
  assert.equal(existsSync(gate), false)
})

test('mutation token write failures fail closed without retrying an acquired gate', t => {
  const dshHome = home(t)
  const owner = acquireInstallation({ dshHome })
  const gate = path.join(owner.lockDir, '.mutation')
  const denied = Object.assign(new Error('cannot publish mutation token'), { code: 'EPERM' })
  const write = fs.writeFileSync, mkdir = fs.mkdirSync
  let attempts = 0, called = false
  t.mock.method(fs, 'mkdirSync', function (directory, ...args) {
    if (directory === gate) attempts++
    return mkdir.call(this, directory, ...args)
  })
  t.mock.method(fs, 'writeFileSync', function (filename, ...args) {
    if (filename === path.join(gate, 'token')) throw denied
    return write.call(this, filename, ...args)
  })
  assert.throws(() => owner.withOwnership(() => { called = true }), error => error === denied)
  assert.equal(attempts, 1)
  assert.equal(called, false)
  assert.equal(existsSync(gate), true)
  assert.equal(readInstallation(dshHome).attemptId, owner.attemptId)
})

test('stopped-owner recovery requires explicit descendant verification and exact generation', async t => {
  const dshHome = home(t)
  const exited = await child('')
  const owner = acquireInstallation({ dshHome, pid: exited.pid })
  owner.retain('Unverified descendants')
  const args = { dshHome, attemptId: owner.attemptId, generation: owner.owner.generation }
  assert.throws(() => releaseStoppedInstallation(args), { code: 'INSTALLATION_UNSAFE' })
  assert.throws(() => releaseStoppedInstallation({ ...args, generation: 'wrong', processesVerifiedStopped: true }), { code: 'INSTALLATION_OWNERSHIP_LOST' })
  assert.equal(releaseStoppedInstallation({ ...args, processesVerifiedStopped: true }), true)
  assert.equal(readInstallation(dshHome), null)
  const active = acquireInstallation({ dshHome })
  assert.throws(() => releaseStoppedInstallation({ dshHome, attemptId: active.attemptId, generation: active.owner.generation, processesVerifiedStopped: true }), { code: 'INSTALLATION_BUSY' })
  active.release()
})

test('CLI lock release is PID and generation fenced; a nested CLI cannot release', t => {
  const dshHome = home(t)
  const first = JSON.parse(execFileSync(process.execPath, [modulePath, 'acquire', '--home', dshHome, '--pid', String(process.pid)], { encoding: 'utf8' }))
  const nested = JSON.parse(execFileSync(process.execPath, [modulePath, 'acquire', '--home', dshHome, '--pid', String(process.pid + 1), '--attempt', first.attemptId], { encoding: 'utf8' }))
  assert.equal(nested.created, false)
  const denied = spawnSync(process.execPath, [modulePath, 'release', '--home', dshHome, '--attempt', first.attemptId, '--generation', first.generation, '--pid', String(process.pid + 1)], { encoding: 'utf8' })
  assert.notEqual(denied.status, 0)
  assert.ok(readInstallation(dshHome))
  execFileSync(process.execPath, [modulePath, 'release', '--home', dshHome, '--attempt', first.attemptId, '--generation', first.generation, '--pid', String(process.pid)])
  assert.equal(readInstallation(dshHome), null)
})

test('standalone Unix bootstrap refuses competing lock before installation mutations', { skip: process.platform === 'win32' }, t => {
  const dshHome = home(t)
  const owner = acquireInstallation({ dshHome })
  writeFileSync(path.join(dshHome, 'settings.yaml'), 'keep: true\n')
  const result = spawnSync('sh', [path.join(root, 'install.sh')], { encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome, DSH_TAVERN_HOST: 'desktop', DSH_TAVERN_INSTALL_ATTEMPT: '' } })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /INSTALLATION_BUSY/)
  for (const name of ['source-cache', 'apps', 'profiles', 'profile-data', '.dsh-tavern-install-root']) assert.equal(existsSync(path.join(dshHome, name)), false, name)
  assert.equal(readFileSync(path.join(dshHome, 'settings.yaml'), 'utf8'), 'keep: true\n')
  assert.equal(readInstallation(dshHome).attemptId, owner.attemptId)
  owner.release()
})

test('standalone installer embeddings are current and ownership precedes persistent writes', () => {
  execFileSync(process.execPath, [path.join(root, 'bin/build-installer-scripts.mjs'), '--check'])
  const unix = readFileSync(path.join(root, 'install.sh'), 'utf8')
  const windows = readFileSync(path.join(root, 'install.ps1'), 'utf8')
  assert.ok(unix.indexOf(' acquire --home ') < unix.indexOf("printf 'cli-v1\\n'"))
  assert.ok(unix.indexOf(' acquire --home ') < unix.indexOf('mkdir -p "$(dirname -- "${SOURCE_CACHE}")"'))
  assert.ok(windows.indexOf('$OwnerJson = & node') < windows.indexOf("Set-Content -LiteralPath (Join-Path $DshRoot '.dsh-tavern-install-root')"))
  assert.ok(windows.indexOf('$OwnerJson = & node') < windows.indexOf('[Environment]::SetEnvironmentVariable'))
})

test('standalone post-download stages use the real process supervisor to bound hung descendants', { skip: process.platform === 'win32' }, t => {
  const dshHome = home(t)
  const owner = acquireInstallation({ dshHome })
  const unix = readFileSync(path.join(root, 'install.sh'), 'utf8')
  const start = unix.indexOf('run_install() {')
  const end = unix.indexOf('# Read the downloaded release', start)
  const body = unix.slice(start, end)
  const result = spawnSync('sh', ['-c', `${body}\nrun_install fixture.hang 100 "$NODE_BINARY" -e 'setInterval(()=>{},1000)'`], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, SOURCE_DIR: root, NODE_BINARY: process.execPath, DSH_HOME: dshHome,
      DSH_TAVERN_INSTALL_ATTEMPT: owner.attemptId, DSH_TAVERN_INSTALL_LOCK: owner.lockDir,
      DSH_TAVERN_INSTALL_PROCESS_DIR: '', DSH_TAVERN_INSTALL_PROCESS_ANCESTORS: '' },
  })
  assert.ifError(result.error)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /超时|timeout|限时/i)
  assert.equal(readInstallation(dshHome).attemptId, owner.attemptId)
  assert.ok(!readInstallation(dshHome).unsafeToRetry)
  owner.release()
})

test('cancellation retries the same logical attempt if adoption rotates its fence', t => {
  const dshHome = home(t)
  const reservation = acquireInstallation({ dshHome, state: 'reserved', pid: 0 })
  const fs = createRequire(import.meta.url)('node:fs')
  const mkdir = fs.mkdirSync
  let updater
  fs.mkdirSync = function (directory, ...args) {
    if (!updater && directory === path.join(reservation.lockDir, '.mutation')) {
      updater = true
      updater = acquireInstallation({ dshHome, attemptId: reservation.attemptId, adopt: true })
    }
    return mkdir.call(this, directory, ...args)
  }
  try { requestCancellation(dshHome, reservation.attemptId) } finally { fs.mkdirSync = mkdir }
  assert.equal(cancellationRequested(dshHome, reservation.attemptId), true)
  updater.release()
})

function age(lockDir, milliseconds) {
  const fs = createRequire(import.meta.url)('node:fs')
  const owner = JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf8'))
  const past = Date.now() - milliseconds
  writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ ...owner, startedAt: past, updatedAt: past }))
  for (const name of ['owner.json', '.']) fs.utimesSync(path.join(lockDir, name), past / 1000, past / 1000)
}

test('a lock whose owner and recorded stage processes all exited is reclaimed', async t => {
  const dshHome = home(t)
  const exited = await child('')
  const abandoned = acquireInstallation({ dshHome, pid: exited.pid })
  abandoned.retain('window closed')
  const stage = path.join(abandoned.lockDir, 'processes', 'stage-1')
  createRequire(import.meta.url)('node:fs').mkdirSync(stage, { recursive: true })
  writeFileSync(path.join(stage, `${exited.pid}.json`), JSON.stringify({ pid: exited.pid, ancestors: [] }))
  age(abandoned.lockDir, 5 * 60 * 1000)
  const successor = acquireInstallation({ dshHome })
  assert.equal(successor.created, true)
  assert.throws(() => abandoned.update({ progress: 1 }), { code: 'INSTALLATION_OWNERSHIP_LOST' })
  successor.release()
})

test('a lock with a live recorded writer stays busy until it is idle past the stale limit', async t => {
  const dshHome = home(t)
  const exited = await child('')
  const abandoned = acquireInstallation({ dshHome, pid: exited.pid })
  const stage = path.join(abandoned.lockDir, 'processes', 'stage-1')
  createRequire(import.meta.url)('node:fs').mkdirSync(stage, { recursive: true })
  writeFileSync(path.join(stage, `${process.pid}.json`), JSON.stringify({ pid: process.pid, ancestors: [] }))
  age(abandoned.lockDir, 5 * 60 * 1000)
  assert.throws(() => acquireInstallation({ dshHome }), error => error.code === 'INSTALLATION_BUSY' && error.message.includes(abandoned.lockDir))
  age(abandoned.lockDir, 2 * 60 * 60 * 1000)
  const successor = acquireInstallation({ dshHome })
  assert.equal(successor.created, true)
  successor.release()
})

test('a fresh lock with a dead owner is not reclaimed during the startup grace period', async t => {
  const dshHome = home(t)
  const exited = await child('')
  const owner = acquireInstallation({ dshHome, pid: exited.pid })
  assert.throws(() => acquireInstallation({ dshHome }), { code: 'INSTALLATION_BUSY' })
  assert.equal(readInstallation(dshHome).attemptId, owner.attemptId)
})

test('an interrupted bootstrap whose shell is still open is reclaimed once its stages exited', async t => {
  // install.ps1 runs inside the user's PowerShell; after Ctrl+C that owner PID stays alive.
  const dshHome = home(t)
  const exited = await child('')
  const interrupted = acquireInstallation({ dshHome, pid: process.pid })
  const stage = path.join(interrupted.lockDir, 'processes', 'stage-1')
  createRequire(import.meta.url)('node:fs').mkdirSync(stage, { recursive: true })
  writeFileSync(path.join(stage, `${process.pid}.json`), JSON.stringify({ pid: process.pid, ancestors: [] }))
  interrupted.retain('Bootstrap interrupted', { ownerDone: true })
  assert.throws(() => acquireInstallation({ dshHome }), { code: 'INSTALLATION_BUSY' })
  writeFileSync(path.join(stage, `${process.pid}.json`), JSON.stringify({ pid: exited.pid, ancestors: [] }))
  const successor = acquireInstallation({ dshHome })
  assert.equal(successor.created, true)
  successor.release()
})

test('a retained lock without ownerDone still treats a live owner as a writer', async t => {
  const dshHome = home(t)
  const owner = acquireInstallation({ dshHome, pid: process.pid })
  owner.retain('nested profile cleanup unverified')
  age(owner.lockDir, 5 * 60 * 1000)
  assert.throws(() => acquireInstallation({ dshHome }), { code: 'INSTALLATION_BUSY' })
})
