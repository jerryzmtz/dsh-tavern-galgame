import {assertCandidateAdmission} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
import {assertDeltaVersion} from './delta-version.mjs'
// private fork: explicit authoring mutations; no whole-index replacement or approval inference.
import {randomUUID} from 'node:crypto'
import {appendFile} from 'node:fs/promises'
import {clearSlots,cleanRemovedFiles,reclaimableFiles} from './remove.mjs'
import {readFile,writeFile,open,unlink} from 'node:fs/promises'
import {atomic,safeProjectFile,loadProject,transaction,productionError,hash} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {animationDependenciesCurrent} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {validateProjectSchema} from '../../tavern-plugin/lib/domain/asset-production-schema.js'
import {pngSize} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
import {invalidateDescendants,descendants} from '../../tavern-plugin/lib/domain/asset-production-graph.js'
const requireValue=(ok,msg)=>{if(!ok)throw productionError('CONFLICT',msg)}
export async function addFigures(root,{input,expectedRevision,dryRun=false}) {
  const invalid=message=>{throw productionError('INVALID_ARGUMENT',message)}
  if(!/^(0|[1-9][0-9]*)$/.test(String(expectedRevision))||!Number.isSafeInteger(Number(expectedRevision)))invalid('--expected-revision must be a nonnegative integer from status')
  if(!input||Object.keys(input).some(k=>k!=='characters')||!Array.isArray(input.characters)||!input.characters.length||input.characters.length>64)invalid('Input must be {characters:[...]} with 1..64 new figures')
  const keys=new Set(),names=new Set(),fields=['key','name','nameCn','identityAppearance','notes','sourceUrls']
  for(const c of input.characters) {
    if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!fields.includes(k)))invalid('Figure fields: key, name (JP primary), nameCn, identityAppearance, notes, sourceUrls')
    if(typeof c.key!=='string'||!/^[a-z][a-z0-9_-]{0,47}$/.test(c.key))invalid('Figure key must match [a-z][a-z0-9_-]{0,47}')
    for(const field of ['name','nameCn','identityAppearance','notes'])if(field==='name'||c[field]!==undefined) {
      if(typeof c[field]!=='string'||!c[field].trim()||c[field].length>4000)invalid(field+' must be a nonempty string of at most 4000 characters')
    }
    if(c.sourceUrls!==undefined&&(!Array.isArray(c.sourceUrls)||c.sourceUrls.length>64||c.sourceUrls.some(url=>{try{return typeof url!=='string'||!['https:','http:'].includes(new URL(url).protocol)}catch{return true}})))invalid('sourceUrls must be an array of HTTP(S) URLs (max 64)')
    if(keys.has(c.key))invalid('Duplicate figure key in input: '+c.key+'; keep one declaration')
    const name=c.name.trim().normalize('NFC')
    if(names.has(name))invalid('Duplicate figure name in input: '+c.name+'; keep one declaration')
    keys.add(c.key);names.add(name)
  }
  const declaration=c=>({name:c.name,identityAppearance:c.identityAppearance||'',...Object.fromEntries(['nameCn','notes','sourceUrls'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]]))})
  const action=p=>{
    requireValue(p.baseline?.scope==='settei','add-figures requires a settei baseline project; use init for a new project')
    requireValue(p.revision===Number(expectedRevision),'Stale project revision: expected '+expectedRevision+', current '+p.revision+'; run status and retry with --expected-revision '+p.revision)
    const added=[],pending=[],authorized=[]
    const recorded=new Set((p.addedFigures||[]).flatMap(batch=>batch.added.map(row=>row.id)))
    for(const c of input.characters) {
      const existing=p.characters.find(row=>row.key===c.key||row.authoringKey===c.key)
      if(existing) {
        requireValue(existing.authoringKey===c.key&&JSON.stringify(declaration(existing))===JSON.stringify(declaration(c)),'Figure key collision: '+c.key+'; choose a new key or rerun the unchanged declaration')
        if(!recorded.has(existing.id))authorized.push({key:existing.key,id:existing.id,authoringKey:existing.authoringKey,slot:existing.key+'/identity-settei',expected_version:0})
        continue
      }
      requireValue(!p.characters.some(row=>row.name.trim().normalize('NFC')===c.name.trim().normalize('NFC')),'Duplicate figure name: '+c.name+'; choose a distinct name/key')
      pending.push(c)
    }
    requireValue(p.characters.length+pending.length<=64,'Project limit is 64 figures; reduce the input')
    for(const c of pending) {
      // Baselines retain native IDs; new authoring figures use init's randomUUID generator.
      const id=randomUUID(),key='f-'+id,slot=key+'/identity-settei'
      p.characters.push({key,id,authoringKey:c.key,...declaration(c),emotions:[],outfits:[]})
      p.slots[slot]={id:slot,character:key,kind:'identity-settei',version:0,palette:[]}
      p.baseline.uuidMap.push({key,id,outfits:[]})
      added.push({key,id,authoringKey:c.key,slot,expected_version:0})
    }
    authorized.push(...added)
    if(authorized.length)(p.addedFigures||=[]).push({operationId:randomUUID(),revision:p.revision+1,added:authorized})
    return {project:root,revision:p.revision+(authorized.length?1:0),added,authorizationRecorded:authorized.map(row=>row.id),idempotent:!authorized.length,dryRun}
  }
  return dryRun?action(await loadProject(root)):transaction(root,action,{afterCommit:async(p,result)=>{
    const logged=new Set(p.framingLog.filter(row=>row?.action==='add-figures').map(row=>row.operationId)),missing=(p.addedFigures||[]).filter(batch=>!logged.has(batch.operationId))
    if(!missing.length)return
    result.auditRepaired=[]
    try {
      if(p.auditError)throw new Error(p.auditError)
      const file=await safeProjectFile(root,'project-log.jsonl')
      let separator=p.auditNeedsSeparator?'\n':''
      for(const batch of missing) {
        await appendFile(file,separator+JSON.stringify({action:'add-figures',...batch})+'\n')
        separator='';result.auditRepaired.push(batch.operationId)
      }
    }catch {
      result.warnings=[{code:'AUDIT_APPEND_FAILED',severity:'warning',message:'Project committed at revision '+p.revision+'; addedFigures authorizes installation. Audit is incomplete. Fix project-log.jsonl access, then rerun the same input with --expected-revision '+p.revision+' to repair missing entries.'}]
    }
  }})
}
export async function figureFraming(root,{figure,mode,tolerance,reference,dryRun=false}) {
  if(!['default','match-reference'].includes(mode)||mode==='default'&&(tolerance!==undefined||reference!==undefined))throw productionError('INVALID_ARGUMENT','Use match-reference with optional tolerance/reference, or default alone')
  const action=p=>{
    const index=p.characters.findIndex(c=>c.id===figure||c.key===figure)
    if(index<0)throw productionError('NOT_FOUND','Unknown figure: '+figure)
    const c=p.characters[index],before=c.avatarFraming||null
    const after=mode==='default'?null:{mode,reference:reference??'installed-default',tolerance:tolerance===undefined?0.03:Number(tolerance)}
    if(after)c.avatarFraming=after;else delete c.avatarFraming
    validateProjectSchema(p)
    const changed=before===null?after!==null:after===null||['mode','reference','tolerance'].some(key=>before[key]!==after[key])
    if(!changed&&before)c.avatarFraming=before
    const diff=changed?[{path:'/characters/'+index+'/avatarFraming',before,after},{path:'/revision',before:p.revision,after:p.revision+1}]:[]
    return {figure:c.id,dryRun,idempotent:!changed,diff,qaRecheck:changed?Object.values(p.slots).filter(s=>s.character===c.key&&s.kind==='avatar'&&s.artifact&&!s.installed).map(s=>s.id):[]}
  }
  return dryRun?action(await loadProject(root)):transaction(root,action,{log:'figure-framing'})
}
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n')
export async function requireMouth(root,options={}) {
  const {dryRun=false}=options
  if((await loadProject(root)).baseline?.scope==='images')return (await import('./animation-declare.mjs')).requireAnimation(root,options,'mouth')
  requireValue(options.sprites===undefined&&!options.rebind&&!options.library&&!options.expectedRevision,'Scoped mouth options require an images baseline')
  const action=p=>{
    requireValue(!p.baseline,'Settei-only baselines have no sprite phase')
    const added=[]
    for(const c of p.characters)for(const o of c.outfits) {
      if(!c.emotions.length)continue
      requireValue(!p.layered?.[c.key+'/'+o.key],'Layered mouth frames must be declared in recipes')
      o.mouth=true
      for(const {id:emotion} of c.emotions.filter(row=>!o.fallbackEmotions?.includes(row.id)))for(const frame of ['closed','small','mid','open']) {
        const id=[c.key,o.key,'mouth',emotion,frame].join('/')
        if(p.slots[id])continue
        p.slots[id]={id,character:c.key,outfit:o.key,kind:'mouth',emotion,frame,version:0}
        added.push({slot:id,expected_version:0})
      }
    }
    validateProjectSchema(p)
    return {semantics:'opening-level',frames:['closed','small','mid','open'],added,dryRun}
  }
  return dryRun?action(await loadProject(root)):transaction(root,action)
}
export async function recordRefusal(root,{slot,file}) {
  const message=await readFile(file,'utf8');requireValue(message.length>0&&message.length<=16000,'Refusal message must be 1..16000 characters')
  return transaction(root,p=>{const s=p.slots[slot];requireValue(s,'Unknown slot');(p.generationLog||=[]).push({slot,status:'refused',message,timestamp:new Date().toISOString()});return {slot,status:'refused'}})
}
export async function recordWaiting(root,{slot,on,note,clear=false}) {
  requireValue(clear?on===undefined&&note===undefined:typeof on==='string'&&on.trim().length>0&&on.length<=300&&typeof note==='string'&&note.trim().length>0&&note.length<=1000,'Specify --waiting-on and --note, or --clear alone')
  return transaction(root,p=>{const s=p.slots[slot];requireValue(s,'Unknown slot')
    p.workflowWaits||={}
    if(clear)delete p.workflowWaits[slot]
    else if(p.workflowWaits[slot]?.on!==on||p.workflowWaits[slot]?.reason!==note)p.workflowWaits[slot]={on,reason:note,timestamp:new Date().toISOString()}
    return {slot,waiting:p.workflowWaits[slot]||null}
  })
}
export async function updateMetadata(root,{slot,file,expectedVersion,dryRun=false}) {
  const metadata=JSON.parse(await readFile(file,'utf8'))
  const action=p=>{const s=p.slots[slot];requireValue(s&&['identity-settei','settei'].includes(s.kind),'Metadata target must be a colour settei');requireValue(Number(expectedVersion)===(s.version||0),'Stale settei version')
    const affected=descendants(p,slot);s.settei=metadata;if(metadata.palette)s.palette=metadata.palette
    s.version=(s.version||0)+1;delete s.accepted;invalidateDescendants(p,slot);validateProjectSchema(p)
    return {slot,version:s.version,affected,dryRun,warnings:[]}}
  return dryRun?action(structuredClone(await loadProject(root))):transaction(root,action)
}
export async function migrateProject(root,{dryRun=false}={}) {
  const file=await safeProjectFile(root,'project.json'),bytes=await readFile(file),p=JSON.parse(bytes)
  requireValue([1,2].includes(p.schemaVersion),'Only v1/v2 projects are supported')
  const originalVersion=p.schemaVersion,changed=[],removeIds=new Set(),removedFiles=[]
  if(!p.migration120)for(const slot of Object.values(p.slots))if(['cg-ranko-game-07','miku-game-ssr1','rika-game-ssr1'].includes(slot.outfit))removeIds.add(slot.id)
  if(originalVersion===1){p.schemaVersion=2;for(const c of p.characters)p.slots[c.key+'/identity-settei']={id:c.key+'/identity-settei',character:c.key,kind:'identity-settei',palette:[]};for(const s of Object.values(p.slots))s.version=s.artifact?1:0}
  const convert=(value,label)=>{
    if(value.status!=='excluded'&&value.provenance?.delivery_status!=='excluded')return
    if(value.id)removeIds.add(value.id)
    else for(const slot of Object.values(p.slots))if(slot.character+'/'+slot.outfit===label)removeIds.add(slot.id)
    delete value.status;delete value.note;delete value.reason;if(value.provenance){delete value.provenance.delivery_status;delete value.provenance.reason;delete value.provenance.exclusion_reason}
    changed.push(label)
  }
  for(const c of p.characters)for(const o of c.outfits){convert(o,c.key+'/'+o.key);for(const s of Object.values(p.slots))if(s.character===c.key&&s.outfit===o.key){convert(s,s.id)}}
  for(const s of Object.values(p.slots)){convert(s,s.id);if(s.waiting){(p.workflowWaits||={})[s.id]=s.waiting;delete s.waiting;changed.push(s.id)}if(Object.hasOwn(s,'note')||Object.hasOwn(s,'reason')||s.refusal){changed.push(s.id);if(s.refusal)(p.generationLog||=[]).push({slot:s.id,...s.refusal});delete s.note;delete s.reason;delete s.refusal}}
  if(removeIds.size){const delta=clearSlots(p,[...removeIds]);removedFiles.push(...delta.files);changed.push(...removeIds)}
  if(originalVersion===2&&!changed.length)return {idempotent:true,schemaVersion:2,reclaimedMedia:[]}
  p.migration120=true;p.revision++;validateProjectSchema(p)
  const reclaimedMedia=await reclaimableFiles(root,p,removedFiles)
  if(!dryRun){const lock=await safeProjectFile(root,'.write-lock'),h=await open(lock,'wx');try{requireValue(bytes.equals(await readFile(file)),'Project changed during migration');try{await writeFile(await safeProjectFile(root,'project.pre-120.backup.json'),bytes,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e};await atomic(root,'project.json',json(p))}finally{await h.close();await unlink(lock)}}
  if(!dryRun&&removedFiles.length)await cleanRemovedFiles(root,removedFiles)
  return {schemaVersion:2,dryRun,migrated:[...new Set(changed)],reclaimedMedia,warnings:[]}
}
export async function mergeProject(root,{file,sourceRoot,dryRun=false}) {
  const delta=JSON.parse(await readFile(file,'utf8'))
  if(delta.kind==='layered')return (await import('./layered.mjs')).mergeLayered(root,{delta,sourceRoot,dryRun})
  requireValue(delta.schema_version===1&&Array.isArray(delta.updates),'Invalid project delta')
  const images=new Map(),removedFiles=[],source=await loadProject(sourceRoot)
  for(const update of delta.updates)if(update.value?.artifact) {
    const s=update.value,raw=s.raw||s.artifact
    const sourceRaw=source.slots[s.id]?.raw||source.slots[s.id]?.artifact
    if(sourceRaw?.hash!==raw.hash||JSON.stringify(sourceRaw.generation)!==JSON.stringify(raw.generation))throw productionError('CONFLICT','Delta raw-image provenance differs from its source project')
    assertCandidateAdmission(source,s,sourceRoot)
    // Derived artifacts already bind their admitted raw image in the source project.
  }
  for(const update of delta.updates)for(const a of [update.value?.raw,update.value?.artifact].filter(Boolean)) {
    requireValue(a.path==='images/'+a.hash+'.png','Delta images must use content-addressed PNG paths')
    const bytes=await readFile(await safeProjectFile(sourceRoot,a.path));requireValue(hash(bytes)===a.hash,'Incoming content-addressed image changed')
    const size=pngSize(bytes,true);requireValue(size.width===a.width&&size.height===a.height,'Delta dimensions differ from decoded image');images.set(a.path,bytes)
  }
  const action=async p=>{
    requireValue(p.id===delta.project_id,'Different project identity')
    const conflicts=[],applied=[],seen=new Set()
    for(const u of delta.updates){requireValue(!p.slots[u.slot]?.installed&&!u.value?.installed,'Installed baseline slots are read-only; deltas fill open slots only');requireValue(!seen.has(u.slot),'Duplicate delta slot');seen.add(u.slot);const old=p.slots[u.slot];if(!old||JSON.stringify(old)===JSON.stringify(u.value))continue;if((old.version||0)!==u.expected_version)conflicts.push(u.slot)}
    requireValue(!conflicts.length,'Incremental conflicts: '+conflicts.join(', '))
    for(const u of delta.updates){const old=p.slots[u.slot];requireValue(old&&u.value?.id===u.slot&&u.value.kind===old.kind&&u.value.character===old.character&&u.value.outfit===old.outfit&&u.value.emotion===old.emotion&&u.value.frame===old.frame,'Delta cannot add/rename runtime identities or replace a whole index');if(JSON.stringify(old)===JSON.stringify(u.value))continue;requireValue(JSON.stringify(old.sourceBinding)===JSON.stringify(u.value.sourceBinding),'Delta cannot change mouth source binding; declare/rebind on the canonical project first');assertDeltaVersion(u);if(u.operation==='remove'){const removal=clearSlots(p,[u.slot]);removedFiles.push(...removal.files);requireValue(JSON.stringify(removal.updates[0].value)===JSON.stringify(u.value),'Invalid removal value')}else{invalidateDescendants(p,u.slot);p.slots[u.slot]=structuredClone(u.value)};applied.push(u.slot)}
    // Ordinary mouth deltas need the original version-bound plan, not just copied PNGs.
    const mouths=delta.updates.filter(u=>['mouth','blink'].includes(u.value?.kind)&&!u.value.sourceBinding&&u.value.artifact)
    if(mouths.some(u=>!p.plans[u.value.planId])) {
      const source=await loadProject(sourceRoot)
      requireValue(source.id===p.id,'Mouth plan source project differs')
      for(const {value:s} of mouths)if(!p.plans[s.planId]) {
        const plan=source.plans[s.planId]
        requireValue(plan?.slot===s.id&&plan.artifact?.hash===s.artifact.hash&&animationDependenciesCurrent(p,s,plan),'STALE_REFERENCES: imported mouth source version/hash changed: '+s.id)
        p.plans[s.planId]=structuredClone(plan)
      }
    }
    for(const {value:s} of delta.updates)if(s?.planId&&source.plans[s.planId]&&!p.plans[s.planId])p.plans[s.planId]=structuredClone(source.plans[s.planId])
    validateProjectSchema(p)
    if(!dryRun)for(const [relative,bytes]of images)await atomic(root,relative,bytes)
    return {applied,idempotent:!applied.length,dryRun,warnings:[]}
  }
  const result=dryRun?await action(structuredClone(await loadProject(root))):await transaction(root,action)
  if(!dryRun&&removedFiles.length)await cleanRemovedFiles(root,removedFiles)
  return result
}
