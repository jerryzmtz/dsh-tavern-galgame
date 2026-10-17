// Explicit authoring ingress: the same character-emotion migration as native packs.
import path from 'node:path'
import {readFile,writeFile,mkdir,open,unlink} from 'node:fs/promises'
import {BACKUP_ROOT} from '../../bin/lib/backup-path.mjs'
import {safeProjectFile,atomic,productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {validateProjectSchema} from '../../tavern-plugin/lib/domain/asset-production-schema.js'
import {migrateCharacterEmotions} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {importFigureVariants} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/import-figure-variants.js'

export async function migrateProjectVariants(root,{dryRun=false}={}) {
  const file=await safeProjectFile(root,'project.json'),bytes=await readFile(file),p=JSON.parse(bytes),changed=[]
  p.characters=p.characters.map(original=>{
    let c=original
    if(!Array.isArray(c.emotions)) {
      const ids=[...new Set(c.outfits.flatMap(o=>o.emotions || []))]
      c=importFigureVariants({}, {[c.id]:c},{}).figures[c.id]
      if(ids.some(id=>!c.emotions.some(e=>e.id===id)))throw productionError('INVALID_ARGUMENT','Unknown legacy emotion; provide its label first')
      c.emotions=c.emotions.filter(e=>ids.includes(e.id))
    }
    c=migrateCharacterEmotions(c)
    if(c!==original)changed.push(c.key)
    if(!p.baseline)for(const o of c.outfits)for(const {id:emotion} of c.emotions) {
      const base={character:c.key,outfit:o.key,emotion}
      for(const kind of ['sprite','avatar',...(o.eyesClosed?.includes(emotion)?[]:['blink'])]) {
        const id=[c.key,o.key,kind,emotion].join('/')
        if(!p.slots[id]){p.slots[id]={...base,id,kind};if(!changed.includes(c.key))changed.push(c.key)}
      }
      if(o.mouth)for(const frame of ['closed','small','mid','open']) {
        const id=[c.key,o.key,'mouth',emotion,frame].join('/')
        if(!p.slots[id]){p.slots[id]={...base,id,kind:'mouth',frame};if(!changed.includes(c.key))changed.push(c.key)}
      }
    }
    return c
  })
  if(changed.length){p.revision++;delete p.review;p.reviews=[]}
  validateProjectSchema(p)
  const backup=changed.length?path.join(BACKUP_ROOT,'asset-project-'+p.id,'project.pre-character-emotions.json'):null
  if(!dryRun&&changed.length) {
    const lock=await safeProjectFile(root,'.write-lock'),handle=await open(lock,'wx')
    try {
      if(!bytes.equals(await readFile(file)))throw productionError('CONFLICT','Project changed during migration')
      await mkdir(path.dirname(backup),{recursive:true});await writeFile(backup,bytes,{flag:'wx'})
      await atomic(root,'project.json',Buffer.from(JSON.stringify(p,null,2)+'\n'))
    } finally {await handle.close();await unlink(lock)}
  }
  return {id:p.id,changed,dryRun,backup}
}
