import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createCardPreparation } from '../../tavern-plugin/lib/domain/card-preparation.js'

const preparation = createCardPreparation()
export function validateSourceCard(filename) {
  if (typeof filename !== 'string' || !filename.endsWith('.json') || /[\\/\x00]/.test(filename) || filename === '.json') throw new Error('sourceCard 只能填写正式人物卡库中的 JSON 文件名')
}
export async function readSourceCard(runtimeHome, filename) {
  validateSourceCard(filename)
  const root = await realpath(path.join(runtimeHome, 'profile-data/tavern/data/resources/cards'))
  const source = await realpath(path.join(root, filename))
  if (!source.startsWith(root + path.sep)) throw new Error('来源人物卡不在正式人物卡库中')
  const bytes = await readFile(source)
  const document = JSON.parse(bytes.toString('utf8'))
  const exported = preparation.present({ card: document, as: 'sillytavern-v3' })
  const name = exported.data?.name
  if (typeof name !== 'string' || !name.trim()) throw new Error('来源人物卡没有有效名称')
  return { source, filename, bytes, name, sha256: createHash('sha256').update(bytes).digest('hex') }
}

