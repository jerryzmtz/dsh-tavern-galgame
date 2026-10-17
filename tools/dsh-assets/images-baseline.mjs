import {assertCandidateAdmission} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
import {createProjectImageReader} from '../../tavern-plugin/lib/domain/asset-production-project.js'
// Sparse authoring: installed slots are inventory, not transported images or invented approvals.
import {readFile,access} from 'node:fs/promises'
import {safeProjectFile,productionError,hash,loadProject,productionProgress,contentFingerprint,prerequisites} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {imageDimensions} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
import {inspectMedia,sealPack} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {composeHybridPreview} from '../../tavern-plugin/lib/domain/hybrid-sprite-preview.js'
import hybrid from '../../tavern-plugin/packages/dsh-asset-library/lib/shared/hybrid-sprite.cjs'
import {staticMouthDocument,mouthFrames,validateMouthGroups,applyImageMouths,staleMouthSource} from './images-mouth.mjs'
import {readImageInstall,saveImageInstall} from './image-install-state.mjs'
import {spriteResourcePaths} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/sprite.js'
import {readNativeSnapshot} from './baseline.mjs'
import path from 'node:path'
import {trimAuthoringImages} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/image-closure.js'
import {canonicalJson,validatePackDocuments} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {openZip} from '../../tavern-plugin/packages/dsh-asset-library/lib/zip.js'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import {decodeMedia} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n')
// Slots and review labels depend on ordered IDs/labels, not native voice or prompt metadata.
const slotEmotions=emotions=>emotions.map(({id,label})=>({id,label}))
export function assertImageEmotions(current,baseline) {
  check(current&&JSON.stringify(slotEmotions(current))===JSON.stringify(slotEmotions(baseline)),'Native figure emotions changed; export a fresh baseline')
}

export async function nativeImageInventory(native,read,exists) {
  const rows=[]
  for(const f of Object.values(native.figures))for(const o of f.outfits) {
    const doc=o.sprite&&native.sprites[o.sprite.manifestKey],assets=o.sprite?.assets||{}
    for(const {id:emotion} of f.emotions) {
      let state=doc?.emotions[emotion],spriteHashes=[],referenceHash,composition
      if(doc?.kind==='hybrid-face-sprites') {
        const resolved=hybrid.resolveHybridSprite(doc,emotion)
        if(resolved.kind==='whole')state=resolved.legacy.emotions[emotion]
        else if(resolved.available) {
          spriteHashes=resolved.layers.map(part=>assets[part.src])
          if((await Promise.all(spriteHashes.map(exists))).every(Boolean)) {
            const r=doc.emotions[emotion].render
            if(r.previewRevision===resolved.revision&&await exists(assets[r.preview]))referenceHash=assets[r.preview]
            else composition=()=>composeHybridPreview(doc,emotion,src=>read(assets[src]))
          }
          state=null
        } else state=null
      }
      const view=state?.stage||state
      if(state&&!state.fallback) {
        spriteHashes=view.src?[assets[view.src]]:(view.layers||[]).map(layer=>assets[layer.src])
        referenceHash=view.src?assets[view.src]:undefined
      }
      const present=spriteHashes.length>0&&(await Promise.all(spriteHashes.map(exists))).every(Boolean)
      if(o.sprite)rows.push({figure:f,outfit:o,emotion,kind:'sprite',present,hashes:present?spriteHashes:[],referenceHash:present?referenceHash:undefined,composition:present?composition:undefined})
      const flat=staticMouthDocument(doc,emotion),set=flat?.rig?.mouthSets?.[flat.emotions[emotion].binding?.mouth?.set]
      if(flat)for(const frame of mouthFrames) {
        const digest=assets[set?.frames[frame]],present=Boolean(digest&&await exists(digest))
        rows.push({figure:f,outfit:o,emotion,kind:'mouth',frame,present,hashes:present?[digest]:[],referenceHash:present?digest:undefined})
      }
      // Legacy portrait resources belong to the sprite, never outfit avatar inventory.
      const avatar=await exists(o.avatars?.[emotion])?o.avatars[emotion]:undefined
      rows.push({figure:f,outfit:o,emotion,kind:'avatar',present:Boolean(avatar),hashes:avatar?[avatar]:[],referenceHash:avatar})
    }
  }
  return rows
}
export async function populateImageBaseline(p,native,library,pack,copies) {
  const source=h=>'packs/'+pack+'/media/'+h+'.'+native.manifest.blobs[h].ext
  async function safePath(h){return safeProjectFile(library,source(h))}
  const readBlob=async h=>readFile(await safePath(h))
  const exists=async h=>{if(!native.manifest.blobs[h])return false;try{await access(await safePath(h));return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
  const reference=async(slot,h,composite)=>{
    if(!h&&!composite)return
    const bytes=h?await readBlob(h):(await composite()).bytes,ext=h?native.manifest.blobs[h].ext:'png',digest=h||hash(bytes),file='sources/native/'+digest+'.'+ext
    copies.set(file,bytes)
    const [width,height]=imageDimensions(bytes,ext)
    p.baseline.sources.push({slot,hash:digest,path:file,nativePath:h?'media/'+h+'.'+ext:'derived/default-sprite.png'})
    return {hash:digest,path:file,width,height}
  }
  // Keep recorded credits/approval evidence verbatim; never infer per-slot human acceptance.
  p.baseline.metadataSources=[]
  for(const {path:nativePath} of native.manifest.files)if(/^credits\/.*\.(json|txt|md)$/i.test(nativePath)) {
    const file='sources/native-metadata/'+nativePath
    copies.set(file,await readFile(await safeProjectFile(library,'packs/'+pack+'/'+nativePath)))
    p.baseline.metadataSources.push({path:file,nativePath})
  }
  for(const f of Object.values(native.figures)) {
    const key='f-'+f.id,c={key,id:f.id,name:f.name,identityAppearance:f.identityAppearance||'',emotions:structuredClone(f.emotions),outfits:f.outfits.map(o=>({key:o.key,label:o.label||o.key,outfitAppearance:o.outfitAppearance||'',imageKinds:o.sprite?['sprite','avatar']:['avatar'],...(o.defaultEmotion!==undefined?{defaultEmotion:o.defaultEmotion}:{}),...(o.fallbackEmotions?{fallbackEmotions:structuredClone(o.fallbackEmotions)}:{})}))}
    p.characters.push(c);p.baseline.uuidMap.push({key,id:f.id,outfits:f.outfits.map(o=>o.key)})
    if(await exists(f.identitySettei?.board))await reference(key+'/identity-settei',f.identitySettei.board)
  }
  for(const row of await nativeImageInventory(native,readBlob,exists)) {
    if(row.kind==='mouth')continue // Native inventory must not expand the original image baseline scope.
    const {figure:f,outfit:o,emotion,kind,present}=row,id=['f-'+f.id,o.key,kind,emotion].join('/')
    const s=p.slots[id]={id,character:'f-'+f.id,outfit:o.key,kind,emotion,version:present?native.revision:0}
    if(present) {
      s.installed={revision:native.revision,hashes:row.hashes};s.status='baseline-installed'
      if(emotion===(o.defaultEmotion??f.emotions[0]?.id)) {
        const a=await reference(id,row.referenceHash,row.composition)
        check(a,'Default sprite has no standalone reference; export a native preview first')
        s.raw=a;s.artifact=a
      }
    }
  }
}
export function assertNativeAvatarParent(p,s,inventory,{includeCandidates=false}={}) {
  if(s.kind!=='avatar'||!s.parentBinding)return
  const b=s.parentBinding,parent=p.slots[b.slot]
  check(parent&&parent.version===b.version&&parent.artifact?.hash===b.hash,'Avatar parent binding changed: '+s.id)
  if(includeCandidates&&!parent.installed)return
  const row=inventory.find(r=>'f-'+r.figure.id===parent.character&&r.outfit.key===parent.outfit&&r.kind==='sprite'&&r.emotion===parent.emotion)
  check(row?.present&&row.hashes.length===1&&row.hashes[0]===b.hash,'Installed avatar parent changed: '+s.id)
}
export async function validateImageCandidates(root,p,{scope,readImage=createProjectImageReader(root)}={}) {
  validateMouthGroups(p,{accepted:scope==='mouths',skipStale:scope!=='mouths'})
  for(const entry of Object.values(p.layered||{}))for(const asset of Object.values(entry.assets))await readImage(asset)
  const progress=productionProgress(p),files=new Map(),selected=s=>scope==='mouths'?s.kind==='mouth':s.kind!=='mouth'||!staleMouthSource(p,s.sourceBinding?.slot)
  const blocked=progress.pending.filter(row=>selected(p.slots[row.slot])&&p.slots[row.slot].artifact&&row.reasons.some(r=>r!=='MISSING_IMAGE'))
  check(!blocked.length,'Unfinished image pipeline: '+blocked.map(r=>r.slot+':'+r.reasons.join('|')).join(', '))
  for(const s of Object.values(p.slots))if(selected(s)&&s.artifact&&!s.installed) {
    assertCandidateAdmission(p,s,root)
    check(!prerequisites(p,s).length,'Image prerequisites not satisfied: '+s.id)
    const a=s.artifact,bytes=await readImage(a)
    const size=await inspectMedia(bytes,{ext:'png',mime:'image/png',size:bytes.length})
    check(size.width===a.width&&size.height===a.height,'Image dimensions changed')
    files.set(a.path,bytes)
  }
  return {p,manifest:{id:p.id,contentHash:contentFingerprint(p)},files,warnings:progress.warnings,scoped:true}
}
export async function compileImageDelivery(root,{library,expectedRevision,excludeOutfit,scope}={}) {
  check(library&&expectedRevision&&expectedRevision!=='null','Image baseline pack requires --library and --expected-revision')
  check(!excludeOutfit,'Image baseline cannot exclude outfits')
  const p=await loadProject(root);check(p.baseline?.scope==='images','Image baseline required')
  check(scope==='mouths'||!Object.values(p.blinkSources||{}).some(source=>p.slots[source.slot.replace('/sprite/','/blink/')]?.artifact)&&!Object.values(p.mouthSources||{}).some(source=>source.route&&source.route!=='static'),'Use --scope animation for declared layered/parts/blink delivery')
  const readImage=createProjectImageReader(root)
  await validateImageCandidates(root,p,{scope,readImage})
  const current=await readNativeSnapshot(library,p.id,{media:true})
  check(current.revision===expectedRevision,'Installed revision changed; refresh before export/install')
  const progress=productionProgress(p),installedState=await readImageInstall(root,p,current),installedSlots=[],written=[]
  const manifest=structuredClone(current.manifest),figures=structuredClone(current.figures),sprites=structuredClone(current.sprites),files=new Map(current.files)
  const exists=async h=>Boolean(manifest.blobs[h]&&files.has('media/'+h+'.'+manifest.blobs[h].ext))
  const inventory=await nativeImageInventory(current,async h=>files.get('media/'+h+'.'+manifest.blobs[h].ext),exists)
  for(const c of p.characters) {
    const selected=scope==='mouths'?c.outfits.filter(o=>Object.values(p.mouthSources||{}).some(source=>p.slots[source.slot].character===c.key&&p.slots[source.slot].outfit===o.key)):c.outfits
    if(!selected.length)continue
    const f=figures[c.id];assertImageEmotions(f?.emotions,c.emotions)
    for(const o of selected){const target=f.outfits.find(v=>v.key===o.key);check(target&&target.defaultEmotion===o.defaultEmotion&&JSON.stringify(target.fallbackEmotions)===JSON.stringify(o.fallbackEmotions),'Native outfit identities/default/fallback changed')}
  }
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
  for(const s of Object.values(p.slots)) {
    if(scope==='mouths'||s.kind==='mouth'||s.installed||!s.artifact)continue
    assertNativeAvatarParent(p,s,inventory,{includeCandidates:true})
    const c=p.characters.find(c=>c.key===s.character),f=figures[c.id],o=f.outfits.find(o=>o.key===s.outfit),a=s.artifact
    const row=inventory.find(r=>r.figure.id===c.id&&r.outfit.key===o.key&&r.kind===s.kind&&r.emotion===s.emotion)
    const base=installedState.slots[s.id]?.hash??s.installed?.hashes?.[0]??null
    const local=s.kind==='avatar'?(o.avatars?.[s.emotion]??null):row?.present&&row.hashes.length===1?row.hashes[0]:null
    check(row&&(!row.present||row.hashes.length===1)&&local===base,'Installed image changed since baseline: '+s.id)
    installedSlots.push({slot:s.id,version:s.version,hash:a.hash})
    if(local===a.hash)continue
    written.push(s.id)
    const bytes=await readFile(await safeProjectFile(root,a.path))
    manifest.blobs[a.hash]={ext:'png',mime:'image/png',size:bytes.length};files.set('media/'+a.hash+'.png',bytes)
    if(s.kind==='avatar'){o.avatars||={};o.avatars[s.emotion]=a.hash}
    else {
      const key=ownSprite(c,o)
      const doc=sprites[key],src='authoring/'+s.emotion+'-'+a.hash+'.png',entry={src}
      const old=staticMouthDocument(doc,s.emotion),oldSet=old?.emotions[s.emotion].binding?.mouth?.set
      o.sprite.assets[src]=a.hash
      if(doc.kind==='static-sprites')doc.emotions[s.emotion]=entry
      else if(doc.kind==='hybrid-face-sprites')doc.emotions[s.emotion]={render:{kind:'whole',legacy:{version:1,kind:'static-sprites',emotions:{[s.emotion]:entry}}}}
      else doc.emotions[s.emotion]={stage:{src,width:a.width,height:a.height}}
      if(old===doc&&oldSet&&!Object.values(doc.emotions).some(state=>state.binding?.mouth?.set===oldSet)){
        delete doc.rig.mouthSets[oldSet]
        if(!Object.keys(doc.rig.mouthSets).length)delete doc.rig
      }
      const used=new Set(spriteResourcePaths(doc))
      for(const resource of Object.keys(o.sprite.assets))if(!used.has(resource))delete o.sprite.assets[resource]
      files.set(manifest.sprites[key],json(sprites[key]))
    }
    files.set('figures/'+c.id+'.json',json(f))
  }
  await applyImageMouths(root,p,{readImage,manifest,figures,sprites,files,inventory,ownSprite,skipStale:scope!=='mouths'})
  trimAuthoringImages(manifest,files,current.figures)
  const sealed=await sealPack(manifest,files,current)
  if(p.mouthSources)validatePackDocuments({manifest,figures,sprites})
  const missing=progress.pending.filter(r=>(scope!=='mouths'||p.slots[r.slot].kind==='mouth')&&r.reasons.includes('MISSING_IMAGE')).length
  return {...sealed,p,current,expectedRevision,installedSlots,written,...(scope?{scope}:{}),warnings:missing?[{code:'MISSING_IMAGES',severity:'warning',message:missing+' missing image slots',count:missing}]:[]}
}

export async function installImageDelivery(root,pack,options) {
  // Validate the exact exported bytes without running legacy archive ingress migrations.
  const zip=await openZip(await safeProjectFile(root,'delivery/final-assets/pack.zip'))
  check(zip.entries.length===pack.files.size+1,'Foreign or stale image archive')
  for(const entry of zip.entries) {
    const bytes=await zip.read(entry)
    if(entry.path==='manifest.json')check(canonicalJson(JSON.parse(bytes))===canonicalJson(pack.manifest),'Foreign or stale image manifest')
    else check(pack.files.get(entry.path)?.equals(bytes),'Foreign or stale image archive: '+entry.path)
  }
  if(options.dryRun)return {id:pack.p.id,scope:pack.scope||'images',dryRun:true,expectedRevision:options.expectedRevision,contentHash:pack.manifest.contentHash,written:pack.written,...(pack.skipped?{skipped:pack.skipped}:{}),warnings:pack.warnings}
  check(options.confirm,'install requires --confirm')
  const updates=new Map([...pack.files].filter(([file,bytes])=>!pack.current.files.get(file)?.equals(bytes)))
  // The trimmed manifest no longer names retired blobs, so publish their file deletions too.
  for(const file of pack.current.files.keys())if(!pack.files.has(file))updates.set(file,null)
  const service=createAssetPackService({assetRoot:path.resolve(options.library),decodeMedia})
  let published=false
  try {
    const result=await service.patchPack({packId:pack.p.id,expectedRevision:options.expectedRevision,patch:{blobs:pack.manifest.blobs,sprites:pack.manifest.sprites},fileUpdates:updates})
    published=true
    check(result.snapshot.manifest.contentHash===pack.manifest.contentHash,'Published image content differs from export')
    await saveImageInstall(root,pack.p,pack.installedSlots||[],result.snapshot,pack.installedMouths,pack.installedBlinks)
    return {id:pack.p.id,scope:pack.scope||'images',status:result.status,revision:result.snapshot.revision,contentHash:result.snapshot.manifest.contentHash,written:pack.written,...(pack.skipped?{skipped:pack.skipped}:{}),warnings:pack.warnings}
  }catch(error){if(published){error.outcome='partial';error.exitCode=7}throw error}finally{await service.dispose()}
}