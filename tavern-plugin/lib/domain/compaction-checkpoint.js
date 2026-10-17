// The user/message a compaction writes in place of the summarized history.
// It stands for many old rounds, so no single chat row owns it.
const COMPACTION_PLUGINS = new Set(['compact', 'dsh-compaction-basic'])

export function isCompactionCheckpoint(event) {
  const source = event?.type === 'user/message' ? event.data?.source : null
  return source?.kind === 'plugin' && COMPACTION_PLUGINS.has(source.plugin)
}
