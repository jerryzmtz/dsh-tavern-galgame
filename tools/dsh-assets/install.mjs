// private fork: installation requires reviewed project + CAS and refuses smaller incoming indexes.
import path from 'node:path'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import {writeNativePack} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/pack-source.js'
import {sealPack} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {loadProject,compileProduction,contentFingerprint,reviewMatchesContent,safeProjectFile,productionError,transaction} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import hybrid from '../../tavern-plugin/packages/dsh-asset-library/lib/shared/hybrid-sprite.cjs'
const populated=(doc,id)=>doc?.kind==='hybrid-face-sprites'?hybrid.resolveHybridSprite(doc,id).available:Boolean(doc?.emotions[id]&&!doc.emotions[id].fallback)
const check=(ok,msg)=>{if(!ok)throw productionError('CONFLICT',msg)}
export function assertNoRemovedStates(current,incoming) {
  if(!current)return
  for(const [id,figure]of Object.entries(current.figures)) {
    const next=incoming.figures[id];check(next,'Incoming pack removes a locally installed figure')
    for(const outfit of figure.outfits){const target=next.outfits.find(o=>o.key===outfit.key);check(target,'Incoming pack removes a locally installed outfit')
      for(const emotion of Object.keys(outfit.avatars||{}))check(target.avatars?.[emotion],'Incoming pack removes a local avatar')
      if(outfit.sprite){const before=current.sprites[outfit.sprite.manifestKey],after=target.sprite&&incoming.sprites[target.sprite.manifestKey];check(before.emotions,'Installed sprites require the explicit emotion migration');check(after&&Object.keys(before.emotions).filter(emotion=>populated(before,emotion)).every(emotion=>populated(after,emotion)),'Incoming pack removes a locally populated emotion; merge the local fills first')}
    }
  }
  for(const asset of current.manifest.assets)check(incoming.manifest.assets.some(a=>a.kind===asset.kind&&a.id===asset.id),'Incoming pack removes a local asset')
}
// Only generated media and authoring appearance belong to the CLI. UI metadata
// (including future fields) stays with the stable figure ID / outfit key.
const ownedOutfitFields=new Set(['key','outfitAppearance','settei','setteiParentVersion','avatars','sprite'])
export function preserveOutfitMetadata(current,incoming) {
  for(const [id,figure]of Object.entries(incoming.figures))for(const outfit of figure.outfits) {
    const previous=current?.figures[id]?.outfits.find(o=>o.key===outfit.key)
    if(previous)for(const [key,value]of Object.entries(previous))if(!ownedOutfitFields.has(key))outfit[key]=structuredClone(value)
  }
  return incoming
}
export async function installProduction(root,{library,expectedRevision,dryRun=false,confirm=false,figures,scope,outfits,slots,sprites,avatarBaseline}) {
  check(path.resolve(library)!==path.resolve(root),'Library must be separate from authoring project')
  if(sprites!==undefined&&scope!=='animation')throw productionError('INVALID_ARGUMENT','--sprites requires --scope animation')
  if(scope==='accepted')return (await import('./accepted-install.mjs')).installAcceptedProduction(root,{library,expectedRevision,dryRun,confirm,figures,outfits,slots,avatarBaseline})
  if(scope!==undefined&&!['avatars','mouths','animation'].includes(scope))throw productionError('INVALID_ARGUMENT','install scope must be avatars, mouths, animation or accepted')
  if(scope==='avatars')return transaction(root,async()=>(await import('./avatar-install.mjs')).installAvatarProduction(root,{library,expectedRevision,dryRun,confirm,figures,outfits,slots,avatarBaseline}))
  if(outfits!==undefined||slots!==undefined&&scope!=='animation'||avatarBaseline!==undefined)throw productionError('INVALID_ARGUMENT','Avatar filters/baseline require --scope avatars')
  if((await loadProject(root)).baseline||['mouths','animation'].includes(scope))return transaction(root,async()=>(await import('./settei-install.mjs')).installSetteiProduction(root,{library,expectedRevision,dryRun,confirm,figures,scope,sprites,slots}))
  check(figures===undefined,'--figures requires a settei baseline')
  const pack=await compileProduction(root),p=pack.p
  check(p.review?.acceptedBy&&reviewMatchesContent(p),'Current review HTML must be explicitly accepted before installation')
  const expected=expectedRevision==='null'?null:expectedRevision
  check(expected===null||typeof expected==='string'&&expected.length>0,'Explicit expected revision or null required')
  let current=null,local=null
  const read=async rel=>JSON.parse(await readFile(await safeProjectFile(library,rel),'utf8'))
  try{local=await read('local/'+p.id+'.json')}catch(e){if(e.code!=='ENOENT')throw e}
  check((local?.revision??null)===expected,'Installed revision changed; refresh before installation')
  if(local){const prefix='packs/'+p.id+'/',manifest=await read(prefix+'manifest.json');current={manifest,figures:{},sprites:{}};for(const id of manifest.figures)current.figures[id]=await read(prefix+'figures/'+id+'.json');for(const [id,file]of Object.entries(manifest.sprites))current.sprites[id]=await read(prefix+file)}
  assertNoRemovedStates(current,pack)
  if(dryRun)return {id:p.id,expectedRevision:expected,contentHash:pack.manifest.contentHash,dryRun:true,warnings:pack.warnings}
  check(confirm,'install requires --confirm and a separately named library root')
  const output=await safeProjectFile(root,'delivery/final-assets/pack.zip'),service=createAssetPackService({assetRoot:path.resolve(library)})
  try{
    let preview=await service.inspectImport({bytes:await readFile(output)})
    check(preview.contentHash===pack.manifest.contentHash,'Export is stale; run pack again')
    check(preview.expectedRevision===expected,'Installed revision changed; refresh before installation')
    assertNoRemovedStates(preview.current,preview.incoming)
    if(preview.current) {
      preserveOutfitMetadata(preview.current,pack)
      for(const [id,figure]of Object.entries(pack.figures))pack.files.set('figures/'+id+'.json',Buffer.from(JSON.stringify(figure,null,2)+'\n'))
      const merged=await sealPack(pack.manifest,pack.files),temporary=await mkdtemp(path.join(os.tmpdir(),'dsh-assets-install-'))
      try {
        const archive=path.join(temporary,'pack.zip')
        await writeNativePack(merged,archive)
        await service.applyImport({inspectionId:preview.inspectionId,decision:'cancel'})
        preview=await service.inspectImport({bytes:await readFile(archive)})
        check(preview.expectedRevision===expected,'Installed revision changed; refresh before installation')
      }finally{await rm(temporary,{recursive:true,force:true})}
    }
    const decision=preview.choices.includes('noop')?'noop':preview.current?'update':'install';check(preview.choices.includes(decision),'Identity collision requires manual native import review')
    const result=await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:expected,decision})
    return {id:p.id,revision:result.snapshot.revision,status:result.status,contentHash:result.snapshot.manifest.contentHash,warnings:pack.warnings}
  }finally{await service.dispose()}
}
