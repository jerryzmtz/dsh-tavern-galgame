import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {mkdir,open,readFile,stat} from 'node:fs/promises'
import {isDeepStrictEqual as equal} from 'node:util'
import {createModMigrationJournal} from './fork-mod-migration.js'
import {createModRegistry} from './domain/mods/registry.js'
import {validateCardAssetExtension,readCardAssetExtension,cardAssetExtensionPointer} from './domain/card-asset-bindings.js'
import {cardAssetWorkspaceRevision} from './fork-card-asset-bindings.js'
import {planItemsMigration,ITEMS_MIGRATION_ID,ITEMS_SOURCE_IDS,migrationPackValue} from '../../fork/mods/items/migration.js'

const fail=(message,code='ITEMS_MIGRATION_INEXACT')=>{throw Object.assign(new Error(message),{code})}
const exact=(condition,message,code)=>{if(!condition)fail(message,code)}
const same=(actual,expected)=>actual.revision===expected.revision && equal(actual.value,expected.value)
const modId='dsh.items'

export function createItemsReplayInspection({readIndex,readWindow,chatIds=[]}) {
  return async()=>{
    const result=[]
    for(const chatId of chatIds) {
      const index=await readIndex(chatId),at=index?.messages.findLastIndex(row=>row.role==='assistant')
      exact(at>=0 && index._storageRevision!=null,'Latest-turn replay baseline unavailable: '+chatId)
      const slice=await readWindow(chatId,{limit:1,before:at+1,revision:index._storageRevision})
      exact(slice?.revision===index._storageRevision,'Replay baseline changed','MOD_MIGRATION_CONFLICT')
      const message=slice.chat.messages[0],pending=[message]
      while(pending.length) {
        const value=pending.pop()
        if(!value || typeof value!=='object')continue
        exact(value.modId || !ITEMS_SOURCE_IDS.includes(value.packId) || !(value.assetId || value.figureId || value.spriteId || value.kind),'Latest turn still references a retiring source pack: '+chatId)
        pending.push(...Object.values(value).filter(row=>row && typeof row==='object'))
      }
      result.push({chatId,messageIndex:at,...(message.id!=null?{messageId:message.id}:{}),turn:message.turn ?? null,revision:index._storageRevision})
    }
    return result
  }
}

export function createItemsCardMigrationOwner({listPaths,readWorkspace,updateCard}) {
  async function workspace(key) {const row=await readWorkspace(key);exact(row?.meta?.id && row.raw,'Card is missing or requires a separate workspace migration: '+key);return row}
  const snapshot=row=>({revision:cardAssetWorkspaceRevision(row),value:readCardAssetExtension(row.raw) ?? null})
  return Object.freeze({
    async list() {
      const rows=[],ids=new Set()
      for(const key of await listPaths()) {const row=await workspace(key);exact(!ids.has(row.meta.id),'Duplicate card identity');ids.add(row.meta.id);rows.push({key,cardId:row.meta.id,...snapshot(row)})}
      return rows
    },
    async read(key) {return snapshot(await workspace(key))},
    async backup(key) {const row=await workspace(key);return {revision:cardAssetWorkspaceRevision(row),cardId:row.meta.id,workspace:row}},
    async compareAndSwap({key,expectedRevision,expectedValue,value}) {
      const row=await workspace(key)
      exact(same(snapshot(row),{revision:expectedRevision,value:expectedValue}),'Card changed','MOD_MIGRATION_CONFLICT')
      validateCardAssetExtension(value)
      await updateCard(key,{},undefined,[{op:'set',path:cardAssetExtensionPointer(row.raw),value}],expectedRevision)
    },
  })
}

// The one-time controller composes existing owners; it never writes their files or chats.
export function createItemsMigrationController({root,cards,mods,modSettings,assetSettings,packs,coreCommands=[],assertIdle,inspectReplay}) {
  const backups=path.join(root,'backups')
  const folder=id=>{exact(typeof id==='string' && /^[0-9a-f-]{36}$/.test(id),'Invalid backup identity');return path.join(backups,id)}
  const assetSnapshot=()=>{const row=assetSettings.read();return {revision:row.revision,value:row.values}}
  const packSnapshot=async key=>{const row=await packs.getPackSnapshot({packId:key});return {revision:row?.revision ?? null,value:row?migrationPackValue(row):null}}
  const releaseSnapshot=async()=>{const row=(await mods.ownerSnapshot()).mods[modId];exact(row,'Item release unavailable');return {revision:row.releaseRevision,value:row}}
  const collectionSnapshot=async()=>({revision:null,value:(await cards.list()).map(row=>row.key).sort()})
  const inventoryValue=rows=>rows.filter(row=>!ITEMS_SOURCE_IDS.includes(row.manifest?.id)).map(row=>({id:row.manifest?.id || row.packId,revision:row.revision ?? null,error:row.error?.code || null})).sort((a,b)=>a.id.localeCompare(b.id))
  const packInventory=async()=>({revision:null,value:inventoryValue(await packs.listPacks())})
  async function write(file,value) {
    await mkdir(path.dirname(file),{recursive:true})
    const handle=await open(file,'wx')
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n')
    try {await handle.writeFile(bytes);await handle.sync();return bytes.length}finally{await handle.close()}
  }
  async function load(id) {
    const plan=JSON.parse(await readFile(path.join(folder(id),'plan.json'),'utf8'))
    const receipt=JSON.parse(await readFile(path.join(folder(id),'receipt.json'),'utf8'))
    exact(plan.id===ITEMS_MIGRATION_ID && plan.backupId===id && receipt.id===id && receipt.complete===true,'Incomplete migration backup')
    const names=[...ITEMS_SOURCE_IDS.map(key=>key+'.zip'),...plan.changes.filter(row=>row.owner==='cards').map((_,index)=>'card-'+index+'.json')]
    for(const name of names) {
      const file=receipt.files.find(row=>row.name===name),info=await stat(path.join(folder(id),name))
      exact(file && info.isFile() && info.size===file.size,'Incomplete migration backup: '+name)
    }
    return {plan,receipt}
  }
  const owners={
    cards:{read:cards.read,async compareAndSwap(input) {validateCardAssetExtension(input.value);await cards.compareAndSwap(input);mods.invalidate()}},
    modSettings:{read:()=>modSettings.read(),compareAndSwap:input=>mods.replaceOwnerSettings(input)},
    assetSettings:{read:assetSnapshot,async compareAndSwap(input) {
      exact(same(assetSnapshot(),{revision:input.expectedRevision,value:input.expectedValue}),'Asset settings changed','MOD_MIGRATION_CONFLICT')
      await assetSettings.save({expectedRevision:input.expectedRevision,globalEnabledPackIds:input.value.globalEnabledPackIds})
    }},
    packs:{read:packSnapshot,async compareAndSwap(input) {
      exact(ITEMS_SOURCE_IDS.includes(input.key),'Unapproved source pack')
      exact(same(await packSnapshot(input.key),{revision:input.expectedRevision,value:input.expectedValue}),'Source pack changed','MOD_MIGRATION_CONFLICT')
      if(input.value===null) {await inspectReplay();return packs.removePack({packId:input.key,expectedRevision:input.expectedRevision})}
      exact(input.expectedValue===null,'Restoration must not replace an independently edited pack','MOD_MIGRATION_CONFLICT')
      const bytes=await readFile(path.join(folder(input.backup.id),input.key+'.zip'))
      const preview=await packs.inspectImport({bytes})
      try {
        exact(preview.current===null && preview.choices.includes('install') && !preview.voiceChanges.length && equal(preview.incoming,input.value),'Backup cannot restore the exact original source')
        // The import preview supplies the native tombstone revision after removal.
        await packs.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'install',acceptScriptRisk:true})
      } catch(error) {await packs.applyImport({inspectionId:preview.inspectionId,decision:'cancel'}).catch(()=>{});throw error}
    }},
    cardCollection:{read:collectionSnapshot},release:{read:releaseSnapshot},packInventory:{read:packInventory},
    replay:{read:async()=>({revision:null,value:await inspectReplay()})},
  }
  for(const port of Object.values(owners))if(port.compareAndSwap) {
    const publish=port.compareAndSwap
    port.compareAndSwap=async input=>{const {plan}=await load(input.backup.id);await assertIdle(plan.evidence.cards.map(row=>row.key));return publish(input)}
  }
  const journal=createModMigrationJournal({root:path.join(root,'journal'),owners,backup:async plan=>{
    const stored=await load(plan.backupId)
    exact(equal(stored.plan,plan),'Prepared plan differs from durable backup','MOD_MIGRATION_CONFLICT')
    return stored.receipt
  }})
  async function compile() {
    const rows=await cards.list(),state=await mods.ownerSnapshot(),settings=await modSettings.read(),asset=assetSnapshot()
    exact(equal({global:state.global,grants:state.grants},settings.value),'Native mod snapshot changed','MOD_MIGRATION_CONFLICT')
    exact(equal(Object.fromEntries(rows.filter(row=>row.value?.modBindings).map(row=>[row.cardId,row.value.modBindings])),state.cards),'Native card snapshot changed','MOD_MIGRATION_CONFLICT')
    const installed=await packs.listPacks()
    exact(installed.every(row=>row.manifest && !row.error),'A broken pack prevents complete source inventory')
    const plan=planItemsMigration({packs:installed,cards:rows,assetSettings:asset,modSettings:settings,modState:state})
    const changed=new Set(plan.changes.filter(row=>row.owner==='cards').map(row=>row.key))
    await assertIdle([...changed]);plan.evidence.replay=await inspectReplay()
    const candidate=structuredClone(state)
    for(const change of plan.changes.filter(row=>row.owner==='cards')) {
      validateCardAssetExtension(change.after)
      candidate.cards[rows.find(row=>row.key===change.key).cardId]=change.after.modBindings
    }
    const registry=createModRegistry({initial:candidate,coreCommands,capabilities:['stage.place','stage.reviseAfterSettlement']})
    const desired=plan.changes.find(row=>row.owner==='modSettings')?.after || settings.value
    await registry.replaceNativeSettings({expectedRevision:state.revision,expectedValue:settings.value,value:desired})
    plan.guards=rows.filter(row=>!changed.has(row.key)).map(row=>({owner:'cards',key:row.key,before:{revision:row.revision,value:row.value}}))
    if(!plan.changes.some(row=>row.owner==='assetSettings'))plan.guards.push({owner:'assetSettings',key:'global',before:asset})
    plan.guards.push({owner:'cardCollection',key:'all',before:{revision:null,value:rows.map(row=>row.key).sort()}},{owner:'release',key:modId,before:{revision:state.mods[modId].releaseRevision,value:state.mods[modId]}})
    plan.guards.push({owner:'packInventory',key:'other',before:{revision:null,value:inventoryValue(installed)}},{owner:'replay',key:'latest',before:{revision:null,value:plan.evidence.replay}})
    return plan
  }
  const brief=state=>state && ({id:state.id,status:state.status,backupId:state.backup?.id,evidence:state.evidence,owners:state.changes.map(row=>({owner:row.owner,key:row.key,committed:!!row.receipt}))})
  async function backup() {
    exact(!(await journal.inspect(ITEMS_MIGRATION_ID)),'An existing journal must be resumed or inspected instead')
    const plan=await compile(),id=randomUUID(),directory=folder(id),files=[]
    plan.backupId=id
    await journal.dryRun(plan)
    for(const change of plan.changes.filter(row=>row.owner==='packs')) {
      const archive=await packs.exportPack({packId:change.key,expectedRevision:change.before.revision})
      try {
        exact(archive.revision===change.before.revision,'Source changed during backup','MOD_MIGRATION_CONFLICT')
        const bytes=archive.bytes || await readFile(archive.file),name=change.key+'.zip'
        files.push({name,size:await write(path.join(directory,name),bytes)})
      } finally {await archive.dispose?.()}
    }
    let cardIndex=0
    for(const change of plan.changes.filter(row=>row.owner==='cards')) {
      const source=await cards.backup(change.key)
      exact(source.revision===change.before.revision,'Card changed during backup','MOD_MIGRATION_CONFLICT')
      const name='card-'+(cardIndex++)+'.json'
      files.push({name,size:await write(path.join(directory,name),{key:change.key,workspace:source.workspace})})
    }
    await write(path.join(directory,'plan.json'),plan)
    await journal.dryRun(plan)
    const receipt={id,complete:true,createdAt:new Date().toISOString(),sourceArchives:[...ITEMS_SOURCE_IDS],files}
    await write(path.join(directory,'receipt.json'),receipt)
    return {backupId:id,status:'backed-up',writes:0,evidence:plan.evidence}
  }
  return Object.freeze({
    backup,
    async dryRun(id) {const {plan}=await load(id);await assertIdle(plan.evidence.cards.map(row=>row.key));await inspectReplay();return {...await journal.dryRun(plan),backupId:id}},
    async apply(id) {const {plan}=await load(id);await assertIdle(plan.evidence.cards.map(row=>row.key));await inspectReplay();return brief(await journal.apply(plan))},
    async resume() {const state=await journal.inspect(ITEMS_MIGRATION_ID);exact(state,'No migration journal');await load(state.backup.id);await assertIdle(state.evidence.cards.map(row=>row.key));return brief(await journal.resume(ITEMS_MIGRATION_ID))},
    async rollback() {const state=await journal.inspect(ITEMS_MIGRATION_ID);exact(state,'No migration journal');await load(state.backup.id);await assertIdle(state.evidence.cards.map(row=>row.key));return brief(await journal.rollback(ITEMS_MIGRATION_ID))},
    async verify() {const state=await journal.inspect(ITEMS_MIGRATION_ID);exact(state?.status==='complete','Migration is not complete');const result=await journal.apply((await load(state.backup.id)).plan);await inspectReplay();return {...brief(result),writes:0}},
    async status() {return brief(await journal.inspect(ITEMS_MIGRATION_ID))},
  })
}
