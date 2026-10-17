// private fork: explicit stopped-writer deployment mode; default remains copy-only.
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {realpath,statfs,lstat,readdir,mkdir,copyFile,readFile,writeFile} from 'node:fs/promises'
import {constants} from 'node:fs'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {checkedPath} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/storage.js'
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}
const liveBase=path.resolve(process.env.DSH_LIVE_DATA_ROOT || fileURLToPath(new URL('../../data/', import.meta.url)))
export function isLiveData(root){const value=path.resolve(root).toLowerCase(),base=liveBase.toLowerCase();return value===base||value.startsWith(base+path.sep)}
export async function migrationRoot(root,{live=false,dataRoot,writerStopped=false,dryRun=true}={},kind){
 if(typeof root!=='string'||!path.isAbsolute(root))fail('INVALID_ARGUMENT','An absolute migration root is required')
 root=await realpath(await checkedPath(root,''))
 if(!live){if(dataRoot||writerStopped)fail('INVALID_ARGUMENT','Deployment options require --live');if(isLiveData(root))fail('COPY_REQUIRED','Use explicit --live --data-root mode after stopping the writer');return root}
 if(!dataRoot||!path.isAbsolute(dataRoot)||!writerStopped)fail('INVALID_ARGUMENT','Live mode requires --data-root and --writer-stopped')
 const data=await realpath(await checkedPath(dataRoot,'')),profile=path.dirname(data)
 if(path.basename(data)!=='data'||root!==(kind==='assets'?path.join(profile,'asset-packs'):profile))fail('INVALID_ARGUMENT','Root must belong to the explicit profile data directory')
 await assertWriterStopped(root)
 if(!dryRun)await assertBackupSpace(root)
 return root
}
export async function assertWriterStopped(root){
 if(!isLiveData(root))return
 if(process.platform!=='win32')fail('WRITER_CHECK_FAILED','Local deployment requires the Windows process check')
 // Query only process names and executable paths, never command lines or credentials.
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('DSH Tavern.exe','DSH Desktop.exe') } | Select-Object Name,ExecutablePath) | ConvertTo-Json -Compress"],{timeout:15000,windowsHide:true})
 const parsed=stdout.trim()?JSON.parse(stdout):[],rows=Array.isArray(parsed)?parsed:[parsed]
 if(rows.some(p=>!p.ExecutablePath||path.resolve(p.ExecutablePath).toLowerCase().startsWith(path.dirname(liveBase).toLowerCase()+path.sep)))fail('WRITER_RUNNING','Stop the local Desktop and launcher before migration')
}
export async function assertBackupSpace(root){const s=await statfs(root);if(s.bavail*s.bsize<20*1024**3)fail('INSUFFICIENT_SPACE','At least 20 GiB free is required before backup/publication')}
// private fork: COPYFILE_EXCL copies are trusted; backups are not re-hashed file by file.
export async function copyBackup(entries,backupRoot,metadata={}){
 await checkedPath(backupRoot,'')
 const receipt=path.join(backupRoot,'backup-complete.json')
 const rows=[]
 async function copy(source,target,relative){
  const info=await lstat(source)
  if(info.isSymbolicLink())fail('INVALID_PATH','Backup refuses links/reparse points')
  if(info.isDirectory()){await mkdir(target,{recursive:true});for(const name of await readdir(source))await copy(path.join(source,name),path.join(target,name),relative+'/'+name);return}
  if(!info.isFile())fail('INVALID_PATH','Backup requires regular files')
  await mkdir(path.dirname(target),{recursive:true});await copyFile(source,target,constants.COPYFILE_EXCL)
  rows.push({path:relative,bytes:info.size})
 }
 await mkdir(backupRoot,{recursive:true})
 for(const {source,relative} of entries)await copy(await checkedPath(source,''),await checkedPath(backupRoot,relative),relative)
 await writeFile(receipt,JSON.stringify({schema_version:1,...metadata,complete:true,files:rows},null,2),{flag:'wx'})
 return receipt
}
export async function requireCompleteBackup(backupRoot,planDigest){
 const receipt=JSON.parse(await readFile(await checkedPath(backupRoot,'backup-complete.json'),'utf8'))
 if(receipt.complete!==true||receipt.planDigest!==planDigest)fail('BACKUP_CONFLICT','A complete backup for this plan is required')
}
