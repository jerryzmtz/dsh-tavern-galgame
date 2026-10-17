import path from 'node:path'
import { readFileSync } from 'node:fs'

// Machine-local overrides stay outside shipped code and portable profile data.
export function profileBackupRoot(dataRoot, { env = process.env, localFile = new URL('../../.dsh-tavern-local.json', import.meta.url) } = {}) {
  if (env.DSH_TAVERN_BACKUP_ROOT) return path.resolve(env.DSH_TAVERN_BACKUP_ROOT)
  let local
  try { local = JSON.parse(readFileSync(localFile, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  return path.resolve(local?.backupRoot || path.join(dataRoot, 'backups'))
}
