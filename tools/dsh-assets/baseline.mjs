// Native settei projects own only the two board layers, never runtime presentation.
import path from 'node:path'
import {p5SnapshotPlan,p5MigrationCommand} from './migrate-p5.mjs'
import {readFile,mkdir,lstat,writeFile} from 'node:fs/promises'
import {validateUuid} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/common.js'
import {validatePackDocuments} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {validateProjectSchema} from '../../tavern-plugin/lib/domain/asset-production-schema.js'
import {safeProjectFile,productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
export async function readNativeSnapshot(library,id,{media=false}={}) {
  validateUuid(id)
  const read=async name=>readFile(await safeProjectFile(library,name))
  const localPath='local/'+id+'.json',local=JSON.parse(await read(localPath)),prefix='packs/'+id+'/'
  const manifest=JSON.parse(await read(prefix+'manifest.json')),figures={},sprites={},files=new Map()
  check(manifest.id===id,'Foreign native pack identity')
  for(const fid of manifest.figures){const name='figures/'+fid+'.json',bytes=await read(prefix+name);files.set(name,bytes);figures[fid]=JSON.parse(bytes)}
  for(const [key,name]of Object.entries(manifest.sprites)){const bytes=await read(prefix+name);files.set(name,bytes);sprites[key]=JSON.parse(bytes)}
  try {validatePackDocuments({manifest,figures,sprites})} catch(error) {
    if(p5SnapshotPlan(manifest,local.revision).targets.length)throw productionError('PRECONDITION','Pre-P5 mirror requires explicit offline migration or a fresh post-P5 baseline; no automatic conversion',{nextAction:p5MigrationCommand(library,id)})
    throw error
  }
  if(media)for(const file of manifest.files)if(!files.has(file.path))files.set(file.path,await read(prefix+file.path))
  check(JSON.parse(await read(localPath)).revision===local.revision,'Native revision changed during snapshot')
  return {manifest,figures,sprites,files,revision:local.revision}
}
export async function baselineProduction(root,{library,pack,scope,figure,'avatar-framing':avatarFraming,dryRun=false}) {
  if(!['settei','images'].includes(scope))throw productionError('INVALID_ARGUMENT','baseline scope must be settei or images')
  if(!library) {
    check(scope==='images','Settei baseline requires --library')
    const directory=path.resolve(pack)
    check(path.basename(path.dirname(directory))==='packs','Installed pack path must be LIB/packs/UUID, with LIB/local/UUID.json revision data')
    library=path.dirname(path.dirname(directory));pack=path.basename(directory)
  }
  const relative=path.relative(path.resolve(library),path.resolve(root))
  check(relative&&relative!=='..'&&(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'Project must be outside the library')
  await safeProjectFile(root,'project.json')
  check(!await lstat(root).catch(e=>{if(e.code==='ENOENT')return null;throw e}),'Baseline destination must not exist')
  const native=await readNativeSnapshot(library,pack),p={schemaVersion:2,id:pack,name:native.manifest.name,revision:0,characters:[],assets:[],slots:{},plans:{},reviews:[],baseline:{scope,packId:pack,nativeRevision:native.revision,contentHash:native.manifest.contentHash,uuidMap:[],sources:[]}},copies=new Map()
  async function evidence(slot,board,metadata={}) {
    if(!board)return
    const descriptor=native.manifest.blobs[board],source='media/'+board+'.'+descriptor.ext,file='sources/native/'+board+'.'+descriptor.ext
    if(!copies.has(file))copies.set(file,await readFile(await safeProjectFile(library,'packs/'+pack+'/'+source)))
    p.baseline.sources.push({slot,hash:board,path:file,nativePath:source,...metadata})
  }
  if(scope==='images')await (await import('./images-baseline.mjs')).populateImageBaseline(p,native,library,pack,copies)
  else for(const figure of Object.values(native.figures)) {
    const key='f-'+figure.id,c={key,id:figure.id,name:figure.name,identityAppearance:figure.identityAppearance||'',emotions:[],outfits:[]}
    p.characters.push(c);p.baseline.uuidMap.push({key,id:figure.id,outfits:figure.outfits.map(o=>o.key)})
    const id=key+'/identity-settei';p.slots[id]={id,character:key,kind:'identity-settei',version:0,palette:[]}
    await evidence(id,figure.identitySettei?.board,figure.identitySettei?{version:figure.identitySettei.version,palette:figure.identitySettei.palette}: {})
    for(const outfit of figure.outfits) {
      c.outfits.push({key:outfit.key,label:outfit.label||outfit.key,outfitAppearance:outfit.outfitAppearance||'',eyesClosed:[]})
      const id=key+'/'+outfit.key+'/settei';p.slots[id]={id,character:key,outfit:outfit.key,kind:'settei',version:0}
      await evidence(id,outfit.settei,outfit.setteiParentVersion?{parentVersion:outfit.setteiParentVersion}:{})
    }
  }
  if(avatarFraming!==undefined||figure!==undefined) {
    check(scope==='images'&&avatarFraming==='match-reference'&&figure,'Use --scope images --figure UUID --avatar-framing match-reference')
    const c=p.characters.find(c=>c.id===figure||c.key===figure)
    check(c,'Unknown figure UUID/key')
    c.avatarFraming={mode:'match-reference',reference:'installed-default',tolerance:0.03}
  }
  validateProjectSchema(p)
  const local=JSON.parse(await readFile(await safeProjectFile(library,'local/'+pack+'.json')))
  check(local.revision===native.revision,'Native revision changed during baseline')
  if(!dryRun) {
    await mkdir(path.dirname(root),{recursive:true});await mkdir(root)
    for(const [file,bytes]of copies){const target=await safeProjectFile(root,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'})}
    await writeFile(path.join(root,'project.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'})
  }
  return {id:pack,project:root,scope,revision:0,nativeRevision:native.revision,contentHash:native.manifest.contentHash,uuidMap:p.baseline.uuidMap,slots:Object.values(p.slots).map(s=>({slot:s.id,expected_version:s.version})),missing:Object.values(p.slots).filter(s=>scope==='images'&&!s.installed&&!p.characters.find(c=>c.key===s.character).outfits.find(o=>o.key===s.outfit).fallbackEmotions?.includes(s.emotion)).map(s=>({slot:s.id,kind:s.kind,expected_version:0})),sources:p.baseline.sources,metadataSources:p.baseline.metadataSources||[],dryRun}
}
