// Shared host/client display identity. Preserve original dialogue spelling and speech fields.
function forkStageDisplayUnits(parts, stripCodeQuote = forkStripBubbleCodeQuote, parse = typeof forkParseBubbles === "function" ? forkParseBubbles : require("./fork-bubble-line.cjs").forkParseBubbles) {
  const units = []
  // Use the same projected Markdown part boundaries as ForkBubbleMarkdown. Never
  // scan HTML interiors: a status frame may contain blank lines or bubble syntax.
  for (const part of parts) {
    if (part.kind !== 'markdown') continue
    let buffer = []
    function flush() {
      for (const block of buffer.join('\n').split(/\n\s*\n/)) {
        if (!block.trim() || /^\s*</.test(block) || /^\s*[-*_]{3,}\s*$/.test(block)) continue
        units.push({ kind: 'narration', text: block.trim() })
      }
      buffer = []
    }
    for (const original of String(part.text || '').split('\n')) {
      const line = stripCodeQuote(original)
      const segments = parse(line, false)
      const bubble = segments.find(segment => segment.kind === 'bubble')
      if (bubble || !segments.length) {
        flush()
        if (bubble) units.push({ kind: 'line', alias: bubble.alias, name: bubble.name, text: original.trim() })
        continue
      }
      // private fork (B4): an unparseable @bubble line is narration of its degraded text, never its raw syntax.
      buffer.push(segments.map(segment => segment.text).join('\n'))
    }
    flush()
  }
  return units
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {forkStageDisplayUnits};
