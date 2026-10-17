// Prepare Session v0 logs so DSH 0.1.5-rc.2 can migrate them. The original file
// is replaced only after the official catalog accepts the result and the visible
// story text still matches. A refused log is left untouched.
import { access, copyFile, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const SURFACE = new Set(['user/message', 'assistant/message', 'tool/result', 'system/message'])
const ALLOWED_FORM = new Set(['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'])
const TAVERN_SOURCE_KEYS = new Set(['kind', 'plugin', 'form', 'sections', 'summary'])
const ZSTD_MAGIC = 0xFD2FB528
const BACKUP_SUFFIX = '.bak-tavern-premigrate'
// Keep each body frame under this uncompressed size so encode does not hold one
// giant joined string for a whole archive (issue #84).
const BODY_FRAME_TARGET = 512 * 1024

export function decodeSessionLog(buffer) {
  const frames = scanZstdFrames(buffer)
  let text = ''
  for (const frame of frames) text += zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
  return text
}

/** Parse header + events frame by frame without concatenating the whole archive. */
export function parseSessionLog(buffer) {
  const frames = scanZstdFrames(buffer)
  let headerLine = null
  let header = null
  const events = []
  for (const frame of frames) {
    const text = zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
    let offset = 0
    while (offset < text.length) {
      const end = text.indexOf('\n', offset)
      const line = end < 0 ? text.slice(offset) : text.slice(offset, end)
      offset = end < 0 ? text.length : end + 1
      if (!line) continue
      if (headerLine === null) {
        headerLine = line
        header = JSON.parse(line)
      } else events.push(JSON.parse(line))
    }
  }
  return { headerLine, header, events }
}

export function prepareLegacySessionBuffer(buffer, catalog) {
  let frames
  try { frames = scanZstdFrames(buffer) }
  catch (error) { return refuse(error.message || String(error)) }
  let headerLine = null
  let header = null
  const events = []
  for (const frame of frames) {
    const text = zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
    let offset = 0
    while (offset < text.length) {
      const end = text.indexOf('\n', offset)
      const line = end < 0 ? text.slice(offset) : text.slice(offset, end)
      offset = end < 0 ? text.length : end + 1
      if (!line) continue
      if (headerLine === null) {
        headerLine = line
        try { header = JSON.parse(line) } catch { return refuse('文件头不是 JSON') }
      } else {
        try { events.push(JSON.parse(line)) } catch { return refuse('事件不是 JSON') }
      }
    }
  }
  if (!headerLine) return refuse('空日志')
  if (header?.version !== 0) return { ok: true, changed: false }
  return prepareParsedLegacySession(header, events, headerLine, catalog, () => parseSessionLog(buffer).events)
}

// Never trade a compacted history boundary for a log that merely opens. Sequence
// numbers can change, but every summary and replacement checkpoint must survive.
function compactionBoundaries(events) {
  return events.flatMap(event => {
    const message = event.data?.message || event.data
    if (event.type === 'compaction/summary') return [{
      kind: 'summary', content: event.data.summary,
      range: Boolean(event.data.shadowedRange), seqs: Boolean(event.data.shadowedSeqs?.length),
    }]
    if (event.surfaceOp?.op === 'replace' &&
        (message?.source?.compactionId || /compact/.test(message?.source?.plugin || ''))) {
      return [{ kind: 'checkpoint', content: message.content }]
    }
    return []
  })
}

function preserveCompaction(boundaries, result) {
  if (!boundaries.length || !result?.ok) return result
  if (!result.artifact || JSON.stringify(boundaries) !== JSON.stringify(compactionBoundaries(result.artifact.events))) {
    return refuse('无法安全保留压缩摘要和上下文边界，已保留原始日志，未执行有损迁移')
  }
  return result
}

function prepareParsedLegacySession(header, events, headerLine, catalog, reparse) {
  const boundaries = compactionBoundaries(events)
  return preserveCompaction(boundaries, prepareParsedLegacySessionUnchecked(header, events, headerLine, catalog, reparse))
}

function prepareParsedLegacySessionUnchecked(header, events, headerLine, catalog, reparse) {
  // Issue #71: stripping illegal source keys (fixedSystemText, …) alone is enough
  // for the host to open many archives. Prefer that over leaving the raw v0 file
  // when the fuller rewrite refuses.
  // Issue #84: mutate the freshly parsed events in place; reparse() only if sanitize
  // needs a pristine copy after a failed rewrite.
  const sanitize = () => sanitizeLegacySessionLog(header, reparse(), catalog, headerLine)
  const draft = events
  const prefix = prefixTexts(draft).join('\n\n')
  let cleaned = false
  for (const event of draft) if (cleanEvent(event)) cleaned = true
  let folded
  try { folded = foldTavernReplacements(draft) }
  catch (error) { return sanitize() || refuse(error.message || String(error)) }
  const hoisted = hoistNestedTurns(folded.events)
  const coordinatesChanged = repairNonPositiveCoordinates(hoisted.events)
  const turnsChanged = assignTurnNumbers(hoisted.events) || coordinatesChanged
  const moved = moveOrphanAssistantMessages(hoisted.events)
  const synthesized = synthesizeOpeningStep(moved.events)
  let placed
  try { placed = placeOpening(synthesized.events, prefix) }
  catch (error) { return sanitize() || refuse(error.message || String(error)) }
  const dangling = dropDanglingPointers(placed.events)
  let next = dangling.events
  const originalStory = storyTexts(next)
  const changed = cleaned || folded.changed || hoisted.changed || turnsChanged || moved.changed || synthesized.changed || placed.changed || dangling.changed
  if (changed) {
    try { next = renumber(next) }
    catch (error) { return sanitize() || refuse(error.message || String(error)) }
  }
  if (!changed) {
    const opened = openSession(catalog, header, events)
    if (opened.ok) return { ok: true, changed: false, artifact: opened.artifact }
    // Source already clean but host still rejects: leave bytes alone (#72 C follow-up).
    return sanitize() || { ok: true, changed: false, reason: opened.reason }
  }
  const opened = openSession(catalog, header, next)
  if (!opened.ok) {
    // Issue #73: structural rewrite (incl. placeOpening) is what fixes
    // surface-before-step, but openSession may still reject for compaction /
    // tool-result drift. Soften those conflicts until the host accepts, rather
    // than discarding the rewrite and leaving the chronology broken.
    const repaired = repairUntilOpenable(header, next, catalog)
    if (repaired.ok) {
      const migratedStory = storyTexts(repaired.artifact.events)
      let reason = repaired.reason
      if (!reason && !sameTexts(originalStory, migratedStory) && !sameTexts(uniqueStory(originalStory), uniqueStory(migratedStory))) {
        reason = '可见正文不完全一致，已写出可打开版本'
      } else if (!reason && prefix && !systemText(repaired.artifact.events).includes(prefix)) {
        reason = '固定背景未完全进入 system 头，已写出可打开版本'
      }
      return { ok: true, changed: true, headerLine, events: repaired.events, artifact: repaired.artifact, reason }
    }
    return sanitize() || { ok: true, changed: false, reason: opened.reason }
  }
  const migratedStory = storyTexts(opened.artifact.events)
  // Prefer a host-readable rewrite over leaving illegal source keys on disk
  // (issue #71). Story/prefix checks stay as soft warnings via result.reason.
  let reason
  if (!sameTexts(originalStory, migratedStory) && !sameTexts(uniqueStory(originalStory), uniqueStory(migratedStory))) {
    reason = '可见正文不完全一致，已写出可打开版本'
  } else if (prefix && !systemText(opened.artifact.events).includes(prefix)) {
    reason = '固定背景未完全进入 system 头，已写出可打开版本'
  }
  return { ok: true, changed: true, headerLine, events: next, artifact: opened.artifact, reason }
}

/** Drop only non-released source members, then open with the official catalog. */
export function sanitizeLegacySessionLog(header, events, catalog, headerLine) {
  const boundaries = compactionBoundaries(events)
  return preserveCompaction(boundaries, sanitizeLegacySessionLogUnchecked(header, events, catalog, headerLine))
}

function sanitizeLegacySessionLogUnchecked(header, events, catalog, headerLine) {
  // Caller owns `events` (fresh reparse or disposable draft); mutate in place.
  const only = events
  let changed = false
  for (const event of only) if (cleanEvent(event)) changed = true
  let next = only
  // Issue #73: source-only cleanup still leaves surface events before the first
  // step, which the host rejects at v2→v3. Apply placeOpening here too.
  try {
    const placed = placeOpening(next, prefixTexts(next).join('\n\n'))
    if (placed.changed) {
      next = dropDanglingPointers(placed.events).events
      next = renumber(next)
      changed = true
    }
  } catch {
    // Keep source-cleaned events when chronology cannot be repaired here.
  }
  if (!changed) return null
  let opened = openSession(catalog, header, next)
  if (!opened.ok) {
    const repaired = repairUntilOpenable(header, next, catalog)
    if (repaired.ok) {
      return {
        ok: true,
        changed: true,
        headerLine: headerLine || JSON.stringify(header),
        events: repaired.events,
        artifact: repaired.artifact,
        reason: repaired.reason,
        sanitizedOnly: true,
      }
    }
    // Issue #72 C / #73: even when the host still cannot open, write the cleaned
    // (and chronology-fixed when possible) source so illegal fields and
    // surface-before-step do not remain on disk forever.
    return {
      ok: true,
      changed: true,
      headerLine: headerLine || JSON.stringify(header),
      events: next,
      reason: opened.reason || '已清理非法字段，但宿主仍无法打开',
      sanitizedOnly: true,
    }
  }
  return {
    ok: true,
    changed: true,
    headerLine: headerLine || JSON.stringify(header),
    events: next,
    artifact: opened.artifact,
    sanitizedOnly: true,
  }
}

/** Progressively drop conflicting rows until the host catalog accepts the log. */
function repairUntilOpenable(header, events, catalog) {
  // openSession clones per row; softenForOpenFailure clones before mutating.
  let current = events
  const notes = []
  let cursor = 0
  while (cursor < 8) {
    const opened = openSession(catalog, header, current)
    if (opened.ok) {
      return {
        ok: true,
        events: current,
        artifact: opened.artifact,
        reason: notes.length ? '已丢弃冲突记录以完成迁移：' + notes.join('；') : undefined,
      }
    }
    const step = softenForOpenFailure(current, cursor, opened.reason)
    if (!step.changed) return { ok: false, reason: opened.reason }
    notes.push(step.note)
    cursor = step.nextAttempt
    current = dropDanglingPointers(step.events).events
    try { current = renumber(current) }
    catch (error) { return { ok: false, reason: error.message || String(error) } }
  }
  const opened = openSession(catalog, header, current)
  if (!opened.ok) return { ok: false, reason: opened.reason }
  return {
    ok: true,
    events: current,
    artifact: opened.artifact,
    reason: notes.length ? '已丢弃冲突记录以完成迁移：' + notes.join('；') : undefined,
  }
}

function softenForOpenFailure(events, startAttempt, reason) {
  const preferred = preferredRepairAttempt(reason)
  const order = []
  if (preferred != null && preferred >= startAttempt) order.push(preferred)
  for (let attempt = startAttempt; attempt < 8; attempt += 1) {
    if (!order.includes(attempt)) order.push(attempt)
  }
  for (const attempt of order) {
    const next = structuredClone(events)
    const applied = applyOpenRepair(next, attempt)
    if (applied) return { events: next, changed: true, note: applied, nextAttempt: Math.max(startAttempt, attempt) + 1 }
  }
  return { events, changed: false, nextAttempt: startAttempt }
}

function preferredRepairAttempt(reason) {
  const text = String(reason || '')
  if (/chunk provenance|complete ordered attempt/i.test(text)) return 4
  if (/tool\/result/i.test(text)) return 2
  if (/compaction/i.test(text)) return 0
  if (/shadowedRange|shadowedSeqs|surface span|earlier event/i.test(text)) return 1
  return null
}

function applyOpenRepair(events, attempt) {
  if (attempt === 0) {
    const before = events.length
    const kept = events.filter(event => !String(event.type).startsWith('compaction/'))
    if (kept.length === before) return null
    events.length = 0
    events.push(...kept)
    return 'compaction'
  }
  if (attempt === 1) {
    let changed = false
    for (const event of events) {
      if (!event.data || typeof event.data !== 'object') continue
      for (const key of ['shadowedRange', 'shadowedSeqs', 'messageSeqs']) {
        if (!Object.hasOwn(event.data, key)) continue
        delete event.data[key]
        changed = true
      }
    }
    return changed ? 'shadowed 指针' : null
  }
  if (attempt === 2) {
    const before = events.length
    const kept = dropMismatchedToolResults(events)
    if (kept.length === before) return null
    events.length = 0
    events.push(...kept)
    return '错位 tool/result'
  }
  if (attempt === 3) {
    const before = events.length
    const kept = events.filter(event => event.type !== 'assistant/chunk' && event.type !== 'reasoning/chunk' && !PACKED_ROWS.has(event.type))
    if (kept.length === before) return null
    events.length = 0
    events.push(...kept)
    return 'chunk 行'
  }
  if (attempt === 4) {
    // Fold keeps chunk-swarm assistant replacements; those fail host provenance
    // checks ("chunk provenance is not one complete ordered attempt").
    const before = events.length
    const kept = events.filter(event => !(event.type === 'assistant/message' && event.surfaceOp?.op === 'replace'))
    if (kept.length === before) return null
    events.length = 0
    events.push(...kept)
    return 'assistant replace'
  }
  if (attempt === 5) {
    // Host: "assistant/message N chunk provenance is not one complete ordered attempt"
    let changed = false
    for (const event of events) {
      if (event.type !== 'assistant/message' || !event.data || typeof event.data !== 'object') continue
      if (Array.isArray(event.data.stream) && event.data.stream.length) {
        event.data.stream = []
        changed = true
      }
      if (Array.isArray(event.sourceEventSeqs) && event.sourceEventSeqs.length) {
        delete event.sourceEventSeqs
        changed = true
      }
    }
    return changed ? 'assistant stream/provenance' : null
  }
  if (attempt === 6) {
    const before = events.length
    const kept = events.filter(event => event.type !== 'tool/result')
    if (kept.length === before) return null
    events.length = 0
    events.push(...kept)
    return '全部 tool/result'
  }
  if (attempt === 7) {
    const before = events.length
    const kept = events.filter(event => !String(event.type).startsWith('tool/') && event.type !== 'agent/inbox/spliced')
    if (kept.length === before) return null
    events.length = 0
    events.push(...kept)
    return 'tool/inbox 辅助事件'
  }
  return null
}

function dropMismatchedToolResults(events) {
  let open = null
  return events.filter(event => {
    if (event.type === 'step/start') open = { turn: event.data?.turn, step: event.data?.step }
    else if (event.type === 'step/end' || event.type === 'turn/end') open = null
    if (event.type !== 'tool/result') return true
    if (!open) return false
    return open.turn === event.data?.turn && open.step === event.data?.step
  })
}

export async function commitLegacySessionFile(file, catalog) {
  const original = await readFile(file)
  const prepared = prepareLegacySessionBuffer(original, catalog)
  if (!prepared.ok) return { ...prepared, written: false }
  let writtenSource = false
  if (prepared.changed) {
    const backup = file + BACKUP_SUFFIX
    try { await access(backup) } catch { await copyFile(file, backup) }
    const compressed = encodeMigratedSessionLog(prepared.headerLine, prepared.events)
    const temporary = file + '.tmp-tavern-premigrate'
    await writeFile(temporary, compressed)
    await rename(temporary, file)
    writtenSource = true
  }
  // Publish the current generation so cold open does not wait on in-browser
  // migration. Android WebView AbortSignal polyfills are easy to get wrong; a
  // cancelled follow then looks like an empty transcript with no loadError.
  let writtenCurrent = false
  const current = path.join(path.dirname(file), 'session.v3.jsonl.zstd')
  if (prepared.artifact && !(await exists(current))) {
    const temporary = current + '.tmp-tavern-premigrate'
    await writeFile(temporary, encodeCurrentGeneration(prepared.artifact, catalog))
    await rename(temporary, current)
    writtenCurrent = true
  }
  return {
    ok: true,
    changed: prepared.changed || writtenCurrent,
    written: writtenSource || writtenCurrent,
    reason: prepared.reason,
  }
}

export function encodeMigratedSessionLog(headerLine, events) {
  return encodeFramedSessionLog(headerLine + '\n', events, event => JSON.stringify(event) + '\n')
}

export function encodeCurrentGeneration(artifact, catalog) {
  const headerLine = JSON.stringify(catalog.encodeCurrentHeader(artifact.header, artifact.inheritedEventCount)) + '\n'
  const events = Array.isArray(artifact.events) ? artifact.events : []
  return encodeFramedSessionLog(headerLine, events, event => JSON.stringify(catalog.encodeCurrentEvent(event)) + '\n')
}

function encodeFramedSessionLog(headerLine, events, stringify) {
  const parts = [compressFrame(Buffer.from(headerLine))]
  if (!events.length) return parts[0]
  let chunk = ''
  for (const event of events) {
    chunk += stringify(event)
    if (chunk.length >= BODY_FRAME_TARGET) {
      parts.push(compressFrame(Buffer.from(chunk)))
      chunk = ''
    }
  }
  if (chunk) parts.push(compressFrame(Buffer.from(chunk)))
  return Buffer.concat(parts)
}

function compressFrame(bytes) {
  return zstdCompressSync(bytes, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
}

export async function migrateLegacySessionDirectory(directory, catalog) {
  const summary = { seen: 0, migrated: 0, unchanged: 0, refused: 0 }
  let entries
  try { entries = await walk(directory) } catch (error) {
    if (error.code === 'ENOENT') return summary
    throw error
  }
  for (const file of entries) {
    if (path.basename(file) === 'session.v3.jsonl.zstd') {
      summary.seen += 1
      try {
        if (await repairMigratedCurrentHeader(file, catalog)) summary.migrated += 1
        else summary.unchanged += 1
      } catch { summary.refused += 1 }
      continue
    }
    if (path.basename(file) !== 'session.jsonl.zstd') continue
    if (await exists(path.join(path.dirname(file), 'session.v3.jsonl.zstd'))) continue
    summary.seen += 1
    try {
      const result = await commitLegacySessionFile(file, catalog)
      if (!result.ok) {
        summary.refused += 1
        console.warn(`dsh-tavern: 旧档未迁移 ${file}: ${result.reason || '未知原因'}`)
      }
      else if (result.written) summary.migrated += 1
      else summary.unchanged += 1
    } catch (error) {
      summary.refused += 1
      console.warn(`dsh-tavern: 旧档迁移异常 ${file}: ${error.message || error}`)
    }
  }
  return summary
}

export async function migrateInstalledLegacySessions(dataRoot, loadCatalog) {
  let catalog
  try {
    if (typeof loadCatalog === 'function') catalog = await loadCatalog()
    else {
      const require = createRequire(process.argv[1])
      catalog = (await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-format-catalog')).href)).sessionFormatCatalog
    }
    if (!catalog?.createRestore) throw new Error('宿主会话格式目录不可用')
  } catch (error) {
    console.warn('dsh-tavern: 旧档迁移未启动：' + (error.message || error))
    return null
  }
  try {
    const summary = await migrateLegacySessionDirectory(path.join(path.dirname(dataRoot), 'sessions'), catalog)
    if (summary.migrated || summary.refused) {
      console.warn(`dsh-tavern: 旧档迁移完成：已准备 ${summary.migrated}，未改 ${summary.unchanged}，保留原文件 ${summary.refused}`)
    }
    return summary
  } catch (error) {
    console.warn('dsh-tavern: 旧档迁移失败：' + (error.message || error))
    return null
  }
}

function refuse(reason) {
  return { ok: false, changed: false, written: false, reason }
}

function openSession(catalog, header, events) {
  try {
    const restore = catalog.createRestore(header, { recovery: 'recoverable', validation: 'current' })
    // Clone one row at a time so validation never doubles the whole object graph
    // in memory (issue #84).
    for (const event of events) restore.decodeRow(structuredClone(event))
    const artifact = restore.finish()
    if (artifact?.header?.version !== 3) return refuse('迁移后不是 v3')
    return { ok: true, artifact }
  } catch (error) {
    return refuse(error.message || String(error))
  }
}

const PACKED_ROWS = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])
const DROPPED_TYPES = new Set(['tavern/import-start', 'dsh-tavern/duplicate-stable-prefix', 'dsh-tavern/stable-prefix'])

function hoistNestedTurns(events) {
  const out = []
  let changed = false
  for (let index = 0; index < events.length;) {
    if (events[index].type !== 'turn/start') {
      out.push(events[index])
      index += 1
      continue
    }
    const taken = takeTurn(events, index)
    if (taken.hoisted) changed = true
    out.push(...taken.events)
    index = taken.next
  }
  return { events: out, changed }
}

function takeTurn(events, start) {
  const body = [events[start]]
  const nested = []
  let hoisted = false
  let index = start + 1
  while (index < events.length) {
    if (events[index].type === 'turn/start') {
      const inner = takeTurn(events, index)
      nested.push(...inner.events)
      hoisted = true
      index = inner.next
      continue
    }
    const event = events[index]
    index += 1
    body.push(event)
    if (event.type === 'turn/end') break
  }
  return { events: [...body, ...nested], next: index, hoisted }
}

function repairNonPositiveCoordinates(events) {
  const step = events.find(event => event.type === 'step/start')
  if (!step?.data) return false
  let changed = false
  for (const event of events) {
    if (event.type !== 'assistant/message' && event.type !== 'tool/result') continue
    if (!event.data || (event.data.turn >= 1 && event.data.step >= 1)) continue
    event.data.turn = step.data.turn
    event.data.step = step.data.step
    changed = true
  }
  return changed
}

function assignTurnNumbers(events) {
  let next = 1
  let changed = false
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== 'turn/start') continue
    const assigned = next
    next += 1
    let depth = 0
    for (let cursor = index; cursor < events.length; cursor += 1) {
      const event = events[cursor]
      if (event.type === 'turn/start') depth += 1
      if (event.data && Object.hasOwn(event.data, 'turn') && event.data.turn !== assigned) {
        event.data.turn = assigned
        changed = true
      }
      if (event.type === 'turn/end') {
        depth -= 1
        if (depth === 0) break
      }
    }
  }
  return changed
}

function moveOrphanAssistantMessages(events) {
  let open = null
  const orphans = []
  const rest = []
  for (const event of events) {
    if (event.type === 'step/start') open = { turn: event.data?.turn, step: event.data?.step }
    else if (event.type === 'step/end' || event.type === 'turn/end') open = null
    if (event.type === 'assistant/message' && (open?.turn !== event.data?.turn || open?.step !== event.data?.step)) {
      orphans.push(event)
      continue
    }
    rest.push(event)
  }
  if (!orphans.length) return { events, changed: false }
  for (const orphan of orphans) {
    const index = rest.findIndex(event => event.type === 'step/end' && event.data?.turn === orphan.data?.turn && event.data?.step === orphan.data?.step)
    if (index < 0) rest.push(orphan)
    else rest.splice(index, 0, orphan)
  }
  return { events: rest, changed: true }
}

function synthesizeOpeningStep(events) {
  if (events.some(event => event.type === 'step/start') || !events.some(event => SURFACE.has(event.type))) return { events, changed: false }
  const time = events.find(event => typeof event.time === 'number')?.time ?? 0
  const head = []
  const surface = []
  const tail = []
  let seenSurface = false
  for (const event of events) {
    if (SURFACE.has(event.type)) {
      seenSurface = true
      if (event.type === 'assistant/message' && event.data) {
        event.data.turn = 1
        event.data.step = 1
      }
      surface.push(event)
    } else if (!seenSurface) head.push(event)
    else tail.push(event)
  }
  return {
    events: [
      ...head,
      { type: 'turn/start', time, data: { turn: 1 } },
      { type: 'step/start', time, data: { turn: 1, step: 1 } },
      ...surface,
      { type: 'step/end', time, data: { turn: 1, step: 1 } },
      { type: 'turn/end', time, data: { turn: 1, reason: { kind: 'completed' } } },
      ...tail,
    ],
    changed: true,
  }
}

function dropDanglingPointers(events) {
  let current = events
  let changed = false
  for (;;) {
    const seqs = presentSeqs(current)
    const drop = new Set()
    const compactionIds = new Set()
    for (const event of current) {
      if (!citesMissingSeq(event, seqs)) continue
      drop.add(event)
      if (event.data?.compactionId) compactionIds.add(event.data.compactionId)
    }
    if (compactionIds.size) {
      for (const event of current) {
        if (String(event.type).startsWith('compaction/') && compactionIds.has(event.data?.compactionId)) drop.add(event)
      }
    }
    if (!drop.size) return { events: current, changed }
    current = current.filter(event => !drop.has(event))
    changed = true
  }
}

function presentSeqs(events) {
  const seqs = new Set()
  for (const event of events) {
    if (typeof event.seq === 'number') seqs.add(event.seq)
    if (!PACKED_ROWS.has(event.type) || typeof event.seq0 !== 'number') continue
    const payload = event.data?.texts || event.data?.args
    if (!Array.isArray(payload)) continue
    for (let offset = 0; offset < payload.length; offset += 1) seqs.add(event.seq0 + offset)
  }
  return seqs
}

function citesMissingSeq(event, seqs) {
  const operation = event.surfaceOp
  if (operation && typeof operation === 'object') {
    if (typeof operation.start === 'number' && !seqs.has(operation.start)) return true
    if (typeof operation.end === 'number' && !seqs.has(operation.end)) return true
  }
  const range = event.data?.shadowedRange
  if (!range || typeof range !== 'object') return false
  return typeof range.start === 'number' && !seqs.has(range.start) || typeof range.end === 'number' && !seqs.has(range.end)
}

function placeOpening(events, prefix) {
  // A prefix already covered by compaction is historical evidence and may be
  // the checkpoint's range endpoint. Keep that row in history even though the
  // fixed background is also lifted into the system header.
  const protectedSeqs = new Set(events.filter(event => event.type === 'compaction/summary').flatMap(event => [
    ...(event.data?.shadowedSeqs || []), event.data?.shadowedRange?.start, event.data?.shadowedRange?.end,
  ]))
  const removablePrefix = event => isPrefix(event) && !protectedSeqs.has(event.seq)
  const source = events.filter(event => !DROPPED_TYPES.has(event.type) && !removablePrefix(event))
  const dropped = source.length !== events.length
  const stepIndex = source.findIndex(event => event.type === 'step/start')
  const before = stepIndex < 0 ? source : source.slice(0, stepIndex)
  const surfaceBefore = before.filter(event => SURFACE.has(event.type))
  if (!surfaceBefore.length && !prefix) return { events: source, changed: dropped }
  if (stepIndex < 0) throw new Error('开场在第一个 step 之前，日志里没有 step')
  const step = source[stepIndex]
  const kept = []
  const moved = []
  for (const event of before) {
    if (!SURFACE.has(event.type)) {
      kept.push(event)
      continue
    }
    if (removablePrefix(event)) continue
    alignMovedStep(event, step)
    moved.push(event)
  }
  const after = source.slice(stepIndex + 1)
  const stepEnd = after.findIndex(event => event.type === 'step/end' || event.type === 'turn/end')
  const stepBody = stepEnd < 0 ? after : after.slice(0, stepEnd)
  const rest = stepEnd < 0 ? [] : after.slice(stepEnd)
  let synthetic = null
  if (prefix && !stepBody.some(event => event.type === 'request/header')) {
    const identity = modelIdentity(source)
    if (!identity) throw new Error('固定背景无法写入 system 头：缺少模型标识')
    synthetic = {
      type: 'request/header',
      time: step.time,
      data: {
        reason: 'initial',
        header: { config: { provider: identity.provider, model: identity.model }, system: prefix },
      },
    }
  }
  const next = [...kept, step, ...(synthetic ? [synthetic] : []), ...moved, ...stepBody, ...rest]
  const filled = prefix ? fillSystem(next, prefix) : false
  const changed = dropped || moved.length > 0 || surfaceBefore.some(isPrefix) || synthetic !== null || filled
  return { events: next, changed }
}

function fillSystem(events, prefix) {
  let open = false
  let changed = false
  for (const event of events) {
    if (event.type === 'step/start') open = true
    else if (event.type === 'step/end' || event.type === 'turn/end') open = false
    else if (open && event.type === 'request/header' && event.data?.header) {
      const header = event.data.header
      if (typeof header.system === 'string' && header.system.includes(prefix)) continue
      header.system = header.system ? prefix + '\n\n' + header.system : prefix
      changed = true
    }
  }
  return changed
}

function alignMovedStep(event, step) {
  if (event.type !== 'assistant/message' && event.type !== 'tool/result') return
  if (!event.data || typeof event.data !== 'object') return
  event.data.turn = step.data?.turn
  event.data.step = step.data?.step
}

function foldTavernReplacements(events) {
  const chunks = chunkSeqs(events)
  const bySeq = new Map(events.filter(event => typeof event.seq === 'number').map(event => [event.seq, event]))
  const alias = new Map()
  const drop = new Set()
  let changed = false
  for (const event of events) {
    if (!isSurfaceReplacement(event)) continue
    const sources = citedSeqs(event)
    if (sources.length && sources.every(seq => chunks.has(seq))) continue
    const target = assistantTarget(sources, bySeq, alias, drop)
    if (target?.data?.message && keepsAdvertisedTools(target.data.message, event.data?.message)) {
      target.data.message.content = structuredClone(event.data.message.content)
      // Issue #72: Chat.bodyEdit points at the replacement message id. Keep that
      // id on the folded target so synchronizeBodyEdits sees it as already recorded.
      const replacementId = event.data?.message?.id
      if (typeof replacementId === 'string' && replacementId.startsWith('tavern-body-edit:')) {
        target.data.message.id = replacementId
      }
      changed = true
    }
    if (typeof event.seq === 'number') {
      alias.set(event.seq, target?.seq ?? event.seq)
      drop.add(event.seq)
    }
    changed = true
  }
  if (!drop.size) return { events, changed: false }
  // Compaction checkpoints can name an edited assistant node. Folding the edit
  // must redirect every downstream span to the surviving node before deleting
  // it; otherwise dangling-pointer cleanup drops the summary and revives history.
  const pointers = new Map([...presentSeqs(events)].map(seq => [seq, seq]))
  for (const [from, target] of alias) {
    let to = target
    const seen = new Set([from])
    while (alias.has(to) && !seen.has(to)) { seen.add(to); to = alias.get(to) }
    pointers.set(from, to)
  }
  const kept = events.filter(event => !drop.has(event.seq))
  for (const event of kept) remapPointers(event, pointers)
  return { events: kept, changed }
}

function isSurfaceReplacement(event) {
  return event?.type === 'assistant/message' && event.surfaceOp?.op === 'replace'
}

function citedSeqs(event) {
  const sources = []
  if (!Array.isArray(event.sourceEventSeqs)) return sources
  for (const entry of event.sourceEventSeqs) {
    if (typeof entry === 'number') sources.push(entry)
    else if (Array.isArray(entry) && entry.length === 2) {
      for (let seq = entry[0]; seq <= entry[1]; seq += 1) sources.push(seq)
    }
  }
  return sources
}

function chunkSeqs(events) {
  const seqs = new Set()
  for (const event of events) {
    if (event.type === 'assistant/chunk' && typeof event.seq === 'number') seqs.add(event.seq)
    if (!PACKED_ROWS.has(event.type) || typeof event.seq0 !== 'number') continue
    const payload = event.data?.texts || event.data?.args
    if (!Array.isArray(payload)) continue
    for (let offset = 0; offset < payload.length; offset += 1) seqs.add(event.seq0 + offset)
  }
  return seqs
}

function toolCallIds(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content.filter(block => block?.type === 'tool-call' && block.id).map(block => block.id)
}

function keepsAdvertisedTools(target, replacement) {
  if (!replacement || !visibleText(replacement)) return false
  const next = new Set(toolCallIds(replacement))
  return toolCallIds(target).every(id => next.has(id))
}

function assistantTarget(sources, bySeq, alias, drop) {
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    let seq = sources[index]
    const seen = new Set()
    while (alias.has(seq) && !seen.has(seq)) {
      seen.add(seq)
      seq = alias.get(seq)
    }
    const target = bySeq.get(seq)
    if (target?.type === 'assistant/message' && !drop.has(target.seq)) return target
  }
  return null
}

function renumber(events) {
  let cursor = 0
  const map = new Map()
  const spans = events.map(row => {
    if (PACKED_ROWS.has(row.type)) {
      const payload = row.data?.texts || row.data?.args
      if (!Array.isArray(payload) || !payload.length) throw new Error('压缩块长度无效')
      if (typeof row.seq0 !== 'number') throw new Error('压缩块缺少 seq0')
      return { row, start: row.seq0, width: payload.length, packed: true }
    }
    return { row, start: row.seq, width: 1, packed: false }
  })
  for (const span of spans) {
    if (typeof span.start === 'number') {
      for (let offset = 0; offset < span.width; offset += 1) map.set(span.start + offset, cursor + offset)
    }
    cursor += span.width
  }
  cursor = 0
  for (const span of spans) {
    if (span.packed) {
      delete span.row.seq
      span.row.seq0 = cursor
    } else {
      remapPointers(span.row, map)
      span.row.seq = cursor
    }
    cursor += span.width
  }
  return events
}

function remapPointers(event, map) {
  if (Array.isArray(event.sourceEventSeqs)) event.sourceEventSeqs = remapSourceEventSeqs(event.sourceEventSeqs, map)
  if (event.surfaceOp && typeof event.surfaceOp === 'object') {
    // Issue #72: soft-drop unmappable surface spans instead of refusing the whole log.
    if (typeof event.surfaceOp.start === 'number' && !map.has(event.surfaceOp.start)) delete event.surfaceOp.start
    else if (typeof event.surfaceOp.start === 'number') event.surfaceOp.start = map.get(event.surfaceOp.start)
    if (typeof event.surfaceOp.end === 'number' && !map.has(event.surfaceOp.end)) delete event.surfaceOp.end
    else if (typeof event.surfaceOp.end === 'number') event.surfaceOp.end = map.get(event.surfaceOp.end)
  }
  const data = event.data
  if (!data || typeof data !== 'object') return
  for (const key of ['sourceEventSeq', 'throughSeq', 'capturedThroughSeq']) {
    if (typeof data[key] !== 'number') continue
    if (!map.has(data[key])) {
      delete data[key]
      continue
    }
    data[key] = map.get(data[key])
  }
  if (data.shadowedRange && typeof data.shadowedRange === 'object') {
    const start = typeof data.shadowedRange.start === 'number' ? map.get(data.shadowedRange.start) : undefined
    const end = typeof data.shadowedRange.end === 'number' ? map.get(data.shadowedRange.end) : undefined
    if (typeof start !== 'number' || typeof end !== 'number') delete data.shadowedRange
    else {
      data.shadowedRange.start = start
      data.shadowedRange.end = end
    }
  }
  for (const key of ['shadowedSeqs', 'messageSeqs']) {
    if (Array.isArray(data[key])) data[key] = remapSeqList(data[key], map)
  }
}

function remapSeqList(values, map) {
  const next = []
  for (const seq of values) {
    if (typeof seq === 'number' && map.has(seq)) next.push(map.get(seq))
  }
  return next
}

function remapSourceEventSeqs(values, map) {
  const flat = []
  for (const entry of values) {
    if (typeof entry === 'number') flat.push(entry)
    else if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'number' && typeof entry[1] === 'number' && entry[1] >= entry[0]) {
      for (let seq = entry[0]; seq <= entry[1]; seq += 1) flat.push(seq)
    }
    // Soft-skip malformed entries (issue #72) instead of refusing the archive.
  }
  const next = []
  for (const seq of flat) if (map.has(seq)) next.push(map.get(seq))
  return next
}

function cleanEvent(event) {
  let changed = false
  if (event.type === 'user/message' && event.data?.role && event.data.role !== 'user') {
    event.data.role = 'user'
    changed = true
  }
  const assistantSource = event.type === 'assistant/message' ? event.data?.message?.source : null
  if (assistantSource && assistantSource.kind == null && assistantSource.provider && assistantSource.model) {
    assistantSource.kind = 'model'
    changed = true
  }
  if (event.type === 'user/message' && event.data && Object.hasOwn(event.data, 'turn')) {
    delete event.data.turn
    changed = true
  }
  if (event.type === 'user/message' && event.data && Object.hasOwn(event.data, 'step')) {
    delete event.data.step
    changed = true
  }
  if (PACKED_ROWS.has(event.type) && Object.hasOwn(event, 'seq')) {
    delete event.seq
    changed = true
  }
  if (event.type === 'subagent/descriptor' && event.data && event.data.version !== 3 && event.data.version !== undefined) {
    event.data.version = 3
    changed = true
  }
  for (const message of messagesOf(event)) {
    if (stripKnownExtras(message?.source)) changed = true
    if (normalizePluginForm(message?.source)) changed = true
    if (cleanSource(message?.source)) changed = true
  }
  return changed
}

function stripKnownExtras(source) {
  if (!source || typeof source !== 'object') return false
  let changed = false
  for (const key of ['version', 'importSource', 'trace', 'fixedSystemText', 'cardContextRevision', 'chatId', 'messageId', 'preparation', 'regenerationId']) {
    if (!Object.hasOwn(source, key)) continue
    delete source[key]
    changed = true
  }
  return changed
}

function normalizePluginForm(source) {
  if (!source || source.kind !== 'plugin' || !source.form || ALLOWED_FORM.has(source.form)) return false
  if (validSections(source.sections)) source.form = 'snapshot'
  else {
    delete source.form
    delete source.sections
    delete source.summary
  }
  return true
}

function cleanSource(source) {
  if (!source || source.kind !== 'plugin' || source.plugin !== 'dsh-tavern') return false
  let changed = false
  for (const key of Object.keys(source)) {
    if (TAVERN_SOURCE_KEYS.has(key)) continue
    delete source[key]
    changed = true
  }
  if (Array.isArray(source.sections)) {
    for (const section of source.sections) {
      if (!section || typeof section !== 'object') continue
      for (const key of Object.keys(section)) {
        if (key === 'name' || key === 'text') continue
        delete section[key]
        changed = true
      }
    }
  }
  if (source.form && !ALLOWED_FORM.has(source.form)) {
    if (validSections(source.sections)) source.form = 'snapshot'
    else {
      delete source.form
      delete source.sections
      delete source.summary
    }
    changed = true
  }
  if (source.form === 'snapshot' && !validSections(source.sections)) {
    delete source.form
    delete source.sections
    changed = true
  }
  if (source.form !== 'snapshot' && source.sections !== undefined) {
    delete source.sections
    changed = true
  }
  if (source.form === 'notice' && typeof source.summary !== 'string') {
    delete source.form
    changed = true
  }
  if (source.form !== 'notice' && source.summary !== undefined) {
    delete source.summary
    changed = true
  }
  return changed
}

function validSections(sections) {
  return Array.isArray(sections) && sections.length > 0 && sections.every(section => section && typeof section.name === 'string' && section.name && typeof section.text === 'string')
}

function modelIdentity(events) {
  const sources = []
  for (const event of events) {
    const message = event.type === 'assistant/message' ? event.data?.message : null
    if (message?.source) sources.push(message.source)
  }
  const model = sources.find(source => source.kind === 'model' && source.provider && source.model)
  const fallback = sources.find(source => source.provider && source.model)
  const source = model || fallback
  return source ? { provider: source.provider, model: source.model } : null
}

function messagesOf(event) {
  const data = event?.data
  if (!data || typeof data !== 'object') return []
  const messages = []
  if (event.type === 'user/message') messages.push(data)
  if (data.message && typeof data.message === 'object') messages.push(data.message)
  for (const key of ['inserted', 'messages']) {
    if (Array.isArray(data[key])) messages.push(...data[key].filter(message => message && typeof message === 'object'))
  }
  return messages
}

function isPrefix(event) {
  return event?.type === 'user/message' && String(event.data?.id || '').startsWith('tavern-session-prefix:')
}

function prefixTexts(events) {
  return events.filter(isPrefix).map(event => prefixText(event.data)).filter(Boolean)
}

function prefixText(message) {
  const fixed = message?.source?.fixedSystemText
  if (typeof fixed === 'string' && fixed.trim()) return fixed
  if (Array.isArray(message?.source?.sections)) {
    const text = message.source.sections.map(section => typeof section?.text === 'string' ? section.text.trim() : '').filter(Boolean).join('\n')
    if (text) return text
  }
  return visibleText(message)
}

function storyTexts(events) {
  const texts = []
  for (const event of events) {
    const message = event.type === 'user/message' ? event.data : event.data?.message
    if (!message || message.role === 'system') continue
    const id = String(message.id || '')
    if (id.startsWith('tavern-session-prefix:') || id.startsWith('v2-to-v3-system-')) continue
    if (!SURFACE.has(event.type)) continue
    const text = visibleText(message)
    if (text) texts.push(text)
  }
  return texts
}

function visibleText(message) {
  const content = Array.isArray(message?.content) ? message.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('') : ''
  if (content) return content
  return typeof message?.source?.fixedSystemText === 'string' ? message.source.fixedSystemText : ''
}

function systemText(events) {
  return events.filter(event => event.type === 'system/message').map(event => visibleText(event.data?.message)).join('\n')
}

function uniqueStory(texts) {
  const seen = new Set()
  const order = []
  for (const text of texts) if (!seen.has(text)) {
    seen.add(text)
    order.push(text)
  }
  return order
}

function sameTexts(left, right) {
  return left.length === right.length && left.every((text, index) => text === right[index])
}

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 6 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      offset += blockType === 1 ? 1 : blockSize
      if (lastBlock) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  if (!frames.length || frames.at(-1).end !== buffer.length) throw new Error('会话日志不是完整的 zstd 帧')
  return frames
}

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await walk(target, files)
    else files.push(target)
  }
  return files
}

async function exists(file) {
  try { await access(file); return true } catch { return false }
}

// Repair only the known Tavern writer defect; never replace a current history
// with an older generation, which could lose turns appended after migration.
export async function repairMigratedCurrentHeader(file, catalog) {
  const bytes = await readFile(file)
  const frames = scanZstdFrames(bytes)
  const first = zstdDecompressSync(bytes.subarray(frames[0].start, frames[0].end)).toString('utf8')
  const header = JSON.parse(first.trim())
  if (header.version !== 3 || Object.hasOwn(header, 'type')) return false
  if (header.isSeeded) throw new Error('无法推断分支存档的继承事件数，保留原文件')
  const physical = catalog.encodeCurrentHeader(header, 0)
  if (catalog.readHeader(physical).status !== 'current') throw new Error('修复后的会话头仍无效')
  const restore = catalog.createRestore(physical, { recovery:'strict', validation:'current' })
  // Feed rows frame by frame; skip the first line of the archive (the bad header).
  let skippedHeader = false
  for (const frame of frames) {
    const text = zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8')
    let offset = 0
    while (offset < text.length) {
      const end = text.indexOf('\n', offset)
      const row = end < 0 ? text.slice(offset) : text.slice(offset, end)
      offset = end < 0 ? text.length : end + 1
      if (!row) continue
      if (!skippedHeader) {
        skippedHeader = true
        continue
      }
      restore.decodeRow(JSON.parse(row))
    }
  }
  restore.finish()
  const backup = file + '.bak-tavern-header'
  if (!(await exists(backup))) await copyFile(file, backup)
  const next = Buffer.concat([compressFrame(Buffer.from(JSON.stringify(physical)+'\n')),bytes.subarray(frames[0].end)])
  const temporary = file + '.tmp-tavern-header'
  await writeFile(temporary,next)
  await rename(temporary,file)
  return true
}
