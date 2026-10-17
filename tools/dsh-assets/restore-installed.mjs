// Restore foreign authoring evidence against the installed pixels, never reinstall or approve it.
import {readFile} from 'node:fs/promises'
import {isDeepStrictEqual as same} from 'node:util'
import {loadProject,transaction,atomic,safeProjectFile,productionError,createProjectImageReader,slotAccepted,hash,contentFingerprint,avatarQaNeedsRecheck} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {validateProjectSchema} from '../../tavern-plugin/lib/domain/asset-production-schema.js'
import {nativeImageInventory} from './images-baseline.mjs'
import {readNativeSnapshot} from './baseline.mjs'
import {readImageInstall} from './image-install-state.mjs'
import {validateLayeredEntry} from './layered.mjs'
import {imageKind,pngSize} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
function decodePng(bytes) {
  check(imageKind(bytes)==='png','Foreign image must decode as PNG')
  return pngSize(bytes)
}
const check=(v,m)=>{if(!v)throw productionError('CONFLICT',m)}
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n')
async function context(p,o) {
  check(p.baseline?.scope==='images','Restore requires a canonical images project')
  const source=await loadProject(o.sourceRoot)
  check(source.id===p.id,'Foreign source project')
  const native=await readNativeSnapshot(o.library,p.id)
  check(native.revision===o.expectedRevision,'Native revision changed')
  const readImage=createProjectImageReader(o.sourceRoot),files=new Map(),decoded=new Map()
  async function collect(v) {
    if(!v||typeof v!=='object')return
    if(v.path&&v.hash&&/^(images|sources)\//.test(v.path)) {
      const bytes=await readImage(v)
      if(!decoded.has(v.path)) {
        let image
        try {image=decodePng(bytes)}catch {check(false,'Foreign image must decode as PNG: '+v.path)}
        decoded.set(v.path,{width:image.width,height:image.height});files.set(v.path,bytes)
      }
      const image=decoded.get(v.path)
      check((v.width===undefined||v.width===image.width)&&(v.height===undefined||v.height===image.height),'Declared PNG dimensions differ: '+v.path)
    }
    for(const child of Object.values(v))if(child&&typeof child==='object')await collect(child)
  }
  async function finish(receipt,receiptPath) {
    validateProjectSchema(p)
    check((await readNativeSnapshot(o.library,p.id)).revision===native.revision,'Native revision changed during restore')
    if(o.dryRun)return
    // Every foreign byte is checked before any project state is committed.
    for(const [file,bytes] of files) {
      let old;try {old=await readFile(await safeProjectFile(o.root,file))}catch(e){if(e.code!=='ENOENT')throw e}
      check(!old||old.equals(bytes),'Destination media conflict: '+file)
    }
    for(const [file,bytes] of files)await atomic(o.root,file,bytes)
    await atomic(o.root,receiptPath,json(receipt))
  }
  return {source,native,collect,finish}
}
export async function restoreInstalledReplacement(root,o) {
  o={...o,root}
  const action=async p=>{
    const {source,native,collect,finish}=await context(p,o),incoming=source.slots[o.slot],old=p.slots[o.slot]
    check(old&&incoming?.replacementBase&&['sprite','avatar'].includes(incoming.kind),'Source must be a replace-installed result for an existing slot')
    check(slotAccepted(incoming)&&!incoming.stale&&!incoming.artifact.redo&&!avatarQaNeedsRecheck(source,incoming),'Source replacement is not currently accepted/current under its source QA policy')
    const tracked=await readImageInstall(o.sourceRoot,source),record=tracked.slots[o.slot]
    check(record?.hash===incoming.artifact.hash&&record.version===incoming.version&&record.revision,'Source install receipt does not match replacement')
    const blob=async h=>{
      const bytes=await readFile(await safeProjectFile(o.library,'packs/'+p.id+'/media/'+h+'.'+native.manifest.blobs[h].ext))
      check(hash(bytes)===h,'Native image bytes changed');return bytes
    }
    const inventory=await nativeImageInventory(native,blob,async h=>Boolean(native.manifest.blobs[h]))
    const rowFor=s=>inventory.find(r=>'f-'+r.figure.id===s.character&&r.outfit.key===s.outfit&&r.kind===s.kind&&r.emotion===s.emotion)
    const row=rowFor(incoming)
    check(row?.present&&same(row.hashes,[incoming.artifact.hash]),'Native replacement differs from source receipt')
    await blob(incoming.artifact.hash);await collect(incoming)
    const value=structuredClone(incoming),plans=Object.values(source.plans).filter(plan=>plan.slot===o.slot)
    for(const plan of plans){check(!p.plans[plan.id]||same(p.plans[plan.id],plan),'Plan identity conflict');await collect(plan)}
    const parentCopies=[]
    if(value.parentBinding) {
      const b=value.parentBinding,parent=p.slots[b.slot],sp=source.slots[b.slot],row=parent&&rowFor(parent)
      check(parent&&sp?.artifact?.hash===b.hash&&sp.version===b.version&&!sp.stale&&row?.present&&same(row.hashes,[b.hash]),'Installed parent changed')
      check(parent.installed?same(parent.installed.hashes,[b.hash]):parent.artifact?.hash===b.hash&&!parent.stale,'Canonical parent changed')
      await collect(sp.artifact)
      if(parent.artifact)check(parent.artifact.hash===b.hash,'Canonical parent artifact changed')
      else parentCopies.push([parent,sp.artifact])
      // Only installed inventory identities can substitute for a foreign inventory UUID.
      const inventoryParent=s=>s?.installed&&s.version===s.installed.revision&&typeof s.version==='string'&&same(s.installed.hashes,[b.hash])
      if(typeof b.version==='string')check(inventoryParent(sp)&&inventoryParent(parent),'Parent must resolve to an installed inventory identity')
      else check(parent.version===b.version&&slotAccepted(parent)&&slotAccepted(sp),'Parent authoring version is not approved')
      value.parentBinding.version=parent.version
    }
    const state=await readImageInstall(root,p),current=state.slots[o.slot]
    check(!current||same(current,record)||old.installed&&current.hash===incoming.replacementBase.hash,'Canonical install tracking changed')
    const replay=same(old,value)
    if(!replay)check(old.installed&&old.version===o.expectedVersion&&same(old.installed.hashes,[incoming.replacementBase.hash]),'Canonical placeholder changed')
    for(const [parent,artifact] of parentCopies)parent.raw=parent.artifact=structuredClone(artifact)
    p.slots[o.slot]=value
    p.restoredReplacements||={}
    p.restoredReplacements[o.slot]={slotHash:hash(JSON.stringify(value)),canonicalFraming:p.characters.find(c=>c.key===value.character)?.avatarFraming??null,sourceFraming:source.characters.find(c=>c.key===value.character)?.avatarFraming??null,revision:native.revision}
    for(const plan of plans)p.plans[plan.id]=structuredClone(plan)
    state.slots[o.slot]=structuredClone(record)
    state.revision=native.revision;state.contentHash=native.manifest.contentHash
    const receipt={kind:'restored-installed-replacement',slot:o.slot,nativeRevision:native.revision,sourceSlot:incoming,sourcePlans:plans,sourceTracking:record,canonicalParentBinding:value.parentBinding}
    await finish(receipt,'sources/restored-replacements/'+hash(o.slot)+'.json')
    if(!o.dryRun)await atomic(root,'sources/image-install.json',json(state))
    return {slot:o.slot,version:value.version,hash:value.artifact.hash,revision:native.revision,idempotent:replay,dryRun:Boolean(o.dryRun),approvalCopied:true,libraryWritten:false}
  }
  return o.dryRun?action(await loadProject(root)):transaction(root,action)
}
export async function attachInstalledLayered(root,o) {
  o={...o,root}
  const action=async p=>{
    const {source,native,collect,finish}=await context(p,o),entry=source.layered?.[o.outfit]
    check(entry,'Source layered outfit is missing');validateLayeredEntry(p,o.outfit,entry)
    check(source.review?.acceptedBy&&source.review.contentHash===contentFingerprint(source),'Layered source approval is stale')
    const receipt=JSON.parse(await readFile(o.file,'utf8')),changes=receipt.changes
    check(receipt.revision&&Array.isArray(changes)&&changes.length,'Actual layered install receipt is required')
    const [character,outfit]=o.outfit.split('/'),figure=native.figures[character.slice(2)],nativeOutfit=figure?.outfits.find(x=>x.key===outfit),doc=native.sprites[nativeOutfit?.sprite?.manifestKey]
    check(doc,'Native outfit is missing')
    await collect(entry.assets)
    for(const row of changes) {
      const render=entry.manifest.emotions[row.emotion]?.render,live=doc.emotions[row.emotion]?.render
      check(render?.kind==='parts'&&live?.kind==='parts'&&render.rig===live.rig,'Layered routing changed')
      const rig=entry.manifest.rigs[render.rig],liveRig=doc.rigs[live.rig],part=rig.parts[row.partId],asset=entry.assets[part?.src]
      check(part&&asset?.hash===row.hash&&part.revision===row.version,'Install receipt differs from source part')
      const selection=rig.recipes[render.recipe].selection,liveSelection=liveRig.recipes[live.recipe].selection
      check(same(selection,liveSelection),'Layered rest selection changed')
      for(const id of Object.values(selection).filter(id=>id!=='none')) {
        const a=rig.parts[id],b=liveRig.parts[id]
        check(same(a,b)&&entry.assets[a.src]?.hash===nativeOutfit.sprite.assets[b.src],'Installed layered part changed: '+id)
        const h=entry.assets[a.src].hash,bytes=await readFile(await safeProjectFile(o.library,'packs/'+p.id+'/media/'+h+'.png'))
        check(hash(bytes)===h,'Native layered bytes changed')
        // The hash binds these native bytes to the PNG decoded once by collect().
        const asset=entry.assets[a.src]
        check(asset.width===b.rect[2]&&asset.height===b.rect[3],'Installed part dimensions differ: '+id)
      }
    }
    const old=p.layered?.[o.outfit],replay=same(old,entry)
    check(replay||!old&&Number(o.expectedVersion)===0,'Canonical layered authoring changed; attachment never overwrites an existing document')
    p.layered||={};p.layered[o.outfit]=structuredClone(entry)
    const tracking={kind:'attached-installed-layered',entryHash:hash(JSON.stringify(entry)),revision:native.revision,sourceRevision:source.revision,sourceReview:source.review,installReceipt:receipt,emotions:changes.map(r=>r.emotion)}
    p.layeredInstalls||={};p.layeredInstalls[o.outfit]=tracking
    await finish({sourceProject:source,tracking},'sources/layered-install/'+hash(o.outfit)+'.json')
    return {outfit:o.outfit,version:entry.version,revision:native.revision,idempotent:replay,dryRun:Boolean(o.dryRun),libraryWritten:false}
  }
  return o.dryRun?action(await loadProject(root)):transaction(root,action)
}
