// private fork: art aliases never change inventory identity. Missing art stays missing.
import {normalizeItemName} from './item-binding.js'
export function resolveItemArt(item,snapshots) {
  const rows=snapshots.flatMap(pack=>(pack?.manifest.assets || []).filter(asset=>asset.kind==='items' && asset.enabled && asset.media).map(asset=>({pack,asset})))
  const name=normalizeItemName(item.name),category=normalizeItemName(item.category)
  const exact=rows.filter(({asset})=>!asset.categoryDefault && [asset.name,...(asset.aliases || [])].some(value=>normalizeItemName(value)===name))
  const generic=category ? rows.filter(({asset})=>asset.categoryDefault && [asset.category,...(asset.aliases || [])].some(value=>normalizeItemName(value)===category)) : []
  const selected=exact.length===1 ? exact[0] : generic.length===1 ? generic[0] : null
  if(!selected)return null
  const {pack,asset}=selected,ref={packId:pack.manifest.id,kind:'items',assetId:asset.id}
  return {resource:true,kind:'media',ref,hash:asset.media,revision:pack.revision,identity:`${ref.packId}:items:${asset.id}:${asset.media}`}
}
