// private fork: real transport -> managed connection -> TTS capabilities, no worker/token access.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createTransport} from '../src/transport.js'
import {createTts} from '../../dsh-tts/src/service.js'

test('installed model and legacy voice inventories populate local capabilities without starting',async t=>{
 const root=await mkdtemp(join(tmpdir(),'local-inventory-'))
 const paths=['gpt','sovits','sv','inventory.json','config.json'].map(p=>join(root,p))
 t.after(async()=>{for(const p of paths)await unlink(p);await rmdir(root)})
 for(const p of paths.slice(0,3))await writeFile(p,'fixture')
 const transport=createTransport({fetch:()=>assert.fail('must not contact or start the worker')})
 const tts=createTts();t.after(()=>tts.dispose())
 for(const source of ['models','voices']){
   const model={gpt:{path:'gpt',sha256:'a'.repeat(64)},sovits:{path:'sovits',sha256:'b'.repeat(64)}}
   const pro={...model,modelVersion:'v2ProPlus',sv:{path:'sv',sha256:'c'.repeat(64)}}
   await writeFile(paths[3],JSON.stringify({[source]:[model,pro,{...model,gpt:{path:'missing',sha256:'d'.repeat(64)}}]}))
   await writeFile(paths[4],JSON.stringify({root,[source]:'inventory.json',url:'http://127.0.0.1:12345',token:'synthetic-only'}))
   const connection=await transport.connection({providerId:'fixture',installPath:root,pythonExecutable:process.execPath,workerScript:paths[4],modelConfigPath:paths[4]})
   const off=tts.registerReferenceProvider('test',{...connection,paid:false,lifecycle:{readinessTimeoutMs:180000}})
   const [service]=await tts.listServices()
   assert.deepEqual(service.capabilities.modelRequirements,[{engine:'gpt-sovits',modelVersion:'v3',gpt:{sha256:'a'.repeat(64)},sovits:{sha256:'b'.repeat(64)}},{engine:'gpt-sovits',modelVersion:'v2ProPlus',gpt:{sha256:'a'.repeat(64)},sovits:{sha256:'b'.repeat(64)},sv:{sha256:'c'.repeat(64)}}])
   assert.equal(service.capabilities.referenceLimits.bytes,8*1024**2)
   assert.ok(!JSON.stringify(service).includes('synthetic-only'))
   off()
 }
})
