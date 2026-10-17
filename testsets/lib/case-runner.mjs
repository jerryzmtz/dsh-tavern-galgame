import path from 'node:path'
import { readdir, realpath, mkdtemp, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { loadScenario } from './scenario.mjs'

export function createCaseRunner({ casesRoot, resultsRoot, runtimeHome, launch = spawn }) {
  let active = null, processHandle = null
  async function cases() {
    const root = await realpath(casesRoot)
    const found = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name) || ['results', 'node_modules', 'profiles'].includes(entry.name)) continue
      const file = path.join(root, entry.name, 'scenario.yaml')
      try {
        const resolved = await realpath(file)
        if (!resolved.startsWith(root + path.sep)) continue
        const scenario = await loadScenario(resolved)
        found.push({ id: entry.name, name: scenario.name || entry.name, model: scenario.model, steps: scenario.steps, timeoutMs: scenario.timeoutMs })
      } catch (error) {
        if (error.code !== 'ENOENT') found.push({ id: entry.name, name: entry.name, error: '案例配置无效，请检查 scenario.yaml' })
      }
    }
    return found.sort((a, b) => a.id.localeCompare(b.id))
  }
  async function start(id) {
    if (['running', 'stopping'].includes(active?.status)) throw Object.assign(new Error('已有测试正在运行，请等待完成'), { status: 409 })
    // Reserve before asynchronous validation so concurrent clicks cannot launch twice.
    const job = { caseId: id, status: 'running', startedAt: new Date().toISOString() }
    active = job
    try {
      const item = (await cases()).find(item => item.id === id)
      if (!item) throw Object.assign(new Error('案例不存在'), { status: 404 })
      if (item.error) throw Object.assign(new Error(item.error), { status: 400 })
      await mkdir(resultsRoot, { recursive: true })
      const output = await mkdtemp(path.join(resultsRoot, 'manual-'))
      job.directory = path.basename(output)
      const child = launch(process.execPath, [path.join(casesRoot, 'test-play.mjs'), path.join(casesRoot, id, 'scenario.yaml'), '--output', output,
        ...(runtimeHome ? ['--runtime-home', runtimeHome] : [])], { shell: false, stdio: 'ignore' })
      processHandle = child
      child.once('error', () => { job.status = 'failed'; job.error = '测试进程启动失败'; job.finishedAt = new Date().toISOString() })
      child.once('exit', (code, signal) => {
        job.status = job.status === 'stopping' ? 'interrupted' : code === 0 ? 'completed' : 'failed'
        if (code !== 0 && job.status !== 'interrupted') job.error ||= signal ? '测试进程已中断，请查看报告' : '测试未通过，请查看报告；若无报告，请检查运行环境'
        job.finishedAt = new Date().toISOString()
      })
      return { ...job }
    } catch (error) { if (active === job) active = null; throw error }
  }
  function stop(directory) {
    if (!active || !directory || active.directory !== directory) throw Object.assign(new Error('测试任务已变化，请刷新后重试'), { status: 409 })
    if (active.status === 'stopping' || !['running'].includes(active.status)) return { ...active }
    if (!processHandle || !processHandle.kill('SIGTERM')) throw Object.assign(new Error('无法通知测试进程中止，请刷新状态后重试'), { status: 409 })
    active.status = 'stopping'
    return { ...active }
  }
  return { cases, start, stop, status: () => active && { ...active } }
}
