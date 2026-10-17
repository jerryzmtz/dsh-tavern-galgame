// private fork: historical authoring fixtures declare their formerly implicit vocabulary.
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {importFigureVariants} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/import-figure-variants.js'
const rows=importFigureVariants({}, {fixture:{outfits:[]}}, {}).figures.fixture.emotions
const order=['calm',...rows.map(row=>row.id).filter(id=>id!=='calm')]
export function declaredProduction(input){
  const next=structuredClone(input)
  for(const figure of next?.characters||[]){
    if(figure.emotions!==undefined&&!Array.isArray(figure.emotions))continue
    const own=figure.emotions||[]
    figure.emotions=[...rows.filter(row=>!own.some(e=>e.id===row.id)).map(row=>({...row})),...own]
    const ids=[...new Set((figure.outfits||[]).flatMap(o=>o.emotions || order))]
    figure.emotions=ids.map(id=>figure.emotions.find(row=>row.id===id)).filter(Boolean)
    for(const outfit of figure.outfits||[]){outfit.defaultEmotion=outfit.emotions?.[0] || figure.emotions[0]?.id;delete outfit.emotions;outfit.mouth??=false}
  }
  return next
}
// Model persisted pre-1.3.7 ledgers, not an opt-out in the current init contract.
async function historicalMouths(result,input){
  const file=path.join(result.project,'project.json'),p=JSON.parse(await readFile(file,'utf8'))
  for(const c of p.characters)for(const o of c.outfits){
    if(input.characters.find(f=>f.key===c.key)?.outfits?.find(f=>f.key===o.key)?.mouth===true)continue
    o.mouth=false
    for(const [id,s]of Object.entries(p.slots))if(s.character===c.key&&s.outfit===o.key&&s.kind==='mouth')delete p.slots[id]
  }
  await writeFile(file,JSON.stringify(p,null,2)+'\n')
  return {...result,slots:Object.keys(p.slots).length}
}
export async function legacyFixtureInit(init,root,input,...args){
  const declared=declaredProduction(input)
  return historicalMouths(await init(root,declared,...args),declared)
}
export function legacyFixtureCli(run){return async args=>{
  if(args[0]==='init'){
    const index=args.indexOf('--characters')
    if(index>=0&&args[index+1]){
      const file=args[index+1],input=declaredProduction(JSON.parse(await readFile(file,'utf8')))
      await writeFile(file,JSON.stringify(input))
      return historicalMouths(await run(args),input)
    }
  }
  return run(args)
}}
