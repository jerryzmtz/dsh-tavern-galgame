// private fork: infrastructure exercised by a non-widget provider, without assets or director.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createVariableBindingRegistry, validateCardVariableBindings, analyzeVariableSchema, resolveVariable } from '../tavern-plugin/lib/domain/variable-bindings/index.js'
import { createCardAssetBoundary } from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import { cardVariableRegistry } from '../tavern-plugin/lib/domain/card-variable-bindings.js'
import hook from '../tavern-plugin/src/client/fork-variable-bindings.cjs'
const target={kind:'inventory-test',slot:'inventory'}
const slot={target,label:'Inventory',valueType:'array',default:[],fieldMapping:{name:{valueType:'string',required:true},count:{valueType:'number'}},guessHints:{keywords:['inventory']}}
const provider={id:'inventory-test',label:'Items',slots:()=>[slot]}
const raw={character_book:{entries:[{comment:'initvar',content:'inventory:\n  - name: initial\n    count: 1'}]}}
test('non-widget provider guesses structured list, resolves sources and maps fields without mutation',()=>{
  const registry=createVariableBindingRegistry();registry.register(provider)
  const sources={mvu:{available:true,value:{inventory:[{name:'live',count:2}]}}}
  const row=registry.list({raw,context:{},sources})[0].slots[0]
  assert.equal(row.source,'auto');assert.deepEqual(row.value,[{name:'live',count:2}]);assert.equal(row.candidates.length,1)
  const bindings={version:1,entries:[{target,variable:{source:'helper-chat',path:'/bag',fields:{name:'/title',count:'/qty'}}}]}
  validateCardVariableBindings(bindings);registry.validateSlots(bindings,{})
  const card={...raw,extensions:{dsh_tavern:{variableBindings:bindings}}},before=JSON.stringify(card)
  const result=registry.list({raw:card,sources:{'helper-chat':{available:true,value:{bag:[{title:'Potion',qty:3}]}}}})[0].slots[0]
  assert.equal(result.source,'author');assert.deepEqual(result.value,[{name:'Potion',count:3}]);assert.equal(JSON.stringify(card),before)
  assert.equal(registry.list({raw:card,sources:{}})[0].slots[0].status,'unavailable')
  assert.throws(()=>registry.register(provider))
  assert.throws(()=>registry.validateSlots({entries:[{target,variable:{source:'mvu',path:'/bag',fields:{count:'/qty'}}}]},{}))
})
test('generic path boundaries, type checks and bounded read do not require widget contracts',()=>{
  for(const path of ['/constructor/x','/__proto__/x','/a~2b','/a[-1]'])assert.throws(()=>validateCardVariableBindings({version:1,entries:[{target,variable:{source:'mvu',path}}]}))
  const registry=createVariableBindingRegistry();registry.register(provider)
  const sources={mvu:{available:true,value:{inventory:'bad'}}}
  const auto=registry.list({raw,sources})[0].slots[0]
  assert.equal(auto.source,'default');assert.deepEqual(auto.value,[])
  const mapped={...raw,extensions:{dsh_tavern:{variableBindings:{version:1,entries:[{target,variable:{source:'mvu',path:'/inventory'}}]}}}}
  assert.equal(registry.list({raw:mapped,sources})[0].slots[0].status,'type-mismatch')
  assert.deepEqual(resolveVariable({source:'mvu',path:'/a~1b/0'},{mvu:{available:true,value:{'a/b':['ok']}}}),{status:'ready',value:'ok'})
  assert.equal(resolveVariable({source:'mvu',path:'/big'},{mvu:{available:true,value:{big:'x'.repeat(9000)}}}).status,'too-large')
  assert.equal(analyzeVariableSchema({character_book:{entries:[{comment:'initvar',content:'z.object({inventory: z.array()})'}]}}).length,0)
})
test('read API works for a registered feature without an asset service or director',async()=>{
  const unregister=cardVariableRegistry.register(provider)
  try {
    const api=createCardAssetBoundary({ctx:{get:()=>null},listCards:async()=>[{path:'card'}],readWorkspace:async()=>({raw}),readVariableSources:async({path,sessionId})=>{assert.equal(path,'card');assert.equal(sessionId,'chat');return {mvu:{available:true,value:{inventory:[]}}}}})
    const result=await api.readCardVariables({path:'card',sessionId:'chat',targets:[target]})
    assert.equal(result.providers[0].id,provider.id);assert.equal(result.providers[0].slots[0].status,'ready')
    assert.deepEqual((await api.readCardVariables({path:'card',sessionId:'chat',targets:[]})).providers,[])
    await assert.rejects(api.readCardVariables({path:'unknown',sessionId:'chat'}),{code:'NOT_FOUND'})
  } finally {unregister()}
})
test('client factory has explicit RPC/signal dependencies and discards requests after cleanup',async()=>{
  let effect,state,resolve,stopped=false
  const React={useState:()=>[{},value=>{state=typeof value==='function'?value(state||{}):value}],useReducer:()=>[0,()=>{}],useEffect:fn=>{effect=fn}}
  const {useCardVariables}=hook.createForkVariableBindingsClient({React,rpc:(method,args)=>{assert.equal(method,'readCardVariables');assert.equal(args.path,'card');return new Promise(done=>{resolve=done})},signals:{subscribe:()=>()=>{stopped=true}}})
  useCardVariables({path:'card',sessionId:'chat'});const cleanup=effect();assert.equal(state.loading,true)
  cleanup();resolve({providers:[]});await Promise.resolve();assert.equal(stopped,true);assert.equal(state.data,null)
})
