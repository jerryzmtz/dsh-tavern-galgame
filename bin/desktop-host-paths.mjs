import { readlinkSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// Desktop packaging can move dependencies between app and app.asar.unpacked.
// A stale junction still identifies the selected installation; inspect its
// target without requiring the missing package to resolve first.
export function desktopHostAnchors(anchor) {
  const anchors = new Set([anchor])
  const require = createRequire(anchor)
  try { anchors.add(realpathSync(require.resolve('@deepseek-ai/dsh-agent'))) } catch {}
  for (const directory of require.resolve.paths('@deepseek-ai/dsh-agent') || []) {
    const link = path.join(directory, '@deepseek-ai', 'dsh-agent')
    try {
      const target = path.resolve(path.dirname(link), readlinkSync(link))
      anchors.add(path.join(target, 'package.json'))
    } catch {}
  }
  for (const candidate of [...anchors]) {
    const match = /^(.*[\\/]resources[\\/])(?:app|app\.asar|app\.asar\.unpacked)(?:[\\/]|$)/.exec(candidate)
    if (!match) continue
    anchors.add(path.join(match[1], 'app', 'package.json'))
    anchors.add(path.join(match[1], 'app.asar.unpacked', 'package.json'))
  }
  return [...anchors]
}
