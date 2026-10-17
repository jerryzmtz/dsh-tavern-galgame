import { randomUUID } from 'node:crypto'
const PATH = 'regex-library.json'
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)

/** Accept SillyTavern regex exports: one script, an array, or an object holding regex_scripts. */
export function regexScriptsFromImport(text, fileName = '') {
  let value
  try { value = JSON.parse(String(text || '')) } catch { throw new Error('不是有效的 JSON 文件: ' + fileName) }
  const scripts = Array.isArray(value) ? value : Array.isArray(value?.regex_scripts) ? value.regex_scripts : [value]
  if (!scripts.length) throw new Error('文件里没有正则: ' + fileName)
  return scripts.map((script, index) => {
    if (!object(script) || typeof script.findRegex !== 'string' || !script.findRegex.trim()) throw new Error('不是酒馆正则（缺少 findRegex）: ' + fileName + (scripts.length > 1 ? ' 第 ' + (index + 1) + ' 条' : ''))
    return JSON.parse(JSON.stringify(script))
  })
}

/** Inert storage: regexes here never run until an agent copies them into a card or preset. */
export function createRegexLibrary({ store, now = Date.now }) {
  async function list() { return (await store.readJson(PATH))?.items || [] }
  async function importFile(text, fileName) {
    const items = regexScriptsFromImport(text, fileName).map(script => ({
      id: randomUUID(), name: String(script.scriptName || script.name || fileName || '未命名正则').trim().slice(0, 120), script, importedAt: now()
    }))
    await store.updateJson(PATH, value => ({ version: 1, items: [...(value?.items || []), ...items] }))
    return items
  }
  async function remove(input) {
    await store.updateJson(PATH, value => {
      const items = value?.items || []
      const item = items.find(item => item.id === input?.id)
      if (!item) throw new Error('正则不存在，请刷新后重试')
      if (JSON.stringify(item) !== JSON.stringify(input.expected)) throw new Error('正则已被修改，请刷新后重试')
      return { ...value, items: items.filter(other => other !== item) }
    })
  }
  return { list, importFile, remove }
}
