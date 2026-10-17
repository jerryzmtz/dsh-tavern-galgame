// Isolated comparison: baseline restores full-scope receipts; compact uses production.
// Large local variables, unchanged render/refresh/save counts.
// DSH_TAVERN_RECEIPT_EXPERIMENT=baseline|compact node --import ./tests/fixtures/worldbook-batch-receipt-experiment.mjs tests/performance/worldbook-template-benchmark.mjs OUTPUT large 20
import { registerHooks } from 'node:module'
const mode = process.env.DSH_TAVERN_RECEIPT_EXPERIMENT || 'baseline'
if (!['baseline', 'compact'].includes(mode)) throw new Error('Unknown receipt experiment')
process.env.DSH_TAVERN_BENCH_EXPERIMENT = 'batch-receipt-' + mode
const target = new URL('../performance/worldbook-template-benchmark.mjs', import.meta.url).href
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Receipt experiment no longer matches benchmark: ' + before)
  return source.replace(before, after)
}
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context)
  if (url !== target) return loaded
  let source = String(loaded.source)
  source = replaceOnce(source, 'mvu:{enabled:true},variables:{},messages:', 'mvu:{enabled:true},variables:{payload:"v".repeat(200000)},messages:')
  source = replaceOnce(source, "res.end(await readFile(new URL(relative,sourceRoot)))", `res.end(await experimentSource(relative))`)
  source = replaceOnce(source, 'const html = mode =>', `async function experimentSource(relative) {
    const original = await readFile(new URL(relative,sourceRoot), 'utf8')
    if (${JSON.stringify(mode)} !== 'baseline' || !relative.endsWith('/session-tasks.js')) return original
    if (original.split('results.push(receipt)').length !== 2) throw new Error('Batch receipt code changed')
    return original.replace('results.push(receipt)', 'results.push(result)')
  }
  const html = mode =>`)
  source = replaceOnce(source, 'const args=JSON.parse(body),method=path.slice(5),begin=performance.now();let result', `const args=JSON.parse(body),method=path.slice(5),begin=performance.now();let result
        if(measuring)metrics.push({name:'request-bytes:'+method,ms:0,bytes:Buffer.byteLength(body)})`)
  return { ...loaded, source }
} })
