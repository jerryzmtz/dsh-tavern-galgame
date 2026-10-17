import {isDeepStrictEqual as equal} from 'node:util'
import {validateConfigValue} from './config.js'
const fail=message=>{throw Object.assign(new Error(message),{code:'CONFIG_MIGRATION_CONFLICT'})}
const fixed=(key,value)=>/Color$/.test(key) && ['auto','stage'].includes(value)?{auto:true}:{fixed:value}

export function inspectLegacyModConfig(source) {
  for(const card of source.cards) {
    const raw=card.workspace.raw,data=raw.data || raw,bound=new Set(data.extensions?.dsh_tavern?.assetBindings?.boundPackIds || [])
    const phone=(source.packs || []).flatMap(pack=>pack.manifest?.assets.filter(asset=>asset.kind==='widgets' && pack.widgets?.[asset.id]?.namespace==='phone').map(asset=>({pack,asset})) || [])
    if(!phone.length)continue
    card.phoneRefs=phone.map(({pack,asset})=>({packId:pack.manifest.id,kind:'widgets',assetId:asset.id}))
    const values={}
    for(const {pack,asset} of phone)if(bound.has(pack.manifest.id) && asset.enabled)for(const [key,value] of Object.entries(asset.settingsDefaults || {})) {
      if(key==='wallpaper')continue
      if(Object.hasOwn(values,key) && !equal(values[key],value))fail('Conflicting per-card phone defaults: '+card.cardId+'/'+key)
      values[key]=value
    }
    card.phoneSettings=values
  }
  return source
}

// Plan against complete native owner snapshots; no live writes and no name/alias guesses.
export function planModConfigMigration(source,schemas) {
  const next=structuredClone(source),changes=[]
  next.configs ||= {global:{},cards:{}}
  const field=(id,key)=>{const value=schemas[id]?.fields.find(row=>row.key===key);if(!value)fail('Unknown setting '+id+':'+key);return value}
  function put(id,key,value,cardId) {
    validateConfigValue(value,field(id,key))
    const layers=cardId?(next.configs.cards[cardId] ||= {}):next.configs.global
    const config=layers[id] ||= {version:1,values:{}}
    if(Object.hasOwn(config.values,key) && !equal(config.values[key],value))fail('Existing config conflicts with migration: '+(cardId || 'global')+'/'+id+'/'+key)
    config.values[key]=value
    changes.push({cardId:cardId || null,modId:id,key,value})
  }
  const global=next.native?.value?.global || next.global
  if(global?.mods?.['dsh.phone']?.settings) {
    for(const [key,value] of Object.entries(global.mods['dsh.phone'].settings))put('dsh.phone',key,fixed(key,value))
    delete global.mods['dsh.phone'].settings
  }
  for(const card of next.cards || []) {
    const raw=card.workspace?.raw || card.raw,data=raw?.data || raw,ext=data?.extensions?.dsh_tavern
    if(!ext)continue
    const phone=ext.modBindings?.mods?.['dsh.phone']
    for(const [key,value] of Object.entries(phone?.settings || {}))put('dsh.phone',key,fixed(key,value),card.cardId)
    if(phone)delete phone.settings
    // Host inspection supplies per-card legacy widget defaults after canonical pack/ref resolution.
    for(const [key,value] of Object.entries(card.phoneSettings || {}))put('dsh.phone',key,fixed(key,value),card.cardId)
    const kept=[]
    for(const row of ext.variableBindings?.entries || []) {
      if((row.target.kind==='items' || row.target.kind==='mods' && row.target.modId==='dsh.items') && row.target.slot==='inventory')put('dsh.items','inventory',{ref:row.variable},card.cardId)
      else if(row.target.kind==='mods' && row.target.modId==='dsh.phone')put('dsh.phone',row.target.slot,{ref:row.variable},card.cardId)
      else if(row.target.kind==='widgets' && card.phoneRefs?.some(ref=>equal(ref,row.target.ref)))put('dsh.phone',row.target.slot,{ref:row.variable},card.cardId)
      else kept.push(row)
    }
    if(ext.variableBindings) {
      if(kept.length)ext.variableBindings={version:1,entries:kept}
      else delete ext.variableBindings
    }
    delete card.phoneSettings
    delete card.phoneRefs
  }
  return {version:1,next,changes,changed:!equal(next,source)}
}
