// In-memory host/client patch for DSH 0.1.5-rc.2. Official package files stay unchanged.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, sep } from 'node:path'

export async function prepareExpandedPatch(runtime, options = {}) {
  const expectedVersion = options.version ?? '0.1.6-alpha.2'
  const marker = 'dsh-tavern/required-session-patch-v1'
  const require = createRequire(join(runtime, 'package.json'))
  const originals = new Map()
  const urls = new Map()
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  // Tavern rollback preserves the original provider, so provider allowlists
  // cannot represent ownership. This experimental profile-wide fix permits
  // citations on replacement only, for every provider; append stays native.
  const own = "(event.surfaceOp?.op === 'replace')"
  async function source(name) {
    const path = require.resolve(name)
    const text = await readFile(path, 'utf8')
    originals.set(path, text)
    return { path, text }
  }
  function once(text, before, after) {
    assert.equal(text.split(before).length, 2, 'Pinned patch target drifted: ' + before)
    return text.replace(before, after)
  }
  async function compile(name, transform = text => text) {
    const { path, text } = await source(name)
    const localRequire = createRequire(path)
    function resolveSpecifier(specifier) {
      if (urls.has(specifier)) return urls.get(specifier)
      if (/^(node:|file:|data:)/.test(specifier)) return specifier
      return pathToFileURL(localRequire.resolve(specifier)).href
    }
    // data: modules cannot resolve bare specifiers. Rewrite both static and
    // dynamic imports (Windows persistence lazily `import("koffi")`).
    let modified = transform(text)
    modified = modified.replace(/\bfrom\s+"([^"]+)"/g, (_, specifier) => 'from ' + JSON.stringify(resolveSpecifier(specifier)))
    modified = modified.replace(/\bfrom\s+'([^']+)'/g, (_, specifier) => 'from ' + JSON.stringify(resolveSpecifier(specifier)))
    modified = modified.replace(/\bimport\s*\(\s*"([^"]+)"\s*\)/g, (_, specifier) => 'import(' + JSON.stringify(resolveSpecifier(specifier)) + ')')
    modified = modified.replace(/\bimport\s*\(\s*'([^']+)'\s*\)/g, (_, specifier) => 'import(' + JSON.stringify(resolveSpecifier(specifier)) + ')')
    modified = modified.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path).href))
    const url = 'data:text/javascript;base64,' + Buffer.from(modified).toString('base64')
    urls.set(name, url)
    return import(url)
  }
  function facade(name, selectedExports) {
    const text = `export * from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)};\nexport { ${selectedExports.join(', ')} } from ${JSON.stringify(urls.get(name))};`
    urls.set(name, 'data:text/javascript;base64,' + Buffer.from(text).toString('base64'))
  }
  const pkg = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8'))
  assert.equal(pkg.version, expectedVersion)
  const { Session } = await load('@deepseek-ai/dsh-session')
  const patchedSurface = await compile('@deepseek-ai/dsh-session/surface', text => once(text,
    "if (event.type === 'assistant/message' && raw !== undefined) {",
    `if (event.type === 'assistant/message' && raw !== undefined && !${own}) {`))
  const surfacePrototype = Object.getPrototypeOf(Session.create('patch-prototype-probe').surface)
  const surfaceDescriptors = Object.fromEntries(['validateNext', '_processDelta'].map(key => [key, Object.getOwnPropertyDescriptor(surfacePrototype, key)]))
  // Append admission, coverage validation, and system-head protection stay native.
  for (const key of Object.keys(surfaceDescriptors)) Object.defineProperty(surfacePrototype, key, Object.getOwnPropertyDescriptor(patchedSurface.SurfaceManager.prototype, key))
  const originalAppend = Session.prototype.append
  const markedSessions = new WeakSet()
  Session.prototype.append = function (type, data, ...args) {
    if (type === 'assistant/message' && args[0]?.surfaceOp?.op === 'replace' && !markedSessions.has(this)) {
      if (!this.snapshotEvents().some(event => event.type === marker)) {
        originalAppend.call(this, marker, { version: 1, hostVersion: pkg.version })
      }
      markedSessions.add(this)
    }
    return originalAppend.call(this, type, data, ...args)
  }
  const restoreSurface = () => {
    Session.prototype.append = originalAppend
    Object.defineProperties(surfacePrototype, surfaceDescriptors)
  }
  try {
    // Stored-event adoption has another bundled copy of the local validator.
    // Cloned storage modules use this copy; the already-live Session service
    // keeps its original identity and the prototype patch above.
    const patchedSession = await compile('@deepseek-ai/dsh-session', text => once(text,
      'if (event.type === "assistant/message" && raw !== void 0) throw',
      `if (event.type === "assistant/message" && raw !== void 0 && !${own}) throw`))
    // Only the in-memory cloned vocabulary understands this required marker.
    // Stock readers refuse the archive instead of treating the edit as a torn tail.
    patchedSession.KNOWN_SESSION_EVENT_TYPES.add(marker)
    // Preserve public class identities: service owners and error consumers
    // imported those classes before this patch. Only validation is replaced.
    facade('@deepseek-ai/dsh-session', ['adoptSessionEvent', 'snapshotSessionEvent', 'foldSurface', 'KNOWN_SESSION_EVENT_TYPES'])
    await compile('@deepseek-ai/dsh-session-persistence', text =>
      `import * as NativeErrors from ${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence')).href)};\n` +
      text.replace(/\bnew (Session\w+Error)\(/g, 'new NativeErrors.$1(').replace(/\binstanceof (Session\w+Error)\b/g, 'instanceof NativeErrors.$1'))
    facade('@deepseek-ai/dsh-session-persistence', ['validateStoredEvents'])
    await compile('@deepseek-ai/dsh-session-format-v2-to-v3', text => once(text,
      'if (event.type === "assistant/message" && sources !== void 0) throw',
      `if (event.type === "assistant/message" && sources !== void 0 && !${own}) throw`))
    const { sessionFormatCatalog: catalog } = await compile('@deepseek-ai/dsh-session-format-catalog')
    const { default: PatchedPersistence } = await compile('@deepseek-ai/dsh-session-persistence-jsonl')
    // Guard #74: Windows create/rename path does `await import("koffi")`. If the
    // bare specifier survived into the data: module, new chats fail immediately.
    {
      const encoded = urls.get('@deepseek-ai/dsh-session-persistence-jsonl')
      const decoded = Buffer.from(String(encoded).slice(String(encoded).indexOf(',') + 1), 'base64').toString('utf8')
      assert.doesNotMatch(decoded, /\bimport\s*\(\s*["']koffi["']\s*\)/)
      if (decoded.includes('koffi')) assert.match(decoded, /\bimport\s*\(\s*"file:[^"]*koffi[^"]*"\s*\)/)
    }
    const query = await compile('@deepseek-ai/dsh-session-query', text =>
      `import { SessionQueryError as NativeQueryError } from ${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-query')).href)};\n` +
      text.replace(/\bnew SessionQueryError\(/g, 'new NativeQueryError(').replace(/\binstanceof SessionQueryError\b/g, 'instanceof NativeQueryError') +
      '\nexport { SessionCorpus, SessionObservationReader };')
    const { text: originalClient } = await source('@deepseek-ai/dsh-api-session-controller/client')
    const clientSource = once(originalClient,
      'if (event.type === "assistant/message" && raw !== void 0) throw',
      `if (event.type === "assistant/message" && raw !== void 0 && !${own}) throw`)
    const undoPersistence = []
    return {
      catalog, patchedSurface, clientSource, marker,
      patchQuery(instance) {
        assert.equal(instance._observations.cache.size, 0, 'Install before querying Session history')
        for (const [target, prototype] of [
          [instance, query.SessionQueryEngine.prototype],
          [instance._corpus, query.SessionCorpus.prototype],
          [instance._observations, query.SessionObservationReader.prototype],
        ]) {
          const keys = Reflect.ownKeys(prototype).filter(key => key !== 'constructor')
          const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(target, key)]))
          for (const key of keys) Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(prototype, key))
          undoPersistence.push(() => {
            for (const [key, descriptor] of descriptors) {
              if (descriptor) Object.defineProperty(target, key, descriptor)
              else delete target[key]
            }
          })
        }
      },
      patchPersistence(instance) {
        // Existing handles must be closed before this experimental installation.
        // Install own methods on ONE backend instance, not its shared prototype.
        assert.equal(instance.tracker.openHandles.size, 0, 'Install before opening Session handles')
        assert.equal(instance.tracker.writers.size, 0, 'Install before acquiring Session writers')
        const keys = Reflect.ownKeys(PatchedPersistence.prototype).filter(key => key !== 'constructor')
        const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(instance, key)]))
        const format = instance.generationFormat
        for (const key of keys) Object.defineProperty(instance, key, Object.getOwnPropertyDescriptor(PatchedPersistence.prototype, key))
        instance.generationFormat = {
          ...format,
          currentVersion: catalog.currentVersion,
          createRestore: header => catalog.createRestore(header, { recovery: 'strict', validation: 'current' }),
          encodeHeader: (header, count) => catalog.encodeCurrentHeader(header, count),
          encodeEvent: event => catalog.encodeCurrentEvent(event),
        }
        instance.coldLogMemo.clear()
        undoPersistence.push(() => {
          for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(instance, key, descriptor)
            else delete instance[key]
          }
          instance.generationFormat = format
          instance.coldLogMemo.clear()
        })
      },
      async verifyFilesUnchanged() {
        const hashes = []
        for (const [path, text] of originals) {
          assert.equal(await readFile(path, 'utf8'), text)
          hashes.push({ packageFile: path.split('/node_modules/').at(-1), sha256: createHash('sha256').update(text).digest('hex') })
        }
        return hashes
      },
      dispose() {
        for (const undo of undoPersistence.reverse()) undo()
        restoreSurface()
      },
    }
  } catch (error) {
    restoreSurface()
    throw error
  }
}

export const SESSION_PATCH_PROTOCOL = 1
export const SESSION_PATCH_VERSION = '0.1.5-rc.2'
const INSTALLED = Symbol.for('dsh-tavern.host-session-patch.v1')
// Each entry lists every known-good bytes of that file for 0.1.5-rc.2.
// Official npm is always first. DSHA v0.1.5-rc2 rewrites two packages at
// packaging time (legacy rc.1 session shape + Android atomic publish); those
// variants keep the same Tavern replacement anchors and must be accepted.
const PINNED_SHA256 = Object.freeze({
  '@deepseek-ai/dsh-session/surface': Object.freeze(['aad7aaabe6cd9b39ae4cc3b50a2873c9b5d73b69d929051f31b18ecc13647c72']),
  '@deepseek-ai/dsh-session': Object.freeze(['05e94f57d96e7979670a5b51024c8591572eb0051ce793613dbdec35cf2c47bf']),
  '@deepseek-ai/dsh-session-persistence': Object.freeze(['0dc2a1634e4b6ebb558aac214009da3dc00f54f315762a56a1841d12baf770d4']),
  '@deepseek-ai/dsh-session-format-v2-to-v3': Object.freeze([
    '2d35e1e0ed497af569d5735fc590187de1568489cfe60d070b5f61330cd5a338',
    '8e7cc1aab2eef1099cbca390dd04c4a8ff3e6b3f64bd9e34e2357630b5e65af5',
  ]),
  '@deepseek-ai/dsh-session-format-catalog': Object.freeze(['bf4bde9e6563d7793f820c4a1b3141f6527283dd6c58f16bf43a67bc557cc48c']),
  '@deepseek-ai/dsh-session-persistence-jsonl': Object.freeze([
    '7d0640c9fc4be6c703b77605fdee6af519c542fae28a6cd4489353309812f062',
    'd387931d4ae848152411ec5f152064108b899bd9b5bd813c540afa2274703998',
  ]),
  '@deepseek-ai/dsh-session-query': Object.freeze(['c2a3954a0060942b179a92111cce556f27b8d659a4d815bb0e9defadbdb874da']),
  '@deepseek-ai/dsh-api-session-controller/client': Object.freeze(['ff33d1f85a0b2f14568fcb555d5f52d2ba5f57f2e0ecfa5d7885ba83e7ff6069']),
})

function hostRequireFrom(anchor) {
  return createRequire(createRequire(anchor).resolve('@deepseek-ai/dsh-tools'))
}

// The plugin file lives in this repo. The running host packages live next to
// the dsh launcher. Pick the copy that actually constructed the live store.
export async function defaultHostRequire(persistence) {
  const anchors = [fileURLToPath(new URL('../../package.json', import.meta.url))]
  if (process.argv[1]) anchors.push(process.argv[1])
  const found = []
  const errors = []
  for (const anchor of anchors) {
    try { found.push(hostRequireFrom(anchor)) }
    catch (error) { errors.push(error) }
  }
  if (!found.length) throw errors.at(-1) || new Error('无法解析宿主包')
  if (!persistence) return found[0]
  for (const candidate of found) {
    const loaded = await import(pathToFileURL(candidate.resolve('@deepseek-ai/dsh-session-persistence')).href)
    if (Object.values(loaded).some(exported => typeof exported === 'function' && persistence instanceof exported)) return candidate
  }
  throw new Error('解析到的宿主包与正在运行的会话存储不是同一份')
}

function runtimeRoot(sessionFile) {
  const parts = sessionFile.split(sep)
  const index = parts.lastIndexOf('node_modules')
  if (index <= 0) throw new Error('无法从宿主包路径定位安装根目录')
  return parts.slice(0, index).join(sep)
}

function createHandle(fields) {
  const handle = {
    protocol: SESSION_PATCH_PROTOCOL,
    status: fields.status,
    serverReady: fields.status === 'ready',
    clientReady: false,
    hostVersion: fields.hostVersion || '',
    reason: fields.reason || '',
    clientReason: '',
    clientSource: fields.clientSource || '',
    confirmClient(report = {}) {
      if (this.status !== 'ready') return
      if (report.protocol !== SESSION_PATCH_PROTOCOL || report.installed !== true) {
        this.clientReady = false
        this.clientReason = report.reason || '客户端会话补丁没有装上'
        return
      }
      this.clientReady = true
      this.clientReason = ''
    },
    replacementAllowed() {
      return this.status === 'skipped' || (this.serverReady && this.clientReady)
    },
    blockReason() {
      if (this.status === 'failed') return this.reason
      if (this.serverReady && !this.clientReady) return this.clientReason || '页面尚未完成会话补丁握手，请刷新后再试'
      return this.reason || '会话补丁未就绪'
    },
    view() {
      const waitingForClient = this.serverReady && !this.clientReady
      return {
        protocol: this.protocol,
        status: this.status,
        ready: this.replacementAllowed(),
        serverReady: this.serverReady,
        clientReady: this.clientReady,
        hostVersion: this.hostVersion,
        reason: waitingForClient ? this.blockReason() : this.reason,
      }
    },
  }
  return handle
}

export async function installHostSessionPatch({ hostRequire, persistence, query } = {}) {
  let require
  try { require = hostRequire || await defaultHostRequire(persistence) }
  catch (error) {
    return createHandle({ status: 'failed', reason: '无法解析宿主 DSH 包：' + (error.message || error) })
  }
  let hostVersion = ''
  try {
    hostVersion = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8')).version || ''
  } catch (error) {
    return createHandle({ status: 'failed', reason: '无法读取宿主 Session 版本：' + (error.message || error) })
  }
  const loadSessionCatalog = async () => {
    const loaded = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-format-catalog')).href)
    return loaded.sessionFormatCatalog
  }
  const finish = fields => Object.assign(createHandle(fields), { loadSessionCatalog })
  if (hostVersion !== SESSION_PATCH_VERSION) return finish({ status: 'skipped', hostVersion })
  if (persistence?.[INSTALLED]) {
    const installed = persistence[INSTALLED]
    if (!installed.loadSessionCatalog) installed.loadSessionCatalog = loadSessionCatalog
    return installed
  }
  for (const [name, allowed] of Object.entries(PINNED_SHA256)) {
    let actual = ''
    try { actual = createHash('sha256').update(readFileSync(require.resolve(name))).digest('hex') }
    catch (error) {
      return finish({ status: 'failed', hostVersion, reason: '无法校验宿主文件 ' + name + '：' + (error.message || error) })
    }
    if (!allowed.includes(actual)) return finish({ status: 'failed', hostVersion, reason: '宿主文件与 0.1.5-rc.2 补丁清单不一致：' + name })
  }
  if (!persistence?.tracker?.openHandles || !persistence?.tracker?.writers) {
    return finish({ status: 'failed', hostVersion, reason: '宿主没有 JSONL 会话存储，不能安装补丁' })
  }
  if (persistence.tracker.openHandles.size || persistence.tracker.writers.size) {
    return finish({ status: 'failed', hostVersion, reason: '会话已经打开，不能热替换。请重启后再使用正文编辑、回退和重新生成。' })
  }
  if (!query?._observations?.cache || !query?._corpus) {
    return finish({ status: 'failed', hostVersion, reason: '宿主会话查询尚未就绪，不能安装补丁' })
  }
  if (query._observations.cache.size) {
    return finish({ status: 'failed', hostVersion, reason: '会话查询缓存已经建立，不能安装补丁。请重启后再试。' })
  }
  let patch
  try {
    patch = await prepareExpandedPatch(runtimeRoot(require.resolve('@deepseek-ai/dsh-session')), { version: SESSION_PATCH_VERSION })
    patch.patchPersistence(persistence)
    patch.patchQuery(query)
  } catch (error) {
    try { patch?.dispose() } catch { /* The installer already restored what it changed. */ }
    return finish({ status: 'failed', hostVersion, reason: '会话补丁安装失败：' + (error.message || error) })
  }
  const handle = finish({ status: 'ready', hostVersion, clientSource: patch.clientSource })
  handle.dispose = () => patch.dispose()
  Object.defineProperty(persistence, INSTALLED, { value: handle })
  return handle
}
