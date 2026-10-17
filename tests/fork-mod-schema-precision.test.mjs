import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {createBuiltinModService} from '../tavern-plugin/lib/fork-mod-service.js'
import {validateModCommand} from '../tavern-plugin/lib/domain/mods/commands.js'
import {createModConfigService} from '../tavern-plugin/lib/domain/mods/config.js'
import {builtinConfigSchemas} from '../tavern-plugin/lib/domain/mods/config-builtins.js'
import {createConfigSourceRegistry} from '../tavern-plugin/lib/domain/mods/config-sources.js'
import {TEXTCARD_TEMPLATE_IDS} from '../fork/mods/textcard/templates.js'
import {ITEM_CATEGORIES} from '../fork/mods/items/categories.js'

const builtins=await createFirstPartyMods()
test('all textcard template schemas match structural and semantic admission',async()=>{
  const manifest=builtins.manifest('dsh.textcard'),module=builtins.module(manifest.id)
  const schemas=module.commandSchema({manifest}),commands=module.configure({manifest}).commands
  const examples=JSON.parse(await readFile(new URL('./fixtures/textcard-templates.json',import.meta.url),'utf8'))
  assert.deepEqual(schemas.map(row=>row.id),TEXTCARD_TEMPLATE_IDS)
  assert.deepEqual(Object.keys(examples),TEXTCARD_TEMPLATE_IDS)
  for(const schema of schemas) {
    const command=commands.find(row=>row.id===schema.id),params=examples[schema.id]
    assert.deepEqual(schema.params,command.params)
    const admit=value=>{validateModCommand(command,value);module.validateCommand(command.id,value)}
    admit(params)
    assert.throws(()=>admit({...params,style:'title'}))
    for(const key of schema.params.required) {
      const missing={...params};delete missing[key]
      assert.throws(()=>admit(missing),command.id+'.'+key+' required')
    }
    // Mutate each nested schema field in an otherwise valid template input.
    const check=(node,value,path=[])=>{
      const rejects=replacement=>{
        const candidate=structuredClone(params)
        let parent=candidate
        for(const key of path.slice(0,-1))parent=parent[key]
        parent[path.at(-1)]=replacement
        assert.throws(()=>admit(candidate),command.id+'.'+path.join('.'))
      }
      if(node.type==='object')for(const [key,child] of Object.entries(node.properties)) {
        if(Object.hasOwn(value,key))check(child,value[key],[...path,key])
      }
      if(node.type==='array') {
        if(node.minItems)rejects(value.slice(0,node.minItems-1))
        rejects(Array.from({length:node.maxItems+1},()=>structuredClone(value[0])))
        value.forEach((item,i)=>check(node.items,item,[...path,i]))
      }
      if(node.type==='string') {
        rejects(' ')
        if(node.minLength)rejects('')
        if(node.maxLength)rejects('x'.repeat(node.maxLength+1))
        if(node.enum)rejects('not-a-template-option')
      }
      if(node.type==='integer') {
        rejects(node.minimum-1);rejects(node.maximum+1);rejects(0.5)
      }
    }
    check(schema.params,params)
  }
  const admit=(id,params)=>{validateModCommand(commands.find(row=>row.id===id),params);module.validateCommand(id,params)}
  const show=schemas.find(row=>row.id==='show')
  const limits=Object.fromEntries(show.params.properties.text.description.replace('Max by preset: ','').replace(/\.$/,'').split('/').map(row=>{const [,id,n]=row.match(/^(\w+?)(\d+)$/);return [id,Number(n)]}))
  assert.deepEqual(Object.keys(limits),show.params.properties.preset.enum)
  for(const [preset,max] of Object.entries(limits)) {
    admit('show',{preset,text:'x'.repeat(max)})
    assert.throws(()=>admit('show',{preset,text:'x'.repeat(max+1)}))
  }
  admit('sequence',{kind:'signal',words:['x'.repeat(24)]})
  assert.throws(()=>admit('sequence',{kind:'signal',words:['x'.repeat(25)]}))
  assert.match(schemas.find(row=>row.id==='sequence').params.properties.words.description,/max24/)
  const relate=examples.relate
  assert.throws(()=>admit('relate',{...relate,people:[relate.people[0],relate.people[0]]}),/Duplicate node/)
  assert.throws(()=>admit('relate',{...relate,links:[{from:'missing',to:relate.people[0].id,label:'link'}]}),/Unknown node/)
  assert.throws(()=>admit('relate',{...relate,links:[{from:relate.people[0].id,to:relate.people[0].id,label:'link'}]}),/different node/)
})

test('installed schema ignores global/card categories while runtime admission keeps exact category choices',async t=>{
  const root=await mkdtemp(fileURLToPath(new URL('../.schema-test-',import.meta.url)))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const itemModule=builtins.module('dsh.items'),empty={manifest:builtins.manifest('dsh.items'),settings:{values:{categories:[]}}}
  assert.equal(itemModule.commandSchema(empty).length,1)
  assert.deepEqual(itemModule.configure(empty).commands,[])
  const globalCategories=ITEM_CATEGORIES.map(row=>({...row,label:'Global '+row.id}))
  const cardCategories=ITEM_CATEGORIES.map(row=>({...row,label:'Card '+row.id}))
  const configService=createModConfigService({schemas:builtinConfigSchemas(builtins.catalogue().map(row=>builtins.manifest(row.id))),sources:createConfigSourceRegistry(),store:{read:async({cardId})=>({revision:'1',global:{categories:{fixed:globalCategories}},card:cardId==='card-override'?{categories:{fixed:cardCategories}}:{}})}})
  const config={async resolved(id,card) {
    const result=await configService.get({modId:id,cardId:card.meta.id}),values={},layers={}
    for(const [key,row] of Object.entries(result.resolved)){values[key]=row.value;layers[key]=row.layer}
    return {values,layers}
  },bindings:async()=>({inventory:{source:'mvu',path:'/bag',fields:{name:'/name'}}})}
  let value={global:{enabledModIds:[],mods:{}},grants:{}},revision=0
  const listeners=new Set(),settings={read:()=>({revision:String(revision),value:structuredClone(value)}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},async compareAndSwap(input){value=structuredClone(input.value);revision++;for(const fn of listeners)fn();return settings.read()}}
  const cards={list:async()=>[],read:async()=>({revision:'1',value:null})}
  const service=createBuiltinModService({root,builtins,settings,cards,config,variables:{},readCard:async cardPath=>({meta:{id:cardPath}}),stage:{read:async()=>undefined,update:()=>assert.fail('No stage writes')}})
  t.after(()=>service.dispose())
  const authority={origin:'https://offline.test'}
  let listed=await service.call('listMods',{},authority)
  await service.call('authorizeMod',{modId:'dsh.items',allowed:true,expectedRevision:listed.revision},authority)
  listed=await service.call('listMods',{},authority)
  await service.call('setModScope',{modId:'dsh.items',scope:'global',expectedRevision:listed.revision},authority)
  let installedSchema
  for(const [cardPath,categories] of [['card-global',globalCategories],['card-override',cardCategories]]) {
    const chat={cardPath,sessionId:'session-'+cardPath,messages:[{role:'assistant',turn:1,text:'An item.'}]}
    const target={sourceKey:'source',branchId:'branch'},first=await service.prepare(chat,1,{target,preview:true})
    const schema=first.schemaCommands.find(command=>command.modId==='dsh.items')
    assert.equal(schema.params.properties.genre.enum,undefined)
    if(installedSchema)assert.equal(JSON.stringify(schema),installedSchema)
    installedSchema=JSON.stringify(schema)
    const resolved=await config.resolved('dsh.items',{meta:{id:cardPath}})
    const [admitted]=builtins.module('dsh.items').configure({manifest:builtins.manifest('dsh.items'),settings:resolved}).commands
    assert.deepEqual(admitted.params.properties.genre.enum,categories.map(row=>row.label).sort())
    for(const genre of ['\u7535\u5b50\u4ea7\u54c1','\u9053\u5177'])assert.throws(()=>validateModCommand(admitted,{action:'show',name:'Device',genre,force:true}),/Choose/)
    chat.messages.push({role:'assistant',turn:2,text:'A different scene.'})
    const second=await service.prepare(chat,2,{target:{...target,sourceKey:'next'},preview:true,judgeRecall:['different']})
    assert.equal(JSON.stringify(second.schemaCommands),JSON.stringify(first.schemaCommands))
    assert.equal(second.grammarRevision,first.grammarRevision)
    const listed=await service.call('listMods',{},authority)
    await service.call('setModScopes',{changes:[{modId:'dsh.items',scope:'off'}],expectedRevision:listed.revision},authority)
    const off=await service.prepare(chat,2,{target,preview:true})
    assert.equal(off.grammarRevision,first.grammarRevision)
    assert.equal(JSON.stringify(off.schemaCommands),JSON.stringify(first.schemaCommands))
    assert.equal(off.commands.length,0)
    const disabled=await service.call('listMods',{},authority)
    await service.call('setModScope',{modId:'dsh.items',scope:'global',expectedRevision:disabled.revision},authority)
  }
})
