import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnGuarded } from '../scripts/test-guard.mjs'
import { acquireAffectedSlot, semaphoreDirectory } from '../scripts/test-run-semaphore.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
function temporary(t) {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
  const dir = fs.mkdtempSync(path.join(root, '.tmp', 'memory-guard-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
async function waitFor(predicate) {
  const end = Date.now() + 15000
  while (!predicate()) { if (Date.now() > end) throw Error('probe did not become ready'); await delay(20) }
}

test('Windows jobs bound external memory and kill blocked tests and their descendants', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const dir = temporary(t)
  const run = (name, source, options = {}) => spawnGuarded(process.execPath, ['-e', source], {
    cwd: root, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' },
    stdio: ['ignore', 'pipe', 'pipe'], statusFile: path.join(dir, name + '.json'), ...options,
  })
  // Even a broken guard cannot allocate more than 1.5 GiB. Main stays synchronous.
  const hog = run('hog', `const held=[]; for(let i=0;i<48;i++) {
    const bytes=new Uint8Array(new ArrayBuffer(32*1024**2)); bytes.fill(1); held.push(bytes);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15);
  } console.log('HOG_SURVIVED');`, { memoryMb: 1024, timeoutMs: 15000 })
  let log = ''
  hog.stdout.on('data', chunk => { log += chunk })
  hog.stderr.on('data', chunk => { log += chunk })
  const memory = await hog.completed
  assert.equal(memory.memoryExceeded, true, JSON.stringify(memory))
  assert.equal(memory.code, 125)
  assert.ok(memory.guard.peakJobBytes <= 1024 ** 3)
  assert.ok(memory.guard.peakJobBytes > 800 * 1024 ** 2)
  assert.ok(!log.includes('HOG_SURVIVED'))
  assert.ok(!alive(memory.guard.pid))
  console.log('bounded ArrayBuffer probe:', JSON.stringify(memory.guard))

  const pidFile = path.join(dir, 'grandchild.json')
  const source = `const {spawn}=require('node:child_process'),fs=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({parent:process.pid,child:child.pid}));
    while(true) {}`
  const blocked = run('timeout', source, { timeoutMs: 1500 })
  blocked.stdout.resume(); blocked.stderr.resume()
  const timeout = await blocked.completed
  const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'))
  assert.equal(timeout.timedOut, true, JSON.stringify(timeout))
  assert.equal(timeout.code, 124)
  await waitFor(() => !alive(pids.parent) && !alive(pids.child))

  fs.unlinkSync(pidFile)
  const abandoned = run('helper-killed', source)
  abandoned.stdout.resume(); abandoned.stderr.resume()
  await waitFor(() => fs.existsSync(pidFile))
  const abandonedPids = JSON.parse(fs.readFileSync(pidFile, 'utf8'))
  abandoned.kill('SIGKILL')
  const killed = await abandoned.completed
  assert.equal(killed.guardError, true)
  await waitFor(() => !alive(abandonedPids.parent) && !alive(abandonedPids.child))
  fs.unlinkSync(pidFile)
  const parentSource = `import fs from 'node:fs'; import {spawnGuarded} from ${JSON.stringify(pathToFileURL(path.join(root, 'scripts/test-guard.mjs')).href)};
    spawnGuarded(process.execPath,['-e',${JSON.stringify(source)}],{cwd:${JSON.stringify(root)},stdio:'ignore',statusFile:${JSON.stringify(path.join(dir, 'parent-exit.json'))}});
    while(!fs.existsSync(${JSON.stringify(pidFile)})) await new Promise(r=>setTimeout(r,20)); process.exit(0)`
  const parent = spawn(process.execPath, ['--input-type=module', '-e', parentSource], { cwd: root, stdio: 'ignore', timeout: 15000 })
  assert.equal(await new Promise(resolve => parent.once('close', resolve)), 0)
  const orphanPids = JSON.parse(fs.readFileSync(pidFile, 'utf8'))
  // libuv may close its own job first, killing the helper before it can write a receipt.
  await waitFor(() => !alive(orphanPids.parent) && !alive(orphanPids.child))
  if (fs.existsSync(path.join(dir, 'parent-exit.json'))) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'parent-exit.json'), 'utf8')).reason, 'parent-exit')
  }
  console.log('timeout, helper-death and parent-death probes: all child trees terminated')
})

test('affected slots serialize independent processes and release after completion', { timeout: 30000 }, async t => {
  const dir = temporary(t), slots = path.join(dir, 'slots')
  // git-common-dir, unlike cwd, is shared by main and every linked worktree.
  const common = semaphoreDirectory(root)
  assert.equal(common, semaphoreDirectory(path.dirname(path.dirname(common))))
  const releaseA = await acquireAffectedSlot(slots, { slots: 2 })
  const releaseB = await acquireAffectedSlot(slots, { slots: 2 })
  const marker = path.join(dir, 'entered')
  const source = `import fs from 'node:fs'; import {acquireAffectedSlot} from ${JSON.stringify(pathToFileURL(path.join(root, 'scripts/test-run-semaphore.mjs')).href)};
    const release=await acquireAffectedSlot(${JSON.stringify(slots)},{slots:2,pollMs:20});
    try {fs.writeFileSync(${JSON.stringify(marker)},'entered')} finally {release()}`
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] })
  t.after(() => { child.kill(); releaseA(); releaseB() })
  let output = ''
  child.stderr.on('data', value => { output += value })
  const closed = new Promise(resolve => child.once('close', resolve))
  await waitFor(() => output.includes('waiting for an affected-run slot'))
  assert.ok(!fs.existsSync(marker))
  releaseA()
  assert.equal(await closed, 0)
  assert.ok(fs.existsSync(marker))
  assert.equal(fs.readdirSync(slots).length, 1)
  releaseB()
  assert.equal(fs.readdirSync(slots).length, 0)
})
