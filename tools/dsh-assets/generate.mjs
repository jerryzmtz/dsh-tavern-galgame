import path from 'node:path'
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {decodeAssetRgba} from '../../tavern-plugin/lib/domain/asset-image-processing.js'
import {generateSceneImage} from '../../tavern-plugin/packages/dsh-image-gen/src/tavern/scene-image-provider.js'
import {renderGeneration,generationReceipt,writeGenerationReceipt} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
const error=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra})
export function generationBackend(env) {
  if(!env.DSH_ASSETS_API_KEY||!env.DSH_ASSETS_BASE_URL||!env.DSH_ASSETS_IMAGE_MODEL||!env.DSH_ASSETS_DISPATCHER_MODEL)throw error('AUTH_REQUIRED','Set DSH_ASSETS_BASE_URL, DSH_ASSETS_API_KEY, DSH_ASSETS_IMAGE_MODEL and DSH_ASSETS_DISPATCHER_MODEL (local or portable; no credential files are read)')
  let endpoint
  try{endpoint=new URL(env.DSH_ASSETS_BASE_URL)}catch{throw error('INVALID_ARGUMENT','Invalid endpoint URL')}
  if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!['http:','https:'].includes(endpoint.protocol))throw error('INVALID_ARGUMENT','Endpoint must not contain credentials, query or fragment')
  return {provider:'openai',baseURL:endpoint.href,model:env.DSH_ASSETS_IMAGE_MODEL,dispatcherModel:env.DSH_ASSETS_DISPATCHER_MODEL,protocol:'responses-image-tool',apiKey:env.DSH_ASSETS_API_KEY}
}
export async function requestGeneration({request,file,referenceImages,output=request.output,confirm,env=process.env}) {
  if(confirm!==true)throw error('PRECONDITION','generate requires --confirm (one paid request)')
  const backend=generationBackend(env)
  file=path.resolve(file)
  await mkdir(path.dirname(file),{recursive:true})
  // Reserve before networking. An interrupted/unknown call cannot silently spend again.
  try{await stat(file);throw error('CONFLICT','Output exists; choose a new --out path for a new attempt')}catch(e){if(e.code!=='ENOENT')throw e}
  try{await writeFile(file+'.request.json',JSON.stringify({template:request.template,fields:request.fields,prompt:request.prompt,references:request.references,output,createdAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'})}catch(e){if(e.code==='EEXIST')throw error('GENERATION_FAILED','Request already registered; inspect '+file+'.request.json and received output, do not replay',{outcome:'unknown',exitCode:7});throw e}
  try {
    const result=await generateSceneImage({...backend,prompt:request.prompt,referenceImages,assetOutput:output,signal:AbortSignal.timeout(300000),maxBytes:20*1024**2})
    await writeFile(file,result.data,{flag:'wx'})
    const hash=createHash('sha256').update(result.data).digest('hex'),receipt=generationReceipt({...request,output},{file,hash})
    await writeGenerationReceipt(file,receipt)
    return {file,receiptFile:file+'.receipt.json',receipt,bytes:result.data,hash}
  }catch(e){
    if(['IMAGE_REFUSED','IMAGE_NO_RESULT'].includes(e.code))throw error(e.code,'Backend did not produce an image; request record retained, no retry',{outcome:'not_applied'})
    throw error('GENERATION_FAILED','Request or receipt write did not complete; inspect '+file+' and its request/receipt sidecars before another attempt',{outcome:'unknown',exitCode:7})
  }
}
export async function generateStandalone({input,fields,out,confirm,prepare=false,env=process.env}) {
  const source=input?path.resolve(input):path.join(process.cwd(),'generation-fields.json')
  fields=input?JSON.parse(await readFile(source,'utf8')):structuredClone(fields)
  const refs=fields.references||[]
  if(!Array.isArray(refs)||refs.length>4||refs.some(r=>typeof r.file!=='string'||typeof r.role!=='string'))throw error('INVALID_ARGUMENT','references must be at most four {file,role} objects; paths are relative to the input JSON')
  fields.references=refs.map(r=>({file:path.resolve(path.dirname(source),r.file),role:r.role}))
  if(['edit','blink','mouth'].includes(fields.kind)&&!fields.references.length)throw error('INVALID_ARGUMENT','Local edits require a source reference in references')
  const request=await renderGeneration(fields),referenceImages=await Promise.all(fields.references.map(async r=>({data:await readFile(r.file),mediaType:'image/png'})))
  if(['edit','blink','mouth'].includes(fields.kind)) {
    const source=decodeAssetRgba(referenceImages[0].data),size=source.width+'x'+source.height
    if(!prepare&&!['1024x1024','1024x1536','1536x1024'].includes(size))throw error('PRECONDITION','Standalone local edits require a native 1024x1024, 1024x1536 or 1536x1024 source; use a source-bound project editWindow for other canvases, never resize the source')
    request.output.size=size
    if(fields.kind==='edit')request.output.background=source.data.some((alpha,i)=>i%4===3&&alpha<255)?'transparent':'opaque'
  }
  if(prepare)return prepareNativeGeneration({request,file:out,confirm})
  const result=await requestGeneration({request,file:out,referenceImages,confirm,env})
  return {output:result.file,receipt:result.receiptFile,template:request.template,hash:result.hash}
}

const nativeProvider='tools.image_gen__imagegen'
const nativeJson=value=>JSON.stringify(value,null,2)+'\n'
function nativeInvocation(request,referencePaths) {
  return {prompt:request.prompt,...(referencePaths.length?{referenced_image_paths:referencePaths}:{}),transparent_background:request.output.background==='transparent'}
}
export async function prepareNativeGeneration({request,file,output=request.output,referencePaths,confirm}) {
  if(confirm!==true)throw error('PRECONDITION','prepare requires --confirm; reserve one native-tool attempt')
  file=path.resolve(file)
  await mkdir(path.dirname(file),{recursive:true})
  try{await stat(file);throw error('CONFLICT','Output already exists; use a new attempt path')}catch(e){if(e.code!=='ENOENT')throw e}
  const references=referencePaths||request.references.map(r=>r.file)
  const frozen={schemaVersion:1,generator:'dsh-assets',provider:nativeProvider,preparedAt:new Date().toISOString(),request:{...request,output},file,
    requestedConstraints:{size:output.size,quality:output.quality,toolGuaranteed:false},
    referencePaths:references,invocation:nativeInvocation({...request,output},references)}
  const requestFile=file+'.request.json',text=nativeJson(frozen)
  // Separate local reservation is authoritative; compare JSON bytes, not another digest.
  try{await writeFile(requestFile+'.prepared',text,{flag:'wx'})}catch(e){if(e.code==='EEXIST')throw error('CONFLICT','Native attempt already reserved; do not call the tool again');throw e}
  await writeFile(requestFile,text,{flag:'wx'})
  return {requestFile,provider:nativeProvider,preparedAt:frozen.preparedAt,invocation:frozen.invocation,requestedConstraints:frozen.requestedConstraints,output:file}
}
export async function finalizeNativeGeneration({requestFile,file}) {
  requestFile=path.resolve(requestFile);file=path.resolve(file)
  const text=await readFile(requestFile,'utf8'),stored=await readFile(requestFile+'.prepared','utf8')
  if(text!==stored)throw error('PRECONDITION','Frozen request changed; preserve the original request and reconcile, never regenerate automatically')
  const frozen=JSON.parse(stored)
  if(frozen.provider!==nativeProvider||!Array.isArray(frozen.referencePaths)||JSON.stringify(frozen.invocation)!==JSON.stringify(nativeInvocation(frozen.request,frozen.referencePaths)))throw error('PRECONDITION','Frozen request does not match the current native tool contract; preserve it for reconciliation, do not edit or replay it')
  const info=await stat(file),prepared=Date.parse(frozen.preparedAt)
  if(!info.isFile()||info.size<33||info.size>20*1024**2||info.birthtimeMs<prepared||info.mtimeMs<prepared)throw error('PRECONDITION','Native raw must be a fresh PNG created after prepare, at most 20 MiB; do not reuse historical output')
  const bytes=await readFile(file)
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw error('PRECONDITION','Native output must be the original PNG')
  const image=decodeAssetRgba(bytes)
  const finalizedAt=new Date().toISOString()
  try{await writeFile(requestFile+'.finalized',nativeJson({file,finalizedAt}),{flag:'wx'})}catch(e){if(e.code==='EEXIST')throw error('CONFLICT','Native finalize already attempted; inspect existing PNG/receipt, never replay');throw e}
  const hash=createHash('sha256').update(bytes).digest('hex')
  const receipt={...generationReceipt(frozen.request,{file:frozen.file,hash,provider:nativeProvider}),requestedConstraints:{size:frozen.request.output.size,quality:frozen.request.output.quality,toolGuaranteed:false},output:{path:frozen.file,hash,size:image.width+'x'+image.height,width:image.width,height:image.height},preparedAt:frozen.preparedAt,finalizedAt,nativeOutput:{path:file,bytes:bytes.length,width:image.width,height:image.height}}
  try{
    await writeFile(frozen.file,bytes,{flag:'wx'})
    await writeGenerationReceipt(frozen.file,receipt)
  }catch(e){throw error('GENERATION_FAILED','Native finalize did not complete; inspect output and receipt without repeating the tool call',{outcome:'unknown',exitCode:7})}
  return {output:frozen.file,receipt:frozen.file+'.receipt.json',template:receipt.template,hash}
}
