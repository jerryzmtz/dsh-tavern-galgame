// Admission of new agent-generated pixels. Stored assets and UI uploads do not use this gate.
import path from 'node:path'
import {readFile,writeFile} from 'node:fs/promises'
import {productionPrompt,assetOutput} from './asset-production-contract.js'
export const GENERATION_CUTOVER='2026-10-16T17:10:14.311Z'
// Exact owner-approved identities, not a grace period or synthetic generation receipts.
export const GENERATION_CUTOVER_EXCEPTIONS={
  "version": "1.3.48",
  "reason": "cutover notice latency",
  "items": [
    {
      "planId": "e6f1b0d6-de15-47b8-9387-2b9cabc39fdb",
      "createdAt": "2026-10-16T17:11:12.891Z",
      "hash": "ebf79c252951f70479710b6879e4f5ba7279bcf36f859d50fe0717784e6a11dc",
      "file": "yukino-outfit01-joy/jobs/mid/raw-attempt05.png",
      "bytes": 1148170
    },
    {
      "planId": "42ca1e25-1b70-48cd-a55e-25f468a76b5f",
      "createdAt": "2026-10-16T17:11:53.916Z",
      "hash": "d2233ca0928b3c211d8198b4669aa8cc0c478081267fa0979866ddbfe3c1d42b",
      "file": "production-game06-joy-batch46/jobs/closed/raw-attempt01.png",
      "bytes": 1737760
    },
    {
      "planId": "6c295693-a4e1-4978-94bb-facd330fdd1a",
      "createdAt": "2026-10-16T17:11:55.738Z",
      "hash": "41c512b898d5cfca94c988b1eb9c64bcc8c945785966929f5582f088621f2a77",
      "file": "production-game06-joy-batch46/jobs/small/raw-attempt01.png",
      "bytes": 1735359
    }
  ]
}
function cutoverException(plan,hash) {
  return !plan?.generation&&typeof plan?.prompt==='string'&&Array.isArray(plan.references)&&GENERATION_CUTOVER_EXCEPTIONS.items.find(row=>row.planId===plan.id&&row.createdAt===plan.createdAt&&row.hash===hash)
}
function exceptionProof(plan,hash) {
  return {kind:'cutover-exception',version:GENERATION_CUTOVER_EXCEPTIONS.version,reason:GENERATION_CUTOVER_EXCEPTIONS.reason,planId:plan.id,createdAt:plan.createdAt,hash}
}
function admittedException(proof,hash) {
  return proof?.kind==='cutover-exception'&&proof.version===GENERATION_CUTOVER_EXCEPTIONS.version&&proof.reason===GENERATION_CUTOVER_EXCEPTIONS.reason&&proof.hash===hash&&GENERATION_CUTOVER_EXCEPTIONS.items.some(row=>row.planId===proof.planId&&row.createdAt===proof.createdAt&&row.hash===hash)
}
export const GENERATION_TEMPLATE_VERSION=1
export const GENERATION_KINDS=['identity-settei','settei','sprite','avatar','avatar-sheet','blink','mouth','cg','background','prop','edit']
const fail=(message,nextAction)=>Object.assign(new Error(message),{code:'GENERATION_RECEIPT_REQUIRED',exitCode:6,nextAction})
export function generationRepair({root,plan,file}={}) {
  return plan&&root?`node bin/dsh-assets.mjs generate --project ${JSON.stringify(path.resolve(root))} --plan ${JSON.stringify(plan.id)} --confirm --json`:`node bin/dsh-assets.mjs generate --kind edit --reference ${JSON.stringify(file||'image.png')} --note "Apply the official clean low-detail Finish while preserving the subject and composition." --out ${JSON.stringify((file||'image.png')+'.generated.png')} --confirm --json`
}
export function historicalGeneration(plan) {
  return !plan?.generation&&Number.isFinite(Date.parse(plan?.createdAt))&&Date.parse(plan.createdAt)<Date.parse(GENERATION_CUTOVER)&&typeof plan.prompt==='string'&&Array.isArray(plan.references)
}
export function historicalProvenance(p,hash) {
  return Object.values(p.plans).find(row=>row.rawHash===hash&&(historicalGeneration(row)||cutoverException(row,hash)))||Object.values(p.slots).find(s=>s.raw?.hash===hash&&['historical-record','cutover-exception'].includes(s.raw.generation?.kind))?.raw.generation
}
function historicalRecord(row) {
  return row?.status==='requested'&&typeof row.id==='string'&&typeof row.file==='string'&&typeof row.prompt==='string'&&Array.isArray(row.refs)&&Number.isFinite(Date.parse(row.time))&&Date.parse(row.time)<Date.parse(GENERATION_CUTOVER)
}
async function readHistoricalRecord(provenance,file) {
  const rows=(await readFile(provenance,'utf8')).split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line))
  return rows.find(row=>historicalRecord(row)&&path.resolve(path.dirname(provenance),row.file)===path.resolve(file))
}
function admittedProof(p,proof,hash) {
  if(admittedException(proof,hash))return true
  if(proof?.generator==='dsh-assets'&&proof.schemaVersion===1&&proof.output?.hash===hash)return true
  if(proof?.kind==='historical-record'&&proof.hash===hash&&historicalRecord(proof.record))return true
  const old=p.plans[proof?.planId]
  return proof?.kind==='historical-plan'&&proof.hash===hash&&historicalGeneration(old)&&old.rawHash===hash
}
export function assertCandidateAdmission(p,s,root) {
  if(!s?.artifact)return
  const raw=s.raw||s.artifact,proof=raw.generation||p.generationAssets?.[raw.hash]
  if(s.installed?.hashes?.includes(raw.hash)&&s.installed.hashes.includes(s.artifact.hash))return
  const derived=raw.provenance,id=[s.character,s.outfit,'sprite',s.emotion].join('/'),parent=p.slots[id]
  const source=p.mouthSources?.[id]||parent?.artifact
  if(s.kind==='mouth'&&derived?.kind==='source-derived'&&derived.slot===s.id&&derived.hash===raw.hash&&derived.artifactHash===s.artifact.hash&&JSON.stringify(derived.rect)===JSON.stringify(s.artifact.rect)&&derived.source?.slot===id&&derived.source.hash===source?.hash&&derived.source.version===(source?.version??parent?.version)&&s.artifact.baseHash===source?.hash&&(s.sourceBinding?JSON.stringify(s.sourceBinding)===JSON.stringify(derived.source):Boolean(parent?.registered)))return
  if(admittedProof(p,proof,raw.hash)||proof?.hash===raw.hash&&admittedProof(p,proof.receipt,proof.sourceHash))return
  if(proof?.kind==='derived'&&proof.hash===raw.hash&&Object.values(p.slots).some(source=>source.raw?.hash===proof.sourceHash&&admittedProof(p,source.raw.generation,proof.sourceHash)))return
  if(cutoverException(p.plans[s.planId],raw.hash)&&p.plans[s.planId].slot===s.id&&p.plans[s.planId].rawHash===raw.hash)return
  if(historicalGeneration(p.plans[s.planId])&&p.plans[s.planId].slot===s.id&&p.plans[s.planId].rawHash===raw.hash)return
  const repair=generationRepair({root,plan:p.plans[s.planId],file:path.resolve(root,raw.path)})
  throw fail('Candidate was not admitted through generated-image import: '+s.id+'. '+repair,repair)
}
export async function renderGeneration(fields) {
  if(!fields||!GENERATION_KINDS.includes(fields.kind)||Object.keys(fields).some(k=>!['kind','figure','outfit','emotionId','frame','userPrompt','references','editWindow'].includes(k)))throw Object.assign(new Error('Use structured generation fields; raw prompts and template overrides are not supported'),{code:'INVALID_ARGUMENT'})
  const {editWindow,...input}=fields
  if(editWindow&&!['width','height'].every(key=>Number.isInteger(editWindow[key])&&editWindow[key]>0&&editWindow[key]<=8192))throw Object.assign(new Error('editWindow dimensions must be positive source-pixel integers <=8192'),{code:'INVALID_ARGUMENT'})
  let prompt=await productionPrompt(input)
  if(editWindow)prompt+='\nEdit the supplied 1:1 crop at exactly '+editWindow.width+'x'+editWindow.height+'. Transparent padding is intentional. Never scale or resample; keep all other pixels unchanged.'
  return {template:{id:fields.kind,version:GENERATION_TEMPLATE_VERSION},fields:structuredClone(fields),prompt,references:structuredClone(fields.references||[]),output:assetOutput(fields.kind)}
}
export function generationReceipt(request,{file,hash,provider='responses-image-tool'}) {
  return {schemaVersion:1,generator:'dsh-assets',template:request.template,fields:request.fields,prompt:request.prompt,references:request.references,output:{...request.output,path:path.resolve(file),hash},provider,createdAt:new Date().toISOString()}
}
export async function writeGenerationReceipt(file,receipt) {
  await writeFile(file+'.receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
}
export async function admitGeneration({file,hash,plan,root,receipt,historical,provenance}) {
  if(admittedException(historical,hash))return historical
  const exception=cutoverException(plan,hash)?plan:historical?.rawHash===hash&&cutoverException(historical,hash)?historical:null
  if(exception)return exceptionProof(exception,hash)
  // A dated frozen pre-cutover plan is real historical provenance, not a fabricated CLI receipt.
  if(historical?.kind==='historical-record'&&historical.hash===hash&&historicalRecord(historical.record))return historical
  const old=historicalGeneration(plan)?plan:historicalGeneration(historical)&&historical.rawHash===hash?historical:null
  if(old)return {kind:'historical-plan',planId:old.id,createdAt:old.createdAt,hash}
  const repair=generationRepair({root,plan,file})
  if(provenance) {
    const record=await readHistoricalRecord(provenance,file)
    if(!record)throw fail('No pre-cutover requested generation record matches this file. '+repair,repair)
    return {kind:'historical-record',source:path.resolve(provenance),record,hash}
  }
  if(!receipt)try{receipt=JSON.parse(await readFile(file+'.receipt.json','utf8'))}catch(error){
    if(!['ENOENT','ENOTDIR'].includes(error.code)&&!(error instanceof SyntaxError))throw error
  }
  let expected
  try {if(receipt?.fields)expected=await renderGeneration(receipt.fields)}catch {}
  if(!expected||receipt.schemaVersion!==1||receipt.generator!=='dsh-assets'||receipt.output?.hash!==hash||receipt.template?.id!==expected.template.id||receipt.template?.version!==expected.template.version||receipt.prompt!==expected.prompt||JSON.stringify(receipt.references)!==JSON.stringify(expected.references)||plan?.generation&&receipt.template.id!==plan.generation.template.id&&receipt.template.id!=='edit')throw fail('Image has no matching official-generation receipt. Generate it with: '+repair,repair)
  return receipt
}
