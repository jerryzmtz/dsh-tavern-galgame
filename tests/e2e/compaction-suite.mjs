import { spawn } from 'node:child_process'
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const base = resolve(process.env.TAVERN_E2E_OUTPUT || join(source, 'output/e2e-compaction'))
await mkdir(base, { recursive: true })
const output = await mkdtemp(join(base, 'suite-'))
const cases = ['manual', 'foreground', 'background', 'both', 'rounds', 'overflow', 'provider-overflow', 'legacy']
const requested = process.argv.slice(2)
if (requested.some(name => !cases.includes(name))) throw Error('Scenarios: ' + cases.join(', '))
const queue = [...(requested.length ? requested : cases)], results = []
const started = Date.now()
// Two fully independent DSH homes/ports; never share user data or sessions.
async function worker() {
  while (queue.length) {
    const scenario = queue.shift()
    const directory = join(output, scenario)
    const start = Date.now()
    const child = spawn(process.execPath, [join(source, 'tests/e2e/gameplay.mjs'), `--compaction=${scenario}`], {
      cwd: source, env: { ...process.env, TAVERN_E2E_OUTPUT: directory }, stdio: ['ignore', 'pipe', 'pipe']
    })
    let log = ''
    child.stdout.on('data', data => { log += data; process.stdout.write(`[${scenario}] ${data}`) })
    child.stderr.on('data', data => { log += data; process.stderr.write(`[${scenario}] ${data}`) })
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    results.push({ scenario, code, ms: Date.now() - start, artifacts: directory })
    await writeFile(join(output, scenario + '.log'), log)
  }
}
await Promise.all([worker(), worker()])
const report = { status: results.every(result => result.code === 0) ? 'passed' : 'failed', ms: Date.now() - started, window: 32768, results }
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(`Compaction suite ${report.status}: ${report.ms} ms\nArtifacts: ${output}`)
if (report.status !== 'passed') process.exitCode = 1
