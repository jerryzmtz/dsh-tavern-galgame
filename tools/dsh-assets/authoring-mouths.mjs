import {assertCandidateAdmission} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
import {selectAnimations} from './animation-selection.mjs'
import {createProjectImageReader} from '../../tavern-plugin/lib/domain/asset-production-project.js'
// Complete accepted authoring groups reuse the native mouth patcher and tracked image CAS.
import {loadProject,slotAccepted,prerequisites,animationDependenciesCurrent,hash,productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {inspectMedia,sealPack} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {trimAuthoringImages} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/image-closure.js'
import {validatePackDocuments} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {readNativeSnapshot} from './baseline.mjs'
import {readImageInstall} from './image-install-state.mjs'
import {nativeImageInventory} from './images-baseline.mjs'
import {mouthFrames,applyImageMouths} from './images-mouth.mjs'
import {applyScopedAnimations} from './animation-patch.mjs'
import {applyAnimationBlinks} from './animation-blinks.mjs'
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
export async function compileAuthoringMouthDelivery(root,{library,expectedRevision,excludeOutfit,scope='mouths',sprites:selectors,slots}={}) {
  check(library&&expectedRevision&&expectedRevision!=='null','Mouth scope requires --library and the installed --expected-revision')
  check(!excludeOutfit,'Mouth scope cannot exclude outfits')
  const original=await loadProject(root),{project:p,selection}=selectAnimations(original,{scope,sprites:selectors,slots});check(!p.baseline||p.baseline.scope==='images','Ordinary authoring project or images baseline required')
  const readImage=createProjectImageReader(root)
  const current=await readNativeSnapshot(library,p.id,{media:true})
  check(current.revision===expectedRevision,'Installed revision changed; refresh before export/install')
  const tracked=await readImageInstall(root,p,current),selected=structuredClone(p),skipped=[],installedSlots=[]
  selected.mouthSources={}
  const ids=new Set(Object.values(p.slots).filter(s=>s.kind==='mouth').map(s=>[s.character,s.outfit,'sprite',s.emotion].join('/')))
  for(const id of ids) {
    if(p.mouthSources?.[id]?.route&&p.mouthSources[id].route!=='static')continue
    const base=p.slots[id],slots=mouthFrames.map(frame=>p.slots[[base.character,base.outfit,'mouth',base.emotion,frame].join('/')])
    const missing=mouthFrames.filter((frame,i)=>!slots[i]?.artifact)
    const unaccepted=slots.filter(s=>s?.artifact&&!slotAccepted(s)).map(s=>s.id)
    if(missing.length||unaccepted.length) {
      skipped.push({source:id,reason:missing.length?'INCOMPLETE_MOUTH_SET':'UNACCEPTED_MOUTH_SET',missing,unaccepted,held:slots.filter(s=>s?.artifact&&slotAccepted(s)).map(s=>s.id)})
      continue
    }
    const bound=p.mouthSources?.[id]
    check((bound||base.artifact&&base.registered)&&!base.stale,'STALE_REFERENCES: source sprite unavailable: '+id)
    const source={slot:id,version:bound?.version??base.version,hash:bound?.hash??base.artifact.hash,width:bound?.width??base.artifact.width,height:bound?.height??base.artifact.height,mouth:tracked.mouths?.[id]?.mouth??bound?.mouth??null}
    check(!bound||base.installed||base.version===bound.version&&base.artifact?.hash===bound.hash,'STALE_REFERENCES: mouth source version/hash changed: '+id)
    for(const s of slots) {
      assertCandidateAdmission(p,s,root)
      const plan=p.plans[s.planId]
      // Original plans (or installed bindings) prove the exact source version/hash.
      check(animationDependenciesCurrent(p,s,plan)&&s.artifact.baseHash===source.hash,'STALE_REFERENCES: mouth source version/hash changed: '+s.id)
      check(!prerequisites(p,s).length&&!s.artifact.redo,'Unfinished mouth pipeline: '+s.id)
      const bytes=await readImage(s.artifact)
      const size=await inspectMedia(bytes,{ext:'png',mime:'image/png',size:bytes.length})
      check(size.width===s.artifact.width&&size.height===s.artifact.height,'Mouth image dimensions changed: '+s.id)
      selected.slots[s.id].sourceBinding={slot:id,version:source.version,hash:source.hash}
      installedSlots.push({slot:s.id,version:s.version,hash:s.artifact.hash})
    }
    selected.mouthSources[id]=source
  }
  for(const s of Object.values(p.slots))if(s.artifact)await readImage(s.artifact)
  for(const source of [...Object.values(p.mouthSources||{}),...Object.values(p.blinkSources||{})])if(source.path)await readImage(source)
  const manifest=structuredClone(current.manifest),figures=structuredClone(current.figures),sprites=structuredClone(current.sprites),files=new Map(current.files)
  const inventory=await nativeImageInventory(current,async h=>files.get('media/'+h+'.'+manifest.blobs[h].ext),async h=>Boolean(manifest.blobs[h]&&files.has('media/'+h+'.'+manifest.blobs[h].ext)))
  const ownSprite=(c,o)=>{
    let key=o.sprite.manifestKey
    if(Object.values(figures).flatMap(f=>f.outfits).filter(o=>o.sprite?.manifestKey===key).length>1) {
      const ownKey='images-'+hash(c.id+'/'+o.key).slice(0,24)
      check(!manifest.sprites[ownKey],'Reserved image manifest key already exists')
      sprites[ownKey]=structuredClone(sprites[key]);manifest.sprites[ownKey]='sprites/'+ownKey+'/manifest.json'
      o.sprite.manifestKey=key=ownKey
    }
    return key
  }
  const {installedMouths,written}=await applyImageMouths(root,selected,{readImage,manifest,figures,sprites,files,inventory,ownSprite})
  const blinks=scope==='animation'?await applyAnimationBlinks(root,p,{readImage,manifest,figures,sprites,files,ownSprite,tracked,installedSlots,skipped}):null
  if(blinks)written.push(...blinks.written)
  const scoped=await applyScopedAnimations(root,p,{readImage,manifest,figures,sprites,files,ownSprite,tracked,installedSlots,skipped},{blinks:scope==='animation'})
  written.push(...scoped.written);Object.assign(installedMouths,scoped.installedMouths)
  if(blinks)Object.assign(blinks.installedBlinks,scoped.installedBlinks)
  trimAuthoringImages(manifest,files,current.figures)
  const sealed=await sealPack(manifest,files,current)
  validatePackDocuments({manifest:sealed.manifest,figures,sprites})
  return {...sealed,p:original,selection,current,scope,expectedRevision,installedSlots,installedMouths,...(blinks?{installedBlinks:blinks.installedBlinks}:{}),written,skipped,warnings:skipped.length?[{code:scope==='animation'?'SKIPPED_ANIMATIONS':'SKIPPED_MOUTH_SETS',severity:'warning',message:'Incomplete or unaccepted animations were held back; mouths require four accepted frames and blink requires an accepted closed patch',count:skipped.length}]:[]}
}
