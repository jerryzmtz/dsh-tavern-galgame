// Isolated benchmark experiment, never imported by production.
// node --import ./tests/fixtures/worldbook-clone-experiment.mjs tests/performance/worldbook-template-benchmark.mjs OUTPUT large
// This preserves every production call path but substitutes only the clone
// primitive in the worldbook module for this process. Not a compatibility claim.
import { registerHooks } from 'node:module'
process.env.DSH_TAVERN_BENCH_EXPERIMENT = 'worldbook-structured-clone'
const target = new URL('../../tavern-plugin/lib/domain/worldbook-resource.js', import.meta.url).href
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context)
  if (url !== target) return loaded
  const source = String(loaded.source)
  const original = 'return value === undefined ? undefined : JSON.parse(JSON.stringify(value))'
  if (source.split(original).length !== 2) throw new Error('Worldbook clone experiment no longer matches source')
  return { ...loaded, source: source.replace(original, 'return value === undefined ? undefined : structuredClone(value)') }
} })
