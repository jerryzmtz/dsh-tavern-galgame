import { readFile } from 'node:fs/promises'
import { redactMvuLoadError } from './mvu-diagnostics.js'

export const OFFICIAL_MVU_VERSION = Object.freeze({
  repository: 'https://github.com/MagicalAstrogy/MagVarUpdate',
  commit: '0a730cd4a9b99689d1135a49b542c780b977c24c',
  upstreamBundleSha256: '3b510787a95c7a51523dcbbb2beff5f13b3bd069abf973dec1fdb1f21eeea61f',
  bundleSha256: '8333353800b525fb6e01bd433fa429b347676b18fdff9565e751f311673ca378',
  assetUrl: '/api/dsh-tavern/vendor/magvarupdate/bundle.js'
})

const bundleUrl = new URL('../vendor/magvarupdate/host-build/artifact/bundle.js', import.meta.url)

function normalizeCrlf(body, crlfCount) {
  if (crlfCount === 0) return body
  const normalized = Buffer.allocUnsafe(body.length - crlfCount)
  let writeAt = 0
  for (let readAt = 0; readAt < body.length; readAt++) {
    if (body[readAt] === 13 && body[readAt + 1] === 10) continue
    normalized[writeAt++] = body[readAt]
  }
  return normalized
}

/** Cache loaded bytes only; failed reads can recover without restarting the server.
 * private fork: the artifact ships inside this package (installer downloads are
 * verified at that trust boundary), so it is not re-hashed per process; the
 * pinned bundleSha256 is its identity and ETag. */
export function createOfficialMvuBundleReader({ read = readFile } = {}) {
  let bundlePromise
  const diagnostic = { scope: 'current-server-process', phase: 'not-read', requests: 0, cacheHits: 0,
    assetPath: 'vendor/magvarupdate/host-build/artifact/bundle.js' }
  return Object.freeze({
    async read() {
      diagnostic.requests++
      if (bundlePromise !== undefined) diagnostic.cacheHits++
      if (bundlePromise === undefined) {
        const startedAt = Date.now()
        for (const key of ['error', 'errorCode', 'bytes', 'servedBytes', 'crlfCount', 'loneLfCount', 'normalizedLineEndings', 'completedAt', 'durationMs']) delete diagnostic[key]
        Object.assign(diagnostic, { phase: 'reading', startedAt })
        bundlePromise = Promise.resolve().then(() => read(bundleUrl)).then(function (body) {
          let crlfCount = 0, loneLfCount = 0
          for (let index = 0; index < body.length; index++) if (body[index] === 10) {
            if (body[index - 1] === 13) crlfCount++; else loneLfCount++
          }
          const canonicalBody = normalizeCrlf(body, crlfCount)
          Object.assign(diagnostic, {
            bytes: body.length, servedBytes: canonicalBody.length, crlfCount, loneLfCount,
            normalizedLineEndings: canonicalBody !== body,
            phase: 'loaded', completedAt: Date.now(), durationMs: Date.now() - startedAt
          })
          return Object.freeze({ body: canonicalBody, mediaType: 'text/javascript; charset=utf-8',
            etag: '"sha256-' + OFFICIAL_MVU_VERSION.bundleSha256 + '"', commit: OFFICIAL_MVU_VERSION.commit, sha256: OFFICIAL_MVU_VERSION.bundleSha256 })
        }).catch(error => {
          Object.assign(diagnostic, { phase: 'read-failed', errorCode: String(error.code || 'READ_FAILED').slice(0, 80) })
          Object.assign(diagnostic, { completedAt: Date.now(), durationMs: Date.now() - startedAt, error: redactMvuLoadError(error.message || error) })
          bundlePromise = undefined
          throw error
        })
      }
      return await bundlePromise
    },
    inspect() { return { ...diagnostic } }
  })
}

const reader = createOfficialMvuBundleReader()

/** Read the pinned official MagVarUpdate artifact from this package. */
export async function readOfficialMvuBundle() {
  return await reader.read()
}

export function inspectOfficialMvuAsset() {
  try { return reader.inspect() } catch {
    return { scope: 'current-server-process', phase: 'diagnostic-unavailable' }
  }
}
