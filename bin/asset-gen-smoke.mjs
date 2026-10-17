// Owner-only smoke: no credential discovery, no paid request unless explicitly confirmed.
import {readFile} from 'node:fs/promises'
const argv = process.argv.slice(2), option = key => argv[argv.indexOf(key)+1]
if (!argv.includes('--confirm-paid') || !argv.includes('--plan')) {
  console.log('Manual only. Export one prepareAssetGeneration result (data) to a local JSON file.\nSet DSH_ASSET_GEN_URL to the authenticated Tavern origin and DSH_ASSET_GEN_TOKEN to its access token.\nThen: node bin/asset-gen-smoke.mjs --plan <file.json> --confirm-paid\nOne generation POST only; bounded status polling. No automatic retry or adoption. No request was sent.')
  process.exit(0)
}
const plan = JSON.parse(await readFile(option('--plan'),'utf8'))
if (plan.imageCount !== 1 || !plan.planId || !plan.consentToken) throw new Error('A prepared, explicitly reviewed single-image plan is required')
const origin = new URL(process.env.DSH_ASSET_GEN_URL || '')
if (!['http:','https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Supply a plain Tavern origin, not a provider endpoint')
const token = process.env.DSH_ASSET_GEN_TOKEN
if (!token) throw new Error('DSH_ASSET_GEN_TOKEN is required; this script never reads stored credentials')
async function rpc(method,input) {
  const response = await fetch(new URL('/api/dsh-tavern/'+method,origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
    headers:{'content-type':'application/json',origin:origin.origin,authorization:'Bearer '+token},body:JSON.stringify(input)})
  if (!response.ok) throw new Error('Tavern HTTP '+response.status+'; not retried')
  const result = await response.json()
  if (!result.ok) throw new Error('Tavern rejected request: '+(result.error?.code || 'RPC_ERROR')+'; not retried')
  return result.data
}
const group = await rpc('generateAssetCandidate',{planId:plan.planId,consentToken:plan.consentToken,confirmNewRequestIds:plan.confirmNewRequestIds})
const jobId = group.jobs[0].jobId
for (let count=0;count<155;count++) {
  const job = await rpc('getAssetGenerationJob',{jobId})
  if (job.status !== 'running') {
    console.log(JSON.stringify({jobId,status:job.status,outcome:job.outcome,checks:job.candidate?.checks,errorCode:job.error?.code},null,2))
    process.exitCode = job.status === 'candidate' ? 0 : 1
    break
  }
  if (count === 154) { console.log('Bounded polling ended. Result may still arrive; do not repeat generation. Inspect job '+jobId); process.exitCode=1; break }
  await new Promise(resolve=>setTimeout(resolve,2000))
}
