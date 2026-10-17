import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,appendFile,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'
import {createMvuDiagnosticStore} from '../tavern-plugin/lib/domain/mvu-diagnostics.js'
const relative='diagnostics/mvu-'+createHash('sha256').update('s').digest('hex')
async function fixture(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'mvu-log-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const storage=createProfileDataStore({dataRoot:root,...options})
 return {root,storage,store:createMvuDiagnosticStore(storage,{flushDelayMs:0}),file:join(root,relative+'.jsonl')}
}
test('steady diagnostic writes append only the new record and survive reopening',async t=>{
 const {root,storage,store,file}=await fixture(t)
 const records=Array.from({length:180},(_,n)=>({n,message:'x'.repeat(8000)}))
 await storage.writeJson(relative+'.json',{version:1,sessionId:'s',dropped:3,records})
 await store.record('s',{n:180,message:'new'})
 const before=await readFile(file)
 await store.record('s',{n:181,message:'new'})
 const after=await readFile(file)
 assert.deepEqual(after.subarray(0,before.length),before)
 assert.ok(after.length-before.length<200,'append must not rewrite historical JSON')
 assert.deepEqual((await createMvuDiagnosticStore(createProfileDataStore({dataRoot:root})).read('s')).records.map(r=>r.n),Array.from({length:182},(_,n)=>n))
})

test('legacy logs remain readable and import once; readers retain count and dropped semantics',async t=>{
 const {root,storage}=await fixture(t)
 const store=createMvuDiagnosticStore(storage,{maxRecords:3,flushDelayMs:0})
 await storage.writeJson(relative+'.json',{version:1,sessionId:'s',dropped:4,records:[{n:0},{n:1}]})
 assert.equal((await store.read('s')).records.length,2)
 await Promise.all(Array.from({length:10},(_,n)=>store.record('s',{n:n+2,authorization:'PRIVATE',message:'Bearer PRIVATE'})))
 const result=await createMvuDiagnosticStore(createProfileDataStore({dataRoot:root}),{maxRecords:3}).read('s')
 assert.deepEqual(result.records.map(r=>r.n),[9,10,11]);assert.equal(result.dropped,13)
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/)
 assert.equal((await storage.readJson(relative+'.json')).records.length,2)
 assert.deepEqual((await store.read('other')).records,[])
})

test('rotation bounds disk and exported bytes and preserves the latest records after restart',async t=>{
 const {root,store,file}=await fixture(t)
 let rotations=0,previous=0
 for(let n=0;n<240;n++){
  await store.record('s',{n,message:'汉'.repeat(8500)})
  const size=(await stat(file)).size
  assert.ok(size<=4*1024*1024)
  if(size<previous)rotations++
  previous=size
 }
 const result=await createMvuDiagnosticStore(createProfileDataStore({dataRoot:root})).read('s')
 assert.ok(rotations>0);assert.ok(Buffer.byteLength(JSON.stringify(result.records))<=2*1024*1024)
 assert.equal(result.records.at(-1).n,239)
 assert.equal(result.dropped+result.records.length,240)
 assert.deepEqual(result.records.map(r=>r.n),Array.from({length:result.records.length},(_,n)=>result.dropped+n))
})

test('a torn final record is ignored on read and repaired before the next append',async t=>{
 const {store,file}=await fixture(t)
 await store.record('s',{n:0});await store.record('s',{n:1})
 await appendFile(file,Buffer.concat([Buffer.from('{"n":2,"message":"'),Buffer.from([0xe6,0xb1])]))
 assert.deepEqual((await store.read('s')).records.map(r=>r.n),[0,1])
 await store.record('s',{n:3})
 const result=await store.read('s')
 assert.deepEqual(result.records.map(r=>r.n),[0,1,3]);assert.equal(result.dropped,0)
 assert.doesNotMatch(await readFile(file,'utf8'),/�/)
})

test('completed malformed lines are reported instead of silently dropping old diagnostics',async t=>{
 const {store,file}=await fixture(t)
 await store.record('s',{n:0});await appendFile(file,'{broken}\n')
 await assert.rejects(store.read('s'),SyntaxError)
 assert.match(await readFile(file,'utf8'),/broken/)
})

test('Windows deferred promotion remains readable and a later writer recovers all records',async t=>{
 const {root,store,file}=await fixture(t,{platform:'win32',sleep:async()=>{},rename:async()=>{throw Object.assign(new Error('busy'),{code:'EPERM'})}})
 await store.record('s',{n:0});await store.record('s',{n:1})
 assert.deepEqual((await store.read('s')).records.map(r=>r.n),[0,1])
 const recovered=createMvuDiagnosticStore(createProfileDataStore({dataRoot:root}),{flushDelayMs:0})
 await recovered.record('s',{n:2})
 assert.deepEqual((await recovered.read('s')).records.map(r=>r.n),[0,1,2])
 assert.ok((await stat(file)).size>0)
})

test('another live writer is rejected without overwriting the journal',async t=>{
 const {store,file,root}=await fixture(t)
 await store.record('s',{n:0})
 const {writeFile}=await import('node:fs/promises')
 await writeFile(file+'.write-lock',JSON.stringify({pid:process.pid,writerId:'other-writer',createdAt:Date.now()}))
 await assert.rejects(store.record('s',{n:1}),{code:'DSH_TAVERN_WRITE_CONFLICT'})
 await rm(file+'.write-lock')
 assert.deepEqual((await createMvuDiagnosticStore(createProfileDataStore({dataRoot:root})).read('s')).records.map(r=>r.n),[0])
 await store.record('s',{n:2})
 assert.deepEqual((await store.read('s')).records.map(r=>r.n),[0,1,2])
})

test('buffered calls avoid disk IO; read flushes one redacted batch before returning',async t=>{
 const {storage,root}=await fixture(t)
 let writes=0
 const store=createMvuDiagnosticStore({...storage,appendText(...args){writes++;return storage.appendText(...args)}},{flushDelayMs:60000})
 t.after(()=>store.dispose())
 for(let n=0;n<10;n++)await store.record('s',{n,token:'PRIVATE'})
 assert.equal(writes,0)
 const result=await store.read('s')
 assert.equal(writes,1);assert.equal(result.records.length,10)
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/)
 assert.equal((await createMvuDiagnosticStore(createProfileDataStore({dataRoot:root})).read('s')).records.length,10)
})

test('timer flushes idle logs and normal disposal drains pending writes',async t=>{
 const {storage,root}=await fixture(t)
 let notify
 const flushed=new Promise(resolve=>notify=resolve)
 const store=createMvuDiagnosticStore({...storage,async appendText(...args){const result=await storage.appendText(...args);notify();return result}},{flushDelayMs:10})
 t.after(()=>store.dispose())
 await store.record('s',{n:0})
 let deadline
 try { await Promise.race([flushed,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('flush timer did not run')),2000)})]) } finally { clearTimeout(deadline) }
 assert.equal((await createMvuDiagnosticStore(createProfileDataStore({dataRoot:root})).read('s')).records.length,1)
 await store.record('s',{n:1});await store.dispose()
 assert.deepEqual((await createMvuDiagnosticStore(createProfileDataStore({dataRoot:root})).read('s')).records.map(r=>r.n),[0,1])
})

test('failed flushes are observable and retry with newer buffered records in order',async t=>{
 const {storage}=await fixture(t)
 let failed=true
 const store=createMvuDiagnosticStore({...storage,appendText(...args){if(failed)return Promise.reject(Error('disk failed'));return storage.appendText(...args)}},{flushDelayMs:60000})
 t.after(()=>store.dispose())
 await store.record('s',{n:0})
 await assert.rejects(store.flush(),/disk failed/)
 const pending=await store.read('s')
 assert.equal(pending.persistence,'pending');assert.equal(pending.records[0].n,0)
 await store.record('s',{n:1});failed=false
 assert.deepEqual((await store.read('s')).records.map(r=>r.n),[0,1])
})

test('blocked IO cannot grow pending retention without limit and dropped count is persisted',async t=>{
 const {storage}=await fixture(t)
 let release,started
 const gate=new Promise(resolve=>release=resolve),writing=new Promise(resolve=>started=resolve)
 let calls=0
 const store=createMvuDiagnosticStore({...storage,async appendText(...args){if(calls++===0){started();await gate}return storage.appendText(...args)}},{maxRecords:3,flushDelayMs:60000})
 t.after(()=>store.dispose())
 await store.record('s',{n:0});const flush=store.flush();await writing
 for(let n=1;n<100;n++)await store.record('s',{n})
 release();await flush
 const result=await store.read('s')
 assert.deepEqual(result.records.map(r=>r.n),[97,98,99]);assert.equal(result.dropped,97)
})

test('background failures retry automatically without repeated warning spam',async t=>{
 const {storage}=await fixture(t)
 let writes=0,warnings=0,notify,deadline
 const recovered=new Promise(resolve=>notify=resolve)
 const store=createMvuDiagnosticStore({...storage,async appendText(...args){
  if(++writes<3)throw Error('temporary failure')
  const result=await storage.appendText(...args);notify();return result
 }},{flushDelayMs:10,onError(){warnings++}})
 t.after(()=>store.dispose())
 await store.record('s',{n:0})
 try { await Promise.race([recovered,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('retry missing')),2000)})]) } finally {clearTimeout(deadline)}
 assert.equal(warnings,1);assert.equal(writes,3)
 assert.equal((await store.read('s')).records[0].n,0)
})

test('too many buffered sessions apply backpressure and shutdown drains them',async t=>{
 const {storage,root}=await fixture(t)
 let writes=0
 const store=createMvuDiagnosticStore({...storage,appendText(...args){writes++;return storage.appendText(...args)}},{flushDelayMs:60000})
 t.after(()=>store.dispose())
 for(let n=0;n<9;n++)await store.record('session-'+n,{n})
 assert.equal(writes,1)
 await store.dispose()
 const reopened=createMvuDiagnosticStore(createProfileDataStore({dataRoot:root}))
 for(let n=0;n<9;n++)assert.equal((await reopened.read('session-'+n)).records[0].n,n)
})
