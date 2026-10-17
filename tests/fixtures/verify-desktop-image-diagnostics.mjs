// Optional installed-Desktop integration check. No live profile, credentials or
// paid endpoint is touched. Pass the app.asar.unpacked directory as argv[2].
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'
import { createImageGenerationModule } from '../../tavern-plugin/packages/dsh-image-gen/src/module.js'
import { createSceneImageHostLogger, createSceneImageDiagnostics } from '../../tavern-plugin/lib/domain/scene-image-diagnostics.js'

const desktop = process.argv[2]
if (!desktop) throw new Error('Pass the installed Desktop app.asar.unpacked directory')
const load = path => import(pathToFileURL(join(desktop, path)).href)
const { Context, Logger } = await load('node_modules/@deepseek-ai/cordis/lib/index.js')
const { default: AdmZip } = await load('node_modules/adm-zip/adm-zip.js')
const main = await readFile(join(desktop, 'lib/main.js'), 'utf8')
const logModule = /from "\.\/(log-files-[^"]+\.js)"/.exec(main)?.[1]
assert.ok(logModule, 'installed Desktop log module exists')
const { t: LogFileSink, r: shouldEmit } = await load('lib/' + logModule)
const exporterSource = main.split('//#region src/file-exporter.ts\n')[1]?.split('//#endregion')[0]
assert.ok(exporterSource, 'use the installed Desktop FileExporter implementation')
const FileExporter = new Function('Logger', 'shouldEmit', exporterSource + '\nreturn FileExporter')(Logger, shouldEmit)
const root = await mkdtemp(join(tmpdir(), 'tavern-desktop-diagnostics-'))
let exporter
try {
  const ctx = new Context()
  exporter = new FileExporter(new LogFileSink(join(root, 'logs'), { maxFileBytes: 1024 * 1024, maxDirectoryBytes: 4 * 1024 * 1024 }))
  const detach = ctx.logger.exporter(exporter)
  const onDiagnostic = createSceneImageHostLogger(ctx.logger)
  const values = new Map()
  const store = { readJson: async path => values.get(path), updateJson: async (path, fn) => { const next = fn(values.get(path)); values.set(path, next); return next } }
  let calls = 0
  const imageModule = createImageGenerationModule({ store, onDiagnostic,
    credentials: () => ({ resolve: async () => ({ value: 'DO-NOT-EXPORT-KEY' }) }),
    fetchImpl: async (_url, init) => {
      assert.equal(init.method, 'HEAD'); calls++
      throw new TypeError('fetch failed DO-NOT-EXPORT-KEY', { cause: Object.assign(new Error('private error'), { code: 'ECONNREFUSED' }) })
    }
  })
  assert.equal((await imageModule.test({ provider: 'novelai' })).status, 'failed')
  await createSceneImageDiagnostics(store, { onDiagnostic }).record('chat', {
    requestId: 'test-request', targetKey: 'test-target', status: 'failed', stage: 'generating', outcome: 'unconfirmed',
    details: { configuration: { provider: 'novelai', model: 'nai-diffusion-5-full' }, prompt: 'DO-NOT-EXPORT-STORY',
      providerRequests: [{ phase: 'response', status: 503, method: 'POST', durationMs: 10 }] }
  })
  detach(); exporter.close(); exporter = null
  const worker = new Worker(pathToFileURL(join(desktop, 'lib/diagnostic-export-worker.js')), {
    workerData: { userDataDir: root, logsDir: join(root, 'logs'), appVersion: 'integration-test', maxEvidenceBytes: 4 * 1024 * 1024 }
  })
  const [result] = await once(worker, 'message')
  assert.equal(result.ok, true, result.error)
  const zip = new AdmZip(result.path)
  const logs = zip.getEntries().filter(entry => entry.entryName.endsWith('.log'))
  assert.ok(logs.length > 0)
  const content = logs.map(entry => entry.getData().toString('utf8')).join('\n')
  for (const expected of ['dsh-tavern.scene-image', 'ECONNREFUSED', 'image.novelai.net', 'generation', '503']) assert.ok(content.includes(expected), expected)
  assert.doesNotMatch(content, /DO-NOT-EXPORT|private error/)
  assert.equal(calls, 1)
  console.log('PASS: image module -> Cordis logger -> installed Desktop FileExporter -> installed Desktop diagnostic ZIP; secrets and story omitted; one read-only request')
} finally {
  exporter?.close()
  await rm(root, { recursive: true, force: true })
}
