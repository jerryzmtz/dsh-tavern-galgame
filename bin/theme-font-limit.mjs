import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Fixed DSH 0.1.5-rc.2 only. Keep its existing setting, persistence and rendering.
const replacements = {
  'index.js': [
    ['const FONT_SIZE_MAX = 17;', 'const FONT_SIZE_MAX = 32;'],
    ['.min(12).max(17).default(14)', '.min(12).max(32).default(14)'],
  ],
  'client.js': [
    ['.min(12).max(17).default(14)', '.min(12).max(32).default(14)'],
    ['disabled: fontSize >= 17,', 'disabled: fontSize >= 32,'],
    ['px > 17) throw new Error(`font size ${px} is outside 12..17`)', 'px > 32) throw new Error(`font size ${px} is outside 12..32`)'],
    ['parsed <= 17 ? parsed : 14', 'parsed <= 32 ? parsed : 14'],
  ],
}

export function patchThemeFontLimit(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-theme' || manifest.version !== '0.1.5-rc.2') {
    throw new Error('字号补丁仅适用于 dsh-client-ui-theme 0.1.5-rc.2')
  }
  // Validate every anchor before writing; repeated installation is a no-op.
  const changes = Object.entries(replacements).map(([name, pairs]) => {
    const file = path.join(directory, 'lib', name)
    const before = readFileSync(file, 'utf8')
    let after = before
    for (const [from, to] of pairs) {
      if (after.split(from).length === 2 && !after.includes(to)) after = after.replace(from, to)
      else if (after.includes(from) || after.split(to).length !== 2) throw new Error(`字号补丁不匹配：${name}；未修改文件`)
    }
    return { file, before, after }
  }).filter(change => change.before !== change.after)
  const written = []
  try {
    for (const change of changes) {
      written.push(change)
      writeFileSync(change.file, change.after)
    }
  } catch (error) {
    for (const change of written.reverse()) writeFileSync(change.file, change.before)
    throw error
  }
  return changes.length > 0
}
