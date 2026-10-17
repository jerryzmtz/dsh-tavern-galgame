import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execute = promisify(execFile)
const launcher = fileURLToPath(new URL('../bin/dsh-tavern.mjs', import.meta.url))
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

test('实际 CLI 创建、复用、重启和停止自己的子进程，不修改其他服务', { skip: process.platform === 'win32', timeout: 30000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-lifecycle-'))
  const bin = path.join(root, 'runtime/bin'), profile = path.join(root, 'profiles/tavern')
  await mkdir(bin, { recursive: true })
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), '{}')
  await writeFile(path.join(profile, 'cordis.patch.yml'), '[]')
  const pidFile = path.join(root, 'logs/tavern.pid.json')
  let ownedPid
  t.after(async () => {
    if (ownedPid) { try { process.kill(ownedPid, 'SIGTERM') } catch {} }
    await rm(root, { recursive: true, force: true })
  })
  const reserve = createServer()
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve))
  const port = reserve.address().port
  await new Promise(resolve => reserve.close(resolve))
  const childScript = path.join(root, 'fixture.mjs')
  await writeFile(childScript, `import { createServer } from 'node:http';
const port=Number(process.argv[process.argv.indexOf('--port')+1]);
const server=createServer((req,res)=>res.end('fixture service'));
setTimeout(()=>server.listen(port,'127.0.0.1',()=>console.log('dsh web: http://127.0.0.1:'+port+'/')),1500);
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`)
  await writeFile(path.join(bin, 'dsh'), '#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(childScript)+' "$@"\n', { mode: 0o755 })
  const env = { ...process.env, DSH_HOME: root, DSH_TAVERN_CLI_HOME: root, DSH_TAVERN_PORT: String(port), DSH_TAVERN_NO_OPEN: '1', PATH: bin + path.delimiter + process.env.PATH }
  const run = action => execute(process.execPath, [launcher, action], { env, timeout: 12000 })
  const firstStart = run('start')
  const firstResult = firstStart.catch(error => error)
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ownedPid = JSON.parse(await readFile(pidFile, 'utf8')).pid; break } catch {}
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.ok(ownedPid, 'first starter published its PID before readiness')
  await assert.rejects(execute(process.execPath, [launcher, 'start'], {
    env: { ...env, DSH_TAVERN_START_TIMEOUT: '0.05' }, timeout: 12000
  }), error => error.code === 1 && /启动超时/.test(error.stderr))
  process.kill(ownedPid, 0)
  assert.equal(JSON.parse(await readFile(pidFile, 'utf8')).pid, ownedPid,
    'a timed-out follower must preserve the original starter and its record')
  const secondStart = await run('start')
  assert.match((await firstResult).stdout, /已启动/)
  assert.match(secondStart.stdout, /正在等待已有 DSH Tavern/)
  assert.match(secondStart.stdout, /已经在运行/)
  assert.equal(JSON.parse(await readFile(pidFile, 'utf8')).pid, ownedPid)
  ownedPid = JSON.parse(await readFile(pidFile, 'utf8')).pid
  assert.notEqual(ownedPid, process.pid)
  assert.match((await run('start')).stdout, /已经在运行/)
  assert.equal(JSON.parse(await readFile(pidFile, 'utf8')).pid, ownedPid)
  assert.match((await run('status')).stdout, /运行/)
  assert.match((await run('restart')).stdout, /已启动/)
  const restartedPid = JSON.parse(await readFile(pidFile, 'utf8')).pid
  assert.notEqual(restartedPid, ownedPid)
  ownedPid = restartedPid
  assert.match((await run('stop')).stdout, /已停止/)
  ownedPid = undefined
  await assert.rejects(readFile(pidFile), { code: 'ENOENT' })
  assert.match((await run('stop')).stdout, /已停止/)
  // The real start command must clean up its detached child before it fails.
  await writeFile(childScript, `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(path.join(root, 'slow.pid'))}, String(process.pid));
setInterval(()=>{},1000);
`)
  await assert.rejects(execute(process.execPath, [launcher, 'start'], {
    env: { ...env, DSH_TAVERN_START_TIMEOUT: '0.3' }, timeout: 12000
  }), error => error.code === 1 && /启动超时/.test(error.stderr))
  const slowPid = Number(await readFile(path.join(root, 'slow.pid'), 'utf8'))
  assert.throws(() => process.kill(slowPid, 0), {code:'ESRCH'})
  await assert.rejects(readFile(pidFile), {code:'ENOENT'})
  const other = createServer((_req, res) => res.end('other service'))
  await new Promise(resolve => other.listen(port, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => other.close(resolve)))
  await assert.rejects(run('start'), error => error.code === 1 && /拒绝启动/.test(error.stderr))
  await assert.rejects(run('stop'), error => error.code === 1 && /拒绝停止/.test(error.stderr))
  assert.equal(await (await fetch('http://127.0.0.1:'+port)).text(), 'other service')
})
