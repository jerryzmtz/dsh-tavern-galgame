// Child CPU includes inherited Node subprocesses, not Chromium/native children.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
const id = process.pid + '-' + randomUUID()
if (process.env.DSH_TEST_METRICS_DIR) process.on('exit', () => {
  try {
    fs.writeFileSync(path.join(process.env.DSH_TEST_METRICS_DIR, id + '.json'), JSON.stringify({ file: process.env.DSH_TEST_FILE, cpu: process.cpuUsage() }))
  } catch { /* A crashing/terminated child is reported as incomplete by the runner. */ }
})
