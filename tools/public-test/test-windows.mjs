// private fork: one OS process per file; bounded browser and exclusive lanes.
// Set DSH_BOOT_MODULE and NODE_OPTIONS (resolve-fallback.mjs) before running.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { discoverTests, gitChanges, buildGraph, selectChanged, classifyTests, schedule } from './test-windows-policy.mjs'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const args = process.argv.slice(2)
let name = 'test-final', list, changedRef, dryRun = false
let jobs = Math.min(8, Math.max(1, os.availableParallelism() - 2)), browserJobs = 2
if (args[0] && !args[0].startsWith('--')) name = args.shift()
for (let i = 0; i < args.length; i++) {
  const [key, inline] = args[i].split(/=(.*)/s)
  if (key === '--dry-run') { dryRun = true; continue }
  if (!['--list', '--changed', '--jobs', '--browser-jobs'].includes(key)) throw new Error('Unknown option: ' + key)
  const value = inline ?? args[++i]
  if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key)
  if (key === '--list') list = value
  if (key === '--changed') changedRef = value
  if (key === '--jobs') jobs = Number(value)
  if (key === '--browser-jobs') browserJobs = Number(value)
}
if (!/^[a-z0-9-]+$/i.test(name)) throw new Error('Use a simple output directory name')
if (![jobs, browserJobs].every(value => Number.isInteger(value) && value >= 1 && value <= 32)) throw new Error('Concurrency must be an integer from 1 to 32')
if (list && changedRef) throw new Error('--list and --changed are mutually exclusive')
const allFiles = discoverTests(root), graph = buildGraph(root)
const selection = changedRef ? selectChanged(allFiles, gitChanges(root, changedRef), graph) : {
  files: list ? JSON.parse(fs.readFileSync(path.resolve(root, list), 'utf8')) : allFiles,
  changed: [], fallback: [],
}
if (!Array.isArray(selection.files) || selection.files.some(file => !allFiles.includes(file))) throw new Error('List must contain discovered test files only')
const files = [...new Set(selection.files)], classes = classifyTests(files, graph)
console.log(JSON.stringify({ selected: files.length, total: allFiles.length, jobs, browserJobs, fallback: selection.fallback }))
if (dryRun) {
  console.log(JSON.stringify({ ...selection, classes }, null, 2))
} else {
  if (process.platform !== 'win32') throw new Error('This runner requires Windows taskkill for child-tree timeouts')
  if (!process.env.DSH_BOOT_MODULE) throw new Error('Set DSH_BOOT_MODULE to the installed runtime boot module')
  const directory = path.join(process.env.DSH_TEST_OUTPUT_ROOT || path.join(root, '.preview'), name)
  fs.mkdirSync(directory, { recursive: true })
  if (fs.existsSync(path.join(directory, 'results.json'))) throw new Error('Output already exists; choose a new run name: ' + name)
  const metricsDirectory = path.join(directory, 'metrics')
  fs.mkdirSync(metricsDirectory, { recursive: true })
  const url = file => pathToFileURL(path.join(root, file)).href
  const env = {
    ...process.env, NODE_ENV: 'test', DSH_TEST_METRICS_DIR: metricsDirectory,
    NODE_OPTIONS: [process.env.NODE_OPTIONS || '', ...['tests/fixtures/runtime-module-resolution.mjs', 'tests/fixtures/no-dependency-links.mjs',
      'tools/public-test/test-windows-metrics.mjs'].map(file => '--import ' + url(file))].join(' '),
  }
  const results = [], started = Date.now()
  const write = (name, value) => fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n')
  write('selection', { ...selection, classes, jobs, browserJobs })
  write('results', results)
  await schedule(files, classes, { parallel: jobs, browser: browserJobs }, async (file, lane, slot) => {
    const begin = Date.now(), log = path.join(directory, file.replaceAll('/', '_') + '.log')
    const output = fs.openSync(log, 'w')
    const child = spawn(process.execPath, [
      '--import', url('tests/fixtures/host-session-patch-preload.mjs'),
      // The runner already isolates each file. Avoid a second Node and duplicate preload.
      '--test', '--test-isolation=none', '--test-reporter=tap', path.join(root, file),
    ], { cwd: root, env: { ...env, DSH_TEST_FILE: file }, stdio: ['ignore', output, output], windowsHide: true })
    let timedOut = false, spawnError, spawnMs
    child.once('spawn', () => { spawnMs = Date.now() - begin })
    const timer = setTimeout(() => {
      timedOut = true
      if (!child.pid) return
      const killed = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      if (killed.error || killed.status !== 0) console.error('Timeout cleanup failed:', file, killed.error || killed.stderr?.toString())
    }, 180000)
    const { code, signal } = await new Promise(resolve => {
      child.once('error', error => { spawnError = error.message })
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    clearTimeout(timer)
    fs.closeSync(output)
    const text = fs.readFileSync(log, 'utf8'), counts = {}
    for (const match of text.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)) counts[match[1]] = Number(match[2])
    results.push({ file, lane, slot, startMs: begin - started, code, signal, timedOut,
      ...(spawnError ? { spawnError } : {}), spawnMs, ms: Date.now() - begin, ...counts })
    write('results', results)
    if (code !== 0 || timedOut || counts.tests === undefined) console.log('FAIL ' + file + (timedOut ? ' TIMEOUT' : ''))
    if (results.length % 100 === 0) console.log('Completed ' + results.length + '/' + files.length)
  })
  let incompleteMetrics = 0
  const samples = fs.readdirSync(metricsDirectory).flatMap(file => {
    try { return [JSON.parse(fs.readFileSync(path.join(metricsDirectory, file), 'utf8'))] }
    catch { incompleteMetrics++; return [] }
  })
  for (const row of results) {
    const processes = samples.filter(sample => sample.file === row.file)
    row.nodeCpuMs = processes.reduce((sum, sample) => sum + (sample.cpu.user + sample.cpu.system) / 1000, 0)
    row.nodeProcesses = processes.length
  }
  write('results', results)
  const failed = results.filter(row => row.code !== 0 || row.timedOut || row.tests === undefined || row.fail || row.cancelled).map(row => row.file)
  const summary = {
    tier: changedRef ? 'changed' : list ? 'focused' : 'full', wallMs: Date.now() - started,
    jobs, browserJobs, incompleteMetrics, nodeCpuMs: results.reduce((sum, row) => sum + row.nodeCpuMs, 0),
    cpuScope: 'Node processes with exit metrics only; excludes Chromium/native children and forcibly terminated processes',
    fileSlotMs: results.reduce((sum, row) => sum + row.ms, 0),
    lanes: Object.fromEntries(['exclusive', 'parallel', 'browser'].map(lane => [lane, {
      files: results.filter(row => row.lane === lane).length,
      slotMs: results.filter(row => row.lane === lane).reduce((sum, row) => sum + row.ms, 0),
    }])),
    files: results.length, passedFiles: results.length - failed.length, failedFiles: failed.length,
    counts: Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled'].map(key => [key, results.reduce((sum, row) => sum + (row[key] || 0), 0)])),
    incompleteFiles: results.filter(row => row.tests === undefined).map(row => row.file),
    slowest: [...results].sort((a, b) => b.ms - a.ms).slice(0, 20).map(({ file, ms, lane }) => ({ file, ms, lane })), failed,
  }
  write('summary', summary)
  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = failed.length ? 1 : 0
}
