// private fork: one full-archive SHA-256; ZIP CRC handles entries. No upload or in-place NAS work.
import path from 'node:path'
import {readFile,writeFile,mkdir,rename,stat,open,unlink,lstat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import {writeZip,openZip,zipPath} from '../../tavern-plugin/packages/dsh-asset-library/lib/zip.js'
import {safeProjectFile,productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
const LIMIT=34*1024**2
const fail=(ok,msg)=>{if(!ok)throw productionError('INVALID_ARGUMENT',msg)}
const version=v=>{fail(typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(v),'Invalid exchange version');return v}
const checksum=async file=>{const hash=createHash('sha256');for await(const b of createReadStream(file))hash.update(b);return hash.digest('hex')}
export function assertLocalExchangeFolder(folder,exchangeRoot=process.env.DSH_ASSETS_EXCHANGE_ROOT) {
  if(!exchangeRoot)return
  const relative=path.relative(path.resolve(exchangeRoot),path.resolve(folder))
  fail(relative!==''&&(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'Copy deliveries locally before unpacking or authoring')
}
const local=assertLocalExchangeFolder
async function absent(file){try{await lstat(file);throw productionError('CONFLICT','Delivery destination exists')}catch(e){if(e.code!=='ENOENT')throw e}}
export async function exchangePack(root,{manifest,out,dryRun=false}) {
  local(root);local(out)
  const spec=JSON.parse(await readFile(manifest,'utf8'));version(spec.version);if(spec.base_version)version(spec.base_version)
  fail(Array.isArray(spec.files)&&spec.files.length<=20000,'Manifest files must be an explicit bounded list')
  const files=[],entries=[],ids=new Set(),paths=new Set()
  for(const f of spec.files){zipPath(f.path);fail(f.path.toLowerCase()!=='.exchange-version.json','Reserved exchange metadata path');fail(typeof f.id==='string'&&!ids.has(f.id)&&!paths.has(f.path.toLowerCase()),'Unique stable id and relative path required');ids.add(f.id);paths.add(f.path.toLowerCase())
    if(f.base_version){fail(f.base_version===spec.base_version&&Number.isSafeInteger(f.size)&&f.size>=0,'Reused file requires base version and size');files.push({id:f.id,path:f.path,size:f.size,base_version:f.base_version});continue}
    const file=await safeProjectFile(root,f.path),s=await stat(file);fail(s.isFile(),'Only regular delivery files allowed');files.push({id:f.id,path:f.path,size:s.size});entries.push({path:f.path,file})
  }
  const name='dsh-exchange-'+spec.version+'.zip',dest=path.join(path.resolve(out),name)
  await absent(dest);await absent(dest+'.json')
  if(dryRun)return {version:spec.version,files,dryRun:true,warnings:[],output:dest}
  await mkdir(out,{recursive:true});await writeZip(dest+'.partial',entries);await rename(dest+'.partial',dest)
  const size=(await stat(dest)).size,sha256=await checksum(dest),volumes=[]
  if(size>=35*1024**2){const h=await open(dest,'r');try{for(let offset=0,index=1;offset<size;offset+=LIMIT,index++){const count=Math.min(LIMIT,size-offset),data=Buffer.alloc(count);let read=0;while(read<count){const r=await h.read(data,read,count-read,offset+read);fail(r.bytesRead>0,'Truncated ZIP');read+=r.bytesRead}const file=name+'.'+String(index).padStart(3,'0');await absent(path.join(out,file));await writeFile(path.join(out,file+'.partial'),data,{flag:'wx'});await rename(path.join(out,file+'.partial'),path.join(out,file));volumes.push({path:file,size:count})}}finally{await h.close()}}
  const result={schema_version:1,version:spec.version,base_version:spec.base_version||null,files,zip:{path:name,size,sha256},...(volumes.length?{volumes}:{}),notes:spec.notes||''}
  await writeFile(dest+'.json.partial',JSON.stringify(result,null,2)+'\n',{flag:'wx'});await rename(dest+'.json.partial',dest+'.json')
  return {manifest:dest+'.json',zip:dest,transportFiles:[...(volumes.length?volumes.map(v=>path.join(out,v.path)):[dest]),dest+'.json'],size,dryRun:false}
}
export async function exchangeReceive({manifest,out,baseFolder,dryRun=false}) {
  local(out);if(baseFolder)local(baseFolder)
  const m=JSON.parse(await readFile(manifest,'utf8'));version(m.version)
  fail(m.schema_version===1&&Array.isArray(m.files)&&m.zip&&/^[a-f0-9]{64}$/.test(m.zip.sha256),'Invalid exchange manifest')
  fail(Number.isSafeInteger(m.zip.size)&&m.zip.size>=0&&m.zip.size<=2*1024**3,'ZIP size exceeds 2 GiB')
  zipPath(m.zip.path);fail(path.basename(m.zip.path)===m.zip.path,'ZIP filename must be flat')
  const sources=m.volumes||[{path:m.zip.path,size:m.zip.size}],folder=path.dirname(path.resolve(manifest)),dest=path.join(path.resolve(out),m.version)
  fail(sources.length>0&&sources.length<=128,'Invalid volume count')
  for(const [i,s]of sources.entries()){fail(typeof s.path==='string'&&path.basename(s.path)===s.path&&Number.isSafeInteger(s.size)&&s.size>0&&s.size<35*1024**2,'Invalid transport volume');if(m.volumes)fail(s.path===m.zip.path+'.'+String(i+1).padStart(3,'0'),'Volume order mismatch');fail((await stat(await safeProjectFile(folder,s.path))).size===s.size,'Transport size mismatch')}
  fail(sources.reduce((n,s)=>n+s.size,0)===m.zip.size,'Reassembled size mismatch');await absent(dest);await absent(dest+'.zip');await absent(dest+'.receipt.json')
  let base
  if(m.files.some(f=>f.base_version)){fail(baseFolder,'Delta requires --base-folder');base=JSON.parse(await readFile(path.join(baseFolder,'.exchange-version.json'),'utf8'));fail(base.version===m.base_version,'Receiver base version differs')}
  const ids=new Set(),names=new Set()
  for(const f of m.files){zipPath(f.path);fail(f.path.toLowerCase()!=='.exchange-version.json','Reserved exchange metadata path');fail(typeof f.id==='string'&&!ids.has(f.id)&&!names.has(f.path.toLowerCase())&&Number.isSafeInteger(f.size)&&f.size>=0,'Invalid exchange file');ids.add(f.id);names.add(f.path.toLowerCase());if(f.base_version)fail(f.base_version===m.base_version&&base.files.some(b=>b.id===f.id&&b.path===f.path&&b.size===f.size),'Unresolvable delta reference')}
  if(dryRun)return {version:m.version,files:m.files,dryRun:true,verified:false,warnings:[{code:'ARCHIVE_NOT_VERIFIED',severity:'warning',message:'Read-only preview checks sizes and references; receive verifies the complete ZIP'}]}
  await mkdir(out,{recursive:true});const staging=dest+'.partial-'+randomUUID(),archive=staging+'.zip';await mkdir(staging)
  const h=await open(archive,'wx');try{for(const s of sources)for await(const b of createReadStream(await safeProjectFile(folder,s.path)))await h.writeFile(b)}finally{await h.close()}
  fail(await checksum(archive)===m.zip.sha256,'Complete ZIP checksum mismatch')
  const zip=await openZip(archive)
  try{
    const entries=zip.entries,changed=m.files.filter(f=>!f.base_version)
    fail(entries.length===changed.length&&entries.every(e=>changed.some(f=>f.path===e.path&&f.size===e.size)),'ZIP file list differs from manifest')
    for(const f of m.files){const target=await safeProjectFile(staging,f.path);await mkdir(path.dirname(target),{recursive:true});const bytes=f.base_version?await readFile(await safeProjectFile(baseFolder,f.path)):await zip.read(entries.find(e=>e.path===f.path));fail(bytes.length===f.size,'Entry size mismatch');await writeFile(target,bytes,{flag:'wx'})}
  }finally{ /* openZip owns its file handles. */ }
  await writeFile(path.join(staging,'.exchange-version.json'),JSON.stringify(m,null,2)+'\n',{flag:'wx'});await rename(staging,dest)
  await rename(archive,dest+'.zip');await writeFile(dest+'.receipt.json',JSON.stringify({version:m.version,verified:true,zip:m.zip,received_at:new Date().toISOString(),next_action:'Acknowledge in the thread. Local operator records acknowledgement before NAS cleanup.'},null,2)+'\n',{flag:'wx'})
  return {destination:dest,version:m.version,verified:true,files:m.files.length,receipt:dest+'.receipt.json'}
}
export async function exchangeCleanup({nasRoot,ackLog,dryRun=false},allowedRoot=process.env.DSH_ASSETS_EXCHANGE_ROOT) {
  fail(process.platform==='win32','NAS cleanup is local-Windows-operator only');fail(typeof allowedRoot==='string'&&allowedRoot.length>0,'Set DSH_ASSETS_EXCHANGE_ROOT before cleanup');fail(path.resolve(nasRoot).toLowerCase()===path.resolve(allowedRoot).toLowerCase(),'Cleanup is confined to DSH_ASSETS_EXCHANGE_ROOT');local(ackLog,allowedRoot)
  const log=JSON.parse(await readFile(ackLog,'utf8'));fail(log.schema_version===1&&Array.isArray(log.acks),'Invalid local ack log')
  const files=[]
  for(const ack of log.acks){fail(['to-dot','from-dot'].includes(ack.direction)&&typeof ack.acknowledged_at==='string'&&typeof ack.thread_ack==='string'&&ack.thread_ack.trim(),'Each delivery requires explicit thread acknowledgement');version(ack.version)
    for(const f of ack.files){fail(new RegExp('^dsh-exchange-'+ack.version.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\.zip(?:\\.json|\\.\\d{3})?$').test(f.path),'Ack filename does not match its version');const file=await safeProjectFile(nasRoot,ack.direction+'/'+f.path);try{fail((await stat(file)).size===f.size,'Acked file size changed');files.push(file)}catch(e){if(e.code!=='ENOENT')throw e}}
  }
  if(!dryRun)for(const file of [...new Set(files)])await unlink(file)
  return {dryRun,files:[...new Set(files)],deleted:dryRun?0:new Set(files).size}
}
