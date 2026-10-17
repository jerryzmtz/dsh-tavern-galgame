import {assertCandidateAdmission} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
// Accepted authoring slots are a sparse native delivery, not a new authoring project.
import path from 'node:path'
import {readFile,rename,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {generationProvenance,productionDependencyClosure,productionDependencyReasons,loadProject,slotAccepted,productionProgress,prerequisites,productionError,safeProjectFile,atomic,hash,contentFingerprint,transaction} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {sealPack,inspectMedia} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {decodeMedia} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
import {writeNativePack} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/pack-source.js'
import {trimAuthoringImages} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/image-closure.js'
import {spriteResourcePaths} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/sprite.js'
import {canonicalJson} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import {openZip} from '../../tavern-plugin/packages/dsh-asset-library/lib/zip.js'
import {readNativeSnapshot} from './baseline.mjs'
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n')
const same=(a,b)=>canonicalJson(a??null)===canonicalJson(b??null)
const receiptPath='delivery/accepted-export.json',baselinePath='sources/accepted-install.json'
const kinds=new Set(['identity-settei','settei','avatar','sprite'])
async function readOptional(root,file) {
  try{return JSON.parse(await readFile(await safeProjectFile(root,file),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;return null}
}
function selectedSlots(p,options) {
  const list=value=>value===undefined?null:value.split(',').map(s=>s.trim())
  const figures=list(options.figures)?.map(key=>{
    const c=p.characters.find(c=>c.id===key||c.key===key)
    if(!c)throw productionError('INVALID_ARGUMENT','Unknown figure UUID/key: '+key)
    return c.key
  }),outfits=list(options.outfits),slots=list(options.slots)
  for(const key of outfits||[])if(!p.characters.some(c=>(!figures||figures.includes(c.key))&&c.outfits.some(o=>o.key===key)))throw productionError('INVALID_ARGUMENT','Unknown outfit key: '+key)
  const rows=Object.values(p.slots).filter(s=>(!figures||figures.includes(s.character))&&(!outfits||!s.outfit||outfits.includes(s.outfit)))
  for(const id of slots||[])if(!rows.some(s=>s.id===id))throw productionError('INVALID_ARGUMENT','Unknown slot in scope: '+id)
  // Identity and outfit boards are explicit creation prerequisites, even for a filtered avatar batch.
  const ids=new Set(slots||rows.map(s=>s.id))
  for(const s of rows)if(ids.has(s.id)&&s.character){ids.add(s.character+'/identity-settei');if(s.outfit)ids.add(s.character+'/'+s.outfit+'/settei')}
  return rows.filter(s=>ids.has(s.id)).sort((a,b)=>a.id.localeCompare(b.id))
}
function valueAt(figures,sprites,c,s) {
  const f=figures[c.id],o=f?.outfits.find(o=>o.key===s.outfit)
  if(s.kind==='identity-settei')return f?.identitySettei??null
  if(s.kind==='settei')return o?.settei?{settei:o.settei,...(o.setteiParentVersion?{setteiParentVersion:o.setteiParentVersion}:{})}:null
  if(s.kind==='avatar')return o?.avatars?.[s.emotion]??null
  const doc=o?.sprite&&sprites[o.sprite.manifestKey],state=doc?.emotions[s.emotion]
  if(!state)return null
  check(doc.kind==='static-sprites','Accepted sprite updates require a static sprite outfit: '+s.id)
  const single={...doc,emotions:{[s.emotion]:state}}
  return {state,assets:Object.fromEntries(spriteResourcePaths(single).map(src=>[src,o.sprite.assets[src]]))}
}
export async function compileAcceptedDelivery(root,options={}) {
  check(options.library&&options.expectedRevision,'Accepted scope requires --library and explicit --expected-revision UUID|null')
  check(path.resolve(root)!==path.resolve(options.library),'Library must be separate from authoring project')
  check(!options.avatarBaseline&&!options.excludeOutfit,'Accepted scope does not use avatar baselines or outfit exclusion')
  const p=await loadProject(root)
  check(!p.baseline,'Accepted scope starts from a new-pack authoring project; existing baselines keep their normal scopes')
  const expected=options.expectedRevision==='null'?null:options.expectedRevision
  const local=await readOptional(options.library,'local/'+p.id+'.json')
  check((local?.revision??null)===expected,'Installed revision changed; null requires a pack that does not exist')
  const current=local?await readNativeSnapshot(options.library,p.id,{media:true}):null
  check((current?.revision??null)===expected,'Installed revision changed during snapshot')
  let baseline=await readOptional(root,baselinePath)
  if(current&&!baseline) {
    // Recovery after native commit but before the local receipt was saved. Never invent a historical baseline.
    const receipt=await readOptional(root,receiptPath)
    check(receipt?.projectId===p.id&&receipt.contentHash===current.manifest.contentHash,'Missing accepted-install baseline; cannot adopt an existing pack')
    baseline=receipt.nextBaseline
  }
  check(!baseline||baseline.projectId===p.id,'Foreign accepted-install baseline')
  check(current||!baseline,'Previously installed pack is missing; do not silently recreate it')
  const manifest=current?structuredClone(current.manifest):{format:'dsh-asset-pack',schemaVersion:1,id:p.id,name:p.name,contentHash:'0'.repeat(64),assets:[],figures:[],sprites:{},bundles:{},blobs:{},files:[]}
  const files=new Map(current?.files),figures=structuredClone(current?.figures||{}),sprites=structuredClone(current?.sprites||{})
  const pending=new Map(productionProgress(p).pending.map(r=>[r.slot,r.reasons])),selected=selectedSlots(p,options),eligible=new Set(),skipped=[],accepted=[],written=[],creates={pack:current?null:p.id,figures:[],outfits:[]},changed=new Set(),verified=new Map()
  const nextBaseline={projectId:p.id,slots:structuredClone(baseline?.slots||{})}
  const closure=s=>productionDependencyClosure(p,s)
  async function media(s,include=false) {
    if(!s.artifact)return
    assertCandidateAdmission(p,s,root)
    const a=s.artifact
    let cached=verified.get(a.path)
    if(!cached){const bytes=await readFile(await safeProjectFile(root,a.path));check(hash(bytes)===a.hash,'Image content changed: '+s.id);const size=await inspectMedia(bytes,{ext:'png',mime:'image/png',size:bytes.length},decodeMedia);cached={bytes,hash:a.hash,...size};verified.set(a.path,cached)}
    check(cached.hash===a.hash&&cached.width===a.width&&cached.height===a.height,'Image identity/dimensions changed: '+s.id)
    if(include&&!manifest.blobs[a.hash]){manifest.blobs[a.hash]={ext:'png',mime:'image/png',size:cached.bytes.length};files.set('media/'+a.hash+'.png',cached.bytes)}
  }
  for(const s of selected) {
    const reasons=[]
    if(!kinds.has(s.kind))reasons.push('OUTSIDE_ACCEPTED_SCOPE')
    if(!slotAccepted(s))reasons.push(s.artifact?'HUMAN_APPROVAL_REQUIRED':'MISSING_IMAGE')
    if(!reasons.length)reasons.push(...productionDependencyReasons(p,s,pending))
    if(reasons.length)skipped.push({slot:s.id,reasons:[...new Set(reasons)]})
    else eligible.add(s.id)
  }
  // Accepted images never create a figure/outfit with an unaccepted board.
  for(const s of selected)if(eligible.has(s.id)) {
    const identity=s.character+'/identity-settei',outfit=s.character+'/'+s.outfit+'/settei'
    if(!eligible.has(identity)||s.outfit&&!eligible.has(outfit)) {
      eligible.delete(s.id);skipped.push({slot:s.id,reasons:['ACCEPTED_PARENT_REQUIRED']})
    }
  }
  const ordered=selected.filter(s=>eligible.has(s.id)).sort((a,b)=>['identity-settei','settei','avatar','sprite'].indexOf(a.kind)-['identity-settei','settei','avatar','sprite'].indexOf(b.kind)||a.id.localeCompare(b.id))
  for(const s of ordered) {
    for(const id of closure(s))await media(p.slots[id])
    const c=p.characters.find(c=>c.key===s.character),sourceOutfit=c.outfits.find(o=>o.key===s.outfit)
    let f=figures[c.id]
    if(!f) {
      check(!baseline?.slots[c.key+'/identity-settei'],'Previously installed figure was removed locally: '+c.id)
      f=figures[c.id]={schemaVersion:1,id:c.id,name:c.name,identityAppearance:c.identityAppearance,emotions:structuredClone(c.emotions||[]),appearance:'sprite',enabled:true,recall:{mode:'constant'},outfits:[]}
      manifest.figures.push(c.id);creates.figures.push(c.id);changed.add(c.id)
    }
    let o=f.outfits.find(o=>o.key===s.outfit)
    if(s.outfit&&!o) {
      check(!baseline?.slots[c.key+'/'+s.outfit+'/settei'],'Previously installed outfit was removed locally: '+s.outfit)
      o={key:sourceOutfit.key,label:sourceOutfit.label,enabled:true,outfitAppearance:sourceOutfit.outfitAppearance,avatars:{},...(sourceOutfit.defaultEmotion?{defaultEmotion:sourceOutfit.defaultEmotion}:{}),...(sourceOutfit.fallbackEmotions?{fallbackEmotions:structuredClone(sourceOutfit.fallbackEmotions)}:{})}
      f.outfits.push(o);creates.outfits.push({figure:c.id,key:o.key});changed.add(c.id)
      if(c.heightCm!==undefined&&(c.heightCm!==170||c.heightConfirmed)){f.heightCm=c.heightCm;f.heightBasis='standing'}
    }
    const a=s.artifact,palette=(s.palette||[]).map(({role,hex,zone})=>({role,hex,zone})),src='accepted/'+s.emotion+'.png'
    const target=s.kind==='identity-settei'?{board:a.hash,version:hash(JSON.stringify({board:a.hash,palette})),palette}:s.kind==='settei'?{settei:a.hash,...(s.parentVersion?{setteiParentVersion:s.parentVersion}:{})}:s.kind==='avatar'?a.hash:{state:{src},assets:{[src]:a.hash}}
    const before=baseline?.slots[s.id]??null,localValue=valueAt(figures,sprites,c,s)
    accepted.push({slot:s.id,version:s.version,hash:a.hash});nextBaseline.slots[s.id]=target
    if(same(target,before)||same(target,localValue))continue
    check(same(localValue,before),'Accepted slot conflicts with a local edit: '+s.id)
    await media(s,true)
    if(s.kind==='identity-settei')f.identitySettei=target
    else if(s.kind==='settei'){delete o.setteiParentVersion;Object.assign(o,target)}
    else if(s.kind==='avatar'){o.avatars||={};o.avatars[s.emotion]=target}
    else {
      let key=o.sprite?.manifestKey
      if(!key){key='accepted-'+hash(c.id+'/'+o.key).slice(0,24);check(!manifest.sprites[key],'Reserved sprite key already exists');o.sprite={manifestKey:key,assets:{}};sprites[key]={version:1,kind:'static-sprites',emotions:{}};manifest.sprites[key]='sprites/'+key+'/manifest.json'}
      check(sprites[key].kind==='static-sprites','Accepted sprite updates require static sprites')
      check(Object.values(figures).flatMap(f=>f.outfits).filter(o=>o.sprite?.manifestKey===key).length===1,'Shared sprite manifest requires a separate native edit')
      sprites[key].emotions[s.emotion]=target.state;Object.assign(o.sprite.assets,target.assets)
      const used=new Set(spriteResourcePaths(sprites[key]));for(const resource of Object.keys(o.sprite.assets))if(!used.has(resource))delete o.sprite.assets[resource]
      files.set(manifest.sprites[key],json(sprites[key]))
    }
    changed.add(c.id);written.push(s.id)
  }
  for(const id of changed)files.set('figures/'+id+'.json',json(figures[id]))
  trimAuthoringImages(manifest,files,current?.figures||{})
  const sealed=await sealPack(manifest,files,current)
  return {...sealed,p,current,expectedRevision:expected,selection:selected.map(s=>s.id),accepted,skipped:skipped.sort((a,b)=>a.slot.localeCompare(b.slot)),written,creates,nextBaseline,changedFigures:[...changed],fileWrites:[...files].filter(([file,bytes])=>!current?.files.get(file)?.equals(bytes)).map(([file])=>file).concat(!current||sealed.manifest.contentHash!==current.manifest.contentHash?['manifest.json']:[]).sort(),fileRemovals:[...(current?.files.keys()||[])].filter(file=>!files.has(file)).sort()}
}
const result=pack=>({id:pack.p.id,scope:'accepted',expectedRevision:pack.expectedRevision,contentHash:pack.manifest.contentHash,creates:pack.creates,accepted:pack.accepted,skipped:pack.skipped,written:pack.written,fileWrites:pack.fileWrites,fileRemovals:pack.fileRemovals,changedFigures:pack.changedFigures})
export async function packAcceptedProduction(root,options) {
  if((await loadProject(root)).baseline?.scope==='images') {
    const {packAvatarProduction}=await import('./avatar-install.mjs')
    return {...await packAvatarProduction(root,options),scope:'accepted'}
  }
  const pack=await compileAcceptedDelivery(root,options)
  check(pack.current||pack.creates.figures.length,'No accepted identities to create a pack')
  const source='delivery/final-assets/pack-source'
  await rm(await safeProjectFile(root,'delivery'),{recursive:true,force:true})
  for(const [file,bytes]of pack.files)await atomic(root,source+'/'+file,bytes)
  await atomic(root,source+'/generation-provenance.json',json(generationProvenance(pack)))
  await atomic(root,source+'/manifest.json',json(pack.manifest))
  await atomic(root,source+'/pack-source.json',json({version:1,id:pack.p.id,name:pack.manifest.name,manifest:'manifest.json'}))
  const output=await safeProjectFile(root,'delivery/final-assets/pack.zip'),temp=output+'.'+randomUUID()+'.tmp'
  await writeNativePack(pack,temp);await rename(temp,output)
  await atomic(root,receiptPath,json({scope:'accepted',projectId:pack.p.id,projectContentHash:contentFingerprint(pack.p),selection:pack.selection,accepted:pack.accepted,expectedRevision:pack.expectedRevision,contentHash:pack.manifest.contentHash,nextBaseline:pack.nextBaseline}))
  return {...result(pack),output,installReady:pack.accepted.length>0}
}
export async function installAcceptedProduction(root,options) {
  // Images baselines already own native identities; only accepted avatar mappings are added.
  if((await loadProject(root)).baseline?.scope==='images') {
    const {compileAvatarDelivery,installAvatarProduction}=await import('./avatar-install.mjs')
    if(options.dryRun) {
      const pack=await compileAvatarDelivery(root,options)
      return {id:pack.p.id,scope:'accepted',dryRun:true,expectedRevision:pack.expectedRevision,contentHash:pack.manifest.contentHash,accepted:pack.accepted,skipped:pack.skipped,written:pack.written}
    }
    return transaction(root,async()=>({...await installAvatarProduction(root,options),scope:'accepted'}))
  }
  if(options.dryRun)return {...result(await compileAcceptedDelivery(root,options)),dryRun:true}
  return transaction(root,async()=>{
    const pack=await compileAcceptedDelivery(root,options)
    check(options.confirm,'install requires --confirm')
    const receipt=await readOptional(root,receiptPath)
    check(receipt?.scope==='accepted'&&receipt.projectId===pack.p.id&&receipt.projectContentHash===contentFingerprint(pack.p),'Foreign or stale accepted export; run pack again')
    check(same(receipt.selection,pack.selection)&&same(receipt.accepted,pack.accepted),'Accepted export selection differs; pack and install must use the same scope')
    check(receipt.contentHash===pack.manifest.contentHash,'Export differs from the current publish; run pack again')
    check(receipt.expectedRevision===pack.expectedRevision||pack.current?.manifest.contentHash===receipt.contentHash,'Stale export revision; run pack again')
    const output=await safeProjectFile(root,'delivery/final-assets/pack.zip'),zip=await openZip(output)
    check(zip.entries.length===pack.files.size+1,'Foreign or stale accepted archive')
    for(const entry of zip.entries){const bytes=await zip.read(entry);check(entry.path==='manifest.json'?same(JSON.parse(bytes),pack.manifest):pack.files.get(entry.path)?.equals(bytes),'Foreign or stale accepted archive: '+entry.path)}
    const service=createAssetPackService({assetRoot:path.resolve(options.library),decodeMedia})
    let published=false
    try {
      const preview=await service.inspectImport({bytes:await readFile(output)})
      check(preview.contentHash===pack.manifest.contentHash,'Native import differs from the reviewed export')
      check(preview.expectedRevision===pack.expectedRevision,'Installed revision changed; refresh before installation')
      const decision=preview.choices.includes('noop')?'noop':pack.current?'update':'install'
      check(preview.choices.includes(decision),'Identity collision requires manual native import review')
      const installed=await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:pack.expectedRevision,decision,...(pack.current&&pack.creates.figures.length?{createFigures:pack.creates.figures}:{})})
      published=true
      const savedBaseline={...pack.nextBaseline,revision:installed.snapshot.revision,contentHash:installed.snapshot.manifest.contentHash}
      if(!same(await readOptional(root,baselinePath),savedBaseline))await atomic(root,baselinePath,json(savedBaseline))
      return {...result(pack),status:installed.status,revision:installed.snapshot.revision,contentHash:installed.snapshot.manifest.contentHash}
    }catch(error){if(published){error.outcome='partial';error.exitCode=7}throw error}finally{await service.dispose()}
  })
}
