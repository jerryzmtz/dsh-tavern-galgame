import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,mkdir,rm,readdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {createModMigrationJournal} from '../tavern-plugin/lib/fork-mod-migration.js'
import {planItemsMigration,ITEMS_SOURCE_IDS,migrationPackValue} from '../fork/mods/items/migration.js'
const root=new URL('../fork/mods/items/',import.meta.url)
// This migration's input is the pre-categories release, not today's built-in schema.
const {manifest,packs:targetPacks}=JSON.parse(await readFile(new URL('./fixtures/items-legacy-release.json',import.meta.url)))
const document=JSON.parse(await readFile(new URL('../fork/widgets/items/widget.json',import.meta.url)))
const clone=structuredClone
function fixture() {
  const packs=targetPacks.map((pack,i)=>{
    const blobs={},assets=pack.entries.map(entry=>{
      const category=entry.kind==='icon'?pack.fields.genres.find(row=>row.icon.entryId===entry.id).label:pack.fields.genres.find(row=>row.id===entry.fields.genreId).label
      const hash=path.posix.basename(entry.media.image,'.png');blobs[hash]={ext:'png',size:pack.files.find(row=>row.path===entry.media.image).size}
      return {id:entry.id,kind:'items',name:entry.name,category,categoryDefault:entry.kind==='icon',enabled:entry.enabled,media:hash,aliases:[],...(entry.recall?{recall:clone(entry.recall)}:{}),directorNote:entry.directorNote || ''}
    })
    if(i===0)assets.push({id:'items',kind:'widgets',enabled:true,settingsDefaults:{inventoryNames:true}})
    return {revision:'source-'+i,manifest:{id:pack.id,assets,blobs,figures:[],sprites:{}},widgets:i===0?{items:clone(document)}:{}}
  })
  const variable={source:'mvu',path:'/背包',fields:{name:'/名称',count:'/数量'}}
  const cards=[{key:'fish',cardId:'card-fish',revision:'c1',value:{schemaVersion:1,stage:{widgets:false},assetBindings:{boundPackIds:[...ITEMS_SOURCE_IDS,'phone-pack']},variableBindings:{version:1,entries:[{target:{kind:'items',slot:'inventory'},variable}]}}},...['neuro','madoka'].map(key=>({key,cardId:'card-'+key,revision:'c1',value:{schemaVersion:1,assetBindings:{boundPackIds:[]}}}))]
  return {packs,cards,assetSettings:{revision:'a1',value:{globalEnabledPackIds:['unrelated-global']}},modSettings:{revision:'m1',value:{global:{enabledModIds:[],mods:{}},grants:{}}},modState:{mods:{'dsh.items':{manifest,releaseRevision:'items-release',packs:Object.fromEntries(targetPacks.map(row=>[row.id,row]))}}}}
}
test('item migration uses a global switch, preserves pack lamps, native mapping, S4 and phone fields without mutating inputs',()=>{
  const input=fixture(),before=JSON.stringify(input),plan=planItemsMigration(input)
  assert.equal(JSON.stringify(input),before)
  assert.deepEqual(plan.evidence.cards.map(row=>row.before.mod),['card','off','off'])
  assert.deepEqual(plan.evidence.cards.map(row=>row.after.mod),['global','global','global'])
  for(const row of plan.evidence.cards)assert.deepEqual(row.before.packs,row.after.packs)
  const card=plan.changes.find(row=>row.owner==='cards').after
  assert.deepEqual(card.assetBindings.boundPackIds,['phone-pack'])
  assert.deepEqual(card.stage,{widgets:false})
  assert.deepEqual(card.variableBindings.entries[0].variable,input.cards[0].value.variableBindings.entries[0].variable)
  assert.deepEqual(card.variableBindings.entries[0].target,{kind:'mods',modId:'dsh.items',slot:'inventory'})
  assert.equal(plan.changes.find(row=>row.owner==='modSettings').after.global.mods['dsh.items'].settings.s4,true)
  assert.equal(plan.evidence.chatWrites,0)
  assert.deepEqual(plan.changes.filter(row=>row.owner==='packs').map(row=>row.key),ITEMS_SOURCE_IDS)
  const global=fixture();global.assetSettings.value.globalEnabledPackIds.push(ITEMS_SOURCE_IDS[1])
  assert.equal(planItemsMigration(global).evidence.cards[1].after.packs[ITEMS_SOURCE_IDS[1]],'global')
  const disabled=fixture();disabled.packs[0].manifest.assets.at(-1).enabled=false
  const off=planItemsMigration(disabled)
  assert.equal(off.evidence.cards[0].after.mod,'off')
  assert.equal(off.changes.find(row=>row.owner==='modSettings').after.global.mods['dsh.items'].settings.s4,true)
})
test('inexact sources, authored destination, missing mapping and mixed/copy content stop during pure preflight',()=>{
  for(const mutate of [
    x=>x.packs.pop(),x=>x.packs[0].manifest.assets.push({id:'phone',kind:'widgets'}),
    x=>x.packs[0].manifest.assets.at(-1).extensions={dsh_tavern:{copiedFrom:{}}},
    x=>delete x.cards[0].value.variableBindings,
    x=>x.cards[0].value.modBindings={version:1,mods:{'dsh.items':{enabled:true,boundPackIds:[]}}},
    x=>x.modState.mods['dsh.items'].packs[ITEMS_SOURCE_IDS[0]].entries[0].name='independent edit',
    x=>x.packs[0].manifest.assets.at(-1).settingsDefaults.other=true,
  ]){const input=fixture();input.modState=clone(input.modState);mutate(input);assert.throws(()=>planItemsMigration(input),{code:'ITEMS_MIGRATION_INEXACT'})}
})
async function journalFixture() {
  const directory=fileURLToPath(new URL('../.tmp/',import.meta.url));await mkdir(directory,{recursive:true})
  const root=await mkdtemp(path.join(directory,'items-migration-')),input=fixture()
  input.assetSettings.value.globalEnabledPackIds.push(ITEMS_SOURCE_IDS[1])
  const plan=planItemsMigration(input),state=new Map(),calls=[]
  for(const change of plan.changes)state.set(change.owner+'/'+change.key,clone(change.before))
  let failAt=-1,foreign=null,backups=0
  const owners=Object.fromEntries(['cards','modSettings','assetSettings','packs'].map(owner=>[owner,{
    async read(key){return clone(state.get(owner+'/'+key))},
    async compareAndSwap({key,expectedRevision,expectedValue,value}) {
      const id=owner+'/'+key,current=state.get(id)
      assert.equal(current.revision,expectedRevision);assert.deepEqual(current.value,expectedValue)
      state.set(id,{revision:current.revision+'+',value:clone(value)});calls.push(id)
      if(calls.length===failAt)throw Error('crash after owner CAS')
    },
  }]))
  const open=()=>createModMigrationJournal({root,owners,backup:async()=>{backups++;if(foreign)foreign();return {id:'durable-backup'}}})
  return {root,input,plan,state,calls,open,crash:n=>{failAt=n},foreign:fn=>{foreign=fn},backups:()=>backups,cleanup:()=>rm(root,{recursive:true,force:true})}
}
test('dry-run writes nothing; each native publication can resume after lost ack; rerun is zero-write and rollback restores sources',async()=>{
  for(let point=1;point<=5;point++) {
    const h=await journalFixture()
    try {
      await h.open().dryRun(h.plan);assert.equal(h.calls.length,0);assert.equal(h.backups(),0);assert.deepEqual(await readdir(h.root),[])
      h.crash(point);await assert.rejects(h.open().apply(h.plan),/crash/)
      assert.equal((await h.open().resume(h.plan.id)).status,'complete');assert.equal(h.calls.length,h.plan.changes.length);assert.equal(h.backups(),1)
      assert.equal((await h.open().apply(h.plan)).writes,0);assert.equal(h.calls.length,h.plan.changes.length)
      h.crash(h.calls.length+1);await assert.rejects(h.open().rollback(h.plan.id),/crash/)
      assert.equal((await h.open().rollback(h.plan.id)).status,'rolled-back')
      for(const change of h.plan.changes)assert.deepEqual(h.state.get(change.owner+'/'+change.key).value,change.before.value)
      assert.equal((await h.open().rollback(h.plan.id)).writes,0)
    } finally {await h.cleanup()}
  }
})
test('CAS drift before backup, during backup, or after publication never overwrites an independent owner',async()=>{
  for(const phase of ['before','backup','after']) {
    const h=await journalFixture()
    try {
      const edit=()=>{const row=h.state.get('cards/fish');row.revision+='foreign';row.value.stage.widgets=true}
      if(phase==='before')edit()
      if(phase==='backup')h.foreign(edit)
      if(phase==='after'){await h.open().apply(h.plan);edit();await assert.rejects(h.open().rollback(h.plan.id),{code:'MOD_MIGRATION_CONFLICT'})}
      else {await assert.rejects(h.open().apply(h.plan),{code:'MOD_MIGRATION_CONFLICT'});assert.equal(h.calls.length,0)}
      assert.equal(h.state.get('cards/fish').value.stage.widgets,true)
    } finally {await h.cleanup()}
  }
  assert.equal(Object.hasOwn(migrationPackValue({revision:'r',installedAt:1,updatedAt:2,manifest:{id:'p'}}),'revision'),false)
})
test('separate controller instances share one journal queue, and rollback leaves untouched owners alone',async()=>{
  const h=await journalFixture()
  try {
    await Promise.all([h.open().apply(h.plan),h.open().apply(h.plan)])
    assert.equal(h.calls.length,h.plan.changes.length);assert.equal(h.backups(),1)
  } finally {await h.cleanup()}
  const partial=await journalFixture()
  try {
    partial.crash(1);await assert.rejects(partial.open().apply(partial.plan),/crash/)
    const key='packs/'+ITEMS_SOURCE_IDS[1],foreign=partial.state.get(key)
    foreign.revision+='foreign';foreign.value.manifest.note='user edit'
    assert.equal((await partial.open().rollback(partial.plan.id)).status,'rolled-back')
    assert.equal(partial.state.get(key).value.manifest.note,'user edit')
    assert.deepEqual(partial.state.get('cards/fish').value,partial.plan.changes[0].before.value)
  } finally {await partial.cleanup()}
})

test('native card, settings, mod-library and pack owners complete a durable migration and archive rollback',async t=>{
  const {nativeItemsMigrationFixture}=await import('./helpers/mod-items-migration.mjs')
  const h=await nativeItemsMigrationFixture(t,{input:fixture()}),before=await Promise.all(h.keys.map(key=>h.readWorkspace(key)))
  let inspections=0,exportsDisposed=0
  h.config.packs={...h.packs,async inspectImport(...args){inspections++;return h.packs.inspectImport(...args)},async exportPack(...args){const archive=await h.packs.exportPack(...args);return {...archive,async dispose(){exportsDisposed++;await archive.dispose?.()}}}}
  await h.assetSettings.save({expectedRevision:h.assetSettings.read().revision,globalEnabledPackIds:[ITEMS_SOURCE_IDS[1]]})
  const settingsBefore=h.settings.read().value,assetsBefore=h.assetSettings.read().values,count=h.events.length
  const backup=await h.open().backup()
  assert.equal(h.events.length,count,'Backup does not publish source owners')
  assert.equal((await h.open().dryRun(backup.backupId)).writes,0)
  assert.equal(h.events.length,count)
  const archive=path.join(h.root,'migration/backups',backup.backupId,ITEMS_SOURCE_IDS[0]+'.zip'),bytes=await readFile(archive)
  await writeFile(archive,'damaged backup')
  await assert.rejects(h.open().apply(backup.backupId),{code:'ITEMS_MIGRATION_INEXACT'});assert.equal(h.events.length,count,'Truncated backup blocks every source publication')
  await writeFile(archive,bytes)
  const applied=await h.open().apply(backup.backupId)
  assert.equal(applied.status,'complete');assert.equal(inspections,0,'Local backups are not reimported or rehashed');assert.equal(exportsDisposed,2)
  for(const id of ITEMS_SOURCE_IDS)assert.equal(await h.packs.getPackSnapshot({packId:id}),null)
  assert.equal((await h.open().verify()).writes,0)
  const committed=h.events.length
  assert.equal((await h.open().apply(backup.backupId)).status,'complete');assert.equal(h.events.length,committed)
  for(let i=0;i<h.keys.length;i++) {
    const after=await h.readWorkspace(h.keys[i]),old=clone(before[i].raw),now=clone(after.raw)
    const raw=value=>value.data || value
    delete raw(old).extensions.dsh_tavern;delete raw(now).extensions.dsh_tavern
    assert.deepEqual(now,old,'Non-migration authored raw stays exact')
  }
  assert.equal((await h.open().rollback()).status,'rolled-back')
  assert.deepEqual(h.settings.read().value,settingsBefore);assert.deepEqual(h.assetSettings.read().values,assetsBefore)
  for(let i=0;i<h.keys.length;i++)assert.deepEqual((await h.readWorkspace(h.keys[i])).raw,before[i].raw)
  for(const id of ITEMS_SOURCE_IDS)assert.deepEqual(migrationPackValue(await h.packs.getPackSnapshot({packId:id})),migrationPackValue(h.originalPacks.get(id)))
})

test('read-only guards and completed reruns detect independent changes without owner writes',async()=>{
  const h=await journalFixture()
  try {
    const key='cards/guard',value={revision:'g1',value:{off:true}};h.state.set(key,value)
    h.plan.guards=[{owner:'cards',key:'guard',before:clone(value)}]
    value.revision='g2';await assert.rejects(h.open().apply(h.plan),{code:'MOD_MIGRATION_CONFLICT'});assert.equal(h.calls.length,0)
    value.revision='g1';await h.open().apply(h.plan)
    const count=h.calls.length;h.state.get('cards/fish').revision+='foreign'
    await assert.rejects(h.open().apply(h.plan),{code:'MOD_MIGRATION_CONFLICT'});assert.equal(h.calls.length,count)
  } finally {await h.cleanup()}
})
test('latest-turn guard reads only native windows, survives durable JSON and rejects retiring asset refs',async()=>{
  const {createItemsReplayInspection}=await import('../tavern-plugin/lib/fork-mod-items-migration.js')
  const calls=[],message={role:'assistant',turn:2,text:'untouched'},inspect=createItemsReplayInspection({chatIds:['one'],readIndex:async()=>({_storageRevision:'r1',messages:[{role:'assistant'},{role:'assistant'}]}),readWindow:async(id,args)=>{calls.push(args);return {revision:'r1',chat:{messages:[message]}}}})
  const before=await inspect();assert.deepEqual(JSON.parse(JSON.stringify(before)),await inspect())
  assert.ok(calls.every(row=>row.limit===1 && row.before===2 && row.revision==='r1'))
  message.ref={packId:ITEMS_SOURCE_IDS[0],assetId:'old',kind:'items'}
  await assert.rejects(inspect(),{code:'ITEMS_MIGRATION_INEXACT'})
  message.ref={modId:'dsh.items',packId:ITEMS_SOURCE_IDS[0],entryId:'new',kind:'icon'}
  await inspect()
})
test('retired private-items migration has no production dispatcher; archived driver keeps its envelope fixture',async()=>{
  const index=await readFile(new URL('../tavern-plugin/lib/index.js',import.meta.url),'utf8')
  assert.doesNotMatch(index,/case 'migrateModItems'|from '\.\/fork-mod-items-migration\.js'/)
  let source=await readFile(new URL('../bin/fork-migrate-mod-items.cdp.js',import.meta.url),'utf8')
  source=source.replace("const fs=await import('node:fs/promises'),path=(await import('node:path')).default;",'const {fs,path,console}=ports;')
  const steps=[],records=[],ports={console:{log(){}},path:{resolve:value=>value,join:(...parts)=>parts.join('/')},fs:{async mkdir(){},async open(){return {async write(value){records.push(JSON.parse(value))},async sync(){},async close(){}}}}}
  const cdp={async ev(expression){return new Function('fetch','return '+expression)(async(_url,request)=>{
    const {action,backupId}=JSON.parse(request.body);steps.push(action)
    if(['dryRun','apply'].includes(action))assert.equal(backupId,'backup-id')
    return {status:200,json:async()=>({ok:true,runtimeGeneration:'native',...(action==='backup'?{backupId:'backup-id'}:{}),...(action==='verify'?{status:'complete',writes:0}:{})})}
  })}}
  await new Function('cdp','process','ports','return(async()=>{'+source+'})()')(cdp,{argv:['node','cdp','steps','9333','run']},ports)
  assert.deepEqual(steps,['status','backup','dryRun','apply','verify']);assert.equal(records.length,5)
})