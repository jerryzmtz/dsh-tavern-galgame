import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import contract from '../tavern-plugin/packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {validateModManifest, validateModPack, validateModPath, validateModVersionRange} from '../tavern-plugin/lib/domain/mods/manifest.js'
import {validateModSettingsSchema, modSettingValue} from '../tavern-plugin/lib/domain/mods/settings.js'
const fixture = new URL('./fixtures/mods/demo/', import.meta.url)
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json',fixture),'utf8'))
const invalid = JSON.parse(await fs.readFile(new URL('./fixtures/mods/invalid.json',import.meta.url),'utf8'))

test('mod contract accepts and deeply freezes a detached manifest without executing it', async () => {
  const checked = validateModManifest(manifest)
  assert.notEqual(checked,manifest)
  assert.ok(Object.isFrozen(checked.commands[0].params.properties.label))
  assert.deepEqual(checked,manifest)
  for (const file of checked.files) assert.equal((await fs.stat(new URL(file.path,fixture))).size,file.size)
  assert.equal(checked.commands[0].placement.section,'director.commands.presentation')
  assert.equal(checked.prompts[0].placement.section,'director.rules.presentation')
})
for (const entry of invalid) test('mod entrance rejects ' + entry.name, () => {
  const value = structuredClone(manifest)
  let parent = value
  for (const part of entry.path.slice(0,-1)) parent = parent[part]
  parent[entry.path.at(-1)] = entry.value
  assert.throws(() => validateModManifest(value),error => error.code === (entry.code || 'MOD_API_UNSUPPORTED') && typeof error.path === 'string')
})
test('prototype keys, duplicate op/verb/ID and unsupported dependency ranges are rejected', () => {
  for (const json of ['{"__proto__":{}}','{"nested":{"constructor":1}}']) assert.throws(() => contract.modJson(JSON.parse(json)))
  for (const delta of [{id:'other'},{id:'other',op:'mod.dsh.demo.other'},{op:'mod.dsh.demo.other',dsl:{verb:'other',syntax:'other'}}]) {
    const value=structuredClone(manifest)
    value.commands.push({...structuredClone(value.commands[0]),...delta})
    assert.throws(() => validateModManifest(value))
  }
  validateModVersionRange('>=1.2.3 <2.0.0')
  for (const value of ['*','^1.0.0','>=1.0.0 <3.0.0','>=01.0.0 <2.0.0']) assert.throws(() => validateModVersionRange(value))
})
test('archive paths are portable, relative and collision-free', () => {
  validateModPath('runtime/main.js')
  for (const value of ['../x','/x','C:/x','a\\x','a//x','a/./x','a/../x','a/NUL.txt','a/end.','https://x']) assert.throws(() => validateModPath(value))
  const value=structuredClone(manifest)
  value.files.push({path:'RUNTIME.js',size:1})
  assert.throws(() => validateModManifest(value))
})
test('field contract covers stable two-level folds, help and declared preview slot', () => {
  const schema=validateModManifest(manifest).settingsSchema
  assert.equal(schema.sections[0].folded,false)
  assert.equal(schema.sections[0].groups[1].folded,true)
  assert.ok(schema.sections[0].help && schema.sections[0].groups[1].help && schema.fields[0].help)
  assert.deepEqual(schema.fields.map(field=>field.type),['text','toggle','slider','segmented','colour','asset-picker','sound-picker'])
  assert.equal(validateModManifest(manifest).ui.preview.entry,'ui/preview.html')
  const layout=structuredClone(manifest)
  layout.ui.layout=[{section:'appearance'},{host:'assets'},{host:'variables'},{host:'advanced'},{page:'preview'}]
  assert.deepEqual(validateModManifest(layout).ui.layout,layout.ui.layout)
  for (const mutate of [
    value=>value.settingsSchema.sections[0].fields=[],
    value=>value.settingsSchema.fields[1].dependsOn={key:'opacity'},
    value=>value.settingsSchema.fields[2].dependsOn={key:'missing'},
    value=>value.settingsSchema.fields[2].dependsOn={key:'visible',equals:'yes'},
    value=>value.ui.layout.push({section:'appearance'}),
    value=>value.ui.layout.push({section:'missing'}),
    value=>delete value.permissions.variables,
    value=>value.ui.preview.entry='missing.html',
    value=>value.ui.preview.modes.push({...value.ui.preview.modes[0]}),
    value=>value.settingsSchema.sections[0].help='First. Second.',
  ]) {
    const invalid=structuredClone(layout);mutate(invalid)
    assert.throws(()=>validateModManifest(invalid),error=>error.code==='MOD_API_UNSUPPORTED' && typeof error.path==='string')
  }
  assert.equal(schema.fields[0].scope,'global')
  assert.equal(schema.fields[5].scope,'global')
  for(const mutate of [value=>delete value.settingsSchema.fields[0].scope,value=>value.settingsSchema.fields[1].scope='card-scoped',value=>value.settingsSchema.fields[0].bindable=true,value=>value.settingsSchema.fields[5].scope='default+card',value=>value.settingsSchema.fields[5].source='main',value=>value.settingsSchema.fields[5].default={modId:'dsh.other',packId:'10000000-0000-4000-8000-000000000001',kind:'icon',entryId:'first'}]) {
    const invalid=structuredClone(manifest);mutate(invalid);assert.throws(()=>validateModManifest(invalid))
  }
})
test('nested object/list and references retain typed defaults and explicit reference ownership', () => {
  const field={key:'rows',type:'list',label:'Rows',maxItems:3,default:[],item:{type:'object',label:'Row',default:{title:''},fields:[{key:'title',type:'text',label:'Title',default:'',maxLength:80}]}}
  validateModSettingsSchema({fields:[field]})
  assert.equal(modSettingValue(field,[{title:'valid'}]),true)
  assert.equal(modSettingValue(field,[{title:17}]),false)
  const ref={key:'icon',type:'reference',label:'Icon',default:null,target:{library:'mod',modId:'dsh.demo',kinds:['icon']}}
  validateModSettingsSchema({fields:[ref]})
  const value={modId:'dsh.demo',packId:'10000000-0000-4000-8000-000000000001',kind:'icon',entryId:'first'}
  assert.equal(modSettingValue(ref,value),true)
  assert.equal(modSettingValue(ref,{...value,modId:'dsh.other'}),false)
  assert.equal(modSettingValue(ref,{...value,path:'C:/private'}),false)
})
test('self-owned packs validate identity, typed entries, recall eligibility and declared media', async () => {
  const pack=JSON.parse(await fs.readFile(new URL('./fixtures/mods/demo-pack.json',import.meta.url),'utf8'))
  const checked=validateModManifest(manifest)
  assert.deepEqual(validateModPack(pack,checked),pack)
  for(const modify of [p=>p.modId='dsh.other',p=>p.entries[0].kind='unknown',p=>p.entries[0].media.image='../outside.png',p=>p.entries[0].recall={mode:'constant',keywords:[]},p=>p.entries.push(structuredClone(p.entries[0]))]) {
    const invalid=structuredClone(pack); modify(invalid)
    assert.throws(()=>validateModPack(invalid,checked))
  }
})
test('P3 contract never holds initial or pending presentation and leaves failed settlements unchanged', () => {
  assert.deepEqual(contract.MOD_SETTLEMENT_POLICY,{initial:'immediate',pending:'play-original',ok:'revise-existing',error:'log-only',skipped:'log-only',replay:'no-one-shots'})
  assert.equal(Object.isFrozen(contract.MOD_SETTLEMENT_POLICY),true)
})
test('public errors use the frozen vocabulary and do not expose unknown exception details', () => {
  assert.deepEqual(contract.MOD_ERRORS,['UNKNOWN_FIELD','MOD_DISABLED','MOD_API_UNSUPPORTED','MOD_DEPENDENCY_MISSING','MOD_PERMISSION_DENIED','MOD_COMMAND_CONFLICT','MOD_REVISION_CONFLICT','MOD_SOURCE_STALE','MOD_RESOURCE_UNAVAILABLE','MOD_RUNTIME_FAILED'])
  assert.deepEqual(contract.modResultError(new Error('secret')),{ok:false,error:{code:'MOD_RUNTIME_FAILED',message:'Mod operation failed',retryable:false}})
})

// private fork (engine row, owner 2026-10): the shipped demo is an internal first-party mod (manifest ui.internal, only `true`);
// listMods flags it and the UI (ModList: 舞台设置 › 模组, the one mod entry — private fork, owner 2026-10: no 模组库 tab) never lists it.
test('the shipped demo mod is internal and flagged in listMods', async () => {
  const {createModRegistry} = await import('../tavern-plugin/lib/domain/mods/registry.js')
  const shipped = JSON.parse(await fs.readFile(new URL('../tavern-plugin/mods/demo/manifest.json', import.meta.url),'utf8'))
  assert.equal(validateModManifest(shipped).ui.internal, true)
  assert.throws(() => validateModManifest({...shipped, ui:{...shipped.ui, internal:false}}), error => error.code === 'MOD_API_UNSUPPORTED')
  const registry = createModRegistry()
  await registry.install({manifest:shipped, expectedRevision:registry.snapshot().revision})
  assert.equal(registry.listMods().mods[0].internal, true)
  const listed = createModRegistry()
  await listed.install({manifest, expectedRevision:listed.snapshot().revision})
  assert.equal(Object.hasOwn(listed.listMods().mods[0], 'internal'), false)
})

// P0 keeps the proposed message API v2 examples alongside production API v1.
test('core/mod P0 examples preserve canonical identities and explicitly remain target contracts', async () => {
  const {coreModV2,replacementExamples,rejectedReplacements,messages} = await import('./fixtures/mods/core-mod-v2.mjs')
  const {default:director} = await import('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs')
  const {resolution} = await import('../tavern-plugin/lib/domain/figure-catalogue.js')
  const {resolveBubbleMood} = await import('../tavern-plugin/lib/domain/dialogue-bubbles.js')
  const proposed=coreModV2(manifest)
  assert.notEqual(proposed.id,proposed.name)
  assert.throws(()=>validateModManifest(proposed))
  const coreTarget=command=>command.mode==='adds' ? command.replaces===undefined : command.mode==='replaces' && typeof command.replaces==='string' && Object.hasOwn(director.byName,command.replaces)
  assert.ok(proposed.commands.every(coreTarget))
  assert.ok(replacementExamples.every(coreTarget))
  assert.ok(rejectedReplacements.every(command=>!coreTarget(command)))
  for(const value of Object.values(messages)) assert.deepEqual(JSON.parse(JSON.stringify(value)),value)
  const actor={actorKey:'actor-canonical',ref:{packId:'11111111-1111-4111-8111-111111111111',figureId:'22222222-2222-4222-8222-222222222222'},name:'Lantern keeper',aliases:['keeper'],enabled:true}
  assert.equal(resolution.resolveFigureName([actor],'keeper').actorKey,actor.actorKey)
  assert.equal(resolveBubbleMood('喜悦',{emotions:[{id:'joy',label:'喜悦'}]}).id,'joy')
})

test('generic variant contract validates kind-owned payloads, explicit selection and reserved time ids',async()=>{
  const {genericVariantExamples:entries,genericVariantCommands:commands}=await import('./fixtures/mods/core-mod-v2.mjs')
  const {validateAssetVariants,selectAssetVariant,variantTarget,backgroundTimeVariant,VARIANT_SWITCH_SCHEMA}=await import('../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variants.js')
  const {shape}=await import('../tavern-plugin/packages/dsh-presentation-protocol/src/asset-pack-json.js')
  const {validateHash}=await import('../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js')
  const ownerCalls=[],validateContent=(kind,content,path)=>{
    ownerCalls.push(kind);shape(content,['media'],['media'],path);validateHash(content.media,path+'.media')
  }
  assert.deepEqual(entries.map(row=>row.kind),['backgrounds','cg','props','music','sfx'])
  for(const row of entries) {
    assert.notEqual(row.id,row.name)
    assert.equal(validateAssetVariants(row.kind,row.variants,validateContent),row.variants)
    assert.equal(selectAssetVariant(row).id,row.variants.default)
    assert.throws(()=>selectAssetVariant(row,'missing'),{code:'REF_UNAVAILABLE'})
    assert.deepEqual(JSON.parse(JSON.stringify(row)),row)
    assert.equal(row.variants.entries.filter(item=>item.id===row.variants.default).length,1)
    assert.equal(new Set(row.variants.entries.map(item=>item.id)).size,row.variants.entries.length)
    assert.ok(row.variants.entries.every(item=>item.content.media && !Object.hasOwn(item,'weather') && !Object.hasOwn(item,'time')))
  }
  for(const command of commands) {
    const entry=entries.find(row=>row.kind===command.kind)
    assert.ok(entry.variants.entries.some(row=>row.id===command.select.variant))
    assert.ok(entry.variants.entries.some(row=>row.id===command.switch.variant))
    assert.equal(command.switch.op,command.select.op.split('.')[0]+'.variant')
  }
  const background=entries[0]
  assert.equal(background.variants.entries.find(row=>row.id==='dusk').name,'Golden hour')
  assert.equal(background.variants.entries.some(row=>row.id==='night'),false)
  assert.equal(background.variants.default,'day')
  assert.equal(entries.some(row=>row.kind==='figures'),false)
  assert.deepEqual([...new Set(ownerCalls)],entries.map(row=>row.kind))
  assert.equal(backgroundTimeVariant(background,'dusk').id,'dusk')
  assert.equal(backgroundTimeVariant(background,'night').id,'day')
  assert.equal(backgroundTimeVariant(background,null).id,'day')
  assert.equal(selectAssetVariant({kind:'music',media:'a'.repeat(64)}),null)
  assert.throws(()=>selectAssetVariant({kind:'music'},'full'),{code:'REF_UNAVAILABLE'})
  for(const mutate of [v=>v.default='missing',v=>v.entries.push(structuredClone(v.entries[0])),v=>v.entries[0].content.kind='music',v=>v.entries[0].time='night',v=>v.entries[0].content.media=7]) {
    const value=structuredClone(background.variants);mutate(value)
    assert.throws(()=>validateAssetVariants('backgrounds',value,validateContent))
  }
  assert.throws(()=>validateAssetVariants('figures',background.variants,validateContent))
  const refs=commands.slice(0,2).map(command=>command.select.background || command.select.cg)
  assert.deepEqual(variantTarget([refs[0]]),refs[0])
  assert.deepEqual(variantTarget(refs,refs[1]),refs[1])
  assert.throws(()=>variantTarget(refs),{code:'REF_UNAVAILABLE'})
  assert.throws(()=>variantTarget([]),{code:'REF_UNAVAILABLE'})
  assert.throws(()=>variantTarget([refs[0]],refs[1]),{code:'REF_UNAVAILABLE'})
  assert.equal(VARIANT_SWITCH_SCHEMA.properties.variant.enum,undefined)
})

// P1 upgrades declarations; the P0 transport examples remain reserved for P3.
test('P1 validates single canonical replacement targets, compatibility ranges and owned builtins',()=>{
  const replacement=structuredClone(manifest)
  Object.assign(replacement.commands[0],{mode:'replaces',replaces:'lighting.mood.set'})
  replacement.compatibility={compatible:[{id:'fixture.other',range:'>=1.0.0 <2.0.0'}],incompatible:[{id:'fixture.blocked',range:'>=1.0.0 <2.0.0',reason:'Same channel'}]}
  assert.equal(validateModManifest(replacement).commands[0].replaces,'lighting.mood.set')
  for(const patch of [{mode:'adds',replaces:'title.play'},{mode:'replaces',replaces:undefined},{mode:'replaces',replaces:['title.play']},{mode:'replaces',replaces:'mod.fixture.other.title'},{mode:'replaces',replaces:'lighting'}]) {
    const value=structuredClone(manifest);Object.assign(value.commands[0],patch)
    assert.throws(()=>validateModManifest(value))
  }
  for(const mutate of [v=>v.compatibility.compatible[0].range='*',v=>v.compatibility.compatible[0].id=v.id,v=>v.builtinAssets=[{id:'frame',path:'missing.png',type:'image'}],v=>v.builtinAssets=[{id:'frame',path:'../frame.png',type:'image'}],v=>v.admission.entryKinds=['props','props']]) {
    const value=structuredClone(replacement);mutate(value);assert.throws(()=>validateModManifest(value))
  }
})


test('P3 message boundary binds host identity and exchanges isolated JSON only',async()=>{
  const {createModMessageTransport}=await import('../tavern-plugin/lib/domain/mods/message-transport.js')
  const {context,messages}=await import('./fixtures/mods/core-mod-v2.mjs')
  assert.throws(()=>createModMessageTransport({context:{...context,hiddenVariables:{secret:true}}}),error=>error.code==='UNKNOWN_FIELD')
  const beforeRound=createModMessageTransport({context:{...context,sourceKey:'',textVersion:'',settledTurn:0},token:'before-round',current:()=>true,
    methods:{'host.context.read':(_args,host)=>host.context}})
  const initial=await beforeRound.dispatch({...messages.request,token:'before-round',method:'host.context.read',args:{}})
  assert.equal(initial.result.ok,true)
  assert.equal(Object.hasOwn(initial.result.value,'turn'),false,'session context does not invent a Round')
  let calls=0
  const data={units:[{text:'Seen'}],inputs:[]}
  const transport=createModMessageTransport({context,token:messages.request.token,current:()=>true,methods:{
    'host.source.window':(args,host)=>{calls++;assert.equal(args.limit,1);return {context:host.context,...data}}
  }})
  const reply=await transport.dispatch(messages.request)
  assert.deepEqual(reply,messages.reply)
  data.units[0].text='Changed in owner'
  assert.equal(reply.result.value.units[0].text,'Seen')
  assert.ok(Object.isFrozen(reply.result.value.context))
  for(const request of [{...messages.request,token:'another-instance'},
    {...messages.request,method:'host.management.saveSettings'},
    {...messages.request,args:{limit:1,sessionId:'another-session'}}]) {
    assert.equal((await transport.dispatch(request)).result.error.code,'MOD_PERMISSION_DENIED')
  }
  assert.equal((await transport.dispatch({...messages.request,args:{callback:()=>{}}})).result.error.code,'MOD_API_UNSUPPORTED')
  assert.equal(calls,1,'invalid envelopes never reach an owner')
})

test('P3 message boundary rejects revoked and late-generation results without retrying',async()=>{
  const {createModMessageTransport}=await import('../tavern-plugin/lib/domain/mods/message-transport.js')
  const {context,messages}=await import('./fixtures/mods/core-mod-v2.mjs')
  let release,calls=0,generation=context.generation
  const transport=createModMessageTransport({context,token:messages.request.token,current:value=>value.generation===generation,methods:{
    'host.source.window':async()=>{calls++;await new Promise(resolve=>{release=resolve});return {text:'Late'}}
  }})
  const request=structuredClone(messages.request),pending=transport.dispatch(request)
  request.requestId='mutated-by-caller'
  generation++;release()
  const reply=await pending
  assert.equal(reply.requestId,messages.request.requestId)
  assert.equal(reply.result.error.code,'MOD_SOURCE_STALE')
  generation=context.generation
  transport.revoke()
  assert.equal((await transport.dispatch(messages.request)).result.error.code,'MOD_SOURCE_STALE')
  assert.equal(calls,1,'revocation does not re-enter or retry the capability')
})

test('P4 declared model/UI ports validate ownership and keep global model selections independent',async()=>{
  const {applyTavernSettingsPatch,presentTavernSettings}=await import('../tavern-plugin/lib/domain/tavern-settings.js')
  const value=structuredClone(manifest)
  value.modelSlots=[{id:'audience',label:'观众模型',purpose:'评论已知剧情',default:'follow-foreground'}]
  value.permissions.models=['audience']
  value.prompts.push({id:'audience',target:'model',modelSlot:'audience',path:value.prompts[0].path,placement:{section:'model.rules',order:0}})
  value.uiLayers=[{id:'audience',entry:value.runtime.entry,band:'audience',order:0,input:'passthrough',playback:'recorded',budget:{maxNodes:64,maxVisible:8}}]
  assert.equal(validateModManifest(value).uiLayers[0].band,'audience')
  const wrong=structuredClone(value);wrong.prompts.at(-1).modelSlot='other'
  assert.throws(()=>validateModManifest(wrong))
  const a=applyTavernSettingsPatch({candidateAutoGenerate:true},{modModelSelection:{modId:'dsh.demo',slotId:'audience',selection:{provider:'fake',model:'canonical'}}})
  const b=applyTavernSettingsPatch(a,{modModelSelection:{modId:'dsh.demo',slotId:'memory',selection:null}})
  assert.deepEqual(presentTavernSettings(b,{}).modModels,{'dsh.demo':{audience:{provider:'fake',model:'canonical'},memory:null}})
  assert.equal(b.candidateAutoGenerate,true)
})

test('P4 editing and preview share one same-kind variant table without changing entry identity',async()=>{
  const {default:helpers}=await import('../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variant-table.cjs')
  const {selectAssetVariant}=await import('../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variants.js')
  for(const content of [{media:'image-ref'},{media:'audio-ref',loop:true}]) {
    const table={default:'a',entries:[{id:'a',name:'A',content},{id:'b',name:'B',content:{...content,media:'other-ref'}}]}
    const entry={id:'stable',kind:'music',variants:table}
    const edited=helpers.editAssetVariantTable(table,{type:'default',id:'b'})
    assert.equal(selectAssetVariant({...entry,variants:edited}).content.media,'other-ref')
    assert.equal(table.default,'a')
    const renamed=helpers.editAssetVariantTable(edited,{type:'rename',id:'b',name:'Shown name'})
    assert.equal(helpers.assetVariantRow(renamed,'b').id,'b')
    assert.equal(helpers.assetVariantRow(renamed,'b').content,table.entries[1].content)
    const moved=helpers.editAssetVariantTable(renamed,{type:'move',id:'b',delta:-1});assert.equal(moved.entries[0].id,'b')
    const removed=helpers.editAssetVariantTable(moved,{type:'remove',id:'b'});assert.equal(selectAssetVariant({...entry,variants:removed}).id,'a')
    assert.throws(()=>helpers.editAssetVariantTable(removed,{type:'remove',id:'a'}))
    assert.throws(()=>selectAssetVariant(entry,'unknown'))
  }
})
