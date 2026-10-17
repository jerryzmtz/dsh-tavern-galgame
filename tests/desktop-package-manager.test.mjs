import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import os from 'node:os';import path from 'node:path'
import {prepareDesktopPackageManager} from '../bin/desktop-package-manager.mjs'

test('Windows Desktop rejects unverified downloaded executables',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'desktop-package-'))
 try{
 const entry=path.join(home,'pnpm.mjs');await writeFile(entry,'')
 const progress=[]
 await assert.rejects(prepareDesktopPackageManager({host:'desktop',platform:'win32',arch:'x64',home,entry,onProgress:message=>progress.push(message),fetch:async()=>new Response('not-node')}),/SHA-256/)
 assert.ok(progress.some(message=>/已下载.*MB/.test(message)), 'download byte progress must be visible before checksum validation')
 }finally{await rm(home,{recursive:true,force:true})}
})

test('Desktop uses its declared pnpm entry and retries failed downloads with the underlying cause', async () => {
 const home = await mkdtemp(path.join(os.tmpdir(), 'desktop-retry-'))
 try {
  const entry = path.join(home, 'pnpm.mjs'); await writeFile(entry, '')
  let attempts = 0
  const urls = []
  const progress = []
  const cause = new Error('connection reset')
  await assert.rejects(prepareDesktopPackageManager({
   host: 'desktop', platform: 'win32', arch: 'x64',
   env: { DSH_HOME: home, DSH_DESKTOP_PNPM_ENTRY: entry, DSH_DESKTOP_APP_EXECUTABLE: path.join(home, 'other-layout', 'Desktop.exe') },
   fetch: async url => { urls.push(url); attempts++; throw cause }, onProgress: text => progress.push(text),
  }), error => error.cause === cause && /3/.test(error.message))
  assert.equal(attempts, 3)
  assert.equal(progress.filter(message=>message.startsWith('正在下载')).length, 3)
  assert.ok(progress.some(message=>message.includes('connection reset')&&message.includes('重试')), 'network failure must explain the fallback')
  assert.equal(new URL(urls[0]).hostname, 'npmmirror.com')
  assert.ok(urls.some(url => new URL(url).hostname === 'nodejs.org'), 'mirror failures must try the official source')
 } finally { await rm(home, { recursive: true, force: true }) }
})

for (const staleLink of [false, true]) test(`detached Desktop resolves pnpm with ${staleLink ? 'stale unpacked' : 'valid'} host link`, { skip: process.platform === 'win32' ? 'private fork: junction fixtures are prohibited on this host' : false }, async () => {
 const { mkdir, symlink } = await import('node:fs/promises')
 const home = await mkdtemp(path.join(os.tmpdir(), 'desktop-detached-'))
 try {
  const host = path.join(home, 'Desktop', 'resources', staleLink ? 'app' : 'app.asar.unpacked')
  const agent = path.join(host, 'node_modules', '@deepseek-ai', 'dsh-agent')
  const pnpm = path.join(host, 'node_modules', 'pnpm')
  const plugin = path.join(home, 'tavern-plugin')
  await mkdir(agent, { recursive: true }); await mkdir(path.join(pnpm, 'bin'), { recursive: true })
  await mkdir(path.join(plugin, 'node_modules', '@deepseek-ai'), { recursive: true })
  await writeFile(path.join(agent, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-agent', main: 'index.js' }))
  await writeFile(path.join(agent, 'index.js'), '')
  await writeFile(path.join(pnpm, 'package.json'), JSON.stringify({ name: 'pnpm', bin: { pnpm: 'bin/pnpm.cjs' } }))
  await writeFile(path.join(pnpm, 'bin', 'pnpm.cjs'), '')
  const target = staleLink ? agent.replace(`${path.sep}app${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`) : agent
  await symlink(target, path.join(plugin, 'node_modules', '@deepseek-ai', 'dsh-agent'), 'junction')
  let downloads = 0
  await assert.rejects(prepareDesktopPackageManager({
   host: 'desktop', platform: 'win32', arch: 'x64',
   env: { DSH_HOME: home, DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: path.join(plugin, 'lib', 'application-updater.js') },
   fetch: async () => { downloads++; return new Response('not-node') },
  }), /SHA-256/)
  assert.ok(downloads >= 1, 'must find the selected Desktop pnpm before provisioning Node')
 } finally { await rm(home, { recursive: true, force: true }) }
})
