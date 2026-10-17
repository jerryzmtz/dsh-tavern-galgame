import {admitGeneration,assertCandidateAdmission,historicalProvenance} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
// Layered authoring is a per-outfit CAS document, not a replacement project index.
import {readFile} from 'node:fs/promises'
import {atomic,loadProject,transaction,safeProjectFile,productionError,hash} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {decodeAssetRgba,encodeAssetRgba} from '../../tavern-plugin/lib/domain/asset-image-processing.js'
import {composeHybridPreview} from '../../tavern-plugin/lib/domain/hybrid-sprite-preview.js'
import {clearHybridPreviews} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/hybrid-closure.js'
import {partAlphaBox} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/part-bbox.js'
import {validateSpriteManifest,spriteResourcePaths} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/sprite.js'
import {shape,validateStateId} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/common.js'
import hybrid from '../../tavern-plugin/packages/dsh-asset-library/lib/shared/hybrid-sprite.cjs'
const check=(ok,msg,code='INVALID_ARGUMENT')=>{if(!ok)throw productionError(code,msg)}
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n')
function target(p,outfit) {const [c,o,...rest]=(outfit||'').split('/'),value=p.characters.find(x=>x.key===c)?.outfits.find(x=>x.key===o);check(!rest.length&&value,'Use an existing character/outfit key');return value}
export function validateLayeredEntry(p,outfit,entry) {
  const o=target(p,outfit)
  shape(entry,['version','manifest','assets'],['version','manifest','assets'],'$.layered')
  check(Number.isSafeInteger(entry.version)&&entry.version>0,'Invalid layered version')
  validateSpriteManifest(entry.manifest);check(entry.manifest.kind==='hybrid-face-sprites','Hybrid manifest required')
  check(Object.keys(entry.manifest.emotions).every(id=>p.characters.find(c=>c.outfits.includes(o))?.emotions.some(row=>row.id===id)),'Layered authoring cannot add difference names')
  for(const a of Object.values(entry.assets)) {
    shape(a,['hash','path','width','height'],['hash','path','width','height'],'$.assets')
    check(/^[a-f0-9]{64}$/.test(a.hash)&&a.path==='images/'+a.hash+'.png','Expected content-addressed PNG')
    check(Number.isInteger(a.width)&&Number.isInteger(a.height)&&a.width>0&&a.height>0,'Invalid PNG size')
  }
}
function pruneAssets(entry) {const paths=new Set(spriteResourcePaths(entry.manifest));entry.assets=Object.fromEntries(Object.entries(entry.assets).filter(([src])=>paths.has(src)))}
export async function mutateLayered(root,o,operation) {
  check(Number.isSafeInteger(Number(o.expectedVersion))&&Number(o.expectedVersion)>=0,'--expected-version must be an integer')
  if(o.out)check(o.out.startsWith('deltas/')&&o.out.endsWith('.json'),'--out must be deltas/NAME.json')
  const incoming=o.file&&operation!=='remove'?await readFile(o.file):null
  const spec=o.spec?JSON.parse(await readFile(o.spec,'utf8')):null
  const initial=o.manifest?JSON.parse(await readFile(o.manifest,'utf8')):null
  if(o.out)await safeProjectFile(root,o.out)
  validateStateId(o.rig);validateStateId(operation==='recipe'?o.recipe:o.part)
  const action=async p=>{
    const outfit=target(p,o.outfit),old=p.layered?.[o.outfit]
    check((old?.version||0)===Number(o.expectedVersion),'Layered outfit version changed','CONFLICT')
    check(old||operation==='base'&&initial,'Initialize with register-base --manifest first','PRECONDITION')
    check(!old||!initial,'Existing manifest cannot be replaced; use register-recipe or a new project','PRECONDITION')
    const entry=old?structuredClone(old):{version:0,manifest:initial,assets:{}}
    validateSpriteManifest(entry.manifest)
    const rig=entry.manifest.rigs[o.rig];check(rig,'Unknown rig','NOT_FOUND')
    let bytes,src
    if(operation==='recipe') {
      const recipe=JSON.parse(incoming),previous=rig.recipes[o.recipe]
      check(recipe.revision===(previous?.revision||0)+1,'Recipe revision must increment','CONFLICT')
      check(p.characters.find(c=>c.outfits.includes(outfit))?.emotions.some(row=>row.id===o.emotion),'Unknown difference')
      rig.recipes[o.recipe]=recipe;entry.manifest.emotions[o.emotion]={render:{kind:'parts',rig:o.rig,recipe:o.recipe}}
    } else {
      const previous=rig.parts[o.part]
      if(operation==='remove') {
        check(previous,'Part missing','NOT_FOUND');if(previous.group==='underlay')rig.baseRevision++
        delete rig.parts[o.part]
      } else {
        check(incoming.length<=20*1024**2,'PNG exceeds 20 MiB')
        const image=decodeAssetRgba(incoming),incomingHash=hash(incoming)
        const receipt=await admitGeneration({file:o.file,hash:incomingHash,root,historical:historicalProvenance(p,incomingHash),provenance:o.provenance});bytes=encodeAssetRgba(image)
        const outputHash=bytes.equals(incoming)?incomingHash:hash(bytes)
        p.generationAssets||={};p.generationAssets[outputHash]={hash:outputHash,sourceHash:incomingHash,receipt}
        if(spec)shape(spec,['group','rect','clearRect'],['group','rect'],'$.spec')
        const group=operation==='base'?'underlay':spec?.group
        check(group&&(operation==='base'||group!=='underlay'),'Use register-base for underlay; --spec requires group/rect')
        if(previous)check(previous.group===group,'Part group cannot change')
        if(old&&group==='underlay')rig.baseRevision++
        src=previous?.src||'layered/'+o.rig+'/'+o.part+'.png'
        for(const [r,other] of Object.entries(entry.manifest.rigs))for(const [id,part]of Object.entries(other.parts))check(r===o.rig&&id===o.part||part.src!==src,'Resource path shared by another part')
        for(const e of Object.values(entry.manifest.emotions))if(e.render.kind==='whole')check(!spriteResourcePaths(e.render.legacy).includes(src),'Resource path is used by a whole image')
        const rect=spec?.rect||o.rect||[0,0,image.width,image.height]
        check(rect[2]===image.width&&rect[3]===image.height,'Rect must match PNG pixels; no implicit rescale')
        rig.parts[o.part]={group,src,rect,bbox:partAlphaBox(bytes),revision:old?(previous?.revision||0)+1:1,baseRevision:rig.baseRevision,...(spec?.clearRect?{clearRect:spec.clearRect}:{})}
        const digest=outputHash;entry.assets[src]={hash:digest,path:'images/'+digest+'.png',width:image.width,height:image.height}
      }
      for(const recipe of Object.values(rig.recipes))if([...Object.values(recipe.selection),...Object.values(recipe.mouthFrames||{}),...Object.values(recipe.blinkFrames||{})].includes(o.part))recipe.revision++
    }
    clearHybridPreviews(entry.manifest,o.rig)
    entry.version++;pruneAssets(entry);validateLayeredEntry(p,o.outfit,entry)
    if(!o.dryRun&&bytes)await atomic(root,entry.assets[src].path,bytes)
    p.layered||={};p.layered[o.outfit]=entry;delete p.review;p.reviews=[]
    const delta={schema_version:1,kind:'layered',project_id:p.id,outfit:o.outfit,expected_version:old?.version||0,value:entry}
    if(!o.dryRun&&o.out)await atomic(root,o.out,json(delta))
    return {version:entry.version,dryRun:Boolean(o.dryRun),delta,missing:layeredMissing(entry),warnings:[]}
  }
  return o.dryRun?action(structuredClone(await loadProject(root))):transaction(root,action)
}
export function availableLayeredManifest(entry) {
  const doc=structuredClone(entry.manifest)
  clearHybridPreviews(doc)
  for(const rig of Object.values(doc.rigs))for(const [id,part]of Object.entries(rig.parts))if(!entry.assets[part.src])delete rig.parts[id]
  return doc
}
export function layeredMissing(entry) {return hybrid.hybridMissing(availableLayeredManifest(entry))}
export async function composePreview(root,{outfit,emotion,out,phoneme,blink,dryRun=false}) {
  const p=await loadProject(root);target(p,outfit);const entry=p.layered?.[outfit]
  check(entry,'Layered outfit missing','NOT_FOUND')
  check(!phoneme||['closed','a','i','u','e','o'].includes(phoneme),'Invalid phoneme')
  check(!blink||['closed','half'].includes(blink),'Invalid blink frame')
  const file=out||'previews/'+outfit+'/'+emotion+'.png'
  check(file.startsWith('previews/')&&file.endsWith('.png'),'Preview output must be previews/NAME.png')
  await safeProjectFile(root,file)
  const result=await composeHybridPreview(availableLayeredManifest(entry),emotion,async src=>readFile(await safeProjectFile(root,entry.assets[src].path)),{mouthFrame:phoneme,blinkFrame:blink})
  if(!dryRun)await atomic(root,file,result.bytes)
  return {output:file,width:result.width,height:result.height,revision:result.revision,dryRun,reviewOnly:true,installReady:false}
}
export async function mergeLayered(root,{delta,sourceRoot,dryRun=false}) {
  shape(delta,['schema_version','kind','project_id','outfit','expected_version','value'],['schema_version','kind','project_id','outfit','expected_version','value'],'$.delta')
  check(delta.schema_version===1&&delta.kind==='layered','Invalid layered delta')
  const action=async p=>{
    check(p.id===delta.project_id,'Different project identity','CONFLICT')
    const old=p.layered?.[delta.outfit]
    if(JSON.stringify(old)===JSON.stringify(delta.value))return {idempotent:true,dryRun}
    check((old?.version||0)===delta.expected_version,'Layered outfit version changed','CONFLICT')
    check(delta.value.version===delta.expected_version+1,'Delta must advance exactly one version','CONFLICT')
    validateLayeredEntry(p,delta.outfit,delta.value)
    const files=new Map(),source=await loadProject(sourceRoot)
    for(const a of Object.values(delta.value.assets)) {
      const bytes=await readFile(await safeProjectFile(sourceRoot,a.path)),image=decodeAssetRgba(bytes)
      check(hash(bytes)===a.hash&&image.width===a.width&&image.height===a.height,'Incoming PNG changed','CONFLICT')
      const proof=source.generationAssets?.[a.hash]
      assertCandidateAdmission(source,{id:delta.outfit,artifact:a},sourceRoot)
      p.generationAssets||={};p.generationAssets[a.hash]=structuredClone(proof)
      files.set(a.path,bytes)
    }
    for(const rig of Object.values(delta.value.manifest.rigs))for(const part of Object.values(rig.parts))if(delta.value.assets[part.src]) {
      const a=delta.value.assets[part.src]
      check(a.width===part.rect[2]&&a.height===part.rect[3]&&JSON.stringify(partAlphaBox(files.get(a.path)))===JSON.stringify(part.bbox),'Part bbox/rect mismatch')
    }
    if(!dryRun)for(const [file,bytes]of files)await atomic(root,file,bytes)
    p.layered||={};p.layered[delta.outfit]=structuredClone(delta.value);delete p.review;p.reviews=[]
    return {applied:[delta.outfit],idempotent:false,dryRun,missing:layeredMissing(delta.value)}
  }
  return dryRun?action(structuredClone(await loadProject(root))):transaction(root,action)
}
