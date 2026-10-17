import {distinctMedia} from './fixtures/asset-packs/pack.mjs'
import {assetContent} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variant-content.js'
import {modAssetCatalogue} from '../tavern-plugin/lib/domain/mods/catalogue.js'
import {withBuiltinPhoneDevice} from '../fork/mods/phone/logic.js'
// Registry-driven offline audit. Set DIRECTOR_CONTRACT_REPORT to retain machine-readable evidence.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
import registry from '../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'
import {historicalPerformanceFixture,performanceRef} from './helpers/performance-director-fixture.mjs'
import {officialPhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {createAssetPackTransaction,buildAssetPackRequest,readAssetPackRecord} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {createDirectorHandles} from '../tavern-plugin/lib/domain/stage-director-handles.js'
import {reduceAssetPackOperation,validateAssetPackToolValue} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {stagePlaybackEmotions} from '../tavern-plugin/lib/domain/stage-playback.js'
import {resolveSpriteEmotion} from '../tavern-plugin/shared/sprite-emotions.cjs'

const ref=(kind,id)=>({...performanceRef(id),kind})
const clone=value=>structuredClone(value)
const unsupported=new Set(['$ref','$defs','oneOf','allOf','not','const','patternProperties','pattern','uniqueItems','additionalProperties','minLength','maxLength'])
function keywords(value,path='$',result=[]) {
  if (!value || typeof value!=='object') return result
  if (Array.isArray(value)) {value.forEach((child,i)=>keywords(child,`${path}[${i}]`,result));return result}
  for (const [key,child] of Object.entries(value)) {
    if (unsupported.has(key) || key==='anyOf') result.push({keyword:key,path:path+'.'+key})
    keywords(child,path+'.'+key,result)
  }
  return result
}
const references=value=>keywords(value).filter(row=>['$ref','$defs'].includes(row.keyword))
function sample(schema,defs) {
  if (schema.$ref) return sample(defs[schema.$ref.split('/').at(-1)],defs)
  if (Object.hasOwn(schema,'const')) return clone(schema.const)
  if (schema.enum) return clone(schema.enum[0])
  if (schema.oneOf || schema.anyOf) return sample((schema.oneOf || schema.anyOf)[0],defs)
  if (schema.type==='object') return Object.fromEntries((schema.required || []).map(key=>[key,sample(schema.properties[key],defs)]))
  if (schema.type==='array') return Array.from({length:schema.minItems || 0},()=>sample(schema.items,defs))
  if (schema.type==='boolean') return false
  if (['integer','number'].includes(schema.type)) return schema.minimum ?? 0
  return 'example'.padEnd(schema.minLength || 1,'x').slice(0,schema.maxLength)
}
async function fixture() {
  const f=await historicalPerformanceFixture()
  const phone=await officialPhonePack()
  phone.revision='audit-phone'
  f.input.snapshots.push(phone)
  f.input.raw.extensions.dsh_tavern.assetBindings.boundPackIds.push(PHONE_PACK_ID)
  f.input.assetStatus[PHONE_PACK_ID+'/widgets/phone']={available:true}
  // Discover authored widget vocabularies too; the shipped items widget currently has no commands.
  for (const dir of await readdir(new URL('../fork/widgets/',import.meta.url),{withFileTypes:true})) {
    if (!dir.isDirectory()) continue
    const widget=JSON.parse(await readFile(new URL('../fork/widgets/'+dir.name+'/widget.json',import.meta.url),'utf8'))
    if (!widget.commands?.length) continue
    f.pack.widgets[dir.name]=widget
    f.pack.manifest.assets.push({kind:'widgets',id:dir.name,name:dir.name,enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',bundleKey:dir.name,entry:'widget.json'})
  }
  const mood=distinctMedia(f.pack.manifest.assets.find(row=>row.kind==='looks'),'mood')
  Object.assign(mood,{id:'mood',layer:'mood',recall:{mode:'constant'}});delete mood.timeOfDay
  f.pack.manifest.assets.push(mood,{kind:'cg',id:'rice',name:'Rice',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',variants:{default:'base',entries:[{id:'base',name:'Meal',content:{description:'Eating.',media:assetContent(f.pack.manifest.assets[0]).media,focusHints:[{key:'face',label:'Face',x:.5,y:.3,zoom:1.5}]}}]}},
    {kind:'props',id:'audit-prop',name:'example',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',media:assetContent(f.pack.manifest.assets[0]).media})
  f.pack.widgets.clock.lifetime={until:'explicit',durationSeconds:60}
  f.input.engine.widgetsEnabled=true
  f.input.engine.widgetAuthorizations={}
  for (const asset of f.pack.manifest.assets) {
    const key=assetRefKey(ref(asset.kind,asset.id))
    f.input.assetStatus[key]={available:true,executableDigest:'a'.repeat(64)}
    f.input.engine.widgetAuthorizations[key]='a'.repeat(64)
  }
  f.input.units[0]={kind:'line',alias:'actor',text:'Synthetic message.'}
  f.input.items={enabled:true,inventory:{complete:true,scopeKey:'test',items:[{name:'example',count:2,owner:null}]},scope:{scopeKey:'test',ownerKey:null}}
  const core=f.prepare(),modCommands=[],schemaCommands=[],manifestCommands=[]
  for (const dir of await readdir(new URL('../fork/mods/',import.meta.url),{withFileTypes:true})) {
    if (!dir.isDirectory()) continue
    const root=new URL('../fork/mods/'+dir.name+'/',import.meta.url)
    const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'))
    const runtime=await import(new URL('runtime.js',root))
    const packs=await Promise.all((manifest.defaultPacks || []).map(async path=>({...JSON.parse(await readFile(new URL(path,root),'utf8')),scope:'global'})))
    let catalogue=manifest.admission.entryKinds.some(kind=>['props','performances'].includes(kind))
      ? modAssetCatalogue(manifest,core.context.catalogue)
      : {packs,recalled:packs.flatMap(pack=>pack.entries.filter(entry=>entry.enabled).map(entry=>({modId:manifest.id,packId:pack.id,kind:entry.kind,entryId:entry.id})))}
    if(manifest.id==='dsh.phone')catalogue=withBuiltinPhoneDevice(catalogue)
    const input={manifest,catalogue,settings:{values:{intensity:'standard'}},bindings:{inventory:{source:'mvu',path:'/bag',fields:{name:'/name',count:'/count'}}}}
    const configured=runtime.configure(input).commands.map(command=>({...command,modId:manifest.id}))
    modCommands.push(...configured)
    schemaCommands.push(...(runtime.commandSchema?.(input) || configured).map(command=>({...command,modId:manifest.id})))
    manifestCommands.push(...manifest.commands.map(command=>command.op))
  }
  const mods=f.prepare({mods:{revision:'audit',commands:modCommands,schemaCommands}})
  assert.deepEqual(modCommands.map(row=>row.op).sort(),manifestCommands.sort(),'Every manifest command needs an available offline fixture')
  return {core,mods}
}
function preparedFor(base,definition) {
  const p=clone(base)
  p.baseline.scene={background:ref('backgrounds','classroom'),timeOfDay:'dusk',timeLook:null}
  p.baseline.cast=['actor']
  if (definition.name.startsWith('cg.') && definition.name!=='cg.set') p.baseline.cg={ref:ref('cg','rice'),variant:'base',focus:'full',resumeCast:['actor']}
  for (const row of p.context.catalogue.candidates.widgets) {
    const set=registry.selected(p.context).find(def=>def.ref && assetRefKey(def.ref)===assetRefKey(row.ref) && def.command.effect==='state.set')
    if (set) p.baseline=reduceAssetPackOperation(p.baseline,set.examples(p.context)[0],p.context,{at:1}).state
  }
  return p
}
function example(def,p) {
  const op=sample(def.schema(p.context),registry.defs(p.context))
  for (const [field,kind] of Object.entries(def.refs || {})) if (Object.hasOwn(op,field)) {
    const row=p.context.catalogue.candidates[kind].find(row=>(!def.ref || assetRefKey(row.ref)===assetRefKey(def.ref)) && (!def.lookLayer || row.asset.layer===def.lookLayer))
    op[field]=Array.isArray(op[field])?[row.ref]:row.ref
  }
  if (op.outfit) op.outfit=p.context.outfits[op.actor][0].key
  if (def.name==='cg.focus.set') op.focus='face'
  if (def.name==='scene.variant') op.variant='day'
  if (def.name==='cg.variant') op.variant='base'
  if (def.command?.admission?.performance && Object.hasOwn(op,'ref')) op.ref=def.command.admission.performance.choices[0].ref
  if (def.command?.admission?.source==='phone.message') {op.contact=p.context.phone.aliases[0];op.side='in'}
  for (const rule of def.command?.admission?.names || []) {
    const group=rule.groups.find(group=>group.candidates.length)
    op[rule.scope]=group.value;op[rule.field]=group.candidates[0]
  }
  for (const rule of def.command?.admission?.lists || []) if (!rule.selector || op[rule.selector]===rule.value) op[rule.field]=Array.from({length:rule.minItems},()=>rule.enum?.[0] || 'x')
  return op
}
function mutations(schema,op,defs,path=[]) {
  const result=[]
  const add=(label,value,remove=false)=>result.push({label:path.join('.')+':'+label,path,value,remove})
  if (schema.$ref) return mutations(defs[schema.$ref.split('/').at(-1)],op,defs,path)
  if (schema.const!==undefined) return result
  if (schema.enum) add('enum','__not_a_choice__')
  if (schema.type) add('type',schema.type==='object'?[]:schema.type==='array'?{}:schema.type==='string'?42:'wrong-type')
  if (schema.type==='object') {
    for (const key of schema.required || []) if (key!=='op') result.push({label:[...path,key].join('.')+':required',path:[...path,key],remove:true})
    if (schema.additionalProperties===false) result.push({label:path.join('.')+':unknown',path:[...path,'unexpected'],value:true})
    for (const [key,child] of Object.entries(schema.properties || {})) if (key!=='op') result.push(...mutations(child,op?.[key],defs,[...path,key]))
  }
  if (schema.type==='array') {
    if (schema.minItems>0) add('minItems',[])
    if (schema.maxItems!==undefined) add('maxItems',Array.from({length:schema.maxItems+1},()=>sample(schema.items,defs)))
    if (schema.uniqueItems) add('uniqueItems',[sample(schema.items,defs),sample(schema.items,defs)])
    if (op?.length) result.push(...mutations(schema.items,op[0],defs,[...path,0]))
  }
  if (schema.minimum!==undefined) add('minimum',schema.minimum-1)
  if (schema.maximum!==undefined) add('maximum',schema.maximum+1)
  if (schema.type==='integer') add('integer',(schema.minimum || 0)+.5)
  if (schema.minLength>0) add('minLength','')
  if (schema.maxLength!==undefined) add('maxLength','x'.repeat(schema.maxLength+1))
  for (const child of schema.oneOf || schema.anyOf || []) result.push(...mutations(child,op,defs,path))
  return result
}
function mutate(op,m) {
  if (!m.path.length) return clone(m.value)
  const value=clone(op);let parent=value
  for (const key of m.path.slice(0,-1)) {if (!parent[key] || typeof parent[key]!=='object') parent[key]={};parent=parent[key]}
  if (m.remove) delete parent[m.path.at(-1)];else parent[m.path.at(-1)]=clone(m.value)
  return value
}
const envelope=(op,command)=>({sequence:1,through:8,done:true,beats:[{at:1,ops:command==='transition.play'?[{op:'scene.clear'},op]:[op]}]})
function transact(p,op,wire=false,tx,command=op?.op,modelEncoded=false) {
  tx ||= createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
  let value=envelope(op,command)
  if (wire && !modelEncoded) value={...value,beats:value.beats.map(beat=>({...beat,ops:beat.ops.map(op=>createDirectorHandles(p.context).operation(op))}))}
  return {tx,receipt:wire?tx.submitModel(value):tx.submit(value)}
}
function problemsForReceipt(receipt) {
  const failures=[]
  if (references(receipt).length) failures.push('repair contains $ref/$defs')
  if (Buffer.byteLength(JSON.stringify(receipt))>16384) failures.push('repair exceeds 16 KiB audit budget')
  for (const error of receipt.errors || []) {
    if (!error.path || !error.message || !error.next_action) failures.push('error lacks field/message/next_action')
    if (!error.retryable) failures.push('fixable invalid argument is not retryable')
    if (!error.choices?.length && !error.schema && !/Remove (?:the )?unknown field/.test(error.message+' '+error.next_action)) failures.push('error lacks choices or self-contained schema')
  }
  return [...new Set(failures)]
}

test('every registered director command has a self-contained, repairable admission contract',async t=>{
  const {core,mods}=await fixture(),rows=[]
  const definitions=[...registry.definitions,...registry.selected(core.context).filter(def=>def.ref),...registry.selected(mods.context).filter(def=>def.mod)]
  for (const def of definitions) await t.test(def.name,()=>{
    const p=preparedFor(def.mod?mods:core,def),op=example(def,p),schema=def.schema(p.context)
    const request=buildAssetPackRequest(p),wireSchema=request.tools[0].parameters
    const variants=[]
    const visit=value=>{if (!value || typeof value!=='object') return;if (value.properties?.op?.const===def.name) variants.push(value);Object.values(value).forEach(visit)}
    visit(wireSchema)
    const row={command:def.name,source:def.mod?'mod':def.ref?'widget':'core',example:op,toolSchemaBytes:Buffer.byteLength(JSON.stringify(wireSchema)),unsupported:keywords(variants.length?variants:schema),envelopeKeywords:[...new Set(keywords(wireSchema.properties.beats.items.properties.ops.items).filter(item=>item.path.split('.').length<5).map(item=>item.keyword))],failures:[],cases:[]}
    rows.push(row)
    if (references(wireSchema).length) row.failures.push('frozen tool contains $ref/$defs')
    const descriptions=[]
    const describe=value=>{if (!value || typeof value!=='object')return;if(value.description)descriptions.push(value.description);Object.values(value).forEach(describe)}
    variants.forEach(describe)
    row.descriptions=descriptions
    if (descriptions.some(text=>/climax|danger|narrated|heavy\/everyday|else omit|scene\/mood turn/i.test(text))) row.failures.push('schema description contains when-to-use guidance')
    try {validateAssetPackToolValue(op,schema,'$',{$defs:registry.defs(p.context)})} catch(error) {row.failures.push('sample violates schema: '+error.message)}
    for (const wire of [false,true]) {
      const {tx,receipt}=transact(p,op,wire)
      row.cases.push({case:wire?'valid-wire':'valid-canonical',receipt})
      if (!receipt.ok) row.failures.push((wire?'wire':'canonical')+' valid sample rejected: '+JSON.stringify(receipt.errors))
      else {try {const record=readAssetPackRecord(JSON.parse(JSON.stringify(tx.effect())));assert.deepEqual(record.end,tx.effect().end)} catch(error) {row.failures.push('saved record invalid: '+error.message)}}
    }
    for (const [field,child] of Object.entries(schema.properties)) for (const choice of child.enum || []) {
      const candidate={...op,[field]:choice}
      for (const rule of def.command?.admission?.lists || []) if (!rule.selector || candidate[rule.selector]===rule.value) candidate[rule.field]=Array.from({length:rule.minItems},()=>rule.enum?.[0] || 'x')
      const {receipt}=transact(p,candidate,true)
      row.cases.push({case:field+'='+JSON.stringify(choice),receipt})
      if (!receipt.ok) (row.agreementReview ||= []).push({field,choice,errors:receipt.errors,description:schema.properties[field].description || def.summary})
    }
    const probes=mutations(schema,op,registry.defs(p.context))
    for (const rule of def.command?.admission?.lists || []) {
      const base={...op,...(rule.selector?{[rule.selector]:rule.value}:{}),[rule.field]:Array.from({length:rule.minItems},()=>rule.enum?.[0] || 'x')}
      for (const [label,value] of [['minItems',[]],['maxItems',Array.from({length:rule.maxItems+1},()=>rule.enum?.[0] || 'x')],['nonblank',Array.from({length:rule.minItems},()=> ' ')],['maxLength',Array.from({length:rule.minItems},()=> 'x'.repeat(rule.maxLength+1))],...(rule.enum?[['enum',Array.from({length:rule.minItems},()=> '__not_a_choice__')]]:[])]) probes.push({label:(rule.value || def.name)+':text:'+label,path:[rule.field],value,base,semantic:true})
    }
    for (const field of def.command?.admission?.nonblank || []) probes.push({label:field+':nonblank',path:[field],value:' ',semantic:true})
    for (const m of probes) {
      const invalid=mutate(m.base || op,m)
      // Union alternatives can overlap. Only probe excluded values or declarative admission rules.
      if (!m.semantic) {try {validateAssetPackToolValue(invalid,schema,'$',{$defs:registry.defs(p.context)});continue} catch {}}
      for (const wire of [false,true]) {
        const value=wire?mutate(createDirectorHandles(p.context).operation(m.base || op),m):invalid
        const {tx,receipt}=transact(p,value,wire,undefined,def.name,wire)
        const resumed=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding,checkpoint:tx.savepoint()})
        const repair=transact(p,m.base || op,wire,resumed,def.name).receipt
        const issues=receipt.ok?['schema-invalid value accepted']:problemsForReceipt(receipt)
        if (references({tools:resumed.request.tools,messages:resumed.request.messages}).length) issues.push('resumed request contains $ref/$defs')
        if (!repair.ok) issues.push('valid same-slot retry failed')
        const label=(wire?'wire:':'canonical:')+m.label
        row.cases.push({case:label,receipt,repairOk:repair.ok,issues})
        row.failures.push(...issues.map(issue=>label+': '+issue))
      }
    }
    if (def.name==='actor.outfit.set') {
      // Expressions belong to source bubbles, not director operations. Record that boundary, not a fake repair API.
      const switched=clone(p),actor=op.actor
      switched.baseline.actors[actor].outfitKey='school'
      const tx=createAssetPackTransaction({prepared:switched,getCurrentBinding:()=>switched.binding})
      const receipt=tx.submit({sequence:1,through:8,done:true,beats:[{at:1,ops:[{op:'actor.outfit.set',actor,outfit:'casual'},{op:'cast.add',actor,emotion:'crying'}]}]})
      assert.equal(receipt.ok,false);assert.equal(receipt.accepted,1)
      assert.equal(receipt.errors[0].path,'$.beats[0].ops[1].emotion');assert.equal(receipt.errors[0].retryable,true)
      assert.match(receipt.errors[0].message,/unknown field/i)
      const resumed=createAssetPackTransaction({prepared:switched,getCurrentBinding:()=>switched.binding,checkpoint:tx.savepoint()})
      const repair=resumed.submit(envelope({op:'cast.add',actor}))
      assert.equal(repair.ok,true);assert.equal(resumed.effect().end.actors[actor].outfitKey,'casual')
      const source=stagePlaybackEmotions({displayUnits:[{kind:'line',text:`@bubble:${actor}|Figure|crying|Tears.`}]},1)
      assert.equal(source[actor],'crying')
      const declared=switched.context.actors[actor].emotions.map(e=>e.id)
      assert.ok(declared.includes(source[actor]),'both outfits use the character declaration')
      const before=resolveSpriteEmotion({emotions:{calm:{},joy:{},crying:{}}},source[actor],['calm',...declared])
      const after=resolveSpriteEmotion({emotions:{calm:{},joy:{}}},source[actor],['calm',...declared])
      assert.equal(before.missing,false);assert.equal(after.missing,true);assert.equal(after.resolvedEmotion,'calm')
      assert.equal(resolveSpriteEmotion({emotions:{calm:{}}},'joy',['calm','joy']).missing,true,'deleted art stays missing')
      row.cases.push({case:'same-beat-outfit-switch-unsupported-emotion-field',receipt,repairOk:repair.ok,source,before,after})
      ;(row.agreementReview ||= []).push({field:'source @bubble emotion',choice:'crying',errors:[],description:'Source requests character crying after switching to casual. Director grammar cannot write emotion; the outfit without crying art uses its own default without changing the source.'})
    }
    row.failures=[...new Set(row.failures)]
    assert.deepEqual(row.failures,[],JSON.stringify({command:row.command,failures:row.failures},null,2))
  })
  if (process.env.DIRECTOR_CONTRACT_REPORT) {
    await mkdir(dirname(process.env.DIRECTOR_CONTRACT_REPORT),{recursive:true})
    await writeFile(process.env.DIRECTOR_CONTRACT_REPORT,JSON.stringify({generatedAt:new Date().toISOString(),commands:rows.length,rows},null,2)+'\n')
  }
})
