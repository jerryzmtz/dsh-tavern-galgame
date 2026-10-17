import { createHash } from 'node:crypto'

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const stop = new Set(['的', '了', '是', '在', '和', '与', '也', '就', '都', '而', '着', 'the', 'a', 'an', 'and', 'of', 'to', 'in', 'is'])
const terms = text => [...segmenter.segment(String(text).normalize('NFKC').toLowerCase())]
  .filter(part => part.isWordLike && !stop.has(part.segment)).map(part => part.segment)

/** Bounded content cache, independent of Chat state and template execution. */
export function createWorldbookBm25() {
  const cache = new Map()
  let bytes = 0
  function document(text) {
    text = String(text || '')
    const key = createHash('sha256').update(text).digest('hex')
    if (cache.has(key)) {
      const value = cache.get(key); cache.delete(key); cache.set(key, value); return value
    }
    const words = terms(text), frequency = new Map()
    for (const word of words) frequency.set(word, (frequency.get(word) || 0) + 1)
    const value = { frequency, length: words.length, bytes: 128 + [...frequency.keys()].reduce((sum, word) => sum + Buffer.byteLength(word) * 2 + 64, 0) }
    if (value.bytes <= 8 * 1024 * 1024) {
      cache.set(key, value); bytes += value.bytes
      while (cache.size > 2048 || bytes > 8 * 1024 * 1024) {
        const oldest = cache.keys().next().value; bytes -= cache.get(oldest).bytes; cache.delete(oldest)
      }
    }
    return value
  }
  return function shortlist({ candidates, corpus = [], query }) {
    const total = candidates.reduce((n, item) => n + item.tokenCost, 0)
    const base = { ran: false, originalCount: candidates.length, retainedCount: candidates.length, thresholds: { count: 20, tokens: 8000 } }
    if (candidates.length <= 20 && total <= 8000) return { candidates, diagnostics: { ...base, reason: 'small-pool' } }
    const started = performance.now(), words = new Set(terms(query || ''))
    if (!words.size) return { candidates, diagnostics: { ...base, reason: 'empty-query' } }
    // Replace raw candidate bodies with the already rendered version. Never run
    // inactive templates for indexing; their literal text is only a prior.
    const bodies = new Map(corpus.map(item => [item.ref, String(item.title || '') + '\n' + String(item.content || '').replace(/<%[\s\S]*?%>/g, '')]))
    for (const item of candidates) bodies.set(item.ref, String(item.title || '') + '\n' + item.text)
    const docs = new Map(), df = new Map()
    let length = 0
    for (const [ref, text] of bodies) {
      const doc = document(text); docs.set(ref, doc); length += doc.length
      for (const word of words) if (doc.frequency.has(word)) df.set(word, (df.get(word) || 0) + 1)
    }
    const average = length / Math.max(1, docs.size) || 1
    const ranked = candidates.map((item, index) => {
      const doc = docs.get(item.ref)
      let score = 0
      for (const word of words) {
        const tf = doc.frequency.get(word) || 0
        if (tf) score += Math.log(1 + (docs.size - df.get(word) + 0.5) / (df.get(word) + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.length / average))
      }
      return { item, index, score }
    }).sort((a, b) => b.score - a.score || a.index - b.index)
    if (!ranked[0]?.score) return { candidates, diagnostics: { ...base, reason: 'no-overlap', elapsedMs: performance.now() - started } }
    // Soft budgets: retain the highest scoring entry whole, and do not split
    // score ties arbitrarily. The Agent remains the semantic decision maker.
    const kept = new Set()
    let tokens = 0
    for (let index = 0; index < ranked.length;) {
      let end = index + 1
      while (end < ranked.length && ranked[end].score === ranked[index].score) end++
      const group = ranked.slice(index, end)
      const cost = group.reduce((sum, row) => sum + row.item.tokenCost, 0)
      if (kept.size && (kept.size + group.length > 20 || tokens + cost > 8000)) break
      for (const row of group) kept.add(row.item.ref)
      tokens += cost
      index = end
    }
    const retained = candidates.filter(item => kept.has(item.ref))
    return { candidates: retained, diagnostics: { ...base, ran: true, retainedCount: retained.length, retainedTokens: tokens,
      elapsedMs: performance.now() - started, scores: ranked.map(row => ({ ref: row.item.ref, score: row.score, keep: kept.has(row.item.ref) })) } }
  }
}
