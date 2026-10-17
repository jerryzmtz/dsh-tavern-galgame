import assert from 'node:assert/strict'
import test from 'node:test'
import { startupTimeoutMs, waitForServiceStartup } from '../bin/service-startup.mjs'

test('Android 冷启动超过 30 秒仍等待就绪，配置按秒解析', async () => {
  assert.equal(startupTimeoutMs('android', undefined),120000)
  assert.equal(startupTimeoutMs('cli', undefined),120000)
  assert.equal(startupTimeoutMs('android','180'),180000)
  for (const value of ['0','-1','oops','Infinity']) assert.throws(()=>startupTimeoutMs('android',value))
  let now=0, stopped=false
  await waitForServiceStartup({timeoutMs:startupTimeoutMs('android'), now:()=>now, sleep:async ms=>{now+=ms}, alive:()=>true, ready:async()=>now>=32000, stop:async()=>{stopped=true}})
  assert.equal(now,32000);assert.equal(stopped,false)
})

test('超时清理真实子进程后才返回失败', async () => {
  const { spawn } = await import('node:child_process')
  const { once } = await import('node:events')
  const { stopStartupChild } = await import('../bin/service-startup.mjs')
  const child = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})
  await once(child,'spawn')
  try {
    await assert.rejects(waitForServiceStartup({timeoutMs:30,alive:()=>child.exitCode===null && child.signalCode===null,ready:async()=>false,stop:()=>stopStartupChild(child)}),/启动超时/)
    assert.ok(child.exitCode!==null || child.signalCode!==null)
  } finally { if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL') }
})

// private fork: bash cannot inspect the Windows process table used by this rollback guard.
test('安装回滚遇到活进程保留新旧源码；确认无进程才恢复旧源码', { skip: process.platform === 'win32' ? 'Requires POSIX process and shell semantics' : false }, async t => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const root = await mkdtemp(tmpdir()+'/tavern-rollback-')
  t.after(()=>rm(root,{recursive:true,force:true}))
  for(const dir of ['app','temp/previous-source','logs']) await mkdir(root+'/'+dir,{recursive:true})
  await writeFile(root+'/app/version','new'); await writeFile(root+'/temp/previous-source/version','old')
  await writeFile(root+'/logs/tavern.pid.json',JSON.stringify({pid:process.pid}))
  const source = await readFile(new URL('../android/setup.sh',import.meta.url),'utf8')
  const body = source.slice(source.indexOf('rollback_source() {'),source.indexOf('\ninstall_from_tarball()'))
  const script = 'DSH_ROOT="$1"; APP_DIR="$1/app"; TEMP_ROOT="$1/temp"; SOURCE_BACKUP="$1/temp/previous-source"; SOURCE_SWAPPED=1\n'+body+'\nrollback_source'
  await assert.rejects(promisify(execFile)('bash',['-c',script,'test',root]))
  assert.equal(await readFile(root+'/app/version','utf8'),'new')
  assert.equal(await readFile(root+'/temp/previous-source/version','utf8'),'old')
  await rm(root+'/logs/tavern.pid.json')
  await promisify(execFile)('bash',['-c',script,'test',root])
  assert.equal(await readFile(root+'/app/version','utf8'),'old')
})

test('slow startup reports once that the service is still initializing', async () => {
  let now = 0, notices = 0
  await waitForServiceStartup({ timeoutMs: startupTimeoutMs('cli', undefined), now: () => now, sleep: async ms => { now += ms }, alive: () => true, ready: async () => now >= 40000, onSlow: () => { notices += 1 }, stop: async () => {} })
  assert.equal(notices, 1)
})
