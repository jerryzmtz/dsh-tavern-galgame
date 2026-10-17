// private fork: deletions use the same slot CAS delta as image updates.
import {unlink,rm,access} from 'node:fs/promises'
import {atomic,loadProject,transaction,safeProjectFile,productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {invalidateDescendants} from '../../tavern-plugin/lib/domain/asset-production-graph.js'
function removableDerivedAnimation(p,s) {
  return s&&['mouth','blink'].includes(s.kind)&&(s.stale||!s.artifact)&&s.sourceBinding?.slot===[s.character,s.outfit,'sprite',s.emotion].join('/')&&Boolean(p.layered?.[s.character+'/'+s.outfit]?.manifest.emotions[s.emotion])
}
export function emptySlot(s) {
  return Object.fromEntries(['id','kind','character','outfit','emotion','frame','key','userPrompt','optional','sourceBinding'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]]).concat([['version',(s.version||0)+1]]))
}
export function clearSlots(p,ids) {
  const updates=[],files=new Set()
  for(const id of ids) {
    const s=p.slots[id]
    if(!s)throw productionError('NOT_FOUND','Unknown slot: '+id)
    const preserveHistory=removableDerivedAnimation(p,s)
    for(const a of [s.raw,s.artifact])if(a?.path)files.add(a.path)
    invalidateDescendants(p,id)
    const value=emptySlot(s);updates.push({slot:id,expected_version:s.version||0,value,operation:'remove'});p.slots[id]=value;if(p.workflowWaits)delete p.workflowWaits[id]
    // Failed derived attempts remain history, not current slot content or a refunded budget.
    for(const [key,plan] of Object.entries(p.plans))if(!preserveHistory&&plan.slot===id){files.add('received/'+key+'.png');for(const a of [plan.artifact,...(plan.references||[])])if(a?.path)files.add(a.path);delete p.plans[key]}
  }
  delete p.review
  p.reviews=[]
  return {schema_version:1,project_id:p.id,updates,files:[...files]}
}
export async function reclaimableFiles(root,p,files) {
  const used=new Set([...Object.values(p.mouthSources||{}),...Object.values(p.blinkSources||{})].flatMap(source=>[source.path,source.atlasPath].filter(Boolean)))
  for(const entry of Object.values(p.layered||{}))for(const a of Object.values(entry.assets))used.add(a.path)
  for(const s of Object.values(p.slots))for(const a of [s.raw,s.artifact])if(a?.path)used.add(a.path)
  for(const plan of Object.values(p.plans))for(const a of [plan.artifact,...(plan.references||[])])if(a?.path)used.add(a.path)
  const result=[]
  for(const file of [...new Set(files)].sort())if(!used.has(file))try{await access(await safeProjectFile(root,file));result.push(file)}catch(e){if(e.code!=='ENOENT')throw e}
  return result
}
export async function cleanRemovedFiles(root,files) {
  return transaction(root,async p=>{
  for(const file of await reclaimableFiles(root,p,files))await unlink(await safeProjectFile(root,file))
  // Derived exports and reviews must not retain removed pixels or an old approval gate.
  for(const file of ['delivery','review.html','review-data.json','review-preview.html','review-preview-data.json'])await rm(await safeProjectFile(root,file),{recursive:true,force:true})
  })
}
export async function removeProduction(root,{slot,outfit,out,dryRun=false}) {
  if(Boolean(slot)===Boolean(outfit))throw productionError('INVALID_ARGUMENT','Specify exactly one of --slot or --outfit (character/outfit or unique outfit key)')
  if(out&&(!out.startsWith('deltas/')||!out.endsWith('.json')))throw productionError('INVALID_ARGUMENT','--out must be a JSON file under deltas/')
  await safeProjectFile(root,out||'removal-delta.json')
  const action=p=>{
    const ids=slot?[slot]:Object.values(p.slots).filter(s=>s.outfit&&(s.character+'/'+s.outfit===outfit||s.outfit===outfit)).map(s=>s.id)
    if(!ids.length)throw productionError('NOT_FOUND','Unknown outfit')
    if(ids.some(id=>{const s=p.slots[id];return s&&p.layered?.[s.character+'/'+s.outfit]?.manifest.emotions[s.emotion]&&['sprite','mouth','blink'].includes(s.kind)&&!removableDerivedAnimation(p,s)}))throw productionError('PRECONDITION','Layered differences require explicit --rig/--part removal; a whole slot cannot hide their parts')
    if(!slot&&new Set(ids.map(id=>p.slots[id].character+'/'+p.slots[id].outfit)).size!==1)throw productionError('INVALID_ARGUMENT','Ambiguous outfit; specify character/outfit')
    return clearSlots(p,ids)
  }
  const result=dryRun?action(structuredClone(await loadProject(root))):await transaction(root,action)
  const {files,...delta}=result
  if(!dryRun){await cleanRemovedFiles(root,files);await atomic(root,out||'removal-delta.json',Buffer.from(JSON.stringify(delta,null,2)+'\n'))}
  return {...delta,dryRun,output:out||'removal-delta.json'}
}
