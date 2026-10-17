import path from 'node:path'
import {rename,cp,lstat,readdir,unlink,rmdir} from 'node:fs/promises'

import os from 'node:os'
import { profileBackupRoot } from '../../tavern-plugin/lib/fork-backup-path.js'
export { profileBackupRoot }

const dshHome = process.env.DSH_TAVERN_CLI_HOME || process.env.DSH_HOME || path.join(os.homedir(), '.dsh-tavern')
export const BACKUP_ROOT = profileBackupRoot(path.join(dshHome, 'profile-data', 'tavern', 'data'))
export const backupPath = name => path.join(BACKUP_ROOT,name)

async function inventory(root) {
  const stat=await lstat(root)
  if(stat.isSymbolicLink())throw new Error('Refuse linked backup input: '+root)
  if(stat.isFile())return {files:1,bytes:stat.size}
  const total={files:0,bytes:0}
  for(const name of await readdir(root)) {
    const child=await inventory(path.join(root,name))
    total.files+=child.files;total.bytes+=child.bytes
  }
  return total
}
async function removeCopiedSource(root) {
  const stat=await lstat(root)
  if(stat.isSymbolicLink())throw new Error('Refuse changed backup input: '+root)
  if(stat.isFile())return unlink(root)
  for(const name of await readdir(root))await removeCopiedSource(path.join(root,name))
  await rmdir(root)
}

// Cross-volume backups copy exclusively and verify count/size before retiring the source.
export async function moveToBackup(source,destination,renameFile=rename) {
  try {await renameFile(source,destination);return}
  catch(error) {if(error.code!=='EXDEV')throw error}
  const before=await inventory(source)
  await cp(source,destination,{recursive:true,force:false,errorOnExist:true})
  const after=await inventory(destination),current=await inventory(source)
  if(after.files!==before.files||after.bytes!==before.bytes||current.files!==before.files||current.bytes!==before.bytes)throw new Error('Backup count/size mismatch; source retained')
  await removeCopiedSource(source)
}
