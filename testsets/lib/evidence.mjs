import { writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export { nativeResult, eventsAfterSeq } from '../../tavern-plugin/lib/domain/native-turn-result.js'

export async function saveJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}
