import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = file => readFile(new URL('../packaging/windows/' + file, import.meta.url), 'utf8')

test('Tavern runtime and its shortcuts share one AppUserModelID distinct from DSH Desktop', async () => {
  const portable = await read('tavern-portable.js')
  const launcher = await read('Launcher.cs')
  const runtimeId = portable.match(/const TAVERN_APP_ID = '([^']+)'/)?.[1]
  const shortcutId = launcher.match(/const string AppUserModelId="([^"]+)"/)?.[1]
  assert.equal(runtimeId, 'ai.deepseek.dsh.tavern')
  assert.equal(shortcutId, runtimeId)
  // The bundled Desktop re-applies its stock id after startup; the override must catch that call too.
  assert.match(portable, /app\.setAppUserModelId = \(\) => setAppUserModelId\(TAVERN_APP_ID\)/)
  // Shortcuts carry System.AppUserModel.ID (PKEY_AppUserModel_ID, pid 5) before they are saved.
  assert.match(launcher, /9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"\),PropertyId=5/)
  assert.ok(launcher.indexOf('store.Commit()') < launcher.indexOf('.Save(Path.Combine(folder,"DSH Tavern.lnk"),true)'))
})
