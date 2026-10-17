import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createConversationPageStore,recordBlock} from '../tavern-plugin/lib/domain/conversation-page-store.js'

for(const fallback of [false,true])test(`record packs preserve hash lookup, standalone dedup and detached reads; fallback=${fallback}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'record-pack-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const options=fallback?{linkFile:async()=>{throw Object.assign(Error('unsupported'),{code:'ENOTSUP'})}}:{}
 const store=createConversationPageStore({root,...options})
 const values=Array.from({length:96},(_,i)=>({type:'scalar',value:'value '+i}))
 const refs=await store.writeRecords('a',values)
 const file=ref=>join(root,'a/blocks',ref.slice(0,2),ref+'.json')
 assert.equal(JSON.parse(await readFile(file(refs[0]),'utf8')).kind,fallback?'record':'block-pack-v1')
 if(!fallback)assert.equal((await stat(file(refs[0]))).ino,(await stat(file(refs[1]))).ino)
 const fresh=createConversationPageStore({root})
 for(let i=0;i<refs.length;i++)assert.deepEqual(await fresh.readRecord('a',refs[i]),values[i])
 const modified=await fresh.readRecord('a',refs[0]);modified.value='changed'
 assert.deepEqual(await fresh.readRecord('a',refs[0]),values[0])
 assert.equal(await store.writeRecord('a',values[0]),refs[0])
 assert.deepEqual(await store.writeRecords('a',values),refs)
 const extra={type:'scalar',value:'new'},mixed=[values[50],extra,...values,extra]
 const mixedRefs=await store.writeRecords('a',mixed,mixed.map(value=>recordBlock(value).ref))
 assert.deepEqual(mixedRefs,[refs[50],recordBlock(extra).ref,...refs,recordBlock(extra).ref])
 for(let i=0;i<mixedRefs.length;i++)assert.deepEqual(await fresh.readRecord('a',mixedRefs[i]),mixed[i])
 const io=[],checking=createConversationPageStore({root,onIO:event=>io.push(event)})
 const invalid=[...values,{type:'scalar',value:'must not publish'}]
 const known=invalid.map(value=>recordBlock(value).ref);known[40]=refs[0]
 await assert.rejects(checking.writeRecords('a',invalid,known),/Immutable block corruption/)
 assert.equal(io.some(event=>event.kind==='write'||event.kind==='link'),false)
 await writeFile(file(refs[0]),'{corrupt')
 await assert.rejects(createConversationPageStore({root}).readRecord('a',refs[0]),/Invalid immutable block/) // private fork: blocks are parsed, not re-hashed
})
