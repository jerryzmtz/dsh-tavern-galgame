import {assertDeltaVersion} from './delta-version.mjs'
// Published slot state is independent of authoring approvals and the original sparse baseline.
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {loadProject,slotAccepted,atomic,safeProjectFile,productionError,transaction} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {canonicalJson} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {verifyBytes} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {decodeMedia} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
import {openZip} from '../../tavern-plugin/packages/dsh-asset-library/lib/zip.js'
import {readNativeSnapshot} from './baseline.mjs'
const file='sources/image-install.json'
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
const same=(a,b)=>canonicalJson(a??null)===canonicalJson(b??null)
export async function readImageInstall(root,p,current) {
  let state
  try {state=JSON.parse(await readFile(await safeProjectFile(root,file),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
  check(!state||state.projectId===p.id,'Foreign image-install baseline')
  state||={projectId:p.id,slots:{}}
  // Native replacement imports retain their exact old publish as the initial tracked base.
  for(const s of Object.values(p.slots))if(s.replacementBase&&!state.slots[s.id])state.slots[s.id]={...s.replacementBase}
  // Recover a native commit interrupted before the per-project receipt write.
  if(current)for(const receiptFile of ['delivery/settei-export.json','delivery/avatar-export.json']) {
    let receipt
    try {receipt=JSON.parse(await readFile(await safeProjectFile(root,receiptFile),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;continue}
    if((receipt.project_id??receipt.projectId)!==p.id||receipt.contentHash!==current.manifest.contentHash)continue
    for(const s of receipt.installedSlots||[])if(!state.slots[s.slot]||state.slots[s.slot].hash!==s.hash||state.slots[s.slot].version!==s.version)state.slots[s.slot]={version:s.version,hash:s.hash,revision:current.revision}
    if(receipt.installedMouths)Object.assign(state.mouths||={},receipt.installedMouths)
    if(receipt.installedBlinks)Object.assign(state.blinks||={},receipt.installedBlinks)
  }
  return state
}
export async function saveImageInstall(root,p,slots,snapshot,mouths,blinks) {
  const before=await readImageInstall(root,p),next=structuredClone(before)
  for(const s of slots) {
    const previous=before.slots[s.slot]
    // Replays retain the actual revision in which this slot was installed.
    if(previous?.version===s.version&&previous?.hash===s.hash)continue
    next.slots[s.slot]={version:s.version,hash:s.hash,revision:snapshot.revision}
  }
  if(mouths)Object.assign(next.mouths||={},mouths)
  if(blinks)Object.assign(next.blinks||={},blinks)
  next.revision=snapshot.revision;next.contentHash=snapshot.manifest.contentHash
  if(!same(before,next))await atomic(root,file,Buffer.from(JSON.stringify(next,null,2)+'\n'))
  return next
}
export async function adoptInstalled(root,options) {
  const action=async p=>{
    check(p.baseline?.scope==='images','Adoption requires an images baseline')
    check(options.library&&options.expectedRevision,'Adoption requires --library and --expected-revision')
    const ids=typeof options.slots==='string'?options.slots.split(',').map(s=>s.trim()):[]
    check(ids.length&&ids.every(Boolean),'Adoption requires explicit --slots SLOT,...')
    const current=await readNativeSnapshot(options.library,p.id,{media:true})
    check(current.revision===options.expectedRevision,'Installed revision changed; refresh before adoption')
    const {nativeImageInventory}=await import('./images-baseline.mjs')
    const inventory=await nativeImageInventory(current,async h=>current.files.get('media/'+h+'.'+current.manifest.blobs[h].ext),async h=>Boolean(current.manifest.blobs[h]&&current.files.has('media/'+h+'.'+current.manifest.blobs[h].ext)))
    const state=await readImageInstall(root,p),sourceRoot=path.resolve(options.sourceRoot||root)
    let source,archive
    if(options.pack) {
      check(options.file,'Historical export adoption requires --file VERSIONED_DELTA.json')
      const receipt=JSON.parse(await readFile(await safeProjectFile(sourceRoot,'delivery/settei-export.json'),'utf8'))
      const zip=await openZip(path.resolve(options.pack)),files=new Map()
      for(const entry of zip.entries)files.set(entry.path,await zip.read(entry))
      const manifest=JSON.parse(files.get('manifest.json'));files.delete('manifest.json')
      check(receipt.scope==='images'&&receipt.project_id===p.id&&manifest.id===p.id&&receipt.contentHash===manifest.contentHash,'Historical image export receipt/archive mismatch')
      await verifyBytes(manifest,files,{decodeMedia})
      // This migration path proves a real, whole prior publish rather than accepting a new candidate.
      check(current.manifest.contentHash===receipt.contentHash,'Historical image export is not the current installed publish')
      const delta=JSON.parse(await readFile(path.resolve(options.file),'utf8'))
      check(delta.project_id===p.id&&Array.isArray(delta.updates),'Historical delta project mismatch')
      for(const row of delta.updates)assertDeltaVersion(row)
      source=Object.fromEntries(delta.updates.map(row=>[row.slot,row.value]));archive=manifest.contentHash
    } else {
      check(!options.file,'--file requires a historical --pack ZIP')
      const historic=await loadProject(sourceRoot)
      check(historic.id===p.id,'Historical project identity differs')
      source=historic.slots
    }
    const adopted=[]
    for(const id of [...new Set(ids)]) {
      const s=p.slots[id],old=source[id]
      check(s&&['sprite','avatar'].includes(s.kind)&&old?.id===id&&old.kind===s.kind&&old.character===s.character&&old.outfit===s.outfit&&old.emotion===s.emotion,'Unknown historical image slot: '+id)
      check(old.artifact&&Number.isInteger(old.version)&&old.version>0&&(archive||slotAccepted(old)&&!old.stale),'Historical image must have an exact accepted version/hash: '+id)
      const c=p.characters.find(c=>c.key===s.character),row=inventory.find(r=>r.figure.id===c.id&&r.outfit.key===s.outfit&&r.kind===s.kind&&r.emotion===s.emotion)
      check(row?.present&&row.hashes.length===1&&row.hashes[0]===old.artifact.hash,'Installed image differs from historical image: '+id)
      check(!state.slots[id]||state.slots[id].hash===old.artifact.hash&&state.slots[id].version===old.version,'Cannot replace an existing installed base: '+id)
      adopted.push({slot:id,version:old.version,hash:old.artifact.hash})
    }
    check(JSON.parse(await readFile(await safeProjectFile(options.library,'local/'+p.id+'.json'),'utf8')).revision===options.expectedRevision,'Installed revision changed during adoption')
    if(!options.dryRun)await saveImageInstall(root,p,adopted,current)
    return {id:p.id,scope:'images',adopted,revision:current.revision,contentHash:current.manifest.contentHash,dryRun:Boolean(options.dryRun)}
  }
  return options.dryRun?action(await loadProject(root)):transaction(root,action)
}
