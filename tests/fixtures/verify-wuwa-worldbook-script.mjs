// Read a user-supplied card; execute only its cleanup function with disposable data.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse } from 'acorn'
const card = JSON.parse(await readFile(process.argv[2], 'utf8'))
function find(value) {
  if (!value || typeof value !== 'object') return null
  if (value.name === '世界书控制' && typeof value.content === 'string') return value.content
  for (const child of Object.values(value)) { const result = find(child); if (result) return result }
}
const source = find(card)
assert.ok(source, 'Worldbook controller script missing')
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
const node = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'cleanupResidualAutoBlue')
assert.ok(node)
const commits = []
const scope = vm.createContext({ SWITCHER_STATE: { simpTradMode: 'simplified' }, manualBlueUids: [2],
  matchSimpTradMode: () => true, applyStrategyChanges: async (...args) => commits.push(args) })
vm.runInContext(source.slice(node.start, node.end), scope, { timeout: 1000 })
const data = { stories: [1, 2].map(uid => ({ uid, bookName: 'test', strategy: { type: 'constant' } })) }
const round = { strategies: new Map() }
assert.equal(await scope.cleanupResidualAutoBlue(data, round), true)
assert.equal(round.strategies.get(1).type, 'selective')
assert.equal(round.strategies.has(2), false, 'manual blue entry must be retained')
assert.equal(commits.length, 0, 'round writes must remain buffered')
await scope.cleanupResidualAutoBlue(data)
assert.equal(commits.length, 1, 'standalone fallback persists normally')
assert.match(source, /cleanupResidualAutoBlue\(data,\s*roundWb\)/, 'master loop must supply the round buffer')
console.log('PASS: residual auto-blue cleanup buffers writes, preserves manual blue, and supports standalone cleanup')
