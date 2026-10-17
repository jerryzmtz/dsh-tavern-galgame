// Convert native inventory into an ordinary, unapproved authoring candidate in one transaction.
import {readFile} from 'node:fs/promises'
import {transaction,preparePlan,ingest,atomic,hash,safeProjectFile,productionError,createProjectImageReader} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {imageDimensions} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
import {readNativeSnapshot} from './baseline.mjs'
import {nativeImageInventory} from './images-baseline.mjs'
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
export async function replaceInstalled(root,options) {
  const bytes=await readFile(options.file)
  return transaction(root,async p=>{
    const s=p.slots[options.slot]
    check(p.baseline?.scope==='images'&&s?.installed&&['sprite','avatar'].includes(s.kind),'Replacement requires an installed native sprite/avatar slot; numeric slots use prompt/import --replace')
    check(s.version===options.expectedVersion,'Slot expected version changed')
    const native=await readNativeSnapshot(options.library,p.id)
    check(native.revision===options.expectedRevision,'Native revision changed')
    const blob=async h=>readFile(await safeProjectFile(options.library,'packs/'+p.id+'/media/'+h+'.'+native.manifest.blobs[h].ext))
    const inventory=await nativeImageInventory(native,blob,async h=>Boolean(native.manifest.blobs[h]))
    const rowFor=slot=>inventory.find(r=>'f-'+r.figure.id===slot.character&&r.outfit.key===slot.outfit&&r.kind===slot.kind&&r.emotion===slot.emotion)
    const row=rowFor(s)
    check(row?.present&&row.hashes.length===1&&s.installed.hashes.length===1&&row.hashes[0]===s.installed.hashes[0]&&row.referenceHash===row.hashes[0],'Installed image changed or is not a single-image slot')
    const readImage=createProjectImageReader(root)
    async function materialize(slot) {
      const row=rowFor(slot)
      check(row?.present&&row.hashes.length===1&&row.referenceHash===row.hashes[0]&&JSON.stringify(row.hashes)===JSON.stringify(slot.installed.hashes),'Installed reference changed or is not a single-image slot: '+slot.id)
      const digest=row.referenceHash,ext=native.manifest.blobs[digest].ext,source=await blob(digest)
      check(hash(source)===digest,'Installed reference bytes changed: '+slot.id)
      if(slot.artifact)await readImage(slot.artifact)
      const file='sources/native/'+digest+'.'+ext,[width,height]=imageDimensions(source,ext)
      await atomic(root,file,source)
      slot.raw=slot.artifact={hash:digest,path:file,width,height}
    }
    await materialize(s)
    if(s.kind==='avatar') {
      const parent=p.slots[[s.character,s.outfit,'sprite',s.emotion].join('/')]
      check(parent,'Avatar requires an exact sprite parent')
      if(parent.installed)await materialize(parent)
      else {check(parent.artifact&&parent.registered&&!parent.stale,'Avatar parent requires a current registered sprite');await readImage(parent.artifact)}
    }
    // Retain the native predecessor; readImageInstall feeds this into the existing three-way CAS.
    s.replacementBase={version:s.version,hash:s.installed.hashes[0],revision:native.revision}
    delete s.installed;delete s.status;delete s.accepted;delete s.acceptedVersion;delete s.approved
    s.version=0
    const plan=await preparePlan(p,root,{slot:s.id,note:'Explicit replacement of installed native image; no approval implied.'})
    for(const ref of plan.references)await readImage(ref)
    const result=await ingest(p,root,p.plans[plan.id],bytes,{...options,replace:true})
    check(s.version===1,'Replacement must create a new candidate')
    check((await readNativeSnapshot(options.library,p.id)).revision===native.revision,'Native revision changed during replacement')
    return {...result,version:s.version,expectedVersion:options.expectedVersion,replacementBase:s.replacementBase,parentBinding:s.parentBinding,accepted:false}
  })
}
