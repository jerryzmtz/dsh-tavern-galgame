import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveStateSource,ledgerSource,stateSourceHints,ledgerInventoryBinding,stateSourceSchema,ledgerConfigExports} from '../tavern-plugin/lib/domain/mods/state-source.js'
import {createConfigSourceRegistry} from '../tavern-plugin/lib/domain/mods/config-sources.js'
import {createModConfigService} from '../tavern-plugin/lib/domain/mods/config.js'
import {builtinConfigSchemas} from '../tavern-plugin/lib/domain/mods/config-builtins.js'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {configure} from '../fork/mods/items/runtime.js'
import {selectItem,itemCatalogue,reconcileItems} from '../fork/mods/items/logic.js'

const chat={ledger:{version:1,items:[{name:'钥匙',qty:2},{name:'寄存书',qty:3,carried:false}],npcs:[],location:'图书馆',consolidatedTurn:3}}

test('one resolver: auto uses presence (including empty/pending MVU), manual never falls back, ledger stays read-only',()=>{
  const original=structuredClone(chat),mvu={available:true,value:{inventory:[]}}
  assert.equal(resolveStateSource({chat,sources:{mvu}}).source,'mvu')
  assert.equal(resolveStateSource({chat}).source,'ledger')
  assert.deepEqual(resolveStateSource({preference:'mvu',chat}),{source:'mvu',available:false})
  assert.equal(resolveStateSource({preference:'ledger',chat,sources:{mvu}}).source,'ledger')
  for(const args of [{chat:{...chat,mvu:{enabled:true}}},{raw:{first_mes:'<initvar>{"inventory":[]}</initvar>'},chat},{raw:{extensions:{mvu:{enabled:true}}},chat}]) {
    assert.equal(resolveStateSource(args).source,'mvu')
    assert.equal(resolveStateSource(args).available,false)
  }
  assert.equal(resolveStateSource({}).available,false)
  const empty=resolveStateSource({chat:{ledger:{items:[]}}})
  assert.equal(empty.available,true);assert.deepEqual(empty.value.inventory,[])
  const source=ledgerSource(chat)
  assert.deepEqual(source.value.inventory,[{name:'钥匙',qty:2}])
  source.value.inventory[0].qty=100
  assert.deepEqual(chat,original)
})

test('ledger config uses the real mapping/formula service; unknown qty errors, phone does not fall through to MVU, source setting is global',async()=>{
  const builtins=await createFirstPartyMods(),schemas={...builtinConfigSchemas(builtins.catalogue().map(row=>builtins.manifest(row.id))),'dsh.state':stateSourceSchema}
  const sources=createConfigSourceRegistry()
  for(const id of ['mvu','ledger'])sources.register({id,label:id,exports:id==='ledger'?ledgerConfigExports:[],read:ctx=>ctx.sources?.[id] || {available:false}})
  const documents={}
  const store={read:async({modId})=>({revision:'0',global:documents[modId] || {},card:{}}),write:async args=>{documents[args.modId]=args.values}}
  const service=createModConfigService({schemas,store,sources}),values={mvu:{available:true,value:{时间:'08:00'}},ledger:ledgerSource(chat)}
  const ctx={sources:values,stateSource:resolveStateSource({preference:'ledger',chat,sources:values})}
  const inventory=await service.resolve('dsh.items','inventory',ctx)
  assert.deepEqual(inventory.value,[{name:'钥匙',count:2,description:undefined}])
  assert.deepEqual(inventory.autoCandidates[0].variable,ledgerInventoryBinding)
  assert.equal((await service.resolve('dsh.phone','clockText',ctx)).value,schemas['dsh.phone'].fields.find(row=>row.key==='clockText').default)
  assert.equal((await service.evaluate('{ledger:/consolidatedTurn}+1',ctx)).value,4)
  values.ledger=ledgerSource({ledger:{items:[{name:'数量未知'}]}})
  assert.equal((await service.resolve('dsh.items','inventory',ctx)).error.code,'CONFIG_TYPE')
  await assert.rejects(service.set({modId:'dsh.state',key:'source',layer:'card',cardId:'card',value:{fixed:'ledger'},expectedRevision:'0'}),{code:'UNKNOWN_FIELD'})
  for(const source of ['mvu','ledger','auto']) {
    await service.set({modId:'dsh.state',key:'source',layer:'global',value:{fixed:source},expectedRevision:'0'})
    assert.equal((await service.resolve('dsh.state','source')).value,source)
  }
  const manifest=builtins.manifest('dsh.items'),catalogue=itemCatalogue()
  // Ledger permits display only; gain/lose belong to a declared MVU settlement binding.
  const payload=selectItem(catalogue,{action:'show',name:'钥匙',genre:'misc',force:true},{binding:ledgerInventoryBinding})
  const [revision]=reconcileItems({bindings:{inventory:ledgerInventoryBinding},performances:[{id:'show',revision:0,payload}]})
  assert.equal(revision.action,'replace')
  assert.equal(revision.payload.count,undefined)
  for(const action of ['gain','lose']) {
    assert.throws(()=>selectItem(catalogue,{action,name:'钥匙',genre:'misc',force:true},{binding:ledgerInventoryBinding}),{code:'MOD_DEPENDENCY_MISSING'})
    assert.doesNotThrow(()=>selectItem(catalogue,{action,name:'钥匙',genre:'misc',force:true},{binding:{...ledgerInventoryBinding,source:'mvu'}}))
  }
  const command=configure({manifest,bindings:{inventory:ledgerInventoryBinding}}).commands[0]
  assert.deepEqual(command.admission.requires,[{field:'action',values:['gain','lose'],available:false,code:'MOD_DEPENDENCY_MISSING'}])
  assert.equal(configure({manifest,bindings:{inventory:{...ledgerInventoryBinding,source:'mvu'}}}).commands[0].admission.requires[0].available,true)
})

test('character hints resolve aliases and traditional names to canonical identities, not resources or stage changes',()=>{
  const rows=[{actorKey:'canonical-007',name:'医师',aliases:['阿醫'],enabled:true,ref:{packId:'p',figureId:'f'}}]
  const selected={source:'ledger',available:true,value:{location:'诊所',consolidatedTurn:2,npcs:[{name:'阿醫',important:true,location:'诊所'},{name:'无资源人物',follow:true}],items:[{name:'SECRET_ITEM'}]}}
  const hints=stateSourceHints(selected,rows)
  assert.deepEqual(hints,{source:'ledger',through:2,location:'诊所',characters:[{actor:'canonical-007',location:'诊所'}]})
  assert.equal(stateSourceHints(selected,rows,{},{}),null)
  assert.equal(stateSourceHints({source:'ledger',available:true,value:{npcs:[]}},rows),null)
  assert.deepEqual(stateSourceHints({source:'mvu',available:true,value:{地点:['门口','位置'],characters:[{name:'医师',location:'门口'}]}},rows),{source:'mvu',location:'门口',characters:[{actor:'canonical-007',location:'门口'}]})
})
