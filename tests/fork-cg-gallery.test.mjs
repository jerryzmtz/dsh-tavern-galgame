// private fork: cached director requests split candidates and story into separate content blocks.
import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
// private fork: real host receipts plus card-local derived storage, never a live profile.
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './helpers/stage-director-harness.mjs'
import {PACK_ID,distinctMedia} from './fixtures/asset-packs/pack.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {verifyCgPlayedReceipt} from '../tavern-plugin/lib/domain/cg-played-receipt.js'
import {createCgGallery} from '../tavern-plugin/lib/fork-cg-gallery.js'
import {createCardStorage} from '../tavern-plugin/lib/fork-card-storage.js'
const ref = id => ({packId:PACK_ID,kind:'cg',assetId:id})
const text = n => Array.from({length:n},(_,i) => `Paragraph ${i+1}.`).join('\n\n')
async function setup(t,shown='rice') {
  const f = await fixture(async request => {
    const tail = directorPromptData(request)
    await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:tail.first+tail.reply.length-1,done:true,beats:tail.first === 1 ? [{at:1,ops:[{op:'cg.set',cg:ref(shown)}]}] : []}})
  }); t.after(() => f.dispose())
  const pack = await f.services.get('assetLibrary').getPackSnapshot({packId:PACK_ID})
  for (const id of ['rice','door']) pack.manifest.assets.push({kind:'cg',id,name:`Secret ${id}`,enabled:true,directorNote:'',recall:{mode:'constant',keywords:[]},variants:{default:'base',entries:[{id:'base',name:'Base',content:{description:'Eating.',media:pack.manifest.assets[0].variants.entries[0].content.media}}]}})
  pack.manifest.assets=pack.manifest.assets.map(asset=>asset.kind==='cg'?distinctMedia(asset,asset.id):asset)
  const op = f.beginReply(2), stream = await f.director.beginStream(f.read(),2)
  stream.update(text(7)); await f.director.drain()
  const prefix = await f.director.get(f.read(),2,null,{readOnly:true})
  const project = () => readStageProjection({expectedDirectionToken:prefix.token,at:1,page:{index:0,para:1,offset:0,version:1},readDirection:() => prefix,readConsumer:() => f.assets.consumer(f.read(),'http://localhost'),readSettings:() => f.engineSettings.read(),revision:() => f.assets.revision})
  const data = new Map(), writes = [], profileData = {readJson:async key => structuredClone(data.get(key)),writeJson:async (key,value) => {writes.push(key);data.set(key,structuredClone(value))},remove:async key => data.delete(key)}
  const cardStorage=createCardStorage({dataRoot:'C:/synthetic'})
  let time=0
  const gallery = createCgGallery({now:()=>time,profileData,cardStorage,resolveCard:async () => f.workspace.meta.id,chatForSession:async () => f.read(),assets:f.assets,readDirection:(chat,turn) => f.director.get(chat,turn,null,{readOnly:true}),readSettings:() => f.engineSettings.read()})
  const issue = (sessionId='session',owner=gallery) => owner.project({sessionId,turn:2,cgDisplay:{visitId:1,requestId:1}},project)
  const projection = await issue()
  assert.equal(projection.status,'ready',JSON.stringify(projection.error)); assert.ok(projection.cgReceipt.displayToken)
  const ack = extra => gallery.ack({sessionId:'session',turn:2,receipt:projection.cgReceipt,ref:ref('rice'),variant:'base',...extra},'http://localhost')
  return {...f,op,stream,prefix,projection,gallery,data,writes,profileData,cardStorage,ack,issue,project,advance:ms=>{time+=ms}}
}
test('canonical page receipt accepts sealed stream convergence, rejects rewritten epoch and forged prefix',async t => {
  const f = await setup(t), receipt = f.projection.cgReceipt
  assert.equal(verifyCgPlayedReceipt(f.prefix,receipt,ref('rice'),'base').variant,'base')
  f.commitReply(f.op,2,text(7)); await f.director.get(f.read(),2); await f.director.drain()
  const canonical = await f.director.get(f.read(),2,null,{readOnly:true})
  assert.notDeepEqual(canonical.token,receipt.expectedDirectionToken)
  assert.equal(verifyCgPlayedReceipt(canonical,receipt,ref('rice'),'base').variant,'base')
  for (const change of [value => value.generation++,value => value.binding.stream.epoch++,value => value.binding.cardRevision='other',value => value.entries[0].state.cg.ref.assetId='door']) {
    const changed = structuredClone(canonical); change(changed)
    if (changed.record) changed.record.entries=changed.entries
    assert.throws(() => verifyCgPlayedReceipt(changed,receipt,ref('rice'),'base'))
  }
  const forged = structuredClone(receipt); forged.expectedDirectionToken.digest='0'.repeat(64)
  assert.throws(() => verifyCgPlayedReceipt(canonical,forged,ref('rice'),'base'))
  assert.throws(() => verifyCgPlayedReceipt(canonical,{...receipt,page:{...receipt.page,offset:9}},ref('rice'),'base'))
  assert.equal((await f.ack()).changed,true)
})
test('gallery lists anonymous locked cells without descriptors, unions repeated sessions and isolates card copies',async t => {
  const f = await setup(t)
  let list = await f.gallery.list({sessionId:'session',limit:1},'http://localhost')
  assert.deepEqual(Object.keys(list.items[0]).sort(),['available','ref','unlocked']); assert.ok(list.nextCursor)
  assert.doesNotMatch(JSON.stringify(list.items),/Secret|media|variants|label/)
  const another = await f.issue('another')
  const replies = await Promise.all([f.ack(),f.ack({sessionId:'another',receipt:another.cgReceipt})])
  assert.deepEqual(replies.map(r => r.changed),[true,false]); assert.equal(f.writes.length,1)
  await assert.rejects(f.gallery.list({sessionId:'session',cursor:list.nextCursor},'http://localhost'),{code:'REVISION_CONFLICT'})
  list = await f.gallery.list({sessionId:'session'},'http://localhost')
  assert.equal(list.items[0].label,'Secret rice'); assert.equal(list.items[0].variants[0].image.media.url.resource,true)
  assert.deepEqual(f.data.get('stage/cg-gallery/card-a.json'),{schemaVersion:1,unlocked:[ref('rice')]})
  f.workspace.meta.id='copy-card'; list=await f.gallery.list({sessionId:'session'},'http://localhost'); assert.equal(list.items[0].unlocked,false)
  f.workspace.meta.id='card-a'; await f.gallery.remove('card-a'); assert.equal(f.data.size,0)
})
test('different sessions union different CG refs; rename and temporary unavailability retain entry unlocks',async t=>{
  const first=await setup(t),second=await setup(t,'door')
  const other=createCgGallery({profileData:first.profileData,cardStorage:first.cardStorage,resolveCard:async()=>first.workspace.meta.id,chatForSession:async()=>second.read(),assets:second.assets,readDirection:(chat,turn)=>second.director.get(chat,turn,null,{readOnly:true}),readSettings:()=>second.engineSettings.read()})
  const issued=await second.issue('other',other)
  await Promise.all([first.ack(),other.ack({sessionId:'other',turn:2,receipt:issued.cgReceipt,ref:ref('door'),variant:'base'},'http://localhost')])
  assert.deepEqual(first.data.get('stage/cg-gallery/card-a.json').unlocked.map(r=>r.assetId),['door','rice'])
  first.workspace.raw.name='Renamed card'
  const pack=await first.services.get('assetLibrary').getPackSnapshot({packId:PACK_ID}),rice=pack.manifest.assets.find(a=>a.kind==='cg'&&a.id==='rice')
  rice.enabled=false;first.assets.invalidate()
  let list=await first.gallery.list({sessionId:'session'},'http://localhost'),row=list.items.find(r=>r.ref.assetId==='rice')
  assert.deepEqual(row,{ref:ref('rice'),unlocked:true,available:false});assert.equal(first.data.get('stage/cg-gallery/card-a.json').unlocked.length,2)
  rice.enabled=true;first.assets.invalidate();list=await first.gallery.list({sessionId:'session'},'http://localhost')
  assert.equal(list.items.find(r=>r.ref.assetId==='rice').unlocked,true)
})

test('cancelled source and valid-prefix append/rewrite have distinct acknowledgement authority',async t=>{
  const f=await setup(t),receipt=f.projection.cgReceipt
  f.stream.update(text(13));await f.director.drain()
  let latest=await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(verifyCgPlayedReceipt(latest,receipt,ref('rice'),'base').variant,'base')
  f.stream.update(text(13).replace('Paragraph 1.','Rewritten.'));await f.director.drain()
  latest=await f.director.get(f.read(),2,null,{readOnly:true})
  assert.throws(()=>verifyCgPlayedReceipt(latest,receipt,ref('rice'),'base'))
  f.stream.cancel();latest=await f.director.get(f.read(),2,null,{readOnly:true})
  await assert.rejects(f.ack());assert.equal(f.writes.length,0)
})

test('no projection or preview unlocks; disabled, unbound, wrong variant and storage failure fail without changing play state',async t => {
  const f = await setup(t); assert.equal(f.writes.length,0)
  await assert.rejects(f.ack({variant:'invented'})); await assert.rejects(f.ack({ref:ref('door')})); assert.equal(f.writes.length,0)
  f.profileData.writeJson=async () => {throw new Error('disk full')}
  await assert.rejects(f.ack(),{code:'CG_GALLERY_WRITE_FAILED'})
  await assert.rejects(f.ack(),{code:'REVISION_CONFLICT'},'failed write still consumes its single-use capability')
  assert.equal((await f.director.get(f.read(),2,null,{readOnly:true})).through,f.prefix.through)
  f.workspace.raw.extensions.dsh_tavern.assetBindings.boundPackIds=[]; f.assets.invalidate()
  await assert.rejects(f.ack()); assert.equal(f.data.size,0)
})

// private fork: regressions from the independent no-projection and same-session card-switch probes.
test('read-only direction/projection cannot forge display authority; capabilities are scoped and single-use',async t=>{
  const f=await setup(t), receipt={expectedDirectionToken:f.prefix.token,page:f.projection.cgReceipt.page,through:f.prefix.through,binding:{forged:true}};
  await assert.rejects(f.ack({receipt}),{code:'REVISION_CONFLICT'});
  const raw=await f.project();await assert.rejects(f.ack({receipt:raw.cgReceipt}),{code:'REVISION_CONFLICT'});
  const preload=await f.gallery.project({sessionId:'session',turn:2},f.project);
  assert.equal(preload.cgReceipt.displayToken,undefined);
  for(const extra of [{sessionId:'another'},{turn:3},{receipt:{...f.projection.cgReceipt,visit:{visitId:2}}},{receipt:{...f.projection.cgReceipt,binding:{forged:true}}}])await assert.rejects(f.ack(extra),{code:'REVISION_CONFLICT'});
  assert.equal(f.writes.length,0);
  const results=await Promise.allSettled([f.ack(),f.ack()]);assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);
  assert.equal(f.writes.length,1);await assert.rejects(f.ack(),{code:'REVISION_CONFLICT'});
});
test('a display capability cannot follow a session to a copied card',async t=>{
  const f=await setup(t);
  f.workspace.meta.id='copy-card';
  await assert.rejects(f.ack(),{code:'REVISION_CONFLICT'},'card identity alone fences the receipt, even without invalidation');
  await f.store.updateChat('chat',chat=>({...chat,cardPath:'cards/copy.json'}));f.assets.invalidate();
  await assert.rejects(f.ack(),{code:'REVISION_CONFLICT'});assert.equal(f.writes.length,0);
});

test('display capabilities expire and are invalidated by asset changes before consumption',async t=>{
  const f=await setup(t);f.advance(300001);await assert.rejects(f.ack(),{code:'REVISION_CONFLICT'});
  const fresh=await f.issue();f.assets.invalidate();await assert.rejects(f.ack({receipt:fresh.cgReceipt}),{code:'REVISION_CONFLICT'});
  assert.equal(f.writes.length,0);
});
