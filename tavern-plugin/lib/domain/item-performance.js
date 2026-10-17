// private fork: serializable host-owned intent ledger; no MVU writes or model calls.
import {bindChange, bindShow, diffItems, itemBindingRefusal as refuse, validateItemPlay} from './item-binding.js'

export const itemSourceKey = source => JSON.stringify([
  source.sessionId,source.branchId,source.messageId,source.swipeId,source.generation,source.textDigest,
])
const terminal = new Set(['PLAYED','REFUSED','DUPLICATE','CANCELLED','SUPPRESSED'])
const active = record => !terminal.has(record.status)
const clone = value => structuredClone(value)

/** The host pins inventory before the run, then persists snapshot() with its task checkpoint. */
export function createItemPerformance({source, runId, scope, inventory, anchors, enabled = false, restored = null}) {
  const sourceKey = itemSourceKey(source)
  const state = restored ? clone(restored) : {version:1,source:clone(source),runId,scope:clone(scope),inventory:clone(inventory),
    anchors:[...anchors],enabled,records:[],receipt:null,page:null,opBytes:0,closed:null}
  if (restored) {
    if (itemSourceKey(state.source) !== sourceKey || state.runId !== runId) throw Error('Item ledger source mismatch')
    for (const record of state.records) if (active(record)) {record.status = 'SUPPRESSED'; record.reason = 'RELOADED'}
    state.closed = 'RELOADED'
  }
  const sameSource = other => itemSourceKey(other) === sourceKey
  function play(record) {
    record.status = 'PLAYED'
    record.playedAt = clone(state.page)
    return clone(record)
  }
  function admit(record, now, forward = false) {
    const page = state.page
    if (record.status !== 'READY' || !page || page.overlay || !page.text) return null
    const target = page.sourceKey === sourceKey && page.at === record.op.at
    if (record.late) return forward ? play(record) : null
    if (target && (!record.waitUntil || now <= record.waitUntil)) return play(record)
    if (target || page.sourceKey !== sourceKey || page.at > record.op.at) record.late = true
    return null
  }
  function bind(record) {
    const result = state.receipt.error ? refuse(state.receipt.error) : bindChange(record.op,state.receipt.diff,state.scope)
    if (!result.ok) {record.status = 'REFUSED'; record.reason = result.error.code; return}
    const factKey = JSON.stringify([sourceKey,result.beforeRevision,result.afterRevision,result.mappingKey,result.item.itemKey,record.op.action])
    if (state.records.some(other => other !== record && other.factKey === factKey)) {
      record.status = 'DUPLICATE'; record.reason = 'FACT_ALREADY_BOUND'; return
    }
    record.bound = result
    record.factKey = factKey
    record.status = 'READY'
  }
  return {
    submit(op, ordinal, now = 0) {
      if (!state.enabled || state.closed) return refuse('ITEMS_DISABLED')
      const checked = validateItemPlay(op,state.anchors)
      if (!checked.ok) return checked
      if (!Number.isSafeInteger(ordinal) || ordinal < 0) return refuse('INVALID_OP',true)
      const intentId = JSON.stringify([state.runId,ordinal])
      const existing = state.records.find(record => record.intentId === intentId)
      if (existing) return JSON.stringify(existing.op) === JSON.stringify(op)
        ? {ok:true,status:existing.acceptedStatus,intentId,effects:[]} : refuse('INTENT_CONFLICT')
      const bytes = Buffer.byteLength(JSON.stringify(op))
      if (state.records.length >= 8 || state.opBytes + bytes > 4096) return refuse('ITEM_BUDGET_EXCEEDED')
      // A show failure stays in this tool invocation and consumes no accepted intent ID.
      const shown = op.action === 'show' ? bindShow(op,state.inventory,state.scope) : null
      if (shown && !shown.ok) return shown
      const record = {intentId,op:clone(op),source:clone(state.source),status:shown ? 'READY' : 'HELD',
        acceptedStatus:shown ? 'bound' : 'held',bound:shown,late:false,waitUntil:null}
      const page = state.page
      if (page?.sourceKey === sourceKey && page.at >= op.at) {
        record.late = page.at > op.at
        if (!record.late) record.waitUntil = page.enteredAt + 500
      } else if (page && page.sourceKey !== sourceKey) record.late = true
      state.records.push(record)
      state.opBytes += bytes
      if (!shown && state.receipt) bind(record)
      const effect = admit(record,now)
      return {ok:true,status:record.acceptedStatus,intentId,effects:effect ? [effect] : []}
    },
    committed(receipt, now = 0) {
      if (state.closed || !sameSource(receipt.source)) return {accepted:false,effects:[]}
      if (state.receipt) {
        const same = state.receipt.beforeRevision === receipt.before.revision && state.receipt.afterRevision === receipt.after.revision
        return {accepted:same,effects:[]}
      }
      const pinned = receipt.before.revision === state.inventory.revision && receipt.before.mappingKey === state.inventory.mappingKey
      state.receipt = {beforeRevision:receipt.before.revision,afterRevision:receipt.after.revision,
        diff:pinned ? diffItems(receipt.before,receipt.after) : refuse('INVENTORY_UNAVAILABLE')}
      const effects = []
      for (const record of state.records) if (record.status === 'HELD') {
        bind(record)
        const effect = admit(record,now)
        if (effect) effects.push(effect)
      }
      return {accepted:true,effects}
    },
    page({source:pageSource = source, at, forward = false, text = true, overlay = false, history = false, skip = false, enabled:pageEnabled = true, now = 0}) {
      if (history || skip || !pageEnabled) {
        for (const record of state.records) if (active(record)) {record.status = 'SUPPRESSED'; record.reason = history ? 'HISTORY' : skip ? 'SKIP' : 'DISABLED'}
        state.closed = history ? 'HISTORY' : skip ? 'SKIP' : 'DISABLED'
        return []
      }
      if (state.closed) return []
      if (pageSource.sessionId !== source.sessionId || pageSource.branchId !== source.branchId
        || pageSource.messageId === source.messageId && !sameSource(pageSource)) {
        this.cancel('SOURCE_CHANGED')
        return []
      }
      const key = itemSourceKey(pageSource), previous = state.page
      const changed = !previous || previous.sourceKey !== key || previous.at !== at
      state.page = {sourceKey:key,at,text,overlay,enteredAt:changed ? now : previous.enteredAt}
      const effects = []
      for (const record of state.records) if (active(record)) {
        if (key === sourceKey && at === record.op.at && record.waitUntil === null) record.waitUntil = now + 500
        if (record.status === 'HELD' && (key !== sourceKey || at > record.op.at || record.waitUntil !== null && now > record.waitUntil)) record.late = true
        const effect = admit(record,now,forward && changed)
        if (effect) effects.push(effect)
      }
      return effects
    },
    failed(reason = 'SETTLEMENT_FAILED') {
      for (const record of state.records) if (record.status === 'HELD') {record.status = 'REFUSED'; record.reason = reason}
      state.receipt = {error:reason}
    },
    cancel(reason = 'SOURCE_CHANGED') {
      for (const record of state.records) if (active(record)) {record.status = 'CANCELLED'; record.reason = reason}
      state.closed = reason
    },
    corrected(afterRevision) {
      if (state.receipt?.afterRevision !== afterRevision) return
      for (const record of state.records) if (record.bound?.afterRevision === afterRevision) record.corrected = true
      this.cancel('SETTLEMENT_CORRECTED')
    },
    snapshot() { return clone(state) },
    history() { return clone(state.records) },
  }
}
