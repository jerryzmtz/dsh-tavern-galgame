#!/usr/bin/env node
import http from 'node:http'
import path from 'node:path'
import { readFile, readdir, realpath, stat, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createCaseRunner } from './lib/case-runner.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const allowed = name => /^(?:report\.(?:json|md)|card-sync\.json|events\.jsonl|(?:\d{2,}|failure)(?:[-.][a-zA-Z0-9_.-]+)?\.(?:json|md|png|jpg|jpeg|webp|gif))$/.test(name)
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

export async function createReportServer(resultsRoot, options = {}) {
  await mkdir(resultsRoot, { recursive: true, mode: 0o700 })
  const root = await realpath(resultsRoot)
  const runner = createCaseRunner({ casesRoot: here, ...options, resultsRoot: root })
  async function inside(relative) {
    const resolved = await realpath(path.resolve(root, relative))
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Not found')
    return resolved
  }
  async function runs() {
    const found = []
    async function visit(directory) {
      const entries = await readdir(directory, { withFileTypes: true })
      if (entries.some(e => e.name === 'report.json' && e.isFile())) {
        const file = path.join(directory, 'report.json')
        const info = await stat(file)
        let report
        try { report = JSON.parse(await readFile(file, 'utf8')) }
        catch { report = { name: path.basename(directory), status: 'unreadable', error: '报告暂时无法读取，请刷新重试' } }
        found.push({ id: Buffer.from(path.relative(root, directory)).toString('base64url'), directory: path.relative(root, directory),
          name: report.name || path.basename(directory), status: report.status, model: report.model,
          startedAt: report.startedAt, updatedAt: info.mtime.toISOString(), rounds: (report.steps || []).filter(s => s.action === 'say').length,
          error: report.error })
        return
      }
      for (const entry of entries) if (entry.isDirectory() && !['home', 'profiles', 'node_modules'].includes(entry.name) && !entry.name.startsWith('.')) await visit(path.join(directory, entry.name))
    }
    await visit(root)
    return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  async function runDirectory(id) {
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Not found')
    const directory = await inside(Buffer.from(id, 'base64url').toString('utf8'))
    await inside(path.relative(root, path.join(directory, 'report.json')))
    return directory
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'")
    const host = `127.0.0.1:${res.socket.localPort}`
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end('Forbidden'); return }
    const url = new URL(req.url, `http://${host}`)
    const json = data => { res.setHeader('Content-Type', mime['.json']); res.end(JSON.stringify(data)) }
    if (req.method !== 'GET' && !(req.method === 'POST' && ['/api/start', '/api/stop'].includes(url.pathname))) { res.writeHead(405); res.end(); return }
    try {
      if (['/api/start', '/api/stop'].includes(url.pathname)) {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        if (req.headers.origin !== `http://${host}`) { res.writeHead(403); res.end(); return }
        try { const job = url.pathname === '/api/stop' ? runner.stop(url.searchParams.get('directory')) : await runner.start(url.searchParams.get('id')); res.statusCode = 202; json(job) }
        catch (error) { res.statusCode = error.status || 500; json({ error: error.status ? error.message : '无法启动测试，请检查本地案例和结果目录' }) }
        return
      }
      if (url.pathname === '/api/cases') { json(await runner.cases()); return }
      if (url.pathname === '/api/job') { json(runner.status()); return }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return }
      if (url.pathname === '/api/runs') { json(await runs()); return }
      if (url.pathname === '/api/run') {
        const directory = await runDirectory(url.searchParams.get('id'))
        const report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'))
        const files = []
        for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isFile() && allowed(entry.name)) files.push({ name: entry.name, bytes: (await stat(path.join(directory, entry.name))).size })
        json({ report, files: files.sort((a, b) => a.name.localeCompare(b.name)) }); return
      }
      let file
      if (url.pathname === '/api/file') {
        const name = url.searchParams.get('name') || ''
        if (!allowed(name) || path.basename(name) !== name) throw new Error('Not found')
        const directory = await runDirectory(url.searchParams.get('id'))
        file = await inside(path.relative(root, path.join(directory, name)))
      } else {
        const assets = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' }
        if (!assets[url.pathname]) throw new Error('Not found')
        file = path.join(here, 'ui', assets[url.pathname])
      }
      const info = await stat(file)
      if (info.size > 32 * 1024 * 1024) { res.writeHead(413); res.end('文件超过 32 MB，请从本地结果目录打开。'); return }
      res.setHeader('Content-Type', mime[path.extname(file)] || 'text/plain; charset=utf-8')
      res.end(await readFile(file))
    } catch { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '文件不存在或暂时无法读取，请刷新重试' })) }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '4318' }, results: { type: 'string', default: path.join(here, 'results') }, 'runtime-home': { type: 'string' } } })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port 应为 0–65535')
  const server = await createReportServer(path.resolve(values.results), { runtimeHome: values['runtime-home'] && path.resolve(values['runtime-home']) })
  server.on('error', error => { console.error(error.message); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.log(`测试报告：http://127.0.0.1:${server.address().port}\n结果目录：${path.resolve(values.results)}`))
}
