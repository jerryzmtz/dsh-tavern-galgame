import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

test('silent Windows startup timeout leaves diagnostics and terminates its child', {skip:process.platform !== 'win32'}, async () => {
 const root = await mkdtemp(path.join(os.tmpdir(),'startup-log-'))
 try {
  const pkg = path.join(root,'runtime/node_modules/@deepseek-ai/dsh')
  await mkdir(pkg,{recursive:true})
  await mkdir(path.join(root,'profiles/tavern'),{recursive:true})
  await writeFile(path.join(root,'profiles/tavern/package.json'),'{}')
  await writeFile(path.join(root,'profiles/tavern/cordis.patch.yml'),'[]')
  await writeFile(path.join(root,'runtime/dsh.cmd'),'@echo off\n')
  await writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.1.5-rc.2',bin:'silent.cjs'}))
  await writeFile(path.join(pkg,'silent.cjs'),'setInterval(()=>{},1000)')
  const result = spawnSync(process.execPath,[fileURLToPath(new URL('../bin/dsh-tavern.mjs',import.meta.url)),'start'],{encoding:'utf8',timeout:15000,env:{...process.env,DSH_TAVERN_HOST:'cli',DSH_TAVERN_CLI_HOME:root,DSH_HOME:root,DSH_TAVERN_PORT:'49387',DSH_TAVERN_START_TIMEOUT:'0.3',DSH_TAVERN_NO_OPEN:'1'}})
  assert.equal(result.status,1,result.stderr)
  assert.match(result.stderr,/启动超时/)
  const logs=(await readFile(path.join(root,'logs/tavern.log'),'utf8')).trim().split('\n').map(JSON.parse)
  assert.ok(logs.find(x=>x.event==='service.starting').node)
  const pid=logs.find(x=>x.event==='service.spawned').pid
  assert.throws(()=>process.kill(pid,0))
  assert.equal(logs.find(x=>x.event==='service.start.failed').portOpen,false)
 } finally {await rm(root,{recursive:true,force:true})}
})

test('Windows installer rejects system directory before creating install files', {skip:process.platform !== 'win32'}, async () => {
 const source=await readFile(new URL('../install.ps1',import.meta.url),'utf8')
 const start=source.indexOf('  $WindowsRoot =')
 const end=source.indexOf('\n  if (-not (Test-Path',start)
 assert.ok(start>0 && end>start)
 const result=spawnSync('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop'; $DshRoot=Join-Path $env:WINDIR 'system32'; "+source.slice(start,end)],{encoding:'utf8'})
 assert.equal(result.status,1)
 assert.match(result.stderr,/system32/)
})
