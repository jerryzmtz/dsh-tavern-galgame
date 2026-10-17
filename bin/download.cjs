'use strict'
// Shared network downloads for the installers and Windows Desktop package management.
// install.ps1 and install.sh embed this file verbatim because they run before any
// code is downloaded: edit it here, then run `node bin/build-installer-scripts.mjs`.
// Keep it dependency-free CommonJS for Node >= 22.19 (Desktop runs it under Electron).
//
// Timeouts follow one rule: a transfer fails when no bytes arrive for `stallMs`
// (slow but moving downloads keep going); `deadlineMs` is only a generous upper bound.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')

const RUNTIME_PATH = /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|cordis\.patch\.yml|install\.ps1|install\.sh|bin\/|config\/|presets\/|patches\/|tavern-plugin\/)/
const EXCLUDED_PART = new Set(['.', '..', 'docs', 'tests', '__tests__', 'testsets'])

class DownloadError extends Error {
  constructor(message, { reason, attempts = [], cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'DownloadError'
    this.reason = reason
    this.attempts = attempts
  }
}

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra })
}

const NETWORK_REASONS = [
  [/^(ENOTFOUND|EAI_AGAIN)$/, '域名解析失败'],
  [/^ECONNREFUSED$/, '连接被拒绝'],
  [/^(ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED)$/, '连接被中断'],
  [/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)$/, '连接超时'],
  [/^(ENETUNREACH|EHOSTUNREACH)$/, '网络不可达'],
  [/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL/, 'TLS 证书校验失败（可能被代理或安全软件拦截）'],
]

// One short Chinese reason per failure; the underlying error stays in `cause`.
function describeFailure(error) {
  if (!error) return '未知错误'
  if (error.code === 'STALLED' || error.code === 'DEADLINE' || error.code === 'HTTP' || error.code === 'CHECKSUM') return error.message
  if (error.name === 'TimeoutError') return '请求超时'
  if (error.name === 'AbortError') return '请求被中止'
  let current = error
  for (let depth = 0; current && depth < 4; depth++, current = current.cause) {
    const code = String(current.code || '')
    for (const [pattern, reason] of NETWORK_REASONS) if (pattern.test(code)) return `${reason}（${code}）`
  }
  return String(error.cause?.code || error.cause?.message || error.message || error)
}

const duration = ms => ms >= 60000 && ms % 60000 === 0 ? `${ms / 60000} 分钟` : `${Number((ms / 1000).toFixed(1))} 秒`

function hostOf(url) {
  try { return new URL(url).hostname } catch { return String(url) }
}

// Fetch one URL into memory, aborting when no data arrives for `stallMs`.
async function fetchBytes(url, { stallMs = 30000, signal, headers, onData, fetch: request = fetch } = {}) {
  const controller = new AbortController()
  let stalled = false, timer
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; controller.abort() }, stallMs) }
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  arm()
  try {
    const response = await request(url, { signal: combined, headers, redirect: 'follow' })
    if (!response.ok) {
      try { await response.body?.cancel() } catch {}
      throw failure('HTTP', `HTTP ${response.status}`, { status: response.status })
    }
    const total = Number(response.headers?.get?.('content-length')) || 0
    const chunks = []
    let received = 0
    if (response.body) for await (const chunk of response.body) {
      arm()
      const bytes = Buffer.from(chunk)
      chunks.push(bytes); received += bytes.length
      onData?.(received, total)
    }
    return Buffer.concat(chunks)
  } catch (error) {
    if (stalled) throw failure('STALLED', `${duration(stallMs)}没有收到数据`, { cause: error })
    throw error
  } finally { clearTimeout(timer) }
}

// Try `urls` in turn (cycling) until one returns bytes matching `sha256`/`size`.
async function download(urls, options = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
  if (!list.length) throw new TypeError('download() needs at least one URL')
  const { sha256, size, label = path.posix.basename(new URL(list[0]).pathname) || list[0], stallMs = 30000, deadlineMs,
    attempts = Math.max(2, list.length), retryDelayMs = 1000, signal, headers, onProgress, onAttempt, onRetry } = options
  const deadline = deadlineMs ? AbortSignal.timeout(deadlineMs) : undefined
  const limit = [signal, deadline].filter(Boolean)
  const combined = limit.length > 1 ? AbortSignal.any(limit) : limit[0]
  const records = []
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const url = list[(attempt - 1) % list.length]
    onAttempt?.({ url, host: hostOf(url), attempt, attempts })
    try {
      const bytes = await fetchBytes(url, { stallMs, signal: combined, headers, fetch: options.fetch,
        onData: (received, total) => onProgress?.({ url, host: hostOf(url), received, total, attempt, attempts }) })
      if (size !== undefined && bytes.length !== size) throw failure('CHECKSUM', `文件大小不符（应为 ${size} 字节，实际 ${bytes.length}）`)
      if (sha256 && createHash('sha256').update(bytes).digest('hex') !== String(sha256).toLowerCase()) throw failure('CHECKSUM', 'SHA-256 校验不符')
      return { bytes, url }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (deadline?.aborted) {
        last = failure('DEADLINE', `超过总时长上限 ${duration(deadlineMs)}`, { cause: error })
        records.push({ url, reason: last.message })
        break
      }
      last = error
      const reason = describeFailure(error)
      records.push({ url, reason })
      const willRetry = attempt < attempts
      onRetry?.({ url, host: hostOf(url), attempt, attempts, reason, willRetry, error })
      if (willRetry) {
        try { await delay(retryDelayMs * attempt, undefined, combined ? { signal: combined } : undefined) }
        catch { if (signal?.aborted) throw signal.reason; break }
      }
    }
  }
  const reason = describeFailure(last)
  throw new DownloadError(`${label} 下载失败（已尝试 ${records.length} 次）：${reason}`, { reason, attempts: records, cause: last })
}

// Download to `destination`; only a verified, complete file is ever published there.
async function downloadFile(urls, destination, options = {}) {
  const result = await download(urls, options)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const partial = `${destination}.download-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(partial, result.bytes)
    await fs.rename(partial, destination)
  } finally { await fs.rm(partial, { force: true }) }
  return result
}

function runtimeFiles(metadata) {
  if (!/^[0-9a-f]{40}$/i.test(String(metadata?.revision || ''))) throw new Error('运行清单缺少有效提交号')
  const files = (Array.isArray(metadata.files) ? metadata.files : [])
    .map(file => ({ ...file, path: String(file?.path || '') }))
    .filter(file => RUNTIME_PATH.test(file.path) && !file.path.split('/').some(part => EXCLUDED_PART.has(part)))
  for (const file of files) {
    if (file.path.includes('\\') || file.path.includes(':') || file.path.split('/').some(part => !part) || !/^[0-9a-f]{64}$/i.test(String(file.sha256 || ''))) {
      throw new Error(`运行清单包含无效文件：${file.path}`)
    }
  }
  if (!files.length) throw new Error('运行清单没有可下载的运行文件')
  return files
}

// Download the runtime files listed by a jsDelivr manifest into `destination`.
// Files whose bytes already match in `installed` are reused instead of downloaded.
async function downloadRuntime({ metadataUrl, rootUrl, destination, installed, concurrency = 6, stallMs = 30000,
  budgetMs = 300000, attempts = 2, status = () => {}, fetch: request, targetCommit = '' } = {}) {
  const source = hostOf(rootUrl)
  const { bytes } = await download([metadataUrl], { label: '运行清单', stallMs: Math.min(stallMs, 15000), attempts, fetch: request })
  const metadata = JSON.parse(bytes.toString('utf8'))
  const files = runtimeFiles(metadata)
  // The @main manifest can lag (CDN cache, or CI not yet published). When the app
  // asked for a specific commit, refuse a different one rather than silently
  // installing an older build; the caller falls back to another source.
  const target = String(targetCommit || '').trim().toLowerCase()
  if (/^[0-9a-f]{40}$/.test(target) && String(metadata.revision).toLowerCase() !== target) {
    throw new Error(`jsDelivr 运行清单（${String(metadata.revision).slice(0, 12)}）与目标版本（${target.slice(0, 12)}）不一致，可能尚未同步`)
  }
  const controller = new AbortController()
  const budget = AbortSignal.timeout(budgetMs)
  const signal = AbortSignal.any([controller.signal, budget])
  let next = 0, done = 0, reused = 0, received = 0
  const report = () => status(`下载代码（${source}）：${done}/${files.length} 文件，复用 ${reused}，已下载 ${(received / 1048576).toFixed(1)} MB`)
  report()
  const worker = async () => {
    while (next < files.length) {
      signal.throwIfAborted()
      const file = files[next++]
      const parts = file.path.split('/')
      let content
      if (installed) {
        try {
          const local = await fs.readFile(path.join(installed, ...parts))
          if (createHash('sha256').update(local).digest('hex') === file.sha256.toLowerCase()) { content = local; reused++ }
        } catch {}
      }
      if (!content) {
        const url = `${rootUrl}@${metadata.revision}/${parts.map(encodeURIComponent).join('/')}`
        content = (await download([url], { label: file.path, sha256: file.sha256, stallMs, attempts, signal, fetch: request,
          onRetry: ({ attempt, attempts: total, reason, willRetry }) => status(`下载失败（${source}）：${file.path}，${reason}；尝试 ${attempt}/${total}${willRetry ? '，正在重试' : '，将切换备用方案'}。`),
        })).bytes
        received += content.length
      }
      signal.throwIfAborted()
      const target = path.join(destination, ...parts)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
      done++
      report()
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
  } catch (error) {
    controller.abort()
    if (budget.aborted) throw new Error(`备用源下载超过 ${duration(budgetMs)}，将切换备用方案`, { cause: error })
    throw error
  }
  await fs.writeFile(path.join(destination, 'dsh-tavern-runtime.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  return metadata
}

const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']
const INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const envValue = (env, name) => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1]

function readInternetSettings() {
  const output = require('node:child_process').execFileSync('reg', ['query', INTERNET_SETTINGS], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  const values = {}
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_\w+\s+(.*?)\s*$/.exec(line)
    if (match) values[match[1]] = match[2]
  }
  return values
}

function proxyUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
}

// Windows "system proxy" (WinINET) is invisible to Node fetch, curl, git and pnpm,
// which only read HTTP(S)_PROXY. Translate it into those variables when none is set.
// Returns the variables to add plus a display summary without credentials.
function proxyEnvironment(env = process.env, { platform = process.platform, readSettings = readInternetSettings } = {}) {
  const added = {}
  const useEnvProxy = () => { if (envValue(env, 'NODE_USE_ENV_PROXY') === undefined) added.NODE_USE_ENV_PROXY = '1' }
  if (PROXY_KEYS.some(key => envValue(env, key))) {
    useEnvProxy()
    return { added, source: 'environment' }
  }
  if (platform !== 'win32') return { added, source: null }
  let settings
  try { settings = readSettings() } catch { return { added, source: null } }
  if (Number(settings.ProxyEnable) === 1 && settings.ProxyServer) {
    const entries = {}
    for (const part of settings.ProxyServer.split(';').map(item => item.trim()).filter(Boolean)) {
      const [scheme, address] = part.includes('=') ? part.split('=', 2) : ['*', part]
      entries[scheme.toLowerCase()] = address
    }
    const http = entries.http || entries['*']
    const https = entries.https || http
    if (http || https) {
      if (http) added.HTTP_PROXY = proxyUrl(http)
      if (https) added.HTTPS_PROXY = proxyUrl(https)
      if (envValue(env, 'NO_PROXY') === undefined) {
        const bypass = String(settings.ProxyOverride || '').split(';').map(item => item.trim())
          .filter(item => item && item !== '<local>' && !item.slice(1).includes('*'))
          .map(item => item.replace(/^\*/, ''))
        added.NO_PROXY = [...new Set(['localhost', '127.0.0.1', '::1', ...bypass])].join(',')
      }
      useEnvProxy()
      return { added, source: 'system', summary: new URL(added.HTTPS_PROXY || added.HTTP_PROXY).host }
    }
    if (entries.socks) return { added, source: 'unsupported', summary: '系统代理只提供 SOCKS，安装程序无法使用；请在代理软件中开启 HTTP 代理或 TUN 模式' }
  }
  if (settings.AutoConfigURL) return { added, source: 'pac', summary: '系统代理使用 PAC 自动配置脚本，安装程序无法读取；如下载失败，请在代理软件中开启 TUN 模式或设置 HTTPS_PROXY' }
  return { added, source: null }
}

// Apply proxyEnvironment() to `env` and, when env is this process's environment,
// to this process's own fetch (Node >= 24.5 can switch the global proxy at runtime).
function applyProxyEnvironment(env = process.env, options) {
  const result = proxyEnvironment(env, options)
  Object.assign(env, result.added)
  if (result.added.HTTPS_PROXY || result.added.HTTP_PROXY) {
    try { require('node:http').setGlobalProxyFromEnv?.(env) } catch {}
  }
  return result
}

function parseOptions(args) {
  const options = {}, rest = []
  for (let index = 0; index < args.length; index++) {
    const match = /^--([a-z0-9-]+)$/.exec(args[index])
    if (match) options[match[1]] = args[++index]
    else rest.push(args[index])
  }
  return { options, rest }
}

const seconds = (value, fallback) => (value === undefined ? fallback : Number(value) * 1000)

// CLI used by the installer scripts:
//   node download.cjs file <destination> [--sha256 H] [--stall S] [--deadline S] [--attempts N] <url>...
//   node download.cjs runtime <metadata-url> <root-url> <destination> [<installed-dir>] [--stall S] [--budget S]
//   node download.cjs proxy-env   prints KEY=VALUE lines to add (Windows system proxy)
async function main(argv) {
  const [command, ...args] = argv
  const { options, rest } = parseOptions(args)
  const status = message => console.log(`DSH_STATUS ${message}`)
  if (command === 'file') {
    const [destination, ...urls] = rest
    if (!destination || !urls.length) throw new Error('用法：download.cjs file <目标文件> <URL>...')
    await downloadFile(urls, destination, { sha256: options.sha256, stallMs: seconds(options.stall, 30000),
      deadlineMs: seconds(options.deadline, undefined), attempts: options.attempts ? Number(options.attempts) : undefined })
    return
  }
  if (command === 'runtime') {
    const [metadataUrl, rootUrl, destination, installed] = rest
    if (!metadataUrl || !rootUrl || !destination) throw new Error('用法：download.cjs runtime <清单 URL> <CDN 根 URL> <目标目录> [已安装目录]')
    const metadata = await downloadRuntime({ metadataUrl, rootUrl: rootUrl.replace(/\/+$/, ''), destination, installed,
      stallMs: seconds(options.stall, 30000), budgetMs: seconds(options.budget, 300000), status,
      targetCommit: process.env.DSH_TAVERN_TARGET_COMMIT })
    status(`下载代码完成：${metadata.revision.slice(0, 12)}`)
    return
  }
  if (command === 'proxy-env') {
    const { added, summary } = proxyEnvironment(process.env)
    for (const [key, value] of Object.entries(added)) console.log(`${key}=${value}`)
    if (summary) status(added.HTTPS_PROXY || added.HTTP_PROXY ? `使用系统代理：${summary}` : summary)
    return
  }
  throw new Error(`未知命令：${command || '(空)'}`)
}

module.exports = { download, downloadFile, downloadRuntime, describeFailure, runtimeFiles, proxyEnvironment, applyProxyEnvironment, DownloadError, RUNTIME_PATH }

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
