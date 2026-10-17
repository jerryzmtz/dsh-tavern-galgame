import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'

// Heuristic source guard, not a natural-language proof. Runtime mod placement is closed separately.
const rules = [
  ['phone', /[（(]\s*(?:手机|短信|SMS|phone)[^）)\n]*[）)]/i],
  ['plugin-marker', /\b[a-z][\w-]*###[^\n]*###/i],
  ['bubble-presentation', /@bubble(?:-voice)?\s*[:：][^|\n]*\|[^|\n]*\|[^|\n]+\||@bubble[^\n]*(?:配音语言|speech|\][ \t]*\|[ \t]*\[)/i],
  ['figure-selection', /每句按情景选一个差分|\[差分：/],
  ['status-output', /(?:输出|模型按约定格式)[^\n]*(?:<avra_status>|固定标签|标签|替换成\s*HTML)|状态美化依赖模型输出格式/],
  ['presentation-tag', /(?:<|\[|【|@)(?:bgm|sfx|cg|emote|expression|sound|item|phone|音效|漫符|表情|物品)(?:[\s:：=/>\]】]|$)/i],
  ['marker-instruction', /(?:正文|模型)[^\n]{0,50}(?:写|输出)[^\n]{0,40}标记|(?:write|emit|output)[^\n]{0,50}(?:marker|channel label|presentation tag)/i],
]

export function markerFindings(path, text) {
  // Also cover escaped literals in JS and card JSON, without executing templates.
  const decoded = text.replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  return decoded.split(/\r?\n/).flatMap((source, index) => rules.filter(([, pattern]) => pattern.test(source))
    .map(([rule]) => ({path, line:index + 1, rule, source:source.trim()})))
}

export function isBodyPromptSource(path) {
  if (!/\.(?:md|txt|json|[cm]?js|ts)$/.test(path)) return false
  if (/^(?:tavern-plugin\/prompts|fork\/skills|presets|examples)\//.test(path)) return true
  if (/^(?:fork|tavern-plugin)\/mods\//.test(path)) return /\/prompts\/|\/manifest\.json$/.test(path)
  return /^tavern-plugin\/lib\/(?!vendor\/)/.test(path)
    && /(?:prompt|foreground|dialogue-bubble|card-system)/.test(path)
}

export async function scanBodyPromptSources(root) {
  const found = []
  async function visit(relative) {
    for (const entry of await readdir(join(root, relative), {withFileTypes:true})) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'vendor') continue
      const path = relative + '/' + entry.name
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && isBodyPromptSource(path)) found.push(...markerFindings(path, await readFile(join(root,path),'utf8')))
    }
  }
  for (const root of ['tavern-plugin/prompts','tavern-plugin/lib','tavern-plugin/mods','fork/skills','fork/mods','presets','examples']) await visit(root)
  return found
}

export const findingKey = ({path, rule, source}) => JSON.stringify([path, rule, source])
export function compareMarkerAllowance(found, allowed) {
  const remaining = new Map()
  for (const row of allowed) remaining.set(findingKey(row), (remaining.get(findingKey(row)) || 0) + 1)
  const added = []
  for (const row of found) {
    const key = findingKey(row), count = remaining.get(key) || 0
    if (count) remaining.set(key, count - 1)
    else added.push(row)
  }
  return {added, stale:allowed.filter(row => remaining.get(findingKey(row)) > 0)}
}
