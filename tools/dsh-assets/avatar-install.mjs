import {assertCandidateAdmission} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
// Avatar deliveries own only selected outfit.avatars[emotion] entries.
import path from 'node:path'
import {readFile,rename,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {generationProvenance,productionDependencyClosure,productionDependencyReasons,loadProject,slotAccepted,prerequisites,productionProgress,productionError,safeProjectFile,hash,atomic,contentFingerprint} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {openZip} from '../../tavern-plugin/packages/dsh-asset-library/lib/zip.js'
import {trimAuthoringImages} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/image-closure.js'
import {verifyBytes,inspectMedia,sealPack} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {decodeMedia} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
import {writeNativePack} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/pack-source.js'
import {readNativeSnapshot} from './baseline.mjs'
import {assertImageEmotions,installImageDelivery,nativeImageInventory,assertNativeAvatarParent} from './images-baseline.mjs'
import {readImageInstall} from './image-install-state.mjs'
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n')
const list=(value,name)=>{
  if(value===undefined)return null
  const values=typeof value==='string'?value.split(',').map(s=>s.trim()):[]
  if(!values.length||values.some(v=>!v))throw productionError('INVALID_ARGUMENT','--'+name+' requires a nonempty comma-separated list')
  return [...new Set(values)].sort()
}
function select(p,options) {
  const figures=list(options.figures,'figures')?.map(key=>{
    const c=p.characters.find(c=>c.id===key||c.key===key)
    if(!c)throw productionError('INVALID_ARGUMENT','Unknown figure UUID/key: '+key)
    return c.key
  })
  const outfits=list(options.outfits,'outfits'),slots=list(options.slots,'slots')
  for(const key of outfits||[])if(!p.characters.some(c=>(!figures||figures.includes(c.key))&&c.outfits.some(o=>o.key===key)))throw productionError('INVALID_ARGUMENT','Unknown outfit key in figure scope: '+key)
  const rows=Object.values(p.slots).filter(s=>s.kind==='avatar'&&(!figures||figures.includes(s.character))&&(!outfits||outfits.includes(s.outfit)))
  for(const id of slots||[])if(!rows.some(s=>s.id===id))throw productionError('INVALID_ARGUMENT','Unknown avatar slot in figure/outfit scope: '+id)
  return rows.filter(s=>!slots||slots.includes(s.id)).sort((a,b)=>a.id.localeCompare(b.id))
}
async function sourceBaseline(p,options) {
  if(options.avatarBaseline) {
    // An explicit historical native export is an import boundary, not a fresh library snapshot.
    const zip=await openZip(path.resolve(options.avatarBaseline)),files=new Map()
    for(const entry of zip.entries)files.set(entry.path,await zip.read(entry))
    check(files.has('manifest.json'),'Avatar baseline must be a native pack ZIP')
    const manifest=JSON.parse(files.get('manifest.json'));files.delete('manifest.json')
    check(manifest.id===p.id,'Avatar baseline pack identity differs from project')
    await verifyBytes(manifest,files,{decodeMedia})
    return {id:manifest.contentHash,figures:Object.fromEntries(manifest.figures.map(id=>[id,JSON.parse(files.get('figures/'+id+'.json'))]))}
  }
  check(p.baseline?.scope==='images','Avatar scope requires --avatar-baseline HISTORICAL_PACK.zip for an existing authoring project; never use the current library as an invented baseline')
  return {id:p.baseline.contentHash}
}
export async function compileAvatarDelivery(root,options={}) {
  check(options.library&&options.expectedRevision&&options.expectedRevision!=='null','Avatar scope requires --library and --expected-revision of an installed pack')
  check(!options.excludeOutfit,'Avatar scope cannot exclude or remove outfits')
  check(path.resolve(root)!==path.resolve(options.library),'Library must be separate from authoring project')
  const p=await loadProject(root),selected=select(p,options),baseline=await sourceBaseline(p,options)
  const current=await readNativeSnapshot(options.library,p.id,{media:true})
  check(current.revision===options.expectedRevision,'Installed revision changed; refresh before export/install')
  const manifest=structuredClone(current.manifest),files=new Map(current.files),figures=structuredClone(current.figures),changedFigures=new Set(),written=[],accepted=[],skipped=[]
  const pending=new Map(productionProgress(p).pending.map(row=>[row.slot,row.reasons])),verified=new Map(),installedState=await readImageInstall(root,p,current),installedSlots=[]
  async function media(s) {
    const a=s.artifact
    if(!a)return
    assertCandidateAdmission(p,s,root)
    let cached=verified.get(a.path)
    if(!cached) {
      const bytes=await readFile(await safeProjectFile(root,a.path))
      check(hash(bytes)===a.hash,'Image content changed: '+s.id)
      const ext=s.installed?path.extname(a.path).slice(1):'png'
      const size=await inspectMedia(bytes,{ext,mime:ext==='jpg'?'image/jpeg':'image/'+ext,size:bytes.length},decodeMedia)
      cached={hash:a.hash,bytes,...size};verified.set(a.path,cached)
    }
    check(cached.hash===a.hash,'Image content changed: '+s.id)
    check(cached.width===a.width&&cached.height===a.height,'Image dimensions changed: '+s.id)
    return cached.bytes
  }
  const inventory=await nativeImageInventory(current,async h=>current.files.get('media/'+h+'.'+current.manifest.blobs[h].ext),async h=>Boolean(current.manifest.blobs[h]))
  const closure=s=>productionDependencyClosure(p,s)
  for(const s of selected) {
    const reasons=[]
    if(!slotAccepted(s))reasons.push(s.artifact?'HUMAN_APPROVAL_REQUIRED':'MISSING_IMAGE')
    const dependencies=[...closure(s)]
    reasons.push(...productionDependencyReasons(p,s,pending))
    if(reasons.length){skipped.push({slot:s.id,reasons:[...new Set(reasons)]});continue}
    assertNativeAvatarParent(p,s,inventory)
    for(const id of dependencies)await media(p.slots[id])
    const c=p.characters.find(c=>c.key===s.character),f=figures[c.id],o=f?.outfits.find(o=>o.key===s.outfit)
    check(o,'Unknown installed figure/outfit: '+s.id)
    assertImageEmotions(f.emotions,c.emotions)
    let before
    if(baseline.figures) {
      const bf=baseline.figures[c.id],bo=bf?.outfits.find(o=>o.key===s.outfit)
      check(bo&&bf.emotions.some(e=>e.id===s.emotion),'Missing historical avatar baseline for '+s.id)
      before=bo.avatars?.[s.emotion]??null
    } else {
      const row=p.baseline.uuidMap.find(row=>row.id===c.id&&row.key===c.key)
      check(row?.outfits.includes(s.outfit),'Missing image baseline identity for '+s.id)
      check(!s.installed||s.installed.hashes.length===1,'Ambiguous avatar baseline: '+s.id)
      before=s.installed?s.installed.hashes[0]:null
    }
    const target=s.artifact.hash,local=o.avatars?.[s.emotion]??null
    accepted.push({slot:s.id,version:s.version,hash:target,baseline:before})
    const base=installedState.slots[s.id]?.hash??before
    // Unchanged historical sources remain unowned; changed sources require the last publish.
    if(target===base&&local!==base&&!installedState.slots[s.id])continue
    check(local===base,'Avatar conflict for figure '+c.id+' ('+c.name+'): '+s.id)
    installedSlots.push({slot:s.id,version:s.version,hash:target})
    if(target===local)continue
    o.avatars||={};o.avatars[s.emotion]=target
    changedFigures.add(c.id);written.push(s.id)
    if(!manifest.blobs[target]) {
      const bytes=await media(s)
      manifest.blobs[target]={ext:'png',mime:'image/png',size:bytes.length};files.set('media/'+target+'.png',bytes)
    }
  }
  for(const id of changedFigures)files.set('figures/'+id+'.json',json(figures[id]))
  const warnings=skipped.length?[{code:'SKIPPED_AVATARS',severity:'warning',message:skipped.length+' avatar slots skipped; see skipped',count:skipped.length}]:[]
  const message=accepted.length?'Only individually accepted avatar slots are eligible':'No accepted avatars in scope; nothing to install'
  trimAuthoringImages(manifest,files,current.figures)
  return {...await sealPack(manifest,files,current),p,current,scope:'avatars',expectedRevision:options.expectedRevision,selection:selected.map(s=>s.id),baseline:baseline.id,accepted,skipped,written,installedSlots,changedFigures:[...changedFigures],warnings,message}
}
const result=pack=>({id:pack.p.id,scope:'avatars',contentHash:pack.manifest.contentHash,expectedRevision:pack.expectedRevision,accepted:pack.accepted,skipped:pack.skipped,written:pack.written,changedFigures:pack.changedFigures,warnings:pack.warnings,message:pack.message})
export async function packAvatarProduction(root,options) {
  const pack=await compileAvatarDelivery(root,options),source='delivery/final-assets/pack-source'
  await rm(await safeProjectFile(root,'delivery'),{recursive:true,force:true})
  for(const [file,bytes]of pack.files)await atomic(root,source+'/'+file,bytes)
  await atomic(root,source+'/generation-provenance.json',json(generationProvenance(pack)))
  await atomic(root,source+'/manifest.json',json(pack.manifest))
  await atomic(root,source+'/pack-source.json',json({version:1,id:pack.p.id,name:pack.manifest.name,manifest:'manifest.json'}))
  const output=await safeProjectFile(root,'delivery/final-assets/pack.zip'),temp=output+'.'+randomUUID()+'.tmp'
  await writeNativePack(pack,temp);await rename(temp,output)
  await atomic(root,'delivery/avatar-export.json',json({scope:'avatars',projectId:pack.p.id,projectContentHash:contentFingerprint(pack.p),baseline:pack.baseline,selection:pack.selection,accepted:pack.accepted,installedSlots:pack.installedSlots,expectedRevision:pack.expectedRevision,contentHash:pack.manifest.contentHash}))
  return {...result(pack),output,installReady:pack.accepted.length>0}
}
export async function installAvatarProduction(root,options) {
  const pack=await compileAvatarDelivery(root,options)
  const receipt=JSON.parse(await readFile(await safeProjectFile(root,'delivery/avatar-export.json')))
  check(receipt.scope==='avatars'&&receipt.projectId===pack.p.id&&receipt.projectContentHash===contentFingerprint(pack.p),'Foreign or stale avatar export; run pack again')
  check(receipt.baseline===pack.baseline&&JSON.stringify(receipt.selection)===JSON.stringify(pack.selection)&&JSON.stringify(receipt.accepted)===JSON.stringify(pack.accepted),'Avatar export selection/acceptance/baseline differs; pack and install must use the same scope')
  check(receipt.expectedRevision===options.expectedRevision||receipt.contentHash===pack.manifest.contentHash,'Stale avatar export revision; run pack again')
  check(receipt.contentHash===pack.manifest.contentHash,'Export differs from the fresh installed snapshot; run pack again')
  return {...result(pack),...await installImageDelivery(root,pack,options)}
}
