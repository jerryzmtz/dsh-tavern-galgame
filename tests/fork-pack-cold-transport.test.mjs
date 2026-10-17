// private fork: cold metadata gets a bounded validation deadline, not a manual Reload race.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const source=await readFile(new URL('../tavern-plugin/src/client/fork-pack-transport.js',import.meta.url),'utf8')
test('first cold catalogue request survives 30 seconds; ordinary RPCs retain their deadline',async()=>{
  const timers=new Map();let id=0,finish,signal
  const ctx={AbortController,URL,Blob,Uint8Array,setTimeout(fn,ms){timers.set(++id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}}
  vm.runInNewContext(source,ctx)
  const client=ctx.createForkPackTransport({fetch:async(_path,options)=>{
    signal=options.signal
    await new Promise(resolve=>{finish=resolve})
    return Response.json([])
  }})
  try {
    const cold=client.service.listPackSummaries()
    assert.equal([...timers.values()][0].ms,90000)
    for(const timer of timers.values()) if(timer.ms<=30000) timer.fn()
    assert.equal(signal.aborted,false)
    finish();assert.deepEqual(await cold,[])
    assert.equal(timers.size,0)
    const ordinary=client.service.resolveAssets({refs:[]})
    assert.equal([...timers.values()][0].ms,30000)
    finish();await ordinary
    const snapshot=client.service.getPackSnapshot({packId:'fixture'})
    assert.equal([...timers.values()][0].ms,90000)
    client.dispose();assert.equal(signal.aborted,true)
    finish();await assert.rejects(snapshot,{code:'ASSET_UNAVAILABLE'})
  } finally {client.dispose()}
})
