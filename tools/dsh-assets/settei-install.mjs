// Build each scoped delivery from the CAS snapshot, preserving every unowned byte.
import path from 'node:path'
import {readFile,rename,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {readNativeSnapshot} from './baseline.mjs'
import {compileImageDelivery,installImageDelivery} from './images-baseline.mjs'
import {generationProvenance,loadProject,compileProduction,contentFingerprint,reviewMatchesContent,safeProjectFile,atomic,productionError,slotAccepted} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {trimAuthoringImages} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/image-closure.js'
import {normalizePackImport} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/normalize-import.js'
import {sealPack} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {writeNativePack} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/pack-source.js'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import {canonicalJson} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {decodeMedia} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n')
export const ownedSetteiFigureFields=Object.freeze(['identitySettei'])
export const ownedSetteiOutfitFields=Object.freeze(['settei','setteiParentVersion'])
const same=(a,b)=>canonicalJson(a)===canonicalJson(b)
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]))
const state=figure=>({...pick(figure,ownedSetteiFigureFields),outfits:figure.outfits.map(o=>({key:o.key,...pick(o,ownedSetteiOutfitFields)})).sort((a,b)=>a.key.localeCompare(b.key))})
function selection(p,figures) {
  if(figures===undefined)return null
  const keys=typeof figures==='string'?figures.split(',').map(s=>s.trim()):[]
  if(!keys.length||keys.some(key=>!key))throw productionError('INVALID_ARGUMENT','--figures requires a nonempty UUID/key list')
  return [...new Set(keys.map(key=>{
    const c=p.characters.find(c=>c.id===key||c.key===key)
    if(!c)throw productionError('INVALID_ARGUMENT','Unknown figure UUID/key: '+key)
    return c.id
  }))].sort()
}
export async function compileSetteiDelivery(root,{library,expectedRevision,excludeOutfit,figures,scope,sprites,slots}={}) {
  const p=await loadProject(root)
  check((sprites===undefined&&slots===undefined)||scope==='animation','Animation selectors require --scope animation')
  if(scope==='animation'||scope==='mouths'&&Object.values(p.mouthSources||{}).some(s=>s.route&&s.route!=='static')) {
    check(figures===undefined,'Animation scope does not support figure filters')
    return (await import('./authoring-mouths.mjs')).compileAuthoringMouthDelivery(root,{library,expectedRevision,excludeOutfit,scope,sprites,slots})
  }
  if(p.baseline?.scope==='images') {
    check(figures===undefined,'--figures requires a settei baseline')
    return compileImageDelivery(root,{library,expectedRevision,excludeOutfit,scope})
  }
  if(scope==='mouths'&&!p.baseline) {
    check(figures===undefined,'Mouth scope selects all complete accepted groups; figure filters are not supported')
    return (await import('./authoring-mouths.mjs')).compileAuthoringMouthDelivery(root,{library,expectedRevision,excludeOutfit})
  }
  check(scope!=='mouths','Mouth scope requires an images baseline or ordinary authoring project')
  check(library&&expectedRevision&&expectedRevision!=='null','Scoped pack requires --library and --expected-revision of an installed pack')
  check(!excludeOutfit,'Scoped settei export cannot remove outfits')
  check(p.baseline?.scope==='settei','Settei baseline required')
  const selected=selection(p,figures),sources=new Map(),recorded=new Map((p.addedFigures||[]).flatMap(batch=>batch.added.map(figure=>[figure.id,figure])))
  // Older projects already contain the complete owned baseline in sources; never migrate or rebaseline.
  for(const source of p.baseline.sources) {
    check(!sources.has(source.slot),'Duplicate baseline source: '+source.slot)
    if(p.slots[source.slot].kind==='identity-settei')check(source.version&&Array.isArray(source.palette),'Incomplete identity baseline: '+source.slot)
    sources.set(source.slot,source)
  }
  const current=await readNativeSnapshot(library,p.id,{media:true})
  check(current.revision===expectedRevision,'Installed revision changed; refresh before export/install')
  const rows=p.baseline.uuidMap.filter(row=>!selected||selected.includes(row.id))
  for(const row of rows) {
    const slots=Object.values(p.slots).filter(s=>s.character===row.key)
    for(const slot of slots)if(slot.artifact||selected&&slot.kind==='identity-settei'||recorded.has(row.id)&&slot.kind==='identity-settei')
      check(slotAccepted(slot)&&!slot.stale,'Unaccepted settei slot for figure '+row.id+': '+slot.id)
  }
  const generated=await compileProduction(root,{figureIds:rows.map(row=>row.id),project:p})
  const manifest=structuredClone(current.manifest),files=new Map(current.files),hashed=new Map(),additions=[],changedFigures=[],media=new Set()
  for(const row of rows) {
    const before=current.figures[row.id],patch=generated.figures[row.id],entry=recorded.get(row.id),c=p.characters.find(c=>c.id===row.id)
    check(patch,'Unknown figure in settei patch: '+row.id)
    let figure
    if(entry) {
      check(entry.key===c.key&&entry.authoringKey===c.authoringKey&&!patch.outfits.length,'Invalid added figure '+row.id)
      check(!p.baseline.sources.some(s=>s.slot.startsWith(row.key+'/')),'Added figure has baseline state: '+row.id)
      if(before&&same(before,patch))continue
      check(!before,'Settei conflict for added figure '+row.id+' ('+c.name+')')
      figure=patch;manifest.figures.push(row.id);additions.push(row.id)
    } else {
      check(!c.authoringKey&&before,'Unknown figure '+row.id+'; only project addedFigures records may extend an installed settei pack')
      const identity=sources.get(row.key+'/identity-settei'),baseline={outfits:row.outfits.map(key=>{
        const source=sources.get(row.key+'/'+key+'/settei')
        return {key,...(source?{settei:source.hash,...(source.parentVersion?{setteiParentVersion:source.parentVersion}:{})}:{})}
      })}
      if(identity)baseline.identitySettei={board:identity.hash,version:identity.version,palette:identity.palette}
      const target=structuredClone(baseline)
      Object.assign(target,pick(patch,ownedSetteiFigureFields))
      for(const outfit of patch.outfits) {
        if(outfit.settei)check(target.identitySettei&&outfit.setteiParentVersion===target.identitySettei.version,'Outfit board must name its accepted identity parent version: '+row.id)
        Object.assign(target.outfits.find(o=>o.key===outfit.key),pick(outfit,ownedSetteiOutfitFields))
      }
      // Compare source to its baseline BEFORE looking at local edits: unchanged source never rolls them back.
      if(same(state(target),state(baseline)))continue
      if(same(state(before),state(target)))continue
      check(same(state(before),state(baseline)),'Settei conflict for figure '+row.id+' ('+c.name+')')
      figure=structuredClone(before)
      Object.assign(figure,pick(target,ownedSetteiFigureFields))
      for(const outfit of target.outfits)Object.assign(figure.outfits.find(o=>o.key===outfit.key),pick(outfit,ownedSetteiOutfitFields))
    }
    changedFigures.push(row.id);files.set('figures/'+row.id+'.json',json(figure))
    if(figure.identitySettei)media.add(figure.identitySettei.board)
    for(const outfit of figure.outfits)if(outfit.settei)media.add(outfit.settei)
  }
  for(const digest of media) {
    if(manifest.blobs[digest])continue
    const descriptor=generated.manifest.blobs[digest],file='media/'+digest+'.'+descriptor.ext
    manifest.blobs[digest]=descriptor;files.set(file,generated.files.get(file));hashed.set(file,digest)
  }
  trimAuthoringImages(manifest,files,current.figures)
  const normalized=normalizePackImport(manifest,files)
  return {...await sealPack(normalized.manifest,files,current,hashed),p,warnings:generated.warnings,expectedRevision,additions,changedFigures,selected}
}
const acceptedImages=pack=>pack.p.baseline?.scope==='images'&&pack.installedSlots?.every(({slot})=>slotAccepted(pack.p.slots[slot])&&!pack.p.slots[slot].stale)
export async function packSetteiProduction(root,options) {
  const pack=await compileSetteiDelivery(root,options),source='delivery/final-assets/pack-source'
  await rm(await safeProjectFile(root,'delivery'),{recursive:true,force:true})
  for(const [file,bytes]of pack.files)await atomic(root,source+'/'+file,bytes)
  await atomic(root,source+'/generation-provenance.json',json(generationProvenance(pack)))
  await atomic(root,source+'/manifest.json',json(pack.manifest))
  await atomic(root,source+'/pack-source.json',json({version:1,id:pack.p.id,name:pack.manifest.name,manifest:'manifest.json'}))
  const output=await safeProjectFile(root,'delivery/final-assets/pack.zip'),temp=output+'.'+randomUUID()+'.tmp'
  await writeNativePack(pack,temp);await rename(temp,output)
  await atomic(root,'delivery/settei-export.json',json({scope:pack.scope||pack.p.baseline.scope,project_id:pack.p.id,projectContentHash:contentFingerprint(pack.p),expectedRevision:pack.expectedRevision,contentHash:pack.manifest.contentHash,selection:pack.selection??null,...(pack.installedSlots?{installedSlots:pack.installedSlots}:{}),...(pack.installedMouths?{installedMouths:pack.installedMouths}:{}),...(pack.installedBlinks?{installedBlinks:pack.installedBlinks}:{}),...(pack.selected?{figures:pack.selected}:{})}))
  return {id:pack.p.id,scope:pack.scope||pack.p.baseline.scope,output,contentHash:pack.manifest.contentHash,expectedRevision:pack.expectedRevision,warnings:pack.warnings,written:pack.written,...(pack.skipped?{skipped:pack.skipped}:{}),changedFigures:pack.changedFigures,figures:pack.selected,installReady:['mouths','animation'].includes(pack.scope)||acceptedImages(pack)||Boolean(pack.selected)||reviewMatchesContent(pack.p)&&Boolean(pack.p.review?.acceptedBy)}
}
export async function installSetteiProduction(root,options) {
  const pack=await compileSetteiDelivery(root,options),p=pack.p
  check(['mouths','animation'].includes(pack.scope)||acceptedImages(pack)||pack.selected||p.review?.acceptedBy&&reviewMatchesContent(p),'Current image slots or review HTML must be explicitly accepted before installation')
  const receipt=JSON.parse(await readFile(await safeProjectFile(root,'delivery/settei-export.json')))
  check(receipt.scope===(pack.scope||p.baseline.scope)&&receipt.project_id===p.id&&receipt.projectContentHash===contentFingerprint(p),'Foreign or stale scoped export; run pack again')
  check(same(receipt.figures||null,pack.selected||null),'Scoped export figure selection differs; run pack with the same --figures')
  check(same(receipt.selection??null,pack.selection??null),'Animation selection differs; pack and install must use identical selectors')
  // A repeated delivery may only bypass its old receipt revision when it is already installed exactly.
  check(receipt.expectedRevision===options.expectedRevision||receipt.contentHash===pack.manifest.contentHash,'Stale scoped export revision; run pack again')
  check(receipt.contentHash===pack.manifest.contentHash,'Export differs from the fresh installed snapshot; run pack again')
  if(p.baseline?.scope==='images'||['mouths','animation'].includes(pack.scope))return installImageDelivery(root,pack,options)
  if(options.dryRun)return {id:p.id,scope:p.baseline.scope,dryRun:true,expectedRevision:options.expectedRevision,contentHash:pack.manifest.contentHash,warnings:pack.warnings,changedFigures:pack.changedFigures}
  check(options.confirm,'install requires --confirm')
  const service=createAssetPackService({assetRoot:path.resolve(options.library),decodeMedia})
  try {
    const archive=await safeProjectFile(root,'delivery/final-assets/pack.zip')
    const preview=await service.inspectImport({bytes:await readFile(archive)})
    check(preview.incoming.manifest.id===p.id&&preview.contentHash===pack.manifest.contentHash,'Foreign or stale scoped archive')
    check(preview.expectedRevision===options.expectedRevision,'Installed revision changed; refresh before installation')
    const decision=preview.choices.includes('noop')?'noop':'update'
    check(preview.current&&preview.choices.includes(decision),'Unknown or foreign installed pack')
    const result=await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:options.expectedRevision,decision,createFigures:pack.additions})
    return {id:p.id,scope:p.baseline.scope,status:result.status,revision:result.snapshot.revision,contentHash:result.snapshot.manifest.contentHash,warnings:pack.warnings}
  }finally{await service.dispose()}
}
