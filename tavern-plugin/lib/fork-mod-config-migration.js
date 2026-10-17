import path from 'node:path'
import {mkdir,open,readFile} from 'node:fs/promises'
import {isDeepStrictEqual as equal} from 'node:util'
import {planModConfigMigration} from './domain/mods/config-migration.js'
import {profileBackupRoot} from './fork-backup-path.js'

// publish is the host owner's single durable multi-owner CAS transaction. It must
// publish pack configs before retiring raw mappings, with recovery on interruption.
export function createModConfigMigration({snapshot,publish,schemas,assertIdle,dataRoot,backupRoot=profileBackupRoot(dataRoot)}) {
  let tail=Promise.resolve()
  async function run({apply=false}={}) {
    const before=await snapshot(),plan=planModConfigMigration(before,schemas)
    const result={apply,changes:plan.changes,writes:0,backup:null}
    if(!apply || !plan.changed)return result
    await assertIdle()
    if(!equal(before,await snapshot()))throw Object.assign(new Error('Migration source changed'),{code:'REVISION_CONFLICT'})
    await mkdir(backupRoot,{recursive:true})
    // A retry reuses the same migration backup, never a second copy of changed inputs.
    const backup=path.join(backupRoot,'mod-config-v1.json')
    let file
    try {file=await open(backup,'wx')}
    catch(error) {
      if(error.code!=='EEXIST')throw error
      const saved=JSON.parse(await readFile(backup,'utf8'))
      if(!equal(saved.before,before) || !equal(saved.plan,plan))throw Object.assign(new Error('Existing migration backup differs; recover the original owner transaction'),{code:'CONFIG_MIGRATION_CONFLICT'})
    }
    if(file)try {await file.writeFile(JSON.stringify({version:1,before,plan})+'\n');await file.sync()}finally {await file.close()}
    await publish({before,next:plan.next,backup})
    if(!equal(await snapshot(),plan.next))throw Object.assign(new Error('Migration publication could not be verified; retain backup '+backup),{code:'CONFIG_MIGRATION_CONFLICT'})
    return {...result,backup,writes:plan.changes.length,verified:true}
  }
  return {run(args){const work=tail.then(()=>run(args));tail=work.catch(()=>{});return work},async readBackup(file){return JSON.parse(await readFile(file,'utf8'))}}
}
