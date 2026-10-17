// private fork: disposable read-only index; journal revisions, never record claims, authorize reuse.
import { createHash } from 'node:crypto'
import { captureStageTarget, stageTargetPrefixBytes } from './stage-incremental.js'
import { readAssetPackRecord, ASSET_PACK_RECORD_FIELD } from './stage-asset-pack-director.js'

export function createStageHistoryCache({ readChanges, maxEntries = 4, maxBytes = 32 * 1024 * 1024, onValidate = () => {}, onTarget = () => {} } = {}) {
  const cache = new Map(), pending = new Map()
  let bytes = 0
  async function build(chat, previous, count) {
    const revision = chat._storageRevision, messages = chat.messages
    let changes
    if (previous && previous.sessionId === chat.sessionId) {
      if (previous.revision === revision) changes = {baseRevision:revision,revision,indices:[]}
      else if (previous.revision < revision) changes = await readChanges?.(chat.id, previous.revision)
    }
    const compatible = changes?.baseRevision === previous?.revision && changes?.revision === revision && Array.isArray(changes?.indices)
    const dirty = compatible ? new Set(changes.indices) : null
    const start = compatible ? Math.min(previous.rows.length, count, ...changes.indices) : 0
    const rows = compatible ? previous.rows.slice(0, start) : []
    let prefix = start ? rows[start - 1].prefix.copy() : createHash('sha256').update('[')
    let accepted = start ? rows[start - 1].previous : null
    let size = start ? rows[start - 1].size : 0
    for (let i = start; i < count; i++) {
      const message = messages[i], raw = message?.[ASSET_PACK_RECORD_FIELD]
      let checked = null, target = null, current = null, recordBytes = 0
      if (raw) {
        if (compatible && !dirty.has(i)) checked = previous.rows[i]?.checked
        if (checked) recordBytes = previous.rows[i].recordBytes
        else { onValidate(i); checked = readAssetPackRecord(raw, {shared:true}); recordBytes = JSON.stringify(checked).length * 2 }
        onTarget(i)
        target = captureStageTarget(chat, i, prefix.copy().update(']').digest('hex'))
        if (checked.binding.target.sourceKey === target.sourceKey && checked.binding.target.predecessorDigest === (accepted?.digest || null)) accepted = current = checked
      }
      if (i) prefix.update(',')
      prefix.update(stageTargetPrefixBytes(message))
      size += 256 + recordBytes
      rows.push({checked, current, previous:accepted, target, prefix:prefix.copy(), size, recordBytes})
    }
    const value = {revision, sessionId:chat.sessionId, rows, size, target(index, currentChat) {
      // private fork: a read target uses the already indexed prefix, never scans history again.
      const row = rows[index]
      if (!row) return captureStageTarget(currentChat,index)
      if (!row.target) {
        onTarget(index)
        const prefix = index ? rows[index - 1].prefix.copy() : createHash('sha256').update('[')
        row.target = captureStageTarget(currentChat,index,prefix.update(']').digest('hex'))
      }
      return {...row.target,branchId:currentChat.timeline.branchId,revision:currentChat.timeline.revision}
    }, at(index) {
      const end = Math.min(rows.length, Math.max(0, index + 1)), row = rows[end - 1]
      return {current:index < rows.length ? row?.current || null : null, previous:row?.previous || null,
        // private fork: current/predecessor lookups do not materialize the entire accepted chain.
        get records() { return rows.slice(0, end).flatMap(row => row.current ? [row.current] : []) }}
    }}
    const latest = cache.get(chat.id)
    if (Number.isSafeInteger(revision) && size <= maxBytes && maxEntries > 0 && !(latest?.revision > revision || latest?.revision === revision && latest.rows.length > rows.length)) {
      if (cache.has(chat.id)) { bytes -= cache.get(chat.id).size; cache.delete(chat.id) }
      while (cache.size && (bytes + size > maxBytes || cache.size >= maxEntries)) {
        const id = cache.keys().next().value; bytes -= cache.get(id).size; cache.delete(id)
      }
      cache.set(chat.id, value); bytes += size
    }
    return value
  }
  return {
    async read(chat, through = chat.messages.length - 1) {
      // Do not validate future records while reading an earlier, still-valid historical turn.
      const count = Math.min(chat.messages.length, Math.max(0, through + 1))
      const previous = cache.get(chat.id), revision = chat._storageRevision
      if (Number.isSafeInteger(revision) && previous?.revision === revision && previous.sessionId === chat.sessionId && previous.rows.length >= count) return previous
      if (!Number.isSafeInteger(revision)) return build(chat,undefined,count)
      const key = JSON.stringify([chat.id, chat.sessionId, revision, count])
      if (pending.has(key)) return pending.get(key)
      const load = build(chat, previous,count)
      pending.set(key, load)
      try { return await load } finally { pending.delete(key) }
    },
    clear() { cache.clear(); bytes = 0 },
  }
}
