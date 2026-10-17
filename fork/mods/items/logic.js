import {normalizeItemName,projectItems,diffItems,itemInventoryPrompt} from '../../../tavern-plugin/lib/domain/item-binding.js'
import {ITEM_CATEGORIES} from './categories.js'
import {normalizeCatalogueText} from '../../../tavern-plugin/lib/domain/asset-pack-lexical.js'
import {selectAssetVariant} from '../../../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variants.js'
const compare=(a,b)=>a<b?-1:a>b?1:0
const identity=value=>JSON.stringify([value.packId,value.kind,value.assetId])
const fail=(code,candidates=[])=>{throw Object.assign(new Error(code),{code,candidates:candidates.slice(0,3)})}

export function itemCatalogue({packs=[],recalled=[]}={}, {categories=ITEM_CATEGORIES,layer='global'}={}) {
  const enabled=packs.filter(pack=>pack.scope==='library').sort((a,b)=>compare(a.id,b.id))
  const recalls=new Set(recalled.map(identity)),rows=[]
  for(const pack of enabled) {
    for(const entry of [...pack.entries].sort((a,b)=>compare(a.id,b.id))) {
      if(entry.kind!=='props' || !entry.enabled || !recalls.has(identity(entry.ref)))continue
      const metadata=entry.extensions?.['dsh.items']
      const category=metadata?.genreId || entry.category || 'misc'
      const genre=categories.find(row=>row.id===category) || categories.find(row=>normalizeCatalogueText(row.label)===normalizeCatalogueText(category)) || categories.find(row=>row.id==='misc')
      if(!genre)continue
      const keywords=entry.recall?.keywords || [],synonyms=Object.values(entry.recall?.synonyms || {}).flat()
      const content=selectAssetVariant(entry)?.content || entry
      rows.push({ref:entry.ref,name:entry.name,nameKey:normalizeItemName(entry.name),genre:genre.label,inventoryId:metadata?.inventoryId || null,
        terms:[...new Set([entry.name,...(entry.aliases || []),...keywords,...synonyms].map(normalizeItemName))],recalled:true,
        genreId:genre.id,iconRef:content.media?entry.ref:categoryIcon(genre,layer)})
    }
  }
  return {genres:categories.map(row=>row.label).sort(compare),categories,layer,rows,packs:enabled}
}
export function itemCatalogueFragments(catalogue,options) {
  return itemCatalogue(catalogue,options).rows.map(row=>({modId:'dsh.items',id:row.ref.packId+'.'+row.ref.assetId,type:'catalogue',source:'library',
    placement:{section:'director.catalogue',order:0},text:JSON.stringify({ref:row.ref,name:row.name,genre:row.genre})}))
}
function categoryIcon(genre,layer) {
  const icon=genre.icon || {builtin:'misc'}
  return {modId:'dsh.items',packId:icon.file?'config.'+layer:'builtin',kind:'icon',entryId:icon.file?icon.file.slice(6,42):icon.builtin}
}
export function selectItem(catalogue,{action,name,genre,force=false},{binding}={}) {
  if(!['show','gain','lose'].includes(action) || typeof name!=='string' || !normalizeItemName(name) || typeof force!=='boolean')fail('INVALID_OP')
  if(action!=='show' && binding?.source!=='mvu')fail('MOD_DEPENDENCY_MISSING')
  // The existing item selection boundary resolves category names before any canonical-key comparison.
  const category=catalogue.categories.find(row=>row.id===genre) || catalogue.categories.find(row=>normalizeCatalogueText(row.label)===normalizeCatalogueText(genre))
  if(!category)fail('ITEM_GENRE_UNKNOWN')
  genre=category.label
  const term=normalizeItemName(name),matches=catalogue.rows.filter(row=>row.recalled && row.genre===genre && row.terms.includes(term))
  const names=[...new Set(matches.map(row=>normalizeItemName(row.name)))]
  if(!force && !names.length)fail('ITEM_UNKNOWN',catalogue.rows.filter(row=>row.recalled && row.genre===genre).map(row=>row.name))
  if(!force && names.length>1)fail('ITEM_AMBIGUOUS',matches.map(row=>row.name))
  const row=names.length===1?matches[0]:null
  const fallback=categoryIcon(category,catalogue.layer)
  return {action,name:row?.name || name,genre,...(row?{ref:row.ref}:{}),iconRef:row?.iconRef || fallback,inventoryId:row?.inventoryId || null,
    binding:binding?JSON.stringify(binding):null,text:(action==='gain'?'获得 ':action==='lose'?'失去 ':'展示 ')+(row?.name || name)}
}
function inventory(rows,revision,previousRevision,binding) {
  return projectItems({committed:true,complete:Array.isArray(rows),revision,previousRevision,mappingKey:JSON.stringify(binding)},
    {status:'ready',source:'author',variable:binding,value:rows},{scopeKey:binding.path,ownerMapped:!!binding.fields?.owner})
}
export function reconcileItems(settlement) {
  const pending=settlement.performances || [],binding=settlement.bindings?.inventory
  const changed=pending.filter(row=>row.payload.action!=='show')
  const display=row=>({performanceId:row.id,expectedRevision:row.revision,action:'replace',payload:row.payload,reason:'display-only'})
  if(!changed.length)return pending.map(display)
  if(!binding || binding.source!=='mvu' || changed.some(row=>row.payload.binding!==JSON.stringify(binding)))return pending.map(display)
  const before=inventory(settlement.before?.inventory,settlement.beforeRevision,undefined,binding)
  const after=inventory(settlement.after?.inventory,settlement.afterRevision,settlement.beforeRevision,binding)
  const diff=diffItems(before,after)
  if(!diff.ok)return pending.map(display)
  if(before.ownerMapped && new Set([...before.items,...after.items].map(row=>row.ownerKey)).size!==1)return pending.map(display)
  if([...before.items,...after.items].some(row=>row.counted && row.count===null))return pending.map(display)
  const used=new Set(),revisions=[]
  for(const performance of pending) {
    const payload=performance.payload
    if(payload.action==='show'){revisions.push(display(performance));continue}
    const matches=diff.changes.filter(row=>payload.inventoryId?row.stableId===payload.inventoryId:normalizeItemName(row.name)===normalizeItemName(payload.name))
    if(!payload.inventoryId && !matches.length) {
      const lost=before.items.filter(row=>row.stableId===null && !after.items.some(next=>next.itemKey===row.itemKey))
      const added=after.items.filter(row=>row.stableId===null && !before.items.some(old=>old.itemKey===row.itemKey))
      if(lost.some(row=>added.some(next=>next.ownerKey===row.ownerKey) && [row,...added].some(item=>normalizeItemName(item.name)===normalizeItemName(payload.name)))){revisions.push(display(performance));continue}
    }
    // Multiple holders/identities are not a license to guess a recipient.
    if(matches.length>1){revisions.push(display(performance));continue}
    const change=matches[0],fact=change?.itemKey
    const keep=change?.action===payload.action && !used.has(fact)
    if(keep)used.add(fact)
    revisions.push({performanceId:performance.id,expectedRevision:performance.revision,action:keep?'replace':'remove',
      ...(keep?{payload:{...payload,count:change.delta,text:(payload.action==='gain'?'获得 ':'失去 ')+payload.name+(change.delta===null?'':' ×'+change.delta)}}:{}),
      reason:keep?'settled-count':change?.action===payload.action?'duplicate-fact':change?'opposite-direction':'no-change'})
  }
  return revisions
}
export function inventoryContext(rows,binding,{enabled=false}={}) {
  if(!enabled || !binding)return ''
  const snapshot=inventory(rows,'context',undefined,binding),owners=[...new Set(snapshot.items.map(row=>row.ownerKey))]
  return itemInventoryPrompt(snapshot,{scopeKey:binding.path,ownerKey:owners.length===1?owners[0]:null},{enabled:true,s4:true})
}
