// Test-only instrumentation. Never log card contents, variable values or URLs.
import { parse } from 'acorn'

export function createInitializationTrace(now = () => performance.now(), limit = 1000) {
  const startedAt = now(), rows = [], pending = new Map()
  let sequence = 0, dropped = 0
  function append(row) { if (rows.length >= limit) { rows.shift(); dropped++ } rows.push(row) }
  async function wait(stage, promise) {
    const id = ++sequence, start = now()
    pending.set(id, { id, stage, startMs: start - startedAt })
    try { const value = await promise; append({ id, stage, startMs: start - startedAt, durationMs: now() - start, status: 'complete' }); return value }
    catch (error) { append({ id, stage, startMs: start - startedAt, durationMs: now() - start, status: 'failed' }); throw error }
    finally { pending.delete(id) }
  }
  return { wait, snapshot: () => ({ elapsedMs: now() - startedAt, dropped, pending: Array.from(pending.values()).map(row => ({ ...row, durationMs: now() - startedAt - row.startMs })), rows: rows.slice() }) }
}

// Wrap await operands without renaming upstream symbols or changing return values.
// Function selection uses semantic string anchors, so a changed build fails closed.
export function instrumentInitializationAwaits(source, kind) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), edits = [], stages = new Set()
  function visit(node, owner = '') {
    if (!node || typeof node !== 'object') return
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const body = source.slice(node.start, node.end)
      if (kind === 'official' && node.type === 'FunctionDeclaration') {
        if (body.includes('runtime.initvar.noMessagesLog')) owner = 'init-check'
        else if (body.includes('runtime.initvar.entryParseFailedLog')) owner = 'initvar-read'
      }
      if (kind === 'client' && node.id?.name === 'drainPromptWrites') owner = 'prompt-drain'
      if (kind === 'client' && node.id?.name === 'withScript') owner = 'script-callback'
    }
    if (node.type === 'AwaitExpression') {
      const operand = source.slice(node.argument.start, node.argument.end)
      let stage = owner
      if (kind === 'official' && operand.includes('__dshTavernCompanionScriptsReady')) stage = 'companion-barrier'
      else if (kind === 'official' && /\._wait_init\(\)/.test(operand)) stage = 'settings-ready'
      if (stage) {
        if (owner === 'init-check') {
          const name = node.argument.callee?.name
          if (['eventEmit', 'setChatMessages', 'updateVariablesWith', 'replaceVariables'].includes(name)) stage += ':' + name
          else if (node.argument.callee?.object?.name === 'Promise') stage += ':all-swipes'
        }
        stages.add(stage)
        edits.push([node.argument.start, 'globalThis.__mvuInitializationTrace.wait(' + JSON.stringify(stage) + ',('], [node.argument.end, '))'])
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue
      if (Array.isArray(value)) value.forEach(child => visit(child, owner))
      else if (value && typeof value === 'object') visit(value, owner)
    }
  }
  visit(ast)
  if (!stages.size) throw new Error('Initialization trace anchors absent: ' + kind)
  for (const [at, text] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, at) + text + source.slice(at)
  parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  return { source, stages: [...stages] }
}

export function instrumentInitializationClient(source) {
  const bootstrap = 'function tavernHelperScriptBootstrap(metadata, initialContext, modules) {'
  if (!source.includes(bootstrap)) throw new Error('Bootstrap trace anchor absent')
  source = instrumentInitializationAwaits(source, 'client').source
  return source.replace(bootstrap, bootstrap + '\nwindow.__mvuInitializationTrace = (' + createInitializationTrace.toString() + ')();\nsetInterval(()=>parent.postMessage({type:"mvu-smoke-trace",trace:window.__mvuInitializationTrace.snapshot()},"*"),500);\n')
}
