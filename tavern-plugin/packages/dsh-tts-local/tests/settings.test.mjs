// private fork: lifecycle supplies a normal provider connection, never adopts another process.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createServer} from 'node:http'
import {once} from 'node:events'
import * as localPlugin from '../src/index.js'
import {createTransport} from '../src/transport.js'

test('auto-start defaults off and retains explicit opt-in',()=>{
  assert.equal(localPlugin.Settings({}).autoStart,false)
  assert.equal(localPlugin.Settings({autoStart:true}).autoStart,true)
  assert.equal(localPlugin.Settings({}).providerId,'default')
  assert.equal(localPlugin.Settings({}).port,undefined)
})

test('base URL/key are supplied unchanged; an occupied port is never adopted',async t=>{
  const directory=await mkdtemp(resolve('.tts-service-test-')),file=join(directory,'config.json')
  t.after(async()=>{await unlink(file);await rmdir(directory)})
  const server=createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer test-only');res.end(JSON.stringify({protocol:'dsh-tts-reference-v1',state:'ready',voices:[]}))})
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()})
  const url='http://127.0.0.1:'+server.address().port
  // private fork: service config keeps token; only the generic provider descriptor calls it key.
  await writeFile(file,JSON.stringify({url,token:'test-only'}))
  const settings={providerId:'engine',installPath:directory,pythonExecutable:file,workerScript:file,modelConfigPath:file,arguments:'["--extra"]',environment:'{"CUSTOM":"yes"}'}
  const transport=createTransport(),signal=new AbortController().signal
  await assert.rejects(transport.prepare(settings,signal),{code:'PORT_OCCUPIED'})
  assert.equal((await transport.probe({url,key:'test-only'},signal)).state,'ready')
  await new Promise(resolve=>server.close(resolve))
  const launch=await transport.prepare(settings,signal)
  // private fork: no installed inventory is an explicit empty local model list.
  assert.deepEqual(launch.provider,{id:'engine',url,key:'test-only',modelRequirements:[]})
  assert.equal(launch.provider.synthesize,undefined);assert.equal(launch.adopted,undefined)
  assert.deepEqual(launch.argv,[file,'-u',file,'--extra','--config',file])
  await assert.rejects(transport.prepare({...settings,environment:'[]'},signal),{code:'INVALID_CONFIG'})
  await writeFile(file,JSON.stringify({url,key:'test-only'}))
  await assert.rejects(transport.prepare(settings,signal),{code:'INVALID_CONFIG'})
})
