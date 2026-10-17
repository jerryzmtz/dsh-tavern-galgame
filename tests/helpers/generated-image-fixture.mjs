// Synthetic provider receipts for existing pixel/pipeline fixtures. Guard tests use the real CLI unwrapped.
import path from 'node:path'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {generationReceipt,renderGeneration} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function fixtureReceipt(file,plan) {
  const request=plan?.generation||await renderGeneration({kind:'edit',userPrompt:'Synthetic pixel fixture, not artwork',references:[]})
  const receipt=generationReceipt(request,{file,hash:digest(await readFile(file)),provider:'synthetic-test-fixture'})
  await writeFile(file+'.receipt.json',JSON.stringify(receipt)+'\n')
  return receipt
}
export function fixtureImport(importImage) {return async(root,options)=>{
  const p=JSON.parse(await readFile(path.join(root,'project.json'),'utf8'))
  if(options.file)try{await fixtureReceipt(options.file,p.plans[options.plan])}catch(e){if(e.code!=='ENOENT')throw e}
  return importImage(root,options)
}}
export function fixtureCli(run) {return async(args,...rest)=>{
  const value=key=>args[args.indexOf('--'+key)+1],root=args.includes('--project')?value('project'):undefined
  if(['import','replace-installed','register-base','register-part'].includes(args[0])&&args.includes('--file')) {
    let p
    if(root)try{p=JSON.parse(await readFile(path.join(root,'project.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
    try{await fixtureReceipt(value('file'),p?.plans[value('plan')])}catch(e){if(e.code!=='ENOENT')throw e}
  }
  return run(args,...rest)
}}
export async function admitSeededFixture(p,root) {
  for(const s of Object.values(p.slots))if(s.raw&&!s.installed?.hashes?.includes(s.raw.hash)&&!s.raw.generation) {
    const receipt=await fixtureReceipt(path.join(root,s.raw.path),p.plans[s.planId])
    s.raw.generation=receipt
  }
  return p
}
