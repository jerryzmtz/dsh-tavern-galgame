import path from 'node:path'
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises'
import {isDeepStrictEqual as equal} from 'node:util'
import {randomUUID} from 'node:crypto'
import {checkedAssetPath} from './fork-card-storage.js'

const queues=new Map()
const conflict=message=>{throw Object.assign(new Error(message),{code:'MOD_MIGRATION_CONFLICT'})}

// Only owner CAS ports publish data. This file owns durable intents and backup receipts, never cards or packs.
export function createModMigrationJournal({root,owners,backup}) {
  root=path.resolve(root)
  const serial=task=>{
    const result=(queues.get(root) || Promise.resolve()).then(task),tail=result.catch(()=>{})
    queues.set(root,tail);tail.finally(()=>{if(queues.get(root)===tail)queues.delete(root)})
    return result
  }
  const read=async id=>{
    const file=await checkedAssetPath(root,id+'.json')
    try{return JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}
  }
  async function write(id,value) {
    const file=await checkedAssetPath(root,id+'.json'),temporary=await checkedAssetPath(root,id+'.'+randomUUID()+'.tmp')
    await mkdir(root,{recursive:true})
    const handle=await open(temporary,'wx')
    try{await handle.writeFile(JSON.stringify(value));await handle.sync()}finally{await handle.close()}
    try{await rename(temporary,file)}catch(error){await unlink(temporary).catch(()=>{});throw error}
  }
  function owner(change) {
    const port=owners[change.owner]
    if(!port || typeof port.read!=='function' || Object.hasOwn(change,'after') && typeof port.compareAndSwap!=='function')throw Error('Unknown migration owner')
    return port
  }
  async function preflight(changes) {
    for(const change of changes) {
      const current=await owner(change).read(change.key)
      if(current.revision!==change.before.revision || !equal(current.value,change.before.value))conflict('Owner changed before migration: '+change.owner+'/'+change.key)
    }
  }
  async function verifyCommitted(journal) {
    await preflight(journal.guards || [])
    for(const change of journal.changes) {
      const current=await owner(change).read(change.key)
      if(!change.receipt || change.receipt.revision!==current.revision || !equal(current.value,change.after))conflict('Completed migration owner changed: '+change.owner+'/'+change.key)
    }
    return {...journal,writes:0}
  }
  async function forward(id,journal) {
    for(let index=0;index<journal.changes.length;index++) {
      await preflight(journal.guards || [])
      const change=journal.changes[index],port=owner(change),current=await port.read(change.key)
      if(equal(current.value,change.after)) {
        if(!change.started && !change.receipt)conflict('An unstarted migration owner was independently changed: '+change.owner+'/'+change.key)
        if(change.receipt && change.receipt.revision!==current.revision)conflict('Previously migrated owner was edited: '+change.owner+'/'+change.key)
      } else {
        if(change.receipt || current.revision!==change.before.revision || !equal(current.value,change.before.value))conflict('Migration recovery conflicts with an owner edit: '+change.owner+'/'+change.key)
        if(!change.started){change.started=true;await write(id,journal)}
        await port.compareAndSwap({key:change.key,expectedRevision:current.revision,expectedValue:current.value,value:change.after,backup:journal.backup})
      }
      const saved=await port.read(change.key)
      if(!equal(saved.value,change.after))conflict('Owner did not publish the planned value: '+change.owner+'/'+change.key)
      if(!change.receipt){change.receipt={revision:saved.revision};await write(id,journal)}
    }
    await preflight(journal.guards || [])
    journal.status='complete';await write(id,journal)
    return structuredClone(journal)
  }
  return Object.freeze({
    inspect:read,
    dryRun:async plan=>{await preflight([...plan.changes,...(plan.guards || [])]);return {id:plan.id,status:'ready',writes:0,changes:plan.changes.length,evidence:plan.evidence}},
    apply:plan=>serial(async()=>{
      let journal=await read(plan.id)
      if(journal?.status==='complete')return verifyCommitted(journal)
      if(journal?.status==='rolled-back' || journal?.status==='rolling-back')conflict('Migration rollback must finish before another application')
      if(!journal) {
        await preflight([...plan.changes,...(plan.guards || [])])
        const receipt=await backup(structuredClone(plan))
        if(!receipt)throw Error('Durable backup receipt is required')
        await preflight([...plan.changes,...(plan.guards || [])])
        journal={version:1,id:plan.id,status:'applying',backup:receipt,changes:structuredClone(plan.changes),guards:structuredClone(plan.guards || []),evidence:structuredClone(plan.evidence)}
        await write(plan.id,journal)
      }
      return forward(plan.id,journal)
    }),
    resume:id=>serial(async()=>{
      const journal=await read(id)
      if(!journal)throw Error('No durable migration intent')
      if(journal.status==='complete')return verifyCommitted(journal)
      if(journal.status==='rolled-back')return {...journal,writes:0}
      if(journal.status==='rolling-back')conflict('Resume this journal with rollback, not apply')
      return forward(id,journal)
    }),
    rollback:id=>serial(async()=>{
      const journal=await read(id)
      if(!journal)throw Error('No durable migration intent')
      if(journal.status==='rolled-back')return {...journal,writes:0}
      await preflight(journal.guards || [])
      // Check every completed owner before restoring any of them; never overwrite a later user edit.
      for(const change of journal.changes.filter(row=>row.started || row.receipt)) {
        const current=await owner(change).read(change.key)
        if((change.rollbackStarted || !change.receipt) && equal(current.value,change.before.value))continue
        if(change.receipt && current.revision!==change.receipt.revision || !equal(current.value,change.after))conflict('Rollback conflicts with an owner edit: '+change.owner+'/'+change.key)
      }
      journal.status='rolling-back';await write(id,journal)
      for(const change of [...journal.changes].reverse()) {
        if(!change.started && !change.receipt)continue
        await preflight(journal.guards || [])
        const port=owner(change),current=await port.read(change.key)
        if(equal(current.value,change.before.value)) {
          if(change.started || change.receipt || change.rollbackStarted){delete change.started;delete change.receipt;delete change.rollbackStarted;await write(id,journal)}
          continue
        }
        if(!equal(current.value,change.after))conflict('Rollback source differs: '+change.owner+'/'+change.key)
        change.rollbackStarted=true;await write(id,journal)
        await port.compareAndSwap({key:change.key,expectedRevision:current.revision,expectedValue:current.value,value:change.before.value,backup:journal.backup})
        const saved=await port.read(change.key)
        if(!equal(saved.value,change.before.value))conflict('Rollback verification failed')
        delete change.started;delete change.receipt;delete change.rollbackStarted;await write(id,journal)
      }
      journal.status='rolled-back';await write(id,journal)
      return structuredClone(journal)
    }),
  })
}
