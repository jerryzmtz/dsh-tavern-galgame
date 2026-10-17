const path = 'background-session-retirement.json'

/** Native Session logs remain readable; only retired Tavern workers lose discovery/reuse. */
export function createBackgroundSessionRetirement(store, { readState, isRunning } = {}) {
  async function records() { return (await store.readJson(path)) || {} }
  return {
    async isRetired(id) { return Object.hasOwn(await records(), id) },
    async retire(id, parentId) {
      if (!id || !parentId) throw new Error('后台会话退休缺少会话编号')
      await store.updateJson(path, old => ({ ...old, [id]: { parentId, retiredAt: Date.now() } }))
    },
    async filter(rows, parentId) {
      const retired = await records()
      // Older releases did not record retirement. Fold only explicitly terminal,
      // superseded identities from Tavern's authority; never infer from the label alone.
      if (readState) {
        const parents = new Set(rows.filter(row => row.kind === 'child').map(row => row.parentId || parentId).filter(Boolean))
        for (const owner of parents) {
          const chat = await readState(owner)
          const current = chat?.timeline?.participants?.background?.sessionId
          if (!current) continue
          const operations = Object.values(chat.timeline.operations || {})
          const running = new Set(operations.filter(op => op.status === 'running').map(op => op.startedSessionId))
          for (const op of operations) {
            if (op.kind === 'agent' && ['failed', 'interrupted'].includes(op.status)
              && op.startedSessionId && op.startedSessionId !== current && !running.has(op.startedSessionId)) {
              Object.defineProperty(retired, op.startedSessionId, { value: {parentId: owner}, enumerable: true, configurable: true })
            }
          }
        }
      }
      return rows.filter(row => {
        const record = retired[row.id]
        // Never hide unrelated children, still-running consumers or a subtree.
        return row.kind !== 'child' || !record || record.parentId !== (row.parentId || parentId)
          || row.activity === 'running' || isRunning?.(row.id) === true || row.hasChildren === true
      })
    }
  }
}

/** Adapt the pinned DSH discovery boundary; do not rewrite native descriptors or logs. */
export function installRetiredBackgroundFilter(subagents, retirement, sessionQuery) {
  const restore = []
  for (const method of ['listChildren', 'listDescendants']) {
    const original = subagents?.[method]
    if (typeof original !== 'function') continue
    const wrapped = async function (parentId, signal) {
      const rows = await original.call(this, parentId, signal)
      const result = await retirement.filter(rows, parentId)
      signal?.throwIfAborted()
      return result
    }
    subagents[method] = wrapped
    restore.push(() => { if (subagents[method] === wrapped) subagents[method] = original })
  }
  // The native header counts global Session summaries independently of the
  // child catalog. Apply the same visibility rule at its public read boundary.
  const original = sessionQuery?.listSessions
  if (typeof original === 'function') {
    const wrapped = async function (signal) {
      const records = await original.call(this, signal)
      const parents = new Set(records.map(row => row.header.parentSession).filter(Boolean))
      const rows = records.map(record => ({
        id: record.header.id,
        kind: record.header.origin === 'subagent' ? 'child' : 'session',
        parentId: record.header.parentSession,
        hasChildren: parents.has(record.header.id),
      }))
      const visible = new Set((await retirement.filter(rows)).map(row => row.id))
      signal?.throwIfAborted()
      return records.filter(record => visible.has(record.header.id))
    }
    sessionQuery.listSessions = wrapped
    restore.push(() => { if (sessionQuery.listSessions === wrapped) sessionQuery.listSessions = original })
  }
  return () => { for (const undo of restore) undo() }
}
