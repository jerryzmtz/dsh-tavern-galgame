import {isDeepStrictEqual as equal} from 'node:util'
import {cardItemWidget} from '../../../tavern-plugin/lib/domain/item-widget.js'
import {validateCardVariableBindings} from '../../../tavern-plugin/lib/domain/variable-bindings/index.js'
import {validateModCardBindings} from '../../../tavern-plugin/lib/domain/mods/card-bindings.js'
import widgetContract from '../../../tavern-plugin/src/client/fork-widget-contracts.cjs'

export const ITEMS_MIGRATION_ID='items-v1'
export const ITEMS_SOURCE_IDS=Object.freeze(['b57d1a7c-22d5-42b0-8193-e772f65fe8bb','245445d4-8ee4-46cc-b57e-d2b56c3fc6ab'])
const modId='dsh.items',copy=structuredClone
const stop=(code,detail)=>{throw Object.assign(new Error(detail),{code})}
const requireExact=(condition,detail)=>{if(!condition)stop('ITEMS_MIGRATION_INEXACT',detail)}
const scope=(global,bound,id)=>global.includes(id)?'global':bound.includes(id)?'card':'off'
export const migrationPackValue=({revision,installedAt,updatedAt,...value})=>value
const emptyBinding=row=>!row || row.enabled!==true && !row.boundPackIds.length && !Object.keys(row.settings || {}).length && !Object.keys(row.bindings || {}).length && !Object.keys(row.packSettings || {}).length

// Pure plan over native owner snapshots. No model, inventory mutation, source writes, or guessed mapping.
export function planItemsMigration({packs,cards,assetSettings,modSettings,modState}) {
  const sources=ITEMS_SOURCE_IDS.map(id=>packs.find(row=>row.manifest.id===id))
  requireExact(sources.every(Boolean),'Both approved independent source packs must be present; use the durable journal for a rerun')
  const installed=modState.mods[modId]
  requireExact(installed,'Install the application item release before inspecting migration')
  requireExact(!modSettings.value.global.enabledModIds.includes(modId),'Destination mod is already enabled')
  const existing=modSettings.value.global.mods[modId]
  requireExact(!existing || !existing.enabledPackIds.length && !Object.keys(existing.settings).length,'Destination settings or pack scopes have already been authored')
  for(const pack of packs)for(const asset of pack.manifest.assets)if(asset.kind==='widgets' && pack.widgets?.[asset.id]?.runtime==='items')
    requireExact(pack.manifest.id===ITEMS_SOURCE_IDS[0] && asset.id==='items' && !asset.extensions?.dsh_tavern?.copiedFrom,'An additional or copied item widget requires an explicit migration plan')
  const widget=sources[0].manifest.assets.find(row=>row.kind==='widgets' && row.id==='items')
  requireExact(widget && sources[0].widgets?.items?.runtime==='items','The approved item entry is missing')
  requireExact(Object.keys(widget.settingsDefaults || {}).every(key=>key==='inventoryNames'),'Unrecognized item settings cannot be discarded')
  const globalIds=assetSettings.value.globalEnabledPackIds
  const s4=widgetContract.forkWidgetResolveSettings(sources[0].widgets.items,widget.settingsDefaults).settings.inventoryNames===true
  const global=copy(modSettings.value)
  global.global.mods[modId]={enabledPackIds:ITEMS_SOURCE_IDS.filter(id=>globalIds.includes(id)),settings:{s4}}
  if(widget.enabled && (globalIds.includes(ITEMS_SOURCE_IDS[0]) || cards.some(card=>card.value?.assetBindings?.boundPackIds.includes(ITEMS_SOURCE_IDS[0]))))global.global.enabledModIds.push(modId)
  global.grants[modId]=installed.releaseRevision
  const changes=[],evidence={sources:[],cards:[],chatWrites:0}
  for(let i=0;i<sources.length;i++) {
    const source=sources[i],manifest=source.manifest,target=installed.packs[manifest.id],items=manifest.assets.filter(row=>row.kind==='items')
    requireExact(manifest.assets.every(row=>row.kind==='items' || i===0 && row===widget) && !manifest.figures.length && !Object.keys(manifest.sprites).length,'A source now contains unrelated content; do not remove the whole pack')
    requireExact(target && !source.distribution && items.length===(i===0?8:48) && target.entries.length===items.length,'Source and destination entry sets or distribution ownership differ')
    requireExact(equal(target.fields.genres.map(row=>row.label),[...new Set(items.map(row=>row.category))]),'Destination categories were independently authored')
    for(const item of items) {
      const entry=target.entries.find(row=>row.id===item.id),genre=target.fields.genres.find(row=>row.label===item.category),blob=manifest.blobs[item.media]
      requireExact(entry && genre && blob && entry.name===item.name && entry.enabled===item.enabled,'Source metadata no longer matches the packaged migration input')
      requireExact(entry.kind===(item.categoryDefault?'icon':'item'),'Source entry kind differs')
      requireExact(entry.media.image===manifest.id+'/media/'+item.media+'.'+blob.ext && target.files.some(file=>file.path===entry.media.image && file.size===blob.size),'Source media identity or size differs')
      if(item.categoryDefault)requireExact(equal(genre.icon,{modId,packId:manifest.id,kind:'icon',entryId:entry.id}),'Category icon reference differs')
      else {
        requireExact(entry.fields.genreId===genre.id && !entry.fields.inventoryId,'Destination inventory association was authored independently')
        const terms=[...new Set([...(item.recall?.keywords || []),...(item.aliases || [])])]
        requireExact(equal(entry.recall,{mode:item.recall?.mode || 'keyword',keywords:terms}) && !item.recall?.synonyms && (entry.directorNote || '')===(item.directorNote || ''),'Recall or director text requires an exact refreshed conversion')
      }
    }
    evidence.sources.push({packId:manifest.id,revision:source.revision,entries:items.length,global:globalIds.includes(manifest.id)})
  }
  for(const card of cards) {
    const ext=card.value,bound=ext?.assetBindings?.boundPackIds || []
    requireExact(emptyBinding(ext?.modBindings?.mods?.[modId]),'Destination card settings were already authored: '+card.key)
    const state=cardItemWidget({extensions:{dsh_tavern:ext}},packs,globalIds)
    const oldMapping=ext?.variableBindings?.entries.find(row=>row.target.kind==='items' && row.target.slot==='inventory')
    requireExact(!state.enabled || oldMapping,'An enabled card needs an explicit existing inventory mapping: '+card.key)
    const next=copy(ext),ownIds=bound.filter(id=>ITEMS_SOURCE_IDS.includes(id))
    if(ownIds.length || oldMapping) {
      next.assetBindings.boundPackIds=bound.filter(id=>!ITEMS_SOURCE_IDS.includes(id))
      next.modBindings ||= {version:1,mods:{}}
      next.modBindings.mods[modId]={boundPackIds:ownIds}
      if(oldMapping) {
        requireExact(oldMapping.variable.source==='mvu','Only the existing MVU mapping can transfer')
        const fields=installed.manifest.variableSlots.find(row=>row.id==='inventory').fieldMapping
        requireExact(Object.keys(oldMapping.variable.fields || {}).every(key=>Object.hasOwn(fields,key)),'An existing inventory field mapping is not declared by the new slot')
        requireExact(!next.variableBindings.entries.some(row=>row.target.kind==='mods' && row.target.modId===modId),'Destination variable mapping already exists')
        next.variableBindings.entries=next.variableBindings.entries.filter(row=>!(row.target.kind==='items' && row.target.slot==='inventory'))
        next.variableBindings.entries.push({target:{kind:'mods',modId,slot:'inventory'},variable:copy(oldMapping.variable)})
        validateCardVariableBindings(next.variableBindings)
      }
      validateModCardBindings(next.modBindings)
      if(!equal(ext,next))changes.push({owner:'cards',key:card.key,before:{revision:card.revision,value:copy(ext)},after:next})
    }
    const prior={mod:state.enabled?scope(globalIds,bound,ITEMS_SOURCE_IDS[0]):'off',packs:Object.fromEntries(ITEMS_SOURCE_IDS.map(id=>[id,scope(globalIds,bound,id)]))}
    const after={mod:global.global.enabledModIds.includes(modId)?'global':'off',packs:Object.fromEntries(ITEMS_SOURCE_IDS.map(id=>[id,scope(global.global.mods[modId].enabledPackIds,next?.modBindings?.mods?.[modId]?.boundPackIds || [],id)]))}
    requireExact(equal(prior.packs,after.packs),'Effective pack lamp mapping is not exact: '+card.key)
    evidence.cards.push({key:card.key,cardId:card.cardId,before:prior,after,mappingTransferred:!!oldMapping})
  }
  if(!equal(modSettings.value,global))changes.push({owner:'modSettings',key:'global',before:copy(modSettings),after:global})
  const assetNext={...copy(assetSettings.value),globalEnabledPackIds:globalIds.filter(id=>!ITEMS_SOURCE_IDS.includes(id))}
  if(!equal(assetSettings.value,assetNext))changes.push({owner:'assetSettings',key:'global',before:copy(assetSettings),after:assetNext})
  // Remove only the independently approved, now-unbound sources, after every target has published.
  for(const source of sources)changes.push({owner:'packs',key:source.manifest.id,before:{revision:source.revision,value:copy(migrationPackValue(source))},after:null})
  return {id:ITEMS_MIGRATION_ID,changes,evidence}
}
