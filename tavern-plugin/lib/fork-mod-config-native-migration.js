import path from 'node:path'
import {mkdir,open,readFile,rename} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual as equal} from 'node:util'
import {rawData} from './domain/card-preparation.js'
import {profileBackupRoot} from './fork-backup-path.js'
import {planModConfigMigration,inspectLegacyModConfig} from './domain/mods/config-migration.js'
const absent=error=>{if(error.code==='ENOENT')return null;throw error}
const fail=message=>{throw Object.assign(new Error(message),{code:'CONFIG_MIGRATION_CONFLICT'})}
export const modConfigLegacy=workspace=>{
  const ext=rawData(workspace.raw).extensions?.dsh_tavern || {}
  return {variableBindings:ext.variableBindings ?? null,phoneSettings:ext.modBindings?.mods?.['dsh.phone']?.settings ?? null}
}
export function createNativeModConfigMigration({root,backupRoot=profileBackupRoot(path.dirname(root)),host,settings,listCards,readCard,retireCard,assertIdle,invalidate,getPacks}) {
  const receiptFile=path.join(root,'mod-config-v1.json'),backup=path.join(backupRoot,'mod-config-v1.json')
  let tail=Promise.resolve()
  const json=async file=>JSON.parse(await readFile(file,'utf8'))
  async function receipt(value) {
    await mkdir(root,{recursive:true})
    const temp=receiptFile+'.'+randomUUID()+'.tmp',file=await open(temp,'wx')
    try {await file.writeFile(JSON.stringify(value));await file.sync()}finally{await file.close()}
    await rename(temp,receiptFile)
  }
  async function snapshot() {
    const cards=(await listCards()).map(row=>({...row,cardId:row.workspace.meta.id})),configs={global:{},cards:{}}
    for(const modId of Object.keys(host.schemas)) {
      const global=await host.store.read({modId})
      if(Object.keys(global.global).length)configs.global[modId]={version:1,values:global.global}
      for(const card of cards) {
        const value=await host.store.read({modId,cardId:card.cardId})
        if(Object.keys(value.card).length)(configs.cards[card.cardId] ||= {})[modId]={version:1,values:value.card}
      }
    }
    const owner=await getPacks(),packs=await owner.listPacks()
    if(packs.some(pack=>pack.error))fail('Repair unavailable packs before migration')
    return inspectLegacyModConfig({native:settings.read(),cards,configs,packs})
  }
  function actions(before,next) {
    const rows=[]
    function config(modId,cardId,value,old) {
      if(!equal(value,old))rows.push({kind:'config',modId,cardId,layer:cardId?'card':'global',before:old?.values || {},after:value.values})
    }
    for(const [id,value] of Object.entries(next.configs.global))config(id,null,value,before.configs.global[id])
    for(const [cardId,mods] of Object.entries(next.configs.cards))for(const [id,value] of Object.entries(mods))config(id,cardId,value,before.configs.cards[cardId]?.[id])
    for(const card of next.cards) {
      const old=before.cards.find(row=>row.cardId===card.cardId),a=modConfigLegacy(old.workspace),b=modConfigLegacy(card.workspace)
      if(!equal(a,b))rows.push({kind:'card',cardId:card.cardId,path:card.path,before:a,after:b})
    }
    if(!equal(before.native.value,next.native.value))rows.push({kind:'native',before:before.native.value,after:next.native.value})
    return rows
  }
  async function current(action) {
    if(action.kind==='native')return settings.read().value
    if(action.kind==='card')return modConfigLegacy(await readCard(action.path))
    return (await host.store.read(action))[action.layer]
  }
  async function run({apply=false}={}) {
    const saved=await json(receiptFile).catch(absent)
    if(saved?.status==='complete')return {...saved.result,writes:0,alreadyComplete:true}
    let record=saved,plan
    if(!record) {
      const before=await snapshot();plan=planModConfigMigration(before,host.schemas)
      const report={apply,changes:plan.changes,writes:0,backup:null}
      if(!apply || !plan.changed)return report
      await assertIdle()
      if(!equal(before,await snapshot()))fail('Owners changed before backup')
      const packs=await getPacks(),archives={}
      for(const card of before.cards) {
        if(!plan.changes.some(change=>change.cardId===card.cardId))continue
        const id=rawData(card.workspace.raw).extensions?.dsh_tavern?.modConfigPackId
        if(id && !archives[id]) {
          const pack=await packs.getPackSnapshot({packId:id})
          const archive=await packs.exportPack({packId:id,expectedRevision:pack.revision})
          try {archives[id]=(archive.bytes || await readFile(archive.file)).toString('base64')}finally{await archive.dispose?.()}
        }
      }
      await mkdir(backupRoot,{recursive:true})
      const existing=await json(backup).catch(absent)
      if(existing) {if(!equal(existing.before,before) || !equal(existing.plan,plan))fail('Existing backup differs; resume its transaction rather than replacing it')}
      else {
        const file=await open(backup,'wx')
        try{await file.writeFile(JSON.stringify({version:1,before,plan,archives}));await file.sync()}finally{await file.close()}
      }
      if(!equal(before,await snapshot()))fail('Owners changed during backup')
      record={version:1,status:'applying',backup,actions:actions(before,plan.next),done:[],report}
      await receipt(record)
    }
    if(!apply)return {apply:false,status:record.status,remaining:record.actions.length-record.done.length,writes:0,backup:record.backup}
    let writes=0
    for(let i=0;i<record.actions.length;i++) {
      const action=record.actions[i],value=await current(action)
      if(!equal(value,action.after)) {
        if(record.done.includes(i) || !equal(value,action.before))fail('Migration owner changed independently at action '+i)
        await assertIdle()
        if(action.kind==='native') {
          const owner=settings.read()
          await settings.compareAndSwap({expectedRevision:owner.revision,expectedValue:action.before,value:action.after})
        } else if(action.kind==='card')await retireCard(action)
        else {
          const owner=await host.store.read(action)
          await host.store.write({...action,expectedRevision:owner.revision,values:action.after})
        }
        writes++
      }
      if(!equal(await current(action),action.after))fail('Owner publication did not verify at action '+i)
      if(!record.done.includes(i)){record.done.push(i);await receipt(record)}
    }
    record.status='complete';record.result={...record.report,apply:true,backup:record.backup,writes,verified:true}
    await receipt(record);invalidate()
    return record.result
  }
  return {run(args){const work=tail.then(()=>run(args));tail=work.catch(()=>{});return work}}
}
