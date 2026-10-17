// private fork: portable authoring state, separate from installed packs and live profile data.
import path from 'node:path'
import {readFile,writeFile,appendFile,mkdir,rename,open,unlink,rm} from 'node:fs/promises'
import {checkedPath} from '../../packages/dsh-asset-library/lib/pack-v2/storage.js'
import {createHash,randomUUID} from 'node:crypto'
import {validateFigureEmotions,validateOutfitEmotions,figureDefaultEmotion} from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {pngSize,imageKind} from '../../packages/dsh-asset-library/lib/pack-v2/media.js'
import {validateUuid} from '../../packages/dsh-asset-library/lib/asset-packs/common.js'
import {sealNativePack,writeNativePack} from '../../packages/dsh-asset-library/lib/pack-v2/pack-source.js'
import {renderGeneration,admitGeneration,assertCandidateAdmission,historicalProvenance} from './asset-generation-receipt.js'
import {requestGeneration,generationBackend,prepareNativeGeneration} from '../../../tools/dsh-assets/generate.mjs'
import {assetOutput,assetPrerequisites,ASSET_REFERENCE_ROLES as roles} from './asset-production-contract.js'
import {checkAssetImage,cropAssetBackground,sliceAssetAvatarSheet} from './asset-image-processing.js'
import {normalizeAvatar,extractEyeRegion,measureMouthOpening} from './asset-production-quality.js'
import {chooseEditWindow,cropEditWindow,extractWindowPatch} from '../../../tools/dsh-assets/edit-window.mjs'
import {registerSprite,cropAvatar,extractProductionPatch} from './asset-production-images.js'
import {validateProjectSchema} from './asset-production-schema.js'
import {bakeHybridPreviews} from './hybrid-sprite-preview.js'
import hybrid from '../../packages/dsh-asset-library/lib/shared/hybrid-sprite.cjs'
import {hybridRuntimeClosure} from '../../packages/dsh-asset-library/lib/asset-packs/hybrid-closure.js'
import {spriteResourcePaths} from '../../packages/dsh-asset-library/lib/asset-packs/sprite.js'
import {slotDependencies,descendants,invalidateDescendants} from './asset-production-graph.js'
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n')
export function productionError(code,message,extra={}) {return Object.assign(new Error(message),{code,...extra})}
const requireValue=(ok,message,code='INVALID_ARGUMENT')=>{if(!ok)throw productionError(code,message)}
const slug=value=>{requireValue(typeof value==='string'&&/^[a-z][a-z0-9_-]{0,47}$/.test(value),'Keys must match [a-z][a-z0-9_-]{0,47}');return value}
const recall={mode:'constant',keywords:[]}
export async function safeProjectFile(root,relative,inspect) {
  requireValue(typeof relative==='string'&&!relative.includes('\\')&&!relative.split('/').some(p=>!p||p==='.'||p==='..')&&!path.isAbsolute(relative),'Unsafe project path')
  try {return await checkedPath(root,relative,inspect)} catch(error) {
    if(error.code==='INVALID_PATH')throw productionError('INVALID_ARGUMENT','Linked or unsafe project path rejected')
    throw error
  }
}
export async function atomic(root,relative,bytes) {
  const dest=await safeProjectFile(root,relative);await mkdir(path.dirname(dest),{recursive:true})
  const temp=dest+'.'+randomUUID()+'.tmp';await writeFile(temp,bytes,{flag:'wx'});await rename(temp,dest)
}
export async function loadProject(root) {
  const p=JSON.parse(await readFile(await safeProjectFile(root,'project.json'),'utf8'))
  requireValue(p.schemaVersion===2,'Unsupported project schema; v1 projects need explicit migration')
  let log=[],auditError,auditNeedsSeparator=false
  try {
    const text=await readFile(await safeProjectFile(root,'project-log.jsonl'),'utf8')
    auditNeedsSeparator=Boolean(text)&&!text.endsWith('\n')
    // Audit is not project state. A torn final line must not hide earlier complete entries.
    for(const line of text.split('\n').filter(line=>line.trim()))try {const entry=JSON.parse(line);if(entry&&typeof entry==='object'&&!Array.isArray(entry))log.push(entry)}catch {}
  }catch(e){if(e.code!=='ENOENT')auditError=e.code||e.message}
  Object.defineProperties(p,{framingLog:{value:log},auditError:{value:auditError},auditNeedsSeparator:{value:auditNeedsSeparator}})
  return validateProjectSchema(p)
}
export async function transaction(root, action, {log,afterCommit}={}) {
  const lock=await safeProjectFile(root,'.write-lock')
  let handle
  try {handle=await open(lock,'wx')} catch(e) {if(e.code==='EEXIST')throw productionError('CONFLICT','Project is busy or interrupted; inspect .write-lock and remove only after its process has stopped');throw e}
  try {
    await handle.writeFile(json({pid:process.pid,at:new Date().toISOString()}))
    const p=await loadProject(root)
    if(log&&p.auditError)throw productionError('CONFLICT','Cannot update project with unreadable audit log: '+p.auditError)
    const before=json(p),beforeContentHash=log?contentFingerprint(p):undefined,result=await action(p)
    if (!before.equals(json(p))) {
      const disk=await readFile(await safeProjectFile(root,'project.json'))
      requireValue(before.equals(json(JSON.parse(disk))),'External project edit detected; reload before writing','CONFLICT')
      p.revision++;validateProjectSchema(p);await atomic(root,'project.json',json(p))
      if(log)try {await appendFile(await safeProjectFile(root,'project-log.jsonl'),(p.auditNeedsSeparator?'\n':'')+JSON.stringify({action:log,revision:p.revision,beforeContentHash,afterContentHash:contentFingerprint(p),...result})+'\n')}catch {throw productionError('CONFLICT','Project changed, but project-log.jsonl could not be written; inspect the project and log before continuing',{outcome:'partial',exitCode:7})}
    }
    // Reconcile append-only audit even on project no-ops, while the same writer lock is held.
    if(afterCommit)await afterCommit(p,result)
    return result
  } finally {await handle.close();await unlink(lock)}
}
function slotAt(p,id) {const s=p.slots[id];requireValue(s,'Unknown slot: '+id,'NOT_FOUND');return s}
const group=(s,kind,emotion,frame)=>[s.character,s.outfit,kind,emotion,frame].filter(Boolean).join('/')
const occupied=(p,id)=>p.slots[id]?.artifact
export const mouthBase=(p,s)=>(s.kind==='blink'?p.blinkSources:p.mouthSources)?.[group(s,'sprite',s.emotion)]||occupied(p,group(s,'sprite',s.emotion))
const inputArtifact=(p,s,id)=>['mouth','blink'].includes(s.kind)&&id===group(s,'sprite',s.emotion)?mouthBase(p,s):occupied(p,id)
export function avatarParentStale(p,s) {
  const b=s.kind==='avatar'&&s.parentBinding,parent=b&&p.slots[b.slot]
  return Boolean(b&&(!parent||parent.version!==b.version||parent.artifact?.hash!==b.hash))
}
export function mouthSourceStale(p,s) {
  if(!s.sourceBinding)return false
  const source=mouthBase(p,s),base=p.slots[s.sourceBinding.slot]
  return !source||source.hash!==s.sourceBinding.hash||source.version!==s.sourceBinding.version||!base?.installed&&(base?.artifact?.hash!==source.hash||base?.version!==source.version)
}
const identityVersion=s=>hash(JSON.stringify({board:s.artifact.hash,palette:(s.palette||[]).map(({role,hex,zone})=>({role,hex,zone}))}))
const firstEmotion=(p,s)=>{const f=p.characters.find(c=>c.key===s.character);return figureDefaultEmotion(f,f?.outfits.find(o=>o.key===s.outfit))}
export const intentionalProductionFallback=(p,s)=>Boolean(s.emotion && p.characters.find(c=>c.key===s.character)?.outfits.find(o=>o.key===s.outfit)?.fallbackEmotions?.includes(s.emotion))
export function prerequisites(p,s) {
  if(s.refusal)return ['REFUSED']
  if(p.workflowWaits?.[s.id])return ['WAITING_EXTERNAL']
  if(slotDependencies(p,s).some(id=>p.workflowWaits?.[id]))return ['DEPENDENCY_WAITING']
  if(s.stale||mouthSourceStale(p,s))return ['STALE_REFERENCES']
  if(slotDependencies(p,s).some(id=>p.slots[id]?.stale||p.slots[id]?.refusal||productionRedoRequired(p.slots[id])))return ['STALE_REFERENCES']
  if(p.baseline?.scope==='images') {
    if(s.installed)return ['BASELINE_INSTALLED']
    if(['mouth','blink'].includes(s.kind)&&!mouthBase(p,s))return ['SPRITE_REQUIRED']
    const first=firstEmotion(p,s),base=p.slots[group(s,'sprite',first)],same=p.slots[group(s,'sprite',s.emotion)]
    if(s.kind==='sprite'&&s.emotion!==first&&!base?.artifact)return ['DEFAULT_SPRITE_REQUIRED']
    if(s.kind==='avatar'&&same&&!same.installed&&(!same.artifact||!same.registered))return ['SPRITE_REGISTRATION_REQUIRED']
    return []
  }
  if(!s.character||s.kind==='identity-settei')return []
  const identity=p.slots[s.character+'/identity-settei']
  if(!slotAccepted(identity)||identity.stale)return ['IDENTITY_SETTEI_REQUIRED']
  const settei=p.slots[group(s,'settei')],calm=occupied(p,group(s,'sprite',firstEmotion(p,s))),avatar=occupied(p,group(s,'avatar',firstEmotion(p,s))),same=occupied(p,group(s,'sprite',s.emotion))
  const gate=assetPrerequisites(s.kind,s.emotion,{settei:slotAccepted(settei),defaultEmotion:firstEmotion(p,s),defaultSprite:calm,defaultAvatar:avatar,sameSprite:same})
  if(gate)return [gate]
  if(['blink','mouth'].includes(s.kind)&&!same)return ['SPRITE_REQUIRED']
  if(['avatar','avatar-sheet','blink','mouth'].includes(s.kind)&&(!p.slots[group(s,'sprite',s.emotion||firstEmotion(p,s))]?.registered||p.slots[group(s,'sprite',s.emotion||firstEmotion(p,s))]?.registered.anchorHash!==p.slots[group(s,'sprite',firstEmotion(p,s))]?.raw?.hash))return ['SPRITE_REGISTRATION_REQUIRED']
  return []
}
function requiredReferences(p,s) {
  const refs=[]
  if(p.baseline?.scope==='images') {
    for(const ref of p.baseline.sources)if(ref.slot===s.character+'/identity-settei'){const {slot:sourceSlot,...image}=ref;refs.push({...image,sourceSlot,role:roles.identity})}
  }
  const add=(id,role)=>{const a=occupied(p,id);if(a&&!refs.some(r=>r.hash===a.hash))refs.push({...a,slot:id,role})}
  if(s.character&&s.kind!=='identity-settei')add(s.character+'/identity-settei',roles.identity)
  if(['sprite','avatar','avatar-sheet'].includes(s.kind))add(group(s,'settei'),roles.settei)
  if(s.kind==='avatar-sheet')add(group(s,'sprite',firstEmotion(p,s)),roles.sprite)
  if(s.kind==='avatar') {
    add(group(s,'sprite',s.emotion),roles.emotionSprite)
  }
  if(['mouth','blink'].includes(s.kind)&&(s.kind==='blink'?p.blinkSources:p.mouthSources)?.[group(s,'sprite',s.emotion)]){const a=mouthBase(p,s);refs.push({path:a.path,hash:a.hash,width:a.width,height:a.height,slot:group(s,'sprite',s.emotion),role:roles.base})}
  else if(['blink','mouth'].includes(s.kind))add(group(s,'sprite',s.emotion),roles.base)
  return refs
}
export const dependencyHash=(p,s)=>{
  if(['blink','mouth'].includes(s.kind)) {
    const id=group(s,'sprite',s.emotion),base=inputArtifact(p,s,id)
    return hash(JSON.stringify([id,base?.hash,s.sourceBinding?.version??p.slots[id]?.version]))
  }
  const refs=slotDependencies(p,s).map(id=>[id,inputArtifact(p,s,id)?.hash,p.slots[id]?.version,p.slots[id]?.accepted])
  return hash(JSON.stringify(s.sourceBinding?[s.sourceBinding,refs]:refs))
}
export function animationDependenciesCurrent(p,s,plan=p.plans[s.planId]) {
  if(['mouth','blink'].includes(s.kind)&&s.sourceBinding)return !mouthSourceStale(p,s)&&s.artifact?.baseHash===s.sourceBinding.hash
  if(!plan||plan.slot!==s.id)return false
  if(plan.dependencyHash===dependencyHash(p,s))return true
  // Pre-1.3.29 plans hashed approval metadata. Prove the original fingerprint at
  // current artifact versions, allowing only the two canonical approval states.
  const refs=slotDependencies(p,s).map(id=>[id,inputArtifact(p,s,id)?.hash,p.slots[id]?.version])
  let candidates=[[]]
  for(const ref of refs)candidates=candidates.flatMap(rows=>[undefined,ref[1]].map(accepted=>[...rows,[...ref,accepted]]))
  return candidates.some(rows=>plan.dependencyHash===hash(JSON.stringify(s.sourceBinding?[s.sourceBinding,rows]:rows)))
}
async function storeImage(root,bytes,kind,digest=hash(bytes)) {
  requireValue(bytes.length<=20*1024**2&&imageKind(bytes)==='png','Input must be a PNG no larger than 20 MiB')
  pngSize(bytes)
  const file='images/'+digest+'.png'
  await atomic(root,file,bytes)
  return {hash:digest,path:file,...checkAssetImage(bytes,['blink','mouth'].includes(kind)?'sprite':kind,{sheet:kind==='avatar-sheet'})}
}
// Authoring projects arrive from external producers; approval binds exact bytes.
export function createProjectImageReader(root) {
  const cache=new Map()
  return async a=>{
    let entry=cache.get(a.path)
    if(!entry){const bytes=await imageBytes(root,a);entry={bytes,hash:hash(bytes)};cache.set(a.path,entry)}
    requireValue(entry.hash===a.hash,'Image content changed: '+a.path,'CONFLICT')
    return entry.bytes
  }
}
async function imageBytes(root,a) {
  return readFile(await safeProjectFile(root,a.path))
}
export async function initProject(root,input) {
  requireValue(input&&Array.isArray(input.characters)&&input.characters.length<=64,'characters must be an array (max 64)')
  await safeProjectFile(root,'project.json');await mkdir(root,{recursive:true})
  const p={schemaVersion:2,id:input.id||randomUUID(),name:input.name||'Asset production',revision:0,characters:[],assets:[],slots:{},plans:{},reviews:[]}
  validateUuid(p.id)
  function add(s) {requireValue(!p.slots[s.id],'Duplicate slot '+s.id);p.slots[s.id]=s}
  for(const c of input.characters) {
    slug(c.key);requireValue(!p.characters.some(x=>x.key===c.key),'Duplicate character key')
    const figure={key:c.key,id:c.id||randomUUID(),name:c.name||c.key,identityAppearance:c.identityAppearance||'',emotions:structuredClone(c.emotions||[]),...(c.heightCm!==undefined?{heightCm:c.heightCm,...(c.heightConfirmed===true?{heightConfirmed:true}:{})}:{}),outfits:[]}
    validateUuid(figure.id);validateFigureEmotions(figure.emotions)
    requireValue(c.heightCm===undefined||Number.isFinite(c.heightCm)&&c.heightCm>0,'heightCm must be a positive supplied measurement')
    add({id:c.key+'/identity-settei',character:c.key,kind:'identity-settei',palette:c.palette||[]})
    for(const o of c.outfits||[{key:'default',label:'Default'}]) {
      slug(o.key);requireValue(!figure.outfits.some(x=>x.key===o.key),'Duplicate outfit key')
      validateOutfitEmotions(figure,o)
      const ids=figure.emotions.map(row=>row.id)
      requireValue(Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.every(id=>figure.emotions.some(e=>e.id===id)),'Every outfit image must name a figure declaration; a sole {id} entry has no differences')
      requireValue(o.status===undefined,'Outfit status is not supported; missing images remain missing')
      const outfit={key:o.key,label:o.label||o.key,...(o.geometry?{geometry:o.geometry}:{}),outfitAppearance:o.outfitAppearance||'',...(o.defaultEmotion?{defaultEmotion:o.defaultEmotion}:{}),...(o.fallbackEmotions?{fallbackEmotions:[...o.fallbackEmotions]}:{}),mouth:ids.length>0,eyesClosed:o.eyesClosed||[]}
      requireValue(outfit.eyesClosed.every(id=>ids.includes(id)),'eyesClosed must name configured emotions')
      figure.outfits.push(outfit)
      const base={character:c.key,outfit:o.key}
      add({...base,id:group(base,'settei'),kind:'settei'})
      for(const emotion of ids) {
        for(const kind of ['sprite','avatar',...(outfit.eyesClosed.includes(emotion)?[]:['blink'])])add({...base,emotion,kind,id:group(base,kind,emotion)})
        if(outfit.mouth)for(const frame of ['closed','small','mid','open'])add({...base,emotion,kind:'mouth',frame,id:group(base,'mouth',emotion,frame)})
      }
      if(o.avatarSheet===true)add({...base,kind:'avatar-sheet',optional:true,id:group(base,'avatar-sheet')})
    }
    p.characters.push(figure)
  }
  for(const [kind,rows]of [['background',input.backgrounds||[]],['cg',input.cgs||[]]])for(const a of rows) {
    slug(a.key);requireValue(typeof a.prompt==='string'&&a.prompt.trim(),'Scene requires prompt')
    p.assets.push({...a,kind});add({id:kind+'/'+a.key,kind,key:a.key,userPrompt:a.prompt})
  }
  validateProjectSchema(p)
  await writeFile(path.join(root,'project.json'),json(p),{flag:'wx'})
  return {project:path.resolve(root),id:p.id,slots:Object.keys(p.slots).length}
}
export async function preparePrompt(root,options) {
  return transaction(root,p=>preparePlan(p,root,options))
}
export async function preparePlan(p,root,{slot,note='',references=[],storedReferences=[],geometry,rect}) {
  const s=slotAt(p,slot),blocked=prerequisites(p,{...s,stale:false,refusal:null})
  requireValue(!blocked.length,blocked.join(', '),'PRECONDITION')
  const refs=requiredReferences(p,s)
  for(const ref of references) {
    requireValue(typeof ref.role==='string'&&ref.role.length<=300,'Reference requires a short role')
    refs.push({...await storeImage(root,await readFile(ref.file),'reference'),role:ref.role})
  }
  refs.push(...storedReferences)
  requireValue(refs.length<=4,'At most four references including required references')
  requireValue(typeof note==='string'&&note.length<=4000,'note must be at most 4000 characters')
  const figure=p.characters.find(c=>c.key===s.character),outfit=figure?.outfits.find(o=>o.key===s.outfit)
  let editWindow
  if(s.sourceBinding&&['blink','mouth'].includes(s.kind)) {
    const base=mouthBase(p,s),sourceBytes=await createProjectImageReader(root)({...base,hash:s.sourceBinding.hash})
    geometry??=outfit?.geometry||p.slots[group(s,'sprite',firstEmotion(p,s))]?.registered?.landmarks
    editWindow=chooseEditWindow({...base,...s.sourceBinding},s.kind,{geometry,rect})
    if(editWindow) {
      const ref=refs.find(r=>r.slot===s.sourceBinding.slot),crop=await storeImage(root,cropEditWindow(sourceBytes,editWindow),'reference')
      Object.assign(ref,{path:crop.path,hash:crop.hash,sourceHash:base.hash})
    }
  }
  const fields={kind:s.kind,figure,outfit,emotionId:s.emotion,frame:s.frame,userPrompt:[s.userPrompt,note].filter(Boolean).join('\n'),references:refs,...(editWindow?{editWindow}:{})}
  const generation=await renderGeneration(fields),prompt=generation.prompt
  const plan={id:randomUUID(),slot,targetVersion:s.version||0,dependencyHash:dependencyHash(p,s),prompt,references:refs.map(({path,hash,role,slot,sourceHash})=>({path,hash,role,...(slot?{slot}:{}),...(sourceHash?{sourceHash}:{})})),output:assetOutput(s.kind),generation,note,status:'prepared',createdAt:new Date().toISOString()}
  if(['blink','mouth'].includes(s.kind)){const base=mouthBase(p,s);plan.output.size=base.width+'x'+base.height}
  if(editWindow){plan.editWindow=editWindow;plan.output.size=editWindow.width+'x'+editWindow.height}
  if(s.sourceBinding)plan.sourceBinding=structuredClone(s.sourceBinding)
  p.plans[plan.id]=plan;return {...plan,project:path.resolve(root)}
}
export async function refreshPlan(root,{plan:planId,clearWait=false,geometry,rect,note}) {
  return transaction(root,async p=>{
    const previous=p.plans[planId];requireValue(previous,'Unknown plan','NOT_FOUND')
    const legacyWindow=previous.editWindow?.width===1024&&previous.editWindow?.height===1024
    requireValue(!previous.refreshedTo&&(previous.status==='prepared'||legacyWindow&&['requested','unknown','invalid'].includes(previous.status)),'Only a prepared plan or a requested legacy square-window plan can be refreshed','CONFLICT')
    const s=slotAt(p,previous.slot)
    const unresolved=Object.values(p.plans).find(r=>r.id!==previous.id&&!r.refreshedTo&&r.slot===s.id&&['requested','unknown','refused','invalid'].includes(r.status)&&(r.targetVersion||0)===(s.version||0))
    requireValue(!unresolved,'Unresolved request for slot: '+unresolved?.id+'; inspect status and resolve that request before refreshing','PRECONDITION')
    const clearedWait=p.workflowWaits?.[s.id]||null
    if(clearWait){requireValue(clearedWait,'No external wait recorded for this slot','PRECONDITION');delete p.workflowWaits[s.id]}
    const refreshed=await preparePlan(p,root,{slot:s.id,note:note??previous.note??'',storedReferences:previous.references.filter(r=>!r.slot),geometry:geometry??previous.editWindow?.geometry,rect:rect??previous.editWindow?.rect})
    if(previous.status==='prepared')previous.status='superseded'
    previous.refreshedTo=refreshed.id
    p.plans[refreshed.id].refreshedFrom=previous.id
    if(clearWait)p.plans[refreshed.id].clearedWait=clearedWait
    return {...refreshed,refreshedFrom:previous.id,clearedWait:clearWait?clearedWait:null,nextAction:'generate-or-import',warnings:[{code:'PLAN_REFRESHED',severity:'warning',message:'New plan bound to current dependencies; old plan superseded. Recheck candidate alignment before import; no request or approval performed.'}]}
  })
}
async function avatarReference(p,root,s,geometry) {
  const framing=p.characters.find(c=>c.key===s.character)?.avatarFraming
  if(!framing)return
  const id=group(s,'avatar',firstEmotion(p,s)),source=p.baseline?.sources.find(r=>r.slot===id)
  requireValue(source,'match-reference requires the installed default avatar in the images baseline: '+id,'PRECONDITION')
  requireValue(geometry?.referenceHeadRect,'Supply measured referenceHeadRect in --geometry (installed default source pixels); no inferred anatomy','PRECONDITION')
  return {bytes:await imageBytes(root,source),geometry:{headRect:geometry.referenceHeadRect},tolerance:framing.tolerance,slot:id,hash:source.hash}
}
const SOURCE_DERIVED=Symbol('source-derived')
export async function deriveSourceFrame(root,options) {
  requireValue(Object.keys(options).every(key=>['plan','rect','geometry','replace','json','project'].includes(key)),'Source derivation accepts only a plan and ROI options; no external image or receipt')
  return transaction(root,async p=>{
    const plan=p.plans[options.plan];requireValue(plan,'Unknown plan','NOT_FOUND')
    const s=slotAt(p,plan.slot)
    requireValue(s.kind==='mouth','Source derivation requires a mouth frame plan','PRECONDITION')
    const source=mouthBase(p,s),id=group(s,'sprite',s.emotion),parent=p.slots[id]
    requireValue(source&&(s.sourceBinding||parent?.registered)&&!mouthSourceStale(p,s),'Current registered group source required','PRECONDITION')
    const binding={slot:id,version:source.version??parent.version,hash:source.hash}
    requireValue(!s.sourceBinding||JSON.stringify(s.sourceBinding)===JSON.stringify(binding),'Source binding changed','CONFLICT')
    requireValue(plan.status==='prepared'||plan.status==='imported'&&plan.source==='source-derived','Use a fresh unrequested plan for source derivation','CONFLICT')
    requireValue(plan.status!=='imported'||s.planId===plan.id,'Frame changed since this derivation; use a fresh plan','CONFLICT')
    const original=await imageBytes(root,source),bytes=plan.editWindow?cropEditWindow(original,plan.editWindow):original
    const proof={kind:'source-derived',slot:s.id,source:binding}
    return ingest(p,root,plan,bytes,{...options,source:'source-derived',generatedHash:hash(bytes),[SOURCE_DERIVED]:proof,order:'closed,small,mid,open'})
  })
}
export async function ingest(p,root,plan,bytes,options) {
  const s=slotAt(p,plan.slot)
  if(options.order!==undefined)requireValue(s.kind==='mouth'&&options.order==='closed,small,mid,open','--order is only supported for mouth plans')

  if(plan.status==='imported') { requireValue((options.generatedHash||hash(bytes))===plan.rawHash,'This plan already ingested different bytes; prepare a new prompt','CONFLICT');return {planId:plan.id,slot:s.id,artifact:plan.artifact,idempotent:true} }
  requireValue(plan.status!=='superseded'&&!plan.refreshedTo,'Plan superseded; use its refreshedTo plan ID','CONFLICT')
  requireValue(!prerequisites(p,{...s,stale:false,refusal:null}).length&&plan.dependencyHash===dependencyHash(p,s),'Plan dependencies changed or blocked; inspect status and use refresh-plan for an unrequested plan','CONFLICT')
  requireValue((plan.targetVersion||0)===(s.version||0),'Slot version changed after prompt; prepare a new plan','CONFLICT')
  if(plan.editWindow||['blink','mouth'].includes(s.kind)) {
    const size=pngSize(bytes),canvas=plan.editWindow||mouthBase(p,s)
    if(size.width!==canvas.width||size.height!==canvas.height)throw productionError('PRECONDITION',
      `Import requires exactly ${canvas.width}x${canvas.height}; received ${size.width}x${size.height}. Native finalize records pixels, not canvas compliance; never resize/resample the PNG.`,
      {nextAction:`Keep the raw PNG and receipt. This source-bound edit needs an original ${canvas.width}x${canvas.height} canvas. If unavailable, record the blocker: node bin/dsh-assets.mjs wait --project ${JSON.stringify(root)} --slot ${JSON.stringify(s.id)} --waiting-on exact-canvas --note "Need original ${canvas.width}x${canvas.height} output; native tool cannot guarantee dimensions" --json. Use a canvas-capable backend only on a new authorized plan; do not replay this request or resize the raw.`})
  }
  const digest=options.generatedHash||hash(bytes)
  const receipt=options[SOURCE_DERIVED]?null:await admitGeneration({file:options.file,hash:digest,plan,root,receipt:options.generationReceipt,historical:historicalProvenance(p,digest),provenance:options.provenance})
  const raw=await storeImage(root,bytes,s.kind,digest)
  if(receipt)raw.generation=receipt
  if(receipt?.generator)await atomic(root,raw.path+'.receipt.json',json(receipt))
  let artifact=raw
  const figure=p.characters.find(c=>c.key===s.character),outfit=figure?.outfits.find(o=>o.key===s.outfit),geometry=s.kind==='avatar'?options.geometry:options.geometry||plan.editWindow?.geometry||outfit?.geometry||p.slots[group(s,'sprite',firstEmotion(p,s))]?.registered?.landmarks
  if(s.kind==='avatar'){
    const reference=await avatarReference(p,root,s,geometry)
    const result=normalizeAvatar(bytes,reference?'1024x1024':plan.output.size,geometry,reference)
    artifact={...await storeImage(root,result.bytes,'avatar'),warnings:[...raw.warnings,...result.warnings],redo:result.redo,geometry:result.geometry,qa:result.qa,resizeCount:result.resizeCount}
  }
  // Imports preserve original pixels; any crop/registration is a separate explicit operation.
  if(['blink','mouth'].includes(s.kind)) {
    const base=mouthBase(p,s)
    requireValue(s.sourceBinding||p.slots[group(s,'sprite',s.emotion)].registered,'Register the sprite before making patches','PRECONDITION')
    if(s.kind==='blink'&&p.characters.find(c=>c.key===s.character)?.emotions?.find(row=>row.id===s.emotion)?.protectTears)requireValue(Array.isArray(geometry?.eyeMasks)&&Array.isArray(geometry?.tearMasks)&&geometry.tearMasks.length>0,'Crying blink requires per-eye eyeMasks and measured tearMasks to preserve tears','PRECONDITION')
    if(plan.editWindow) {
      requireValue(JSON.stringify(plan.editWindow.source)===JSON.stringify(s.sourceBinding),'Edit window source changed; refresh-plan with current measurements','CONFLICT')
      requireValue((!options.geometry||JSON.stringify(options.geometry)===JSON.stringify(plan.editWindow.geometry))&&(!options.rect||JSON.stringify(options.rect)===JSON.stringify(plan.editWindow.rect)),'Window ROI is frozen in the plan; refresh-plan to change full-source geometry','PRECONDITION')
    }
    const result=plan.editWindow?extractWindowPatch(await imageBytes(root,base),bytes,s.kind,plan.editWindow):s.kind==='blink'?extractEyeRegion(await imageBytes(root,base),bytes,geometry):extractProductionPatch(await imageBytes(root,base),bytes,s.kind,options.rect,geometry)
    artifact={...await storeImage(root,result.bytes,'patch'),rect:result.rect,...(result.blend?{blend:result.blend}:{}),baseHash:base.hash,warnings:result.warnings,...(s.kind==='mouth'?{opening:measureMouthOpening(result.bytes,geometry?.mouth)}:{})}
  }
  if(options[SOURCE_DERIVED])raw.provenance={...options[SOURCE_DERIVED],hash:raw.hash,artifactHash:artifact.hash,rect:artifact.rect,geometry:structuredClone(geometry||null),editWindow:plan.editWindow||null}
  if(s.artifact&&s.artifact.hash!==artifact.hash)requireValue(options.replace===true,'Slot already has an image; pass --replace','CONFLICT')
  if(!options[SOURCE_DERIVED]&&s.raw?.hash===raw.hash&&!s.stale&&s.artifact?.hash===artifact.hash&&s.artifact?.redo===artifact.redo&&s.artifact?.blend===artifact.blend&&JSON.stringify(s.artifact?.geometry)===JSON.stringify(artifact.geometry)&&JSON.stringify(s.artifact?.rect)===JSON.stringify(artifact.rect)) {
    plan.status='imported';plan.rawHash=raw.hash;plan.artifact=s.artifact
    return {planId:plan.id,slot:s.id,artifact:s.artifact,idempotent:true}
  }
  if(s.kind==='sprite')delete s.registered
  if(s.kind==='avatar'){delete s.parentBinding;delete s.rebindReview;delete s.previousAcceptance}
  if(s.artifact?.hash!==artifact.hash||s.stale)invalidateDescendants(p,s.id)
  if(options[SOURCE_DERIVED])for(const key of ['accepted','acceptedVersion','acceptedBy','approved'])delete s[key]
  if(['identity-settei','settei'].includes(s.kind))delete s.accepted
  s.version=(s.version||0)+1;delete s.stale;delete s.refusal
  if(s.kind==='settei')s.parentVersion=identityVersion(p.slots[s.character+'/identity-settei'])
  s.raw=raw;s.artifact=artifact;s.planId=plan.id;s.inputs=plan.references.filter(r=>r.slot).map(r=>({slot:r.slot,hash:r.sourceHash||r.hash}))
  if(s.kind==='avatar') {
    const parent=p.slots[group(s,'sprite',s.emotion)]
    if(parent?.artifact)s.parentBinding={slot:parent.id,version:parent.version,hash:parent.artifact.hash}
  }
  if(s.kind==='avatar-sheet') {
    const ids=figure.emotions.map(row=>row.id).filter(id=>!outfit.fallbackEmotions?.includes(id)),slices=sliceAssetAvatarSheet(bytes,ids)
    for(const [emotion,part]of Object.entries(slices)) {
      const target=p.slots[group(s,'avatar',emotion)]
      if(target) {requireValue(!target.artifact||options.replace,'Sheet would overwrite an avatar; pass --replace','CONFLICT');target.artifact=await storeImage(root,part,'avatar');target.raw=target.artifact;target.raw.generation={kind:'derived',hash:target.raw.hash,sourceHash:raw.hash};target.inputs=s.inputs}
    }
  }
  plan.status='imported';plan.source=options.source||'external-tool';plan.rawHash=raw.hash;plan.artifact=artifact;plan.completedAt=new Date().toISOString()
  const orderWarnings=s.kind==='mouth'?await orderMouthFrames(p,root,s,{order:options.order}):[]
  return {planId:plan.id,slot:s.id,artifact,warnings:[...(artifact.warnings||[]),...orderWarnings]}
}
export async function orderMouthFrames(p,root,s,{order}={}) {
  const labels=['closed','small','mid','open'],slots=labels.map(frame=>p.slots[group(s,'mouth',s.emotion,frame)]),key=[s.character,s.outfit,s.emotion].join('/')
  if(order!==undefined){requireValue(order===labels.join(','),'--order must be closed,small,mid,open');p.mouthOrders||={};p.mouthOrders[key]=order}
  if(slots.some(slot=>!slot?.artifact))return []
  for(const slot of slots)if(slot.artifact.opening?.method!=='skin-distance-v1')slot.artifact.opening=measureMouthOpening(await imageBytes(root,slot.artifact))
  const compare=(a,b)=>a.artifact.opening.opening-b.artifact.opening.opening||a.artifact.opening.area-b.artifact.opening.area
  const ordered=[...slots].sort(compare),disagrees=ordered.some((slot,i)=>slot!==slots[i])
  const warnings=slots.flatMap(slot=>slot.artifact.opening.warnings||[]),explicit=Boolean(p.mouthOrders?.[key]),uncertain=slots.some(slot=>slot.artifact.opening.confident===false)
  if(explicit&&disagrees)warnings.push({code:'MOUTH_ORDER_DISAGREES',severity:'warning',message:'Explicit file order retained; aperture height/area is not monotonic. Human review required; no silent reorder.'})
  if(!explicit&&!uncertain&&disagrees) {
    warnings.push({code:'MOUTH_RELABELLED',severity:'warning',message:'Frames relabelled by skin-distance/lip-boundary aperture height then area; original pixels and source slots retained'})
    for(let i=0;i<slots.length;i++){const source=ordered[i],target=slots[i];p.slots[target.id]={...source,id:target.id,frame:target.frame,version:Math.max(...slots.map(s=>s.version||0))+1,provenance:{...source.provenance,source_slot:source.provenance?.source_slot||source.id}}}
  }
  if(ordered.some((slot,i)=>i&&slot.artifact.opening.opening===ordered[i-1].artifact.opening.opening))warnings.push({code:'MOUTH_OPENING_AMBIGUOUS',severity:'warning',message:'Measured openings tie; review mouth ROI/skin reference manually, no regeneration'})
  const unique=[...new Map(warnings.map(w=>[w.code+'|'+w.message,w])).values()]
  for(const slot of slots)p.slots[slot.id].artifact={...p.slots[slot.id].artifact,warnings:[...(p.slots[slot.id].artifact.warnings||[]).filter(w=>!w.code.startsWith('MOUTH_')),...unique]}
  return unique
}
export async function importImage(root,options) {
  if(options.order!==undefined)requireValue(options.order==='closed,small,mid,open'&&options.plan,'--order requires a mouth plan and closed,small,mid,open')
  requireValue(Boolean(options.plan)!==Boolean(options.slot),'Specify exactly one of --plan or --slot')
  const bytes=await readFile(options.file)
  if(options.slot)return transaction(root,async p=>{
    const s=slotAt(p,options.slot)
    requireValue(s.kind==='sprite'&&!s.installed,'Direct local fills support open sprite slots; installed baseline slots are read-only','PRECONDITION')

    requireValue(!p.workflowWaits?.[s.id]&&!s.refusal,'Resolve the recorded wait/refusal before importing','PRECONDITION')
    const digest=hash(bytes),receipt=await admitGeneration({file:options.file,hash:digest,root,historical:historicalProvenance(p,digest),provenance:options.provenance})
    const raw=await storeImage(root,bytes,s.kind,digest);raw.generation=receipt
    await atomic(root,raw.path+'.receipt.json',json(receipt))
    if(s.raw?.hash===raw.hash)return {slot:s.id,artifact:s.artifact,idempotent:true}
    requireValue(!s.artifact||options.replace===true,'Slot already has an image; pass --replace','CONFLICT')
    invalidateDescendants(p,s.id);delete s.registered;delete s.planId;delete s.stale
    s.version=(s.version||0)+1;s.raw=raw;s.artifact=raw;s.inputs=[]
    s.provenance={...s.provenance,source:options.source||'external-tool',imported_at:new Date().toISOString(),local_fill:true}
    return {slot:s.id,artifact:raw,registered:false,nextAction:'register',warnings:raw.warnings}
  })
  return transaction(root,async p=>{const plan=p.plans[options.plan];requireValue(plan,'Unknown plan','NOT_FOUND');return ingest(p,root,plan,bytes,options)})
}
export async function generateImage(root,options,env=process.env) {
  if(options.order!==undefined)requireValue(options.order==='closed,small,mid,open','--order must be closed,small,mid,open')
  requireValue(options.confirm===true,'generate requires --confirm (one paid request)','PRECONDITION')
  if(!options.prepare)generationBackend(env)
  const plan=await transaction(root,async p=>{
    const plan=p.plans[options.plan];requireValue(plan,'Unknown plan','NOT_FOUND')
    requireValue(plan.status!=='superseded'&&!plan.refreshedTo,'Plan superseded; use its refreshedTo plan ID','CONFLICT')
    if(plan.status!=='prepared')return {...plan,replay:true}
    requireValue(plan.generation,'This historical plan has no structured fields; use refresh-plan before a new generation. Existing raw images still use import.','PRECONDITION')
    const s=slotAt(p,plan.slot);if(options.order!==undefined)requireValue(s.kind==='mouth','--order requires a mouth plan');requireValue(!prerequisites(p,{...s,stale:false,refusal:null}).length&&plan.dependencyHash===dependencyHash(p,s)&&(plan.targetVersion||0)===(s.version||0),'Stale plan','CONFLICT')
    // Stored prompt text is display-only; only structured fields can reach the backend.
    plan.generation=await renderGeneration(plan.generation.fields);plan.prompt=plan.generation.prompt
    plan.status='unknown';plan.requestedAt=new Date().toISOString();return structuredClone(plan)
  })
  if(plan.replay) {
    if(plan.status==='unknown')throw productionError('GENERATION_FAILED','This plan has an unknown request outcome; reconcile received bytes through import, never replay the request',{outcome:'unknown',exitCode:7})
    return {planId:plan.id,status:plan.status,idempotent:true}
  }
  let received=false
  try {
    const referenceImages=await Promise.all(plan.generation.references.map(async a=>({data:await imageBytes(root,a),mediaType:'image/png'})))
    const file=await safeProjectFile(root,'received/'+plan.id+'.png')
    if(options.prepare)return {...await prepareNativeGeneration({request:plan.generation,file,output:plan.output,referencePaths:await Promise.all(plan.generation.references.map(r=>safeProjectFile(root,r.path))),confirm:options.confirm}),planId:plan.id}
    const result=await requestGeneration({request:plan.generation,file,referenceImages,output:plan.output,confirm:options.confirm,env});received=true
    return await transaction(root,p=>ingest(p,root,p.plans[plan.id],result.bytes,{...options,file,source:'local-endpoint',generatedHash:result.hash,generationReceipt:result.receipt}))
  } catch(e) {
    const invalid=received&&e.code==='PRECONDITION',code=invalid?'PRECONDITION':['IMAGE_REFUSED','IMAGE_NO_RESULT'].includes(e.code)?e.code:'GENERATION_FAILED',outcome=invalid||e.outcome==='not_applied'?'not_applied':'unknown'
    await transaction(root,p=>{p.plans[plan.id].status=invalid?'invalid':outcome==='unknown'?'unknown':'refused';p.plans[plan.id].error=code})
    throw productionError(code,'Request did not produce an installed candidate. Inspect status and received/'+plan.id+'.png before preparing another request.',{outcome,exitCode:outcome==='unknown'?7:1})
  }
}
export function contentFingerprint(p) {return hash(JSON.stringify({id:p.id,name:p.name,characters:p.characters,assets:p.assets,slots:p.slots,...(p.layered?{layered:p.layered}:{}),...(p.mouthOrders?{mouthOrders:p.mouthOrders}:{}),...(p.mouthSources?{mouthSources:p.mouthSources}:{}),...(p.blinkSources?{blinkSources:p.blinkSources}:{}),...(p.baseline?{baseline:p.baseline}:{}),...(p.addedFigures?{addedFigures:p.addedFigures}:{})}))}
// Policy changes do not revoke human decisions about unchanged pixels.
export function reviewMatchesContent(p) {
  let current=contentFingerprint(p)
  if(p.review?.contentHash===current)return true
  for(const event of [...(p.framingLog||[])].reverse())if(event.action==='figure-framing'&&event.afterContentHash===current) {
    current=event.beforeContentHash
    if(p.review?.contentHash===current)return true
  }
  return false
}
const reviewableAvatarWarnings=new Set(['AVATAR_HEAD_SCALE','AVATAR_HEADROOM','AVATAR_CENTER','AVATAR_SIDE_HAIR','AVATAR_NECK_SHOULDERS','AVATAR_ASPECT_RATIO','AVATAR_REFERENCE_DELTA'])
function avatarWarningsReviewable(s) {
  const qa=s?.artifact?.qa
  return s?.kind==='avatar'&&qa?.pass===false&&qa.warnings?.length>0&&qa.warnings.every(w=>w.severity==='warning'&&reviewableAvatarWarnings.has(w.code))
}
function avatarWarningAccepted(s) {
  const approval=s?.warningAcceptance
  return avatarWarningsReviewable(s)&&slotAccepted(s)&&approval?.hash===s.artifact.hash&&approval.version===s.version&&Boolean(approval.reviewer&&approval.reason)&&JSON.stringify(approval.qa)===JSON.stringify(s.artifact.qa)
}
// Preserve numeric evidence; only a current, explicit reviewer record resolves composition redo.
export const productionRedoRequired=s=>Boolean(s?.artifact?.redo)&&!avatarWarningAccepted(s)
export const slotAccepted=s=>Boolean(s?.artifact)&&s.accepted===s.artifact.hash&&(s.acceptedVersion===undefined?['identity-settei','settei'].includes(s.kind):s.acceptedVersion===s.version)
export function productionDependencyClosure(p,s,seen=new Set()) {
  if(seen.has(s.id))return seen
  seen.add(s.id)
  for(const id of [...slotDependencies(p,s),...(s.inputs||[]).map(r=>r.slot)])if(p.slots[id])productionDependencyClosure(p,p.slots[id],seen)
  return seen
}
export function productionDependencyReasons(p,s,pending=new Map(productionProgress(p).pending.map(r=>[r.slot,r.reasons]))) {
  const reasons=[]
  for(const id of productionDependencyClosure(p,s)) {
    const blocked=[...(pending.get(id)||[]),...prerequisites(p,p.slots[id]).filter(r=>r!=='BASELINE_INSTALLED')]
    reasons.push(...blocked.map(r=>id===s.id?r:'DEPENDENCY:'+id+':'+r))
  }
  return [...new Set(reasons)]
}
export async function rebindProductionAvatar(root,{slot,parentVersion,reviewer,acceptedProject}) {
  requireValue(typeof reviewer==='string'&&reviewer.trim()&&reviewer.length<=160,'Name the human reviewer')
  requireValue(parentVersion!==undefined&&String(parentVersion).length,'Name the accepted parent version')
  const historical=acceptedProject?await loadProject(acceptedProject):null
  return transaction(root,async p=>{
    const s=slotAt(p,slot)
    requireValue(s.kind==='avatar'&&s.artifact&&!s.installed,'Rebind supports candidate avatar slots only','PRECONDITION')
    const parent=slotAt(p,group(s,'sprite',s.emotion))
    requireValue(String(parent.version)===String(parentVersion)&&slotAccepted(parent)&&!parent.stale,'Parent version must be current and accepted','PRECONDITION')
    const bytes=await imageBytes(root,s.artifact)
    requireValue(hash(bytes)===s.artifact.hash,'Avatar bytes changed','CONFLICT')
    requireValue(hash(await imageBytes(root,parent.artifact))===parent.artifact.hash,'Parent bytes changed','CONFLICT')
    let evidence=slotAccepted(s)?{hash:s.accepted,version:s.acceptedVersion,reviewer:s.acceptedBy}:s.previousAcceptance
    if(historical) {
      const old=historical.slots[slot]
      requireValue(historical.id===p.id&&old?.kind==='avatar'&&slotAccepted(old)&&!old.stale&&old.acceptedBy,'Historical project must contain canonical accepted avatar evidence','PRECONDITION')
      requireValue(hash(await imageBytes(acceptedProject,old.artifact))===old.accepted,'Historical accepted bytes changed','CONFLICT')
      evidence={hash:old.accepted,version:old.acceptedVersion,reviewer:old.acceptedBy}
    }
    requireValue(evidence?.hash===s.artifact.hash&&evidence.version===s.version&&evidence.reviewer,'No matching previous acceptance; supply --accepted-project with the historical accepted project','PRECONDITION')
    requireValue(s.artifact.qa?.pass!==false,'Avatar QA requires resolution','PRECONDITION')
    // QA/crop references are not rewritten: a changed source needs its own recheck.
    const qaReference=s.artifact.qa?.reference
    requireValue(!qaReference?.slot||qaReference.slot!==parent.id||qaReference.hash===parent.artifact.hash,'Avatar QA source changed; recheck before rebinding','PRECONDITION')
    requireValue(!s.artifact.baseHash||s.artifact.baseHash===parent.artifact.hash,'Avatar crop source changed; recheck before rebinding','PRECONDITION')
    const binding={slot:parent.id,version:parent.version,hash:parent.artifact.hash}
    const idempotent=!s.stale&&slotAccepted(s)&&JSON.stringify(s.parentBinding)===JSON.stringify(binding)
    if(!idempotent) {
      s.inputs=(s.inputs||[]).filter(r=>r.slot!==parent.id).concat({slot:parent.id,hash:parent.artifact.hash,version:parent.version})
      s.parentBinding=binding
      s.rebindReview={reviewer,previousAcceptance:evidence,parent:binding,at:new Date().toISOString()}
      s.accepted=evidence.hash;s.acceptedVersion=s.version;s.acceptedBy=reviewer;delete s.stale
    }
    const blocked=productionDependencyReasons(p,s)
    requireValue(!blocked.length,'Avatar dependency closure blocked: '+blocked.join(', '),'PRECONDITION')
    return {slot,accepted:s.accepted,version:s.version,parent:binding,reviewer:s.acceptedBy,idempotent}
  })
}
export async function acceptProduction(root,{slot,review,reviewer,acceptWarning}) {
  requireValue(typeof reviewer==='string'&&reviewer.trim()&&reviewer.length<=160,'Name the human reviewer')
  requireValue(!(slot&&review),'Choose --slot or --review, not both')
  if(acceptWarning!==undefined)requireValue(!review&&typeof acceptWarning==='string'&&acceptWarning.trim()&&acceptWarning.length<=1000,'--accept-warning requires per-slot acceptance and a nonempty reason (max 1000 characters)')
  return transaction(root,async p=>{
    if(review) {
      requireValue(p.review?.hash===review&&reviewMatchesContent(p),'Review is absent or stale','CONFLICT')
      requireValue(hash(await readFile(await safeProjectFile(root,p.review.path)))===review,'Review HTML was modified','CONFLICT')
      await compileProduction(root)
      for(const s of Object.values(p.slots))if(s.artifact&&!s.installed) {
        s.approved=s.artifact.hash;s.accepted=s.artifact.hash;s.acceptedVersion=s.version;s.acceptedBy=reviewer
      }
      p.review.contentHash=contentFingerprint(p);p.review.acceptedBy=reviewer;p.review.acceptedAt=new Date().toISOString()
      return p.review
    }
    const ids=[...new Set((Array.isArray(slot)?slot:[slot]).flatMap(id=>typeof id==='string'?id.split(',').map(v=>v.trim()):[]))]
    requireValue(ids.length&&ids.every(Boolean),'Name at least one --slot')
    const slots=ids.map(id=>{
      const s=slotAt(p,id)
      requireValue(['identity-settei','settei','sprite','avatar','mouth','blink'].includes(s.kind),'Per-slot acceptance supports identity/settei, sprite, avatar, mouth and blink slots: '+id,'PRECONDITION')
      requireValue(s.artifact&&!s.installed,'No candidate for '+id+'; import a candidate image before accepting this slot','PRECONDITION')
      requireValue(!['mouth','blink'].includes(s.kind)||!mouthSourceStale(p,s)&&!prerequisites(p,s).length,'Candidate dependencies are not current: '+id,'PRECONDITION')
      if(['blink','mouth'].includes(s.kind)) {
        const base=mouthBase(p,s)
        requireValue(animationDependenciesCurrent(p,s)&&s.artifact.baseHash===base?.hash,'Animation source version/hash changed: '+id,'PRECONDITION')
        requireValue(!s.artifact.redo&&s.artifact.qa?.pass!==false,'Animation QA requires resolution: '+id,'PRECONDITION')
      }
      requireValue(!s.stale&&!p.workflowWaits?.[s.id],'Candidate is stale or waiting: '+id+'; resolve status and refresh the candidate before accepting','PRECONDITION')
      if(acceptWarning!==undefined) {
        requireValue(avatarWarningsReviewable(s),'Only measured avatar composition warnings can be accepted; missing anatomy or integrity failures require correction','PRECONDITION')
        requireValue(!avatarQaNeedsRecheck(p,s)&&!avatarParentStale(p,s)&&!prerequisites(p,s).length&&!(s.inputs||[]).some(r=>inputArtifact(p,s,r.slot)?.hash!==r.hash),'Avatar QA or dependencies are stale; recheck before accepting warnings','PRECONDITION')
      }
      assertCandidateAdmission(p,s,root)
      return s
    })
    const results=slots.map(s=>{
      // Explicit accept is the only migration of approved-only or unversioned legacy records.
      const idempotent=slotAccepted(s)&&s.acceptedVersion===s.version&&(acceptWarning===undefined||avatarWarningAccepted(s)&&s.warningAcceptance.reason===acceptWarning.trim()&&s.warningAcceptance.reviewer===reviewer)
      if(acceptWarning!==undefined&&!idempotent)s.warningAcceptance={hash:s.artifact.hash,version:s.version,reviewer,reason:acceptWarning.trim(),at:new Date().toISOString(),qa:structuredClone(s.artifact.qa)}
      if(!idempotent){s.accepted=s.artifact.hash;s.acceptedBy=reviewer;s.acceptedVersion=s.version}
      return {slot:s.id,accepted:s.artifact.hash,version:s.version,reviewer:s.acceptedBy||p.review?.acceptedBy||reviewer,...(s.warningAcceptance?{warningAcceptance:s.warningAcceptance}:{}),idempotent}
    })
    return results.length===1?results[0]:{slots:results,idempotent:results.every(r=>r.idempotent)}
  })
}
export async function registerProduction(root,{slot,landmarks,anchorLandmarks,poseException}) {
  return transaction(root,async p=>{
    const s=slotAt(p,slot);requireValue(s.kind==='sprite'&&s.raw&&!s.installed,'Imported open sprite required','PRECONDITION')
    assertCandidateAdmission(p,s,root)
    const anchor=p.slots[group(s,'sprite',firstEmotion(p,s))];requireValue(anchor?.raw,'Default variant sprite required','PRECONDITION')
    if(poseException) {
      requireValue(typeof poseException==='string'&&poseException.length>=8&&poseException.length<=1000,'Describe legitimate head tilt, raised arms, bent knees or seated pose')
      const warnings=[{code:'POSE_EXCEPTION',severity:'warning',message:poseException}]
      if(s.artifact?.hash!==s.raw.hash){invalidateDescendants(p,s.id);s.version=(s.version||0)+1}
      s.artifact=s.raw;s.registered={poseException,anchorHash:anchor.raw.hash,warnings}
      if(s.provenance?.local_fill){delete s.stale;s.inputs=requiredReferences(p,s).filter(r=>r.slot).map(r=>({slot:r.slot,hash:r.hash}))}
      return {slot,registered:s.registered,warnings}
    }
    const result=registerSprite(await imageBytes(root,s.raw),await imageBytes(root,anchor.raw),landmarks,anchorLandmarks)
    const next=await storeImage(root,result.bytes,'sprite')
    if(s.artifact?.hash!==next.hash) {invalidateDescendants(p,s.id);s.version=(s.version||0)+1}
    s.artifact=next;s.registered={...result.transform,anchorHash:anchor.raw.hash,landmarks,anchorLandmarks,warnings:result.warnings}
    if(s.provenance?.local_fill){delete s.stale;s.inputs=requiredReferences(p,s).filter(r=>r.slot).map(r=>({slot:r.slot,hash:r.hash}))}
    return {slot,artifact:s.artifact,registered:s.registered,warnings:result.warnings}
  })
}
export async function cropProductionAvatar(root,{slot,rect}) {
  return transaction(root,async p=>{
    const s=slotAt(p,slot);requireValue(s.kind==='avatar'&&s.raw&&!s.installed,'Imported open avatar required','PRECONDITION')
    const source=s.artifact.geometry?.headRect,[x,y,w,h]=rect,side=Math.max(w,h),geometry=source?{headRect:[source[0]-x+Math.floor((side-w)/2),source[1]-y+Math.floor((side-h)/2),source[2],source[3]],referenceHeadRect:s.artifact.geometry.referenceHeadRect,occlusion:s.artifact.geometry.occlusion}:{}
    const result=normalizeAvatar(cropAvatar(await imageBytes(root,s.raw),rect),'1024x1024',geometry,await avatarReference(p,root,s,geometry)),next={...await storeImage(root,result.bytes,'avatar'),geometry:result.geometry,qa:result.qa,redo:result.redo,warnings:result.warnings,resizeCount:result.resizeCount}
    if(s.artifact?.hash!==next.hash){invalidateDescendants(p,s.id);s.version=(s.version||0)+1}
    s.artifact=next;return {slot,artifact:s.artifact}
  })
}
export async function projectStatus(root,{offset=0,limit=100,slot}={}) {
  const p=await loadProject(root),plans=Object.values(p.plans),nextActions=[],plansBySlot=new Map()
  for(const plan of plans){if(!plansBySlot.has(plan.slot))plansBySlot.set(plan.slot,[]);plansBySlot.get(plan.slot).push(plan)}
  const rows=Object.values(p.slots).filter(s=>{
    if(slot&&s.id!==slot || intentionalProductionFallback(p,s)&&!s.artifact)return false
    const render=p.layered?.[s.character+'/'+s.outfit]?.manifest.emotions[s.emotion]?.render
    return !(p.baseline?.scope!=='images'&&render&&['parts','missing'].includes(render.kind)&&['blink','mouth'].includes(s.kind))
  }).map(s=>{
    const entry=p.layered?.[s.character+'/'+s.outfit],render=entry?.manifest.emotions[s.emotion]?.render
    if(s.kind==='sprite'&&render&&['parts','missing'].includes(render.kind)&&(!p.baseline||p.layeredInstalls?.[s.character+'/'+s.outfit]?.emotions.includes(s.emotion))) {
      const tracked=p.layeredInstalls?.[s.character+'/'+s.outfit]
      if(tracked?.entryHash===hash(JSON.stringify(entry)))return {slot:s.id,kind:s.kind,state:'baseline-installed',version:entry.version,dependencies:[],missing:false,blocked:[],warnings:[],registered:true,layered:true,nativeRevision:tracked.revision}
      const result=hybrid.resolveHybridSprite(entry.manifest,s.emotion),available=result.available&&result.layers.every(part=>entry.assets[part.src])
      const approved=Boolean(p.review?.acceptedBy)&&reviewMatchesContent(p)
      if(!approved)nextActions.push({slot:s.id,kind:s.kind,action:available?'review-html':'register-part'})
      return {slot:s.id,kind:s.kind,state:!available?'missing':approved?'approved':'changed',version:entry.version,dependencies:[],missing:!available,blocked:available?[]:['MISSING_PART'],warnings:[],registered:true,layered:true}
    }
    if(s.installed)return {slot:s.id,kind:s.kind,state:'baseline-installed',version:s.version,expected_version:s.version,missing:false,dependencies:[],blocked:[],warnings:[],installed:s.installed}
    const currentPlans=(plansBySlot.get(s.id)||[]).filter(r=>(r.targetVersion||0)===(s.version||0)),waiting=currentPlans.filter(r=>!r.refreshedTo&&['unknown','refused','invalid'].includes(r.status))
    const blocked=[...(avatarParentStale(p,s)?['STALE_REFERENCES']:[]),...(avatarQaNeedsRecheck(p,s)?['AVATAR_QA_RECHECK_REQUIRED']:[]),...prerequisites(p,{...s,stale:false}),...(productionRedoRequired(s)?['REDO_REQUIRED']:[]),...(!s.stale&&(s.inputs||[]).some(r=>inputArtifact(p,s,r.slot)?.hash!==r.hash)?['STALE_REFERENCES']:[]),...(['identity-settei','settei'].includes(s.kind)&&s.artifact&&!s.stale&&!slotAccepted(s)?['HUMAN_APPROVAL_REQUIRED']:[]),...waiting.map(r=>r.status==='unknown'?'REQUEST_OUTCOME_UNKNOWN':r.status==='invalid'?'EXTRACTION_REDO_REQUIRED':'REQUEST_REFUSED')]
    const approved=!s.stale&&slotAccepted(s)
    const row={slot:s.id,kind:s.kind,state:!s.artifact?'missing':s.stale?'changed':blocked.length?'blocked':approved?'approved':'changed',version:s.version||0,dependencies:slotDependencies(p,s),missing:!s.artifact&&!s.optional,blocked:[...new Set(blocked)],warnings:[...(s.artifact?.warnings||[]),...(s.registered?.warnings||[])],...(s.artifact?{hash:s.artifact.hash}:{}),...(s.kind==='sprite'?{registered:Boolean(s.registered&&s.registered.anchorHash===p.slots[group(s,'sprite',firstEmotion(p,s))]?.raw?.hash)}:{})}
    if(p.workflowWaits?.[s.id])row.waiting=p.workflowWaits?.[s.id]
    if(waiting.length)row.waitingRequests=waiting.map(r=>({id:r.id,status:r.status}))
    if(!row.blocked.length&&!approved&&!s.refusal&&!productionRedoRequired(s)){
      let deps // the slot's dependency identity is hashed at most once, not once per prepared plan
      const prepared=currentPlans.findLast(r=>r.status==='prepared'&&r.dependencyHash===(deps??=dependencyHash(p,s)))
      const needsImage=!s.artifact||s.stale,action=needsImage?prepared?'generate-or-import':'prompt':s.kind==='sprite'&&!row.registered?'register':'review-html'
      nextActions.push({slot:s.id,kind:s.kind,action,...(needsImage&&prepared?{planId:prepared.id}:{})})
    }
    return row
  })
  return {project:path.resolve(root),id:p.id,revision:p.revision,total:rows.length,missing:rows.filter(r=>r.missing).length,offset,limit,slots:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null,nextActions,waiting:rows.filter(r=>r.blocked.length).map(r=>({slot:r.slot,reasons:r.blocked,dependencies:r.dependencies,...(r.waiting?{external:r.waiting}:{}),...(r.waitingRequests?{requests:r.waitingRequests}:{})})),requests:plans.filter(r=>r.status==='unknown').map(r=>({id:r.id,slot:r.slot,status:r.status})).slice(0,100),installReady:reviewMatchesContent(p)&&Boolean(p.review?.acceptedBy)}
}
export function avatarQaNeedsRecheck(p,s) {
  if(s.kind!=='avatar'||!s.artifact||s.installed)return false
  const config=p.characters.find(c=>c.key===s.character)?.avatarFraming,qa=s.artifact.qa
  const restored=p.restoredReplacements?.[s.id]
  // An exact installed recovery keeps the source QA policy; any slot or framing edit ends that exception.
  if(restored?.slotHash===hash(JSON.stringify(s))&&JSON.stringify(restored.canonicalFraming)===JSON.stringify(config??null))return false
  return config?qa?.mode!==config.mode||qa.tolerance!==config.tolerance||qa.referenceRelative!==2:qa?.mode==='match-reference'
}
export function productionProgress(p) {
  const stages=Object.fromEntries(['identity-settei','settei','sprite','avatar','blink','mouth','background','cg','avatar-sheet'].map(kind=>[kind,{total:0,complete:0,pending:0}])),pending=[],warnings=[]
  for(const s of Object.values(p.slots)) {
    if(intentionalProductionFallback(p,s)&&!s.artifact)continue
    const layered=p.layered?.[s.character+'/'+s.outfit],render=layered?.manifest.emotions[s.emotion]?.render
    if(render&&['parts','missing'].includes(render.kind)&&['sprite','blink','mouth'].includes(s.kind)&&(!p.baseline||s.kind==='sprite'&&p.layeredInstalls?.[s.character+'/'+s.outfit]?.emotions.includes(s.emotion))) {
      if(s.kind!=='sprite')continue
      const resolved=hybrid.resolveHybridSprite(layered.manifest,s.emotion)
      const available=resolved.available&&resolved.layers.every(part=>layered.assets[part.src])
      stages.sprite.total++;if(available)stages.sprite.complete++;else {stages.sprite.pending++;pending.push({slot:s.id,kind:s.kind,reasons:['MISSING_IMAGE']})}
      continue
    }
    if(s.installed){stages[s.kind].total++;stages[s.kind].complete++;continue}
    const reasons=avatarQaNeedsRecheck(p,s)?['AVATAR_QA_RECHECK_REQUIRED']:[]
    if(!s.optional&&!s.artifact)reasons.push('MISSING_IMAGE')
    if(['identity-settei','settei'].includes(s.kind)&&s.artifact&&!slotAccepted(s))reasons.push('HUMAN_APPROVAL_REQUIRED')
    if(s.stale||s.refusal||p.workflowWaits?.[s.id])reasons.push('BLOCKED')
    if(mouthSourceStale(p,s)||avatarParentStale(p,s))reasons.push('STALE_REFERENCES')
    if(productionRedoRequired(s))reasons.push('REDO_REQUIRED')
    if(s.artifact&&s.kind==='sprite'&&(!s.registered||s.registered.anchorHash!==p.slots[group(s,'sprite',firstEmotion(p,s))]?.raw?.hash))reasons.push('REGISTRATION_REQUIRED')
    if(s.artifact&&(s.inputs||[]).some(r=>inputArtifact(p,s,r.slot)?.hash!==r.hash))reasons.push('STALE_REFERENCES')
    const stage=stages[s.kind];stage.total++
    if(reasons.length){stage.pending++;pending.push({slot:s.id,kind:s.kind,reasons})}else stage.complete++
    if(s.artifact)warnings.push(...[...(s.artifact.warnings||[]),...(s.registered?.warnings||[])].map(w=>({...w,slot:s.id})))
  }
  for(const c of p.characters||[])if(c.heightCm===undefined)warnings.push({code:'HEIGHT_UNSPECIFIED',severity:'warning',character:c.key,message:'No measured height supplied; no default height is exported'})
  for(const c of p.characters||[])if(c.heightCm===170&&!c.heightConfirmed)warnings.push({code:'LEGACY_DEFAULT_HEIGHT',severity:'warning',character:c.key,message:'Unconfirmed legacy height 170 is not a measurement and is not exported; set heightConfirmed only after owner confirmation'})
  return {stages,pending,warnings}
}
export async function compileProduction(root,{excludeOutfit,figureIds,project}={}) {
  const original=project||await loadProject(root),p=figureIds?structuredClone(original):original
  if(p.baseline?.scope==='images')return (await import('../../../tools/dsh-assets/images-baseline.mjs')).validateImageCandidates(root,p)
  if(figureIds) {
    requireValue(p.baseline?.scope==='settei','Figure selection requires a settei baseline')
    p.characters=p.characters.filter(c=>figureIds.includes(c.id))
    const keys=new Set(p.characters.map(c=>c.key))
    p.slots=Object.fromEntries(Object.entries(p.slots).filter(([,s])=>keys.has(s.character)))
  }
  if(excludeOutfit!==undefined) {
    const matches=p.characters.flatMap(c=>c.outfits.filter(o=>c.key+'/'+o.key===excludeOutfit).map(o=>({c,o})))
    requireValue(matches.length===1,'--exclude-outfit must name one existing CHARACTER/OUTFIT')
    const {c,o}=matches[0]
    c.outfits=c.outfits.filter(value=>value!==o)
    for(const [id,s]of Object.entries(p.slots))if(s.character===c.key&&s.outfit===o.key)delete p.slots[id]
    if(p.layered)delete p.layered[excludeOutfit]
  }
  for(const s of Object.values(p.slots))assertCandidateAdmission(p,s,root)
  for(const [outfit,entry]of Object.entries(p.layered||{}))if(p.characters.some(c=>c.outfits.some(o=>c.key+'/'+o.key===outfit)))for(const a of Object.values(entry.assets))assertCandidateAdmission(p,{id:outfit,artifact:a},root)
  const files=new Map(),manifest={format:'dsh-asset-pack',schemaVersion:1,id:p.id,name:p.name,contentHash:'0'.repeat(64),assets:[],figures:[],sprites:{},bundles:{},blobs:{},files:[]},missing=[],warnings=[]
  const progress=productionProgress(p)
  const included=id=>Boolean(occupied(p,id))
  const artifact=id=>included(id)?occupied(p,id):undefined
  missing.push(...progress.pending.map(s=>s.slot+':'+s.reasons.join('|')));warnings.push(...progress.warnings)
  const blocked=progress.pending.filter(row=>p.slots[row.slot].artifact&&row.reasons.some(reason=>reason!=='MISSING_IMAGE'))
  requireValue(!blocked.length,'Unfinished image pipeline: '+blocked.slice(0,30).map(row=>row.slot+':'+row.reasons.join('|')).join(', '),'PRECONDITION')
  const missingCount=progress.pending.filter(s=>s.reasons.includes('MISSING_IMAGE')).length
  if(missingCount)warnings.unshift({code:'MISSING_IMAGES',severity:'warning',message:`${missingCount} missing image slots; no substitutes included`,count:missingCount})
  const readImage=createProjectImageReader(root)
  async function blob(a) {
    const bytes=await readImage(a);
    if(files.has('media/'+a.hash+'.png'))return a.hash
    manifest.blobs[a.hash]={ext:'png',mime:'image/png',size:bytes.length};files.set('media/'+a.hash+'.png',bytes);return a.hash
  }
  for(const c of p.characters) {
    const outfits=c.outfits
    if(!outfits.length&&!p.baseline)continue
    const figure={schemaVersion:1,id:c.id,name:c.name,identityAppearance:c.identityAppearance,emotions:structuredClone(c.emotions||[]),...(c.heightCm!==undefined&&(c.heightCm!==170||c.heightConfirmed)?{heightCm:c.heightCm,heightBasis:'standing'}:{}),appearance:'sprite',enabled:true,recall:{mode:'constant'},outfits:[]}
    const identity=p.slots[c.key+'/identity-settei']
    if(identity?.artifact)figure.identitySettei={board:await blob(identity.artifact),version:identityVersion(identity),palette:(identity.palette||[]).map(({role,hex,zone})=>({role,hex,zone}))}
    for(const o of outfits) {
      const s={character:c.key,outfit:o.key},key=c.key+'-'+o.key,assets={},spriteEmotions={},rig={mouthSets:{}},layered=p.layered?.[c.key+'/'+o.key]
      const outfit={key:o.key,label:o.label,enabled:true,...(o.defaultEmotion?{defaultEmotion:o.defaultEmotion}:{}),...(o.fallbackEmotions?{fallbackEmotions:[...o.fallbackEmotions]}:{}),recall,outfitAppearance:o.outfitAppearance,...(artifact(group(s,'settei'))?{settei:await blob(artifact(group(s,'settei'))),setteiParentVersion:p.slots[group(s,'settei')].parentVersion}:{}),avatars:{},sprite:{manifestKey:key,assets}}
      const resource=async(a,name)=>{assets[name]=await blob(a);return name}
      for(const {id:emotion} of c.emotions) {
        if(artifact(group(s,'avatar',emotion)))outfit.avatars[emotion]=await blob(artifact(group(s,'avatar',emotion)))
        if(layered?.manifest.emotions[emotion]||!included(group(s,'sprite',emotion)))continue
        const sprite=artifact(group(s,'sprite',emotion)),state={src:await resource(sprite,'emotions/'+emotion+'/stage.png')}
        const blink=artifact(group(s,'blink',emotion))
        if(blink) {requireValue(blink.baseHash===sprite.hash,'Blink source changed','CONFLICT');state.blink={closed:await resource(blink,emotion+'-blink.png'),rect:blink.rect,...(blink.blend?{blend:blink.blend}:{})}}
        if(o.mouth&&['closed','small','mid','open'].every(frame=>included(group(s,'mouth',emotion,frame)))) {
          const frames={},patches=['closed','small','mid','open'].map(frame=>occupied(p,group(s,'mouth',emotion,frame)))
          const rect=patches[0].rect
          for(const [i,frame]of ['closed','small','mid','open'].entries()) {
            const a=patches[i];requireValue(a.baseHash===sprite.hash&&JSON.stringify(a.rect)===JSON.stringify(rect),'Mouth frames require the same base and rect','CONFLICT')
            frames[frame]=await resource(a,emotion+'-mouth-'+frame+'.png')
          }
          const blends=Object.fromEntries(['closed','small','mid','open'].flatMap((frame,i)=>patches[i].blend?[[frame,patches[i].blend]]:[]))
          rig.mouthSets[emotion]={canvas:[rect[2],rect[3]],pivot:[0,0],frames,...(Object.keys(blends).length?{blends}:{})}
          state.binding={canvas:[sprite.width,sprite.height],mouth:{set:emotion,anchor:{x:rect[0],y:rect[1],scale:1,rotation:0},surface:'neutral'}}
        }
        spriteEmotions[emotion]=state
      }
      let doc={version:1,kind:'static-sprites',emotions:spriteEmotions,...(Object.keys(rig.mouthSets).length?{rig}:{})}
      if(layered) {
        const {availableLayeredManifest}=await import('../../../tools/dsh-assets/layered.mjs')
        const converted={}
        for(const [id,state]of Object.entries(spriteEmotions))converted[id]={render:{kind:'whole',legacy:{version:1,kind:'static-sprites',emotions:{[id]:state},...(state.binding?{rig:{mouthSets:{[state.binding.mouth.set]:rig.mouthSets[state.binding.mouth.set]}}}:{})}}}
        doc=hybridRuntimeClosure(availableLayeredManifest(layered));doc.emotions={...converted,...doc.emotions}
        for(const [id,entry]of Object.entries(doc.emotions))if(entry.render.kind==='whole'&&spriteResourcePaths(entry.render.legacy).some(src=>!assets[src]&&!layered.assets[src]))doc.emotions[id]={render:{kind:'missing'}}
        for(const src of spriteResourcePaths(doc))if(layered.assets[src])assets[src]=await blob(layered.assets[src])
        for(const [src,bytes]of await bakeHybridPreviews(doc,src=>files.get('media/'+assets[src]+'.png'))) {
          const digest=hash(bytes);assets[src]=digest;manifest.blobs[digest]={ext:'png',mime:'image/png',size:bytes.length};files.set('media/'+digest+'.png',bytes)
        }
      }
      if(!Object.keys(doc.emotions).length){delete outfit.sprite;figure.outfits.push(outfit);continue}
      manifest.sprites[key]='sprites/'+key+'/manifest.json';files.set(manifest.sprites[key],json(doc));figure.outfits.push(outfit)
    }
    if(!figure.outfits.length&&!p.baseline)continue
    manifest.figures.push(c.id);files.set('figures/'+c.id+'.json',json(figure))
  }
  for(const a of p.assets) {
    if(!included(a.kind+'/'+a.key))continue
    const media=await blob(occupied(p,a.kind+'/'+a.key)),base={id:a.key,name:a.name||a.key,kind:a.kind==='background'?'backgrounds':'cg',enabled:true,recall,directorNote:''}
    manifest.assets.push(a.kind==='background'?{...base,media}:{...base,variants:{default:'default',entries:[{id:'default',name:'Default',content:{description:(a.description||a.prompt).slice(0,80),media}}]}})
  }
  return {...await sealNativePack(manifest,files),warnings,p:original}
}
export async function validateProduction(root) {
  const p=await loadProject(root),{stages,pending,warnings}=productionProgress(p)
  if(pending.length)return {id:p.id,status:'partial',valid:false,compiled:false,stages,pending,warnings:warnings.slice(0,100),warningCount:warnings.length}
  const pack=await compileProduction(root)
  return {id:pack.manifest.id,status:'complete',valid:true,compiled:!pack.scoped,stages,pending:[],files:pack.files.size,warnings:pack.warnings.slice(0,100),warningCount:pack.warnings.length,contentHash:pack.manifest.contentHash}
}
export function generationProvenance(pack) {return {schemaVersion:1,contentHash:pack.manifest.contentHash,images:pack.manifest.files.filter(f=>/^media\/.*\.(?:png|jpe?g|webp)$/i.test(f.path)).map(({path,sha256})=>({path,hash:sha256})),plans:pack.p.plans,slots:pack.p.slots,generationAssets:pack.p.generationAssets,layered:pack.p.layered}}
export async function packProduction(root,options={}) {
  return transaction(root,async p=>{
  requireValue(options.sprites===undefined||options.scope==='animation','--sprites requires --scope animation')
  if(options.scope==='accepted')return (await import('../../../tools/dsh-assets/accepted-install.mjs')).packAcceptedProduction(root,options)
  requireValue(options.scope===undefined||['avatars','mouths','animation'].includes(options.scope),'pack scope must be avatars, mouths, animation or accepted')
  if(options.scope==='avatars')return (await import('../../../tools/dsh-assets/avatar-install.mjs')).packAvatarProduction(root,options)
  requireValue(options.outfits===undefined&&(options.slots===undefined||options.scope==='animation')&&options.avatarBaseline===undefined,'Avatar filters/baseline require --scope avatars')
  if(p.baseline||['mouths','animation'].includes(options.scope))return (await import('../../../tools/dsh-assets/settei-install.mjs')).packSetteiProduction(root,options)
  requireValue(!options.library&&!options.expectedRevision&&!options.figures,'Library/CAS/figure options apply only to installed baselines')
  const pack=await compileProduction(root,options),source='delivery/final-assets/pack-source'
  await rm(await safeProjectFile(root,'delivery'),{recursive:true,force:true})
  for(const [file,bytes]of pack.files)await atomic(root,source+'/'+file,bytes)
  // Preserve original raw receipts/records; deterministic derived images are not new backend generations.
  await atomic(root,source+'/generation-provenance.json',json(generationProvenance(pack)))
  await atomic(root,source+'/manifest.json',json(pack.manifest))
  await atomic(root,source+'/pack-source.json',json({version:1,id:pack.manifest.id,name:pack.manifest.name,manifest:'manifest.json'}))
  for(const c of pack.p.characters)for(const o of c.outfits) {
    if(!pack.manifest.sprites[c.key+'-'+o.key]||!occupied(pack.p,c.key+'/'+o.key+'/settei'))continue
    const a=occupied(pack.p,c.key+'/'+o.key+'/settei')
    await atomic(root,'delivery/colour-settings/'+c.key+'-'+o.key+'.png',await imageBytes(root,a))
  }
  await atomic(root,'delivery/colour-settings/appearance.json',json(pack.p.characters.filter(c=>pack.manifest.figures.includes(c.id)).map(c=>({id:c.id,name:c.name,identityAppearance:c.identityAppearance,outfits:c.outfits.filter(o=>pack.manifest.sprites[c.key+'-'+o.key]).map(o=>({key:o.key,outfitAppearance:o.outfitAppearance}))}))))
  const output=await safeProjectFile(root,'delivery/final-assets/pack.zip'),temp=output+'.'+randomUUID()+'.tmp'
  await writeNativePack(pack,temp);await rename(temp,output)
  return {id:pack.manifest.id,output,source:path.join(root,source),contentHash:pack.manifest.contentHash,warnings:pack.warnings.slice(0,100),excludedOutfits:options.excludeOutfit?[options.excludeOutfit]:[],installReady:!options.excludeOutfit&&reviewMatchesContent(pack.p)&&Boolean(pack.p.review?.acceptedBy)}
  })
}
export async function reviewProduction(root,options={}) {
  if(options.data||options.scope) {
    const {renderReview}=await import('../../../tools/dsh-assets/review-data.mjs')
    const {html,data}=await renderReview(root,options.data?null:await loadProject(root),options)
    await atomic(root,'review-preview.html',Buffer.from(html));await atomic(root,'review-preview-data.json',json(data))
    return {absolutePath:path.join(root,'review-preview.html'),reviewOnly:true,installReady:false}
  }
  return transaction(root,async p=>{
    const {renderReview}=await import('../../../tools/dsh-assets/review-data.mjs')
    const contentHash=contentFingerprint(p),{html,data}=await renderReview(root,p),digest=hash(html),file='review.html'
    await atomic(root,file,Buffer.from(html));await atomic(root,'review-data.json',json(data))
    p.review={hash:digest,contentHash,path:file}
    return {...p.review,absolutePath:path.join(root,file),nextAction:'accept --review '+digest+' --reviewer NAME'}
  })
}
