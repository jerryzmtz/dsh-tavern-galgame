import test from 'node:test'
import {readFileSync} from 'node:fs'
const widget=JSON.parse(readFileSync(new URL('../fork/widgets/items/widget.json',import.meta.url),'utf8'))
import assert from 'node:assert/strict'
import {syntheticPack,cardExtension} from './fixtures/asset-packs/pack.mjs'
import {prepareStageItems,finalizeStageItems,invalidateStageItems} from '../tavern-plugin/lib/domain/stage-items.js'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {prepareAssetPackDirector,buildAssetPackRequest,createAssetPackTransaction} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
const op=(action,name,at=1)=>({op:'item.play',action,name,at})
const batch=ops=>({sequence:1,through:2,done:true,beats:[{at:1,ops}]})
async function fixture(enabled=true){
 const pack=await syntheticPack(),extension=cardExtension();extension.stage={}
 pack.widgets={items:widget};pack.manifest.assets.push({kind:'widgets',id:'items',name:'物品',enabled,recall:{mode:'constant',keywords:[]},directorNote:''})
 extension.variableBindings={version:1,entries:[{target:{kind:'items',slot:'inventory'},variable:{source:'mvu',path:'/inventory'}}]}
 const raw={extensions:{dsh_tavern:extension}},before={inventory:[{id:'letter-id',name:'letter',count:1}]}
 const previous={role:'assistant',greeting:true,swipeId:0,variables:[{stat_data:before}]}
 const message={role:'assistant',turn:2,swipeId:0,mvu:{pending:true},mvuBaseline:{swipeId:0,variables:{stat_data:before}}}
 const chat={id:'chat',sessionId:'session',_storageRevision:10,timeline:{branchId:'branch'},messages:[previous,message],mvu:{openingInitialization:{version:2,status:'complete'}}}
 const items=prepareStageItems(raw,chat,1,[pack])
 const input={raw,snapshots:[{...pack,revision:'pack-r1'}],cardRevision:'card-r1',engine:{},target:{sourceKey:'reply',branchId:'branch',revision:1},units:['one','two'],items}
 const prepared=prepareAssetPackDirector(input),transaction=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
 return {raw,chat,input,prepared,transaction,message,before}
}
test('production director repairs show in the same transaction, persists held gain and binds on MVU commit',async()=>{
 const {transaction,message,chat}=await fixture()
 const first=transaction.submit(batch([op('show','key'),op('gain','key')]))
 assert.equal(first.retryable,true);assert.equal(first.accepted,1);assert.equal(first.errors[0].code,'ITEM_NOT_FOUND')
 const repaired=transaction.submit(batch([op('show','letter')]))
 assert.equal(repaired.sealed,true);assert.equal(repaired.accepted,2)
 message.stageDirectionAssetPacks=transaction.effect();finalizeStageItems(chat,1)
 assert.deepEqual(message.stageItems.records.map(row=>row.status),['READY','HELD'])
 message.variables=[{stat_data:{inventory:[{id:'letter-id',name:'letter',count:1},{id:'key-id',name:'brass key',count:2}]}}]
 message.mvu={pending:false,receipt:{status:'updated'}};finalizeStageItems(chat,1)
 assert.equal(message.stageItems.records[1].bound.item.delta,2)
 assert.equal(message.stageItems.records[1].bound.item.name,'brass key')
 const saved=structuredClone(message.stageItems);finalizeStageItems(chat,1);assert.deepEqual(message.stageItems,saved)
})
test('items admission selects real core or mod routes without changing grammar or retrying handlers',async()=>{
 const {input,message,chat}=await fixture(),builtins=await createFirstPartyMods()
 const command={...builtins.manifest('dsh.items').commands[0],modId:'dsh.items'}
 const prepare=commands=>prepareAssetPackDirector({...input,mods:{revision:'installed-items',commands,schemaCommands:[command]}})
 const off=prepare([]),on=prepare([command]),requests=[off,on].map(p=>buildAssetPackRequest(p,true,undefined,'',true))
 assert.equal(requests[0].system,requests[1].system)
 assert.deepEqual(requests[0].tools,requests[1].tools)
 assert.match(requests[0].sections.find(row=>row.key==='admission-command-guidance').text,/item\.play/)
 assert.ok(!requests[1].sections.some(row=>row.key==='admission-command-guidance'))
 const transaction=p=>createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
 const active=transaction(on),rejected=active.submitModel(batch([op('gain','key')]))
 assert.equal(rejected.retryable,true)
 assert.deepEqual(rejected.errors[0].choices,[command.op])
 const modOp={op:command.op,action:'gain',name:'key',genre:'tool',force:false}
 assert.equal(active.submitModel(batch([modOp])).ok,true)
 assert.deepEqual(active.effect().entries.flatMap(entry=>entry.ops).map(row=>row.op),['mod.command'])
 const core=transaction(off),inactive=core.submitModel(batch([modOp]))
 assert.deepEqual(inactive.errors[0].choices,['item.play'])
 assert.equal(core.submitModel(batch([op('gain','key')])).ok,true)
 message.stageDirectionAssetPacks=core.effect();finalizeStageItems(chat,1)
 assert.deepEqual(message.stageItems.records.map(row=>row.status),['HELD'])
 assert.equal(message.stageItems.records[0].op.op,'item.play')
})
test('op at must equal its enclosing beat; counts and direction op budget are enforced',async()=>{
 const {transaction}=await fixture()
 const result=transaction.submit(batch([op('gain','key',2),{...op('gain','key'),count:1}]))
 assert.equal(result.accepted,0);assert.ok(result.errors.some(row=>row.code==='INVALID_ANCHOR'))
})
test('items off has identical wire prompt to absent feature input',async()=>{
 const {input,prepared}=await fixture(false)
 const a=buildAssetPackRequest(prepared),b=buildAssetPackRequest(prepareAssetPackDirector({...input,items:undefined}))
 assert.equal(JSON.stringify({system:a.system,messages:a.messages,tools:a.tools}),JSON.stringify({system:b.system,messages:b.messages,tools:b.tools}))
 assert.match(JSON.stringify(a.tools),/item\.play/)
 assert.ok(!JSON.parse(a.messages[0].content[0].text).allowedCommands.includes('item.play'))
 assert.equal(prepared.binding.items,undefined)
})
test('settlement first binds only after director commit; changed baseline refuses',async()=>{
 for(const change of [false,true]){
  const {transaction,message,chat,before}=await fixture()
  transaction.submit(batch([op('lose','letter')]))
  message.mvu={pending:false,receipt:{status:'updated'}};message.variables=[{stat_data:{inventory:[]}}]
  if(change)message.mvuBaseline.variables.stat_data={inventory:[{id:'letter-id',name:'letter',count:8}]}
  finalizeStageItems(chat,1);assert.equal(message.stageItems,undefined)
  message.stageDirectionAssetPacks=transaction.effect();finalizeStageItems(chat,1)
  assert.equal(message.stageItems.records[0].status,change?'REFUSED':'READY')
  if(!change)assert.equal(message.stageItems.records[0].bound.item.delta,1)
 }
})
test('production ledger refuses failed or timed out settlement and never replays corrected facts',async()=>{
 for(const mode of ['failed','timeout','corrected']){
  const {transaction,message,chat}=await fixture()
  transaction.submit(batch([op('gain','key'),op('show','letter')]))
  message.stageDirectionAssetPacks=transaction.effect();finalizeStageItems(chat,1,0)
  if(mode==='corrected')invalidateStageItems(message)
  message.mvu={pending:false,receipt:{status:mode==='failed'?'error':'updated'}}
  message.variables=[{stat_data:{inventory:[{id:'letter-id',name:'letter',count:1},{id:'key-id',name:'key',count:1}]}}]
  finalizeStageItems(chat,1,mode==='timeout'?60001:1000)
  assert.equal(message.stageItems.records[0].status,'REFUSED')
  assert.equal(message.stageItems.records[1].status,mode==='corrected'?'CORRECTED':'READY')
 }
})
test('enabled but unmapped inventory remains serializable and show refuses in its tool receipt',async()=>{
 const {raw,chat,input}=await fixture();delete raw.extensions.dsh_tavern.variableBindings
 // private fork: mod-config now auto-detects /inventory; use a genuinely unrecognized unmapped slot.
 chat.messages[0].variables[0].stat_data={unrecognized:chat.messages[0].variables[0].stat_data.inventory}
 const prepared=prepareAssetPackDirector({...input,items:prepareStageItems(raw,chat,1,input.snapshots)})
 const transaction=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
 const result=transaction.submit(batch([op('show','letter')]))
 assert.equal(result.accepted,0);assert.equal(result.errors[0].code,'INVENTORY_UNAVAILABLE')
})
