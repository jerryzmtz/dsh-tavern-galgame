import {selectWallpaper} from '../../../../fork/mods/phone/logic.js'
import {assetPackDigest} from '../stage-asset-pack-catalogue.js'

export async function selectPhoneWallpaperRequest(args,deps) {
  const stale=()=>{throw Object.assign(new Error('Phone selection is stale; reopen the picker'),{code:'REVISION_CONFLICT'})}
  if(Object.keys(args).some(key=>!['sessionId','turn','at','expectedDirectionToken','choice'].includes(key)) || typeof args.choice!=='string')throw Object.assign(new Error('Invalid wallpaper selection'),{code:'ARG_INVALID'})
  const chat=await deps.readChat(args.sessionId),message=chat?.messages.at(-1)
  if(!chat || message?.role!=='assistant' || message.pending || Number(message.turn || (message.greeting?1:0))!==args.turn || deps.busy(chat))stale()
  const direction=await deps.readDirection(chat,args.turn)
  if(!direction.record || JSON.stringify(direction.token)!==JSON.stringify(args.expectedDirectionToken) || !Number.isSafeInteger(args.at) || args.at<1 || args.at>direction.through)stale()
  const authority=await deps.readAuthority(),[phone]=await deps.readPresentation({chat,direction,at:args.at})
  const selected=selectPhoneWallpaper(direction.record,phone?.wallpaperChoices || [],args.choice,args.at,direction.through)
  if(!selected)return {status:'ready',token:direction.token,widgets:[phone]}
  const latest=await deps.readChat(args.sessionId)
  if(!latest || latest.id!==chat.id || latest.timeline.branchId!==chat.timeline.branchId || latest._storageRevision!==chat._storageRevision || deps.busy(latest) || (await deps.readAuthority()).revision!==authority.revision)stale()
  const saved=await deps.patch(chat.id,chat._storageRevision,[{op:'set',path:['messages',chat.messages.length-1,'stageDirectionAssetPacks'],value:selected}],{source:'phone.wallpaper.select',touchUpdatedAt:false})
  if(!saved)stale()
  const current=await deps.readChat(args.sessionId),checked=await deps.readDirection(current,args.turn)
  deps.publish(args.sessionId,args.turn)
  return {status:'ready',token:checked.token,widgets:await deps.readPresentation({chat:current,direction:checked,at:args.at})}
}

export function selectPhoneWallpaper(record,choices,choice,at,through) {
  const ref=selectWallpaper({phone:{wallpapers:choices}},choice)
  const next=structuredClone(record)
  if(JSON.stringify(next.end.modState?.['dsh.phone']?.wallpaper)===JSON.stringify(ref) && next.stats?.phoneWallpaperSelection!==undefined)return null
  // Replace only our previous state-only tail; accepted story operations keep their ordinals.
  next.end.modState={...next.end.modState,'dsh.phone':{...next.end.modState?.['dsh.phone'],wallpaper:ref}}
  if(next.stats?.phoneWallpaperSelection!==undefined)next.entries.pop()
  next.entries.push({at:through,ops:[],state:structuredClone(next.end),timeTransitionMs:0})
  next.stats={...next.stats,phoneWallpaperSelection:at}
  next.digest=assetPackDigest({binding:next.binding,baseline:next.baseline,entries:next.entries,end:next.end})
  return next
}
