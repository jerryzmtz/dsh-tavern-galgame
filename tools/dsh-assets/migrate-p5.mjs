// Explicit offline mirror ingress; conversion is owned by the live P5 planner.
import path from 'node:path'
import {readFile,mkdir,writeFile,copyFile,stat,lstat,realpath,rename,rm,readdir} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {planModsP5} from './p5-plan.mjs'
import {validateUuid} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/common.js'
import {validatePackDocuments,computeContentHash} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {safeProjectFile,productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
const check=(ok,message)=>{if(!ok)throw productionError('PRECONDITION',message)}
const inside=(a,b)=>{const r=path.relative(a,b);return !r||!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r)}
const lstatOrNull=p=>lstat(p).catch(e=>{if(e.code==='ENOENT')return null;throw e})
// Validate the whole destination before anything is created: no existing component may be a link or junction, the destination must not exist, and its real location must be outside the source library.
async function assertNewOutput(library,out) {
  const chain=[];for(let p=out,up;;p=up){chain.unshift(p);up=path.dirname(p);if(up===p)break}
  let existing=null
  for(const p of chain){const st=await lstatOrNull(p);if(!st)break;check(!st.isSymbolicLink(),'Linked or unsafe project path rejected: '+p);existing=p}
  check(existing!==out,'Destination already exists; never overwrite a mirror')
  const realOut=path.join(await realpath(existing),path.relative(existing,out)),realLibrary=await realpath(library)
  check(!inside(library,out)&&!inside(out,library)&&!inside(realLibrary,realOut)&&!inside(realOut,realLibrary),'Destination must be new and outside the source library')
}
export function p5SnapshotPlan(manifest,revision) {
  return planModsP5({snapshots:[{manifest,revision}]})
}
export function p5MigrationCommand(library,pack) {
  return `node bin/dsh-assets.mjs migrate-p5 --library ${JSON.stringify(path.resolve(library))} --pack ${pack} --out ${JSON.stringify(path.resolve(library)+'-p5')} --dry-run --json`
}
export async function migrateP5Snapshot({library,pack,out,dryRun=false,confirm=false,expectedRevision}) {
  validateUuid(pack)
  check(dryRun!==confirm,'Run --dry-run first; apply explicitly with --confirm --expected-revision from the preview')
  library=path.resolve(library);out=path.resolve(out)
  await assertNewOutput(library,out)
  const localName='local/'+pack+'.json',prefix='packs/'+pack+'/',read=async name=>readFile(await safeProjectFile(library,name))
  const localBytes=await read(localName),local=JSON.parse(localBytes),original=JSON.parse(await read(prefix+'manifest.json'))
  check(original.id===pack,'Foreign pack identity')
  const plan=p5SnapshotPlan(original,local.revision)
  check(!plan.blockers.length,'P5 conversion has unresolved blockers')
  const manifest=plan.targets[0]?.manifest||structuredClone(original),figures={},sprites={}
  for(const id of manifest.figures)figures[id]=JSON.parse(await read(prefix+'figures/'+id+'.json'))
  for(const [id,file] of Object.entries(manifest.sprites))sprites[id]=JSON.parse(await read(prefix+file))
  if(plan.targets.length)manifest.contentHash=await computeContentHash(manifest)
  validatePackDocuments({manifest,figures,sprites})
  const sources=[]
  for(const file of manifest.files) {
    const from=await safeProjectFile(library,prefix+file.path)
    check((await stat(from)).size===file.size,'Source file size changed: '+file.path)
    sources.push(from)
  }
  const result={pack,sourceRevision:local.revision,changed:plan.targets.length>0,out,contentHash:manifest.contentHash,audit:plan.audit,refMap:plan.refMap,files:manifest.files.length,offlineOnly:true}
  if(dryRun)return {...result,dryRun:true,nextAction:`node bin/dsh-assets.mjs migrate-p5 --library ${JSON.stringify(library)} --pack ${pack} --out ${JSON.stringify(out)} --expected-revision ${JSON.stringify(local.revision)} --confirm --json`}
  check(expectedRevision===local.revision,'Source revision changed; repeat --dry-run')
  const staging=out+'.partial-'+randomUUID(),revision=plan.targets.length?randomUUID():local.revision
  await mkdir(staging)
  try {
    for(const [index,file] of manifest.files.entries()) {
      const to=await safeProjectFile(staging,prefix+file.path)
      await mkdir(path.dirname(to),{recursive:true});await copyFile(sources[index],to)
    }
    const write=async(name,value)=>{const file=await safeProjectFile(staging,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'})}
    await write(prefix+'manifest.json',manifest)
    await write(localName,{...local,revision})
    await write('migration-p5.json',{...result,revision,kind:'offline-p5-mirror',note:'Local conversion revision is not a live CAS token. Authoring project approvals and installed baselines are not rewritten.'})
    check((await read(localName)).equals(localBytes),'Source revision changed while copying; partial output is not published')
    // Exclusive mkdir claims the destination; never rename over someone else's directory.
    await mkdir(out)
    try {
      for(const entry of await readdir(staging))await rename(path.join(staging,entry),path.join(out,entry))
    } catch(e) {
      await rm(out,{recursive:true,force:true})
      throw e
    }
  } finally {
    await rm(staging,{recursive:true,force:true})
  }
  return {...result,revision,dryRun:false}
}
