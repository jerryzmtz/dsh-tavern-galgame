import test from 'node:test'
import assert from 'node:assert/strict'
import {projectItems,diffItems,bindChange,bindShow,itemPlaySchema,validateItemPlay,itemInventoryPrompt} from '../tavern-plugin/lib/domain/item-binding.js'
import {createItemPerformance} from '../tavern-plugin/lib/domain/item-performance.js'
import {cardVariableRegistry} from '../tavern-plugin/lib/domain/card-variable-bindings.js'

const scope = {scopeKey:'bag',ownerKey:'mami'}
const source = {sessionId:'s',branchId:'b',messageId:7,swipeId:0,generation:2,textDigest:'text-v2'}
const row = (name,count = 1,id = name) => ({name,count,id,owner:'mami'})
const snapshot = (rows, revision = 'r0', options = {}) => projectItems({committed:true,complete:true,revision,
  previousRevision:revision === 'r0' ? null : 'r0',mappingKey:'mapping-v1',...options.pinned},
  {status:'ready',source:'author',value:rows,...options.resolved}, {scopeKey:'bag',ownerMapped:true,...options.mapping})
const op = (action,name,at = 2) => ({op:'item.play',action,name,at})
const queue = (inventory = snapshot([]), extras = {}) => createItemPerformance({source,runId:'run',scope,inventory,anchors:[1,2,3,4],enabled:true,...extras})
const receipt = (before,after) => ({source,before,after})

for (const [spoken,name,action,oldCount,newCount,strategy] of [
  ['黑色的小东西','黑色小东西','gain',0,1,'S3-single'],
  ['纸袋','装有点心的纸袋','lose',1,0,'S2-substring'],
  ['黄铜钥匙','旧楼正门黄铜钥匙','gain',0,1,'S2-substring'],
  ['小红果','小红苹果','lose',1,0,'S3-single'],
  ['木牌','夜间通行凭证','gain',0,1,'S3-single'],
  ['悲叹之种','悲叹之种','lose',3,2,'S2-exact'],
]) test(`drift: ${spoken} -> ${name}`, () => {
  const before = snapshot([row(name,oldCount,'canonical-item')]), after = snapshot([row(name,newCount,'canonical-item')],'r1')
  const result = bindChange(op(action,spoken),diffItems(before,after),scope)
  assert.equal(result.ok,true)
  assert.equal(result.item.name,name)
  assert.equal(result.item.delta,1)
  assert.equal(result.strategy,strategy)
})

test('direction gate precedes exact matching and single-candidate fallback', () => {
  const diff = diffItems(snapshot([row('apple',2)]),snapshot([row('apple',1)],'r1'))
  assert.equal(bindChange(op('gain','apple'),diff,scope).error.code,'NO_CHANGE_MATCH')
  assert.equal(bindChange(op('show','unrelated knife'),diff,scope).error.code,'INVALID_OP')
})
test('exact beats substring; multiple substrings and unmatched candidates refuse', () => {
  const diff = diffItems(snapshot([]),snapshot([row('key'),row('bronze key')],'r1'))
  assert.equal(bindChange(op('gain','key'),diff,scope).item.name,'key')
  assert.equal(bindChange(op('gain','ke'),diff,scope).error.code,'AMBIGUOUS_ITEM')
  assert.equal(bindChange(op('gain','unknown'),diff,scope).error.code,'AMBIGUOUS_ITEM')
})
test('holder is required where mapped and cannot be inferred from exact name', () => {
  const diff = diffItems(snapshot([]),snapshot([row('key'),{...row('key',1,'other'),owner:'homura'}],'r1'))
  assert.equal(bindChange(op('gain','key'),diff,{scopeKey:'bag'}).error.code,'HOLDER_UNRESOLVED')
  assert.equal(bindChange(op('gain','key'),diff,{scopeKey:'bag',ownerKey:'sayaka'}).error.code,'NO_CHANGE_MATCH')
  assert.equal(bindChange(op('gain','key'),diff,scope).item.ownerKey,'mami')
  assert.equal(bindChange(op('gain','key'),diff,{...scope,scopeKey:'other-bag'}).error.code,'HOLDER_UNRESOLVED')
})
test('show uses prior positive inventory, never a unique different item or current gain', () => {
  const inventory = snapshot([row('怀表'),row('旧照片',0),row('礼盒御守',1)])
  assert.equal(bindShow(op('show','怀表'),inventory,scope).ok,true)
  assert.equal(bindShow(op('show','御守'),inventory,scope).ok,true)
  assert.equal(bindShow(op('show','旧照片'),inventory,scope).error.code,'ITEM_NOT_FOUND')
  assert.equal(bindShow(op('show','短刀'),snapshot([row('夜间通行凭证')]),scope).error.code,'ITEM_NOT_FOUND')
  assert.equal(bindShow(op('show','合影'),snapshot([row('致姐姐的蓝色小信')]),scope).error.code,'ITEM_NOT_FOUND')
})
test('show duplicate display names with distinct stable IDs refuses', () => {
  assert.equal(bindShow(op('show','key'),snapshot([row('key',1,'id-a'),row('key',1,'id-b')]),scope).error.code,'AMBIGUOUS_ITEM')
})
test('unknown inventory, absent mapping and malformed identity do not become empty', () => {
  for (const options of [{resolved:{source:'default'}},{resolved:{status:'missing'}},{resolved:{variable:{source:'helper-chat'}}},{pinned:{complete:false}},{pinned:{committed:false}}]) {
    const inventory = snapshot([], 'r0', options)
    assert.equal(inventory.complete,false)
    assert.equal(bindShow(op('show','key'),inventory,scope).error.code,'INVENTORY_UNAVAILABLE')
    assert.equal(diffItems(inventory,snapshot([row('key')],'r1')).ok,false)
  }
  assert.equal(snapshot([row('key'),row('key')]).complete,false)
  assert.equal(snapshot([{name:'key',count:1}]).complete,false)
})
test('missing, strings, negative and nonfinite counts cannot manufacture a gain or show', () => {
  for (const value of [undefined,null,'2',-1,Infinity,NaN,1.5]) {
    const inventory = snapshot([{...row('key'),count:value}],'r1')
    assert.equal(inventory.items[0].count,null)
    assert.equal(diffItems(snapshot([]),inventory).changes.length,0)
    assert.equal(bindShow(op('show','key'),inventory,scope).ok,false)
  }
})
test('complete empty list is real absence; removed item keeps old MVU name and count', () => {
  const result = bindChange(op('lose','key'),diffItems(snapshot([row('old key',3,'stable')]),snapshot([],'r1')),scope)
  assert.equal(result.item.name,'old key')
  assert.equal(result.item.delta,3)
  assert.equal(result.item.remaining,0)
})
test('stable rename is not gain; ambiguous name-only replacement is not a transfer', () => {
  assert.equal(diffItems(snapshot([row('key',1,'stable')]),snapshot([row('new name',1,'stable')],'r1')).changes.length,0)
  const before = snapshot([{name:'key',count:1,owner:'mami'}]), after = snapshot([{name:'new name',count:1,owner:'mami'}],'r1')
  assert.equal(diffItems(before,after).changes.length,0)
})
test('mapping/revision discontinuity refuses; net zero produces no event', () => {
  const before = snapshot([row('key')])
  for (const pinned of [{previousRevision:'other'},{mappingKey:'changed'},{revision:'r0'}]) {
    assert.equal(diffItems(before,snapshot([row('key',2)],'r1',{pinned})).ok,false)
  }
  assert.equal(diffItems(before,snapshot([row('key')],'r1')).changes.length,0)
})
test('explicit noncounted membership never displays a synthetic count', () => {
  const mapping = {counted:false}
  const diff = diffItems(snapshot([],'r0',{mapping}),snapshot([row('letter')],'r1',{mapping}))
  assert.equal(bindChange(op('gain','letter'),diff,scope).item.delta,null)
  assert.equal(bindShow(op('show','letter'),snapshot([row('letter',null)],'r0',{mapping}),scope).ok,true)
})
test('normalization is NFKC, case and whitespace only', () => {
  assert.equal(bindShow(op('show','  brass   key '),snapshot([row('ＢＲＡＳＳ KEY')]),scope).strategy,'S2-exact')
})
test('registry exposes Chinese structured inventory fields and static auto fallback', () => {
  const raw = {character_book:{entries:[{comment:'initvar',content:'{"inventory": []}'}]}}
  const provider = cardVariableRegistry.list({raw,context:{packs:[{manifest:{id:'items-pack',assets:[{kind:'widgets',id:'items',enabled:true}]},widgets:{items:{runtime:'items'}}}],allowedPackIds:['items-pack']},sources:{mvu:{available:true,value:{inventory:[]}}}}).find(p => p.id === 'items')
  assert.equal(provider.slots[0].source,'auto')
  assert.equal(provider.slots[0].label,'物品列表')
  assert.equal(provider.slots[0].fieldMapping.name.label,'名称')
  assert.equal(provider.slots[0].active,true)
})
test('strict op validation and bounded S4; off costs zero bytes', () => {
  assert.equal(validateItemPlay({...op('gain','key'),count:1},[2]).error.code,'INVALID_OP')
  assert.equal(validateItemPlay(op('gain','key',8),[2]).error.code,'INVALID_ANCHOR')
  assert.equal(validateItemPlay(op('gain','钥'.repeat(65)),[2]).error.code,'INVALID_OP')
  const inventory = snapshot(Array.from({length:20},(_,i) => row('长物品名称'.repeat(8)+i)))
  assert.equal(itemInventoryPrompt(inventory,scope), '')
  assert.equal(itemInventoryPrompt(inventory,scope,{enabled:false,s4:true}), '')
  const prompt = itemInventoryPrompt(inventory,scope,{enabled:true,s4:true})
  assert.ok(Buffer.byteLength(prompt) <= 1024)
  assert.ok(JSON.parse(prompt).inventory.length <= 12)
  assert.ok(JSON.parse(prompt).inventory.every(name => inventory.items.some(item => item.name === name)))
  assert.ok(Buffer.byteLength(JSON.stringify(itemPlaySchema)) < 512)
})

test('hold waits for commit, then target page plays once and receipt retries stay inert', () => {
  const before = snapshot([]), after = snapshot([row('key')],'r1'), host = queue(before)
  assert.equal(host.submit(op('gain','key'),0).status,'held')
  assert.deepEqual(host.page({at:1}),[])
  assert.deepEqual(host.committed(receipt(before,after)).effects,[])
  assert.equal(host.page({at:2,forward:true,now:10}).length,1)
  assert.deepEqual(host.page({at:2,now:20}),[])
  assert.deepEqual(host.committed(receipt(before,after)).effects,[])
  assert.deepEqual(host.submit(op('gain','key'),0).effects,[])
  assert.equal(host.history()[0].status,'PLAYED')
})
test('commit before intent, no intent means no automatic gain, duplicate net fact binds once', () => {
  const before = snapshot([]), after = snapshot([row('key')],'r1'), host = queue()
  assert.deepEqual(host.committed(receipt(before,after)).effects,[])
  assert.deepEqual(host.history(),[])
  host.submit(op('gain','key'),0)
  host.submit(op('gain','bronze key',3),1)
  assert.equal(host.history()[1].status,'DUPLICATE')
  assert.equal(host.page({at:2}).length,1)
})
test('short wait admits on the same page; expired wait requires a forward text page', () => {
  const before = snapshot([]), after = snapshot([row('key')],'r1')
  for (const delay of [100,600]) {
    const host = queue()
    host.submit(op('gain','key'),0)
    host.page({at:2,now:0})
    assert.equal(host.committed(receipt(before,after),delay).effects.length,delay < 500 ? 1 : 0)
    if (delay > 500) {
      assert.equal(host.page({at:2,now:delay+1}).length,0)
      assert.equal(host.page({at:1,now:delay+2}).length,0)
      assert.equal(host.page({at:3,forward:true,text:false,now:delay+3}).length,0)
      assert.equal(host.page({at:4,forward:true,now:delay+4}).length,1)
      assert.equal(host.history()[0].late,true)
    }
  }
})
test('late fact may play on the next turn, not on an overlay or blank awaiting page', () => {
  const host = queue(), before = snapshot([]), after = snapshot([row('key')],'r1')
  host.submit(op('gain','key'),0)
  host.page({at:3,now:10})
  host.committed(receipt(before,after),20)
  const nextSource = {...source,messageId:9,generation:3,textDigest:'next'}
  assert.equal(host.page({source:nextSource,at:1,forward:true,overlay:true,now:30}).length,0)
  assert.equal(host.page({source:nextSource,at:2,forward:true,now:40}).length,1)
})
test('show failure is synchronous, correctable in the same run, and pinned to prior inventory', () => {
  const before = snapshot([row('letter')]), host = queue(before)
  assert.equal(host.submit(op('show','key'),0).error.code,'ITEM_NOT_FOUND')
  assert.equal(host.submit(op('show','letter'),0).status,'bound')
  host.committed(receipt(before,snapshot([row('key')],'r1')))
  assert.equal(host.submit(op('show','key'),1).error.code,'ITEM_NOT_FOUND')
  assert.equal(host.page({at:2}).length,1)
})
test('history, skip, disable, reload and branch/generation changes never replay queued events', () => {
  for (const options of [{history:true},{skip:true},{enabled:false},{source:{...source,branchId:'other'}},{source:{...source,generation:3}}]) {
    const host = queue()
    host.submit(op('gain','key'),0)
    assert.equal(host.page({at:2,...options}).length,0)
    assert.equal(host.committed(receipt(snapshot([]),snapshot([row('key')],'r1'))).effects.length,0)
    assert.equal(host.page({at:3,forward:true}).length,0)
  }
  const host = queue(snapshot([row('key')]))
  host.submit(op('show','key'),0)
  const reopened = queue(undefined,{restored:host.snapshot()})
  assert.equal(reopened.page({at:2}).length,0)
  assert.equal(reopened.history()[0].status,'SUPPRESSED')
})
test('settlement failure and correction retain diagnostic history without new animation', () => {
  const host = queue()
  host.submit(op('gain','key'),0)
  host.failed('TASK_TIMEOUT')
  assert.equal(host.history()[0].reason,'TASK_TIMEOUT')
  const played = queue()
  played.submit(op('gain','key'),0)
  played.committed(receipt(snapshot([]),snapshot([row('key')],'r1')))
  played.page({at:2})
  played.corrected('r1')
  assert.equal(played.history()[0].status,'PLAYED')
  assert.equal(played.history()[0].corrected,true)
})
test('receipt baseline must equal the inventory pinned before the director run', () => {
  const host = queue()
  host.submit(op('gain','key'),0)
  const before = snapshot([], 'unrelated'), after = snapshot([row('key')],'r2',{pinned:{previousRevision:'unrelated'}})
  host.committed(receipt(before,after))
  assert.equal(host.history()[0].status,'REFUSED')
  assert.equal(host.page({at:2}).length,0)
})
test('failed settlement rejects later gain but does not invalidate already verified show', () => {
  const host = queue(snapshot([row('letter')]))
  host.submit(op('show','letter'),0)
  host.failed()
  host.submit(op('gain','key'),1)
  assert.equal(host.history()[1].status,'REFUSED')
  assert.equal(host.page({at:2}).length,1)
})
test('per-run op budget and idempotency reject excess and rewritten IDs', () => {
  const host = queue(snapshot([row('key')]))
  for (let i = 0; i < 8; i++) assert.equal(host.submit(op('show','key'),i).ok,true)
  assert.equal(host.submit(op('show','key'),8).error.code,'ITEM_BUDGET_EXCEEDED')
  assert.equal(host.submit(op('show','key'),0).ok,true)
  assert.equal(host.submit(op('show','different'),0).error.code,'INTENT_CONFLICT')
})
test('foreign receipts and mutated caller objects cannot alter the pinned ledger', () => {
  const before = snapshot([row('key')]), host = queue(before)
  before.items[0].count = 0
  assert.equal(host.submit(op('show','key'),0).ok,true)
  assert.equal(host.committed({...receipt(snapshot([]),snapshot([row('key')],'r1')),source:{...source,swipeId:1}}).accepted,false)
  const copy = host.history(); copy[0].bound.item.name = 'injected'
  assert.equal(host.history()[0].bound.item.name,'key')
})
