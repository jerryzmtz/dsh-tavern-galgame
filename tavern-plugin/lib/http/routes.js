import { FULL_PROMPT_TEMPLATE_ASSET_PREFIX, readFullPromptTemplateAsset } from '../domain/full-prompt-template-assets.js'
import { OFFICIAL_MVU_VERSION, readOfficialMvuBundle } from '../domain/official-mvu-assets.js'
import { TAVERN_CLIENT_ASSET_PREFIX, readTavernClientAsset } from '../domain/tavern-client-assets.js'
import { TAVERN_RELEASE_CAPABILITIES } from '../domain/release-capabilities.js'
import { serveAssetFile } from '../fork-http-file.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, resolveTavernRuntimeAsset } from '../domain/tavern-runtime-assets.js'
import { observeHttpRequests } from '../domain/http-performance-diagnostics.js'
import { projectCachedResourceBody } from '../domain/tavern-static-resource-cache.js'
import { redactMvuLoadError } from '../domain/mvu-diagnostics.js'
import { pluginMediaRange, slicePluginMediaStream } from '../domain/plugin-media.js'
import { PLUGIN_ASSET_PREFIX } from '../domain/plugin-assets.js'
import { isTrustedHostRequest } from './host-fence.js'

// A 50 MiB save/skill ZIP expands to 69,905,068 base64 bytes, plus its JSON envelope.
export const DEFAULT_RPC_BODY_LIMIT = 80 * 1024 * 1024

export function registerTavernHttpRoutes({
  ctx,
  widgetService, live2dFiles, LIVE2D_ROUTE_PREFIX,
  fontLibrary,
  dispatch,
  fileResources,
  helperHistoryAccess,
  mobileCardImport,
  performanceDiagnostics,
  runtimeGeneration,
  runtimeReadiness,
  sceneIllustrations,
  readPluginMediaFile,
  pluginAssets,
  sessionResources,
  str,
  tavernRemoteAssets,
  tavernStaticResources,
  exposeHandler,
}) {
  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    ctx.effect(() => observeHttpRequests(webServer.server, snapshot => performanceDiagnostics.http(snapshot)))
    // Fixed SillyTavern compatibility version for card-script feature probes.
    ctx.effect(() => {
      return webServer.register({
        kind: 'prefix',
        path: '/version',
        handler: async (req, res) => {
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
          if (pathname !== '/version') { res.writeHead(404); res.end('not found'); return }
          if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ pkgVersion: '1.12.14' }))
        }
      })
    })
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/dsh-tavern',
      handler: handleTavernRequest
    }), 'dsh-tavern: web route')
  }
  // In-process callers (the server script runtime) share these exact routes.
  exposeHandler?.(handleTavernRequest)

  async function handleTavernRequest(req, res) {
      {
        let pathname
        try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname) }
        catch { res.writeHead(400); res.end('invalid URL'); return }
        const cachedAssetMatch = /^\/api\/dsh-tavern\/remote-assets\/([0-9a-f]{64})(?:\/[^/]*)?$/i.exec(pathname)
        const readsStaticAsset = req.method === 'GET' && pathname === '/api/dsh-tavern/static-assets'
        const readsFullTemplate = req.method === 'GET' && pathname.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)
        const readsOfficialMvu = req.method === 'GET' && pathname === OFFICIAL_MVU_VERSION.assetUrl
        const readsRuntimeAsset = ['GET', 'HEAD'].includes(req.method) && pathname.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)
        const readsClientAsset = req.method === 'GET' && pathname.startsWith(TAVERN_CLIENT_ASSET_PREFIX)
        const readsPluginAsset = (req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith(PLUGIN_ASSET_PREFIX)
        const readsCachedAsset = req.method === 'GET' && cachedAssetMatch
        const readsCapability = req.method === 'GET' && ['/api/dsh-tavern/session-resource', '/api/dsh-tavern/helper-history'].includes(pathname)
        const cookieFree = req.method === 'GET' && (readsCapability || readsCachedAsset || readsStaticAsset || readsOfficialMvu || readsFullTemplate || readsRuntimeAsset || readsClientAsset || readsPluginAsset)
        if (cookieFree) {
          if (!isTrustedHostRequest(req)) {
            res.writeHead(403); res.end('forbidden'); return
          }
        } else {
          const connection = ctx.get('connection')
          const rejection = connection ? connection.requestRejection(req) : 503
          if (rejection) { res.writeHead(rejection); res.end('forbidden'); return }
        }
        const origin = req.headers.origin
        const sameOrigin = origin === 'http://' + req.headers.host || origin === 'https://' + req.headers.host
        if (origin && !sameOrigin && !(cookieFree && origin === 'null')) {
          res.writeHead(403); res.end('forbidden'); return
        }
        if (pathname === '/api/dsh-tavern/session-resource' && req.method === 'GET') {
          const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, max-age=600',
            'Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}
          try {
            const json = await sessionResources.read(new URL(req.url, 'http://localhost').searchParams.get('cap'))
            res.writeHead(200, headers); res.end(json)
          } catch (_) {
            res.writeHead(403, {...headers, 'Cache-Control':'no-store'})
            res.end(JSON.stringify({error:'Resource unavailable; refresh the session'}))
          }
          return
        }
        if (pathname === '/api/dsh-tavern/helper-history' && req.method === 'GET') {
          const target = new URL(req.url, 'http://localhost')
          const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'}
          try {
            const result = await helperHistoryAccess.read(target.searchParams.get('cap'), Number(target.searchParams.get('from')), Number(target.searchParams.get('to')))
            res.writeHead(200,headers); res.end(JSON.stringify(result))
          } catch (_) { res.writeHead(403,headers); res.end(JSON.stringify({error:'History unavailable; refresh the session'})) }
          return
        }
        // Voice grants and paid asset generation still require an explicit same-origin carrier.
        const figureVoiceRoute = /^\/api\/dsh-tavern\/(?:getFigureVoiceEditor|listFigureVoiceChoices|assignFigureVoice|previewFigureVoice|openFigureVoicePreview|closeFigureVoicePreview)$/.test(pathname)
        const assetGenerationRoute = /^\/api\/dsh-tavern\/(?:prepareAssetGeneration|generateAssetCandidate|getAssetGenerationJob|cancelAssetGenerationJob|listAssetCandidates|readAssetCandidate|rejectAssetCandidate|retryAssetCandidateSave|acceptAssetCandidate|getAssetGenPrompts|setAssetGenPrompt)$/.test(pathname)
        if ((figureVoiceRoute || assetGenerationRoute) && (!sameOrigin || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
          res.writeHead(403); res.end('forbidden'); return
        }
        const gameplayRoute = pathname.startsWith('/api/dsh-tavern/gameplay.')
        const sceneImageRoute = TAVERN_RELEASE_CAPABILITIES.sceneImages && /^\/api\/dsh-tavern\/(?:scene-image|scene-image-artist-preview|scene-image-stored|listSceneImageHistory|removeSceneImageHistory|getSceneImageSettings|saveSceneImageSettings|testSceneImageConnection|listSceneImageModels|testSceneImageGeneration|sceneImageStatus|recordSceneImageInteraction|generateSceneImage|retrySceneImageSave|cancelSceneImage|removeSceneImage|setSceneImageReference)$/.test(pathname)
        if (req.method === 'GET' && pathname === '/api/dsh-tavern/runtime-generation') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0'
          })
          res.end(JSON.stringify({ ok: true, runtimeGeneration }))
          return
        }
        try {
          if (readsFullTemplate) {
            const asset = await readFullPromptTemplateAsset(pathname)
            if (!asset) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); return }
            res.writeHead(200, { 'Content-Type': asset.mediaType, 'Content-Length': asset.body.length,
              'ETag': asset.etag, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' })
            res.end(asset.body)
            return
          }
          if (readsClientAsset) {
            const asset = await readTavernClientAsset(pathname)
            if (asset === undefined) {
              res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'no-cache',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff'
            })
            res.end(asset.body)
            return
          }
          if (readsPluginAsset) {
            const asset = pluginAssets ? await pluginAssets.read(pathname) : undefined
            if (asset === undefined) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); return }
            // Opened directly (an SVG, say), an asset runs no script with the page's rights.
            const headers = { 'Content-Type': asset.mediaType, 'Accept-Ranges': 'bytes', ETag: asset.etag, 'Cache-Control': 'no-cache',
              'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' }
            if (req.headers['if-none-match'] === asset.etag) { res.writeHead(304, headers); res.end(); return }
            const range = pluginMediaRange(req.headers.range, asset.length)
            if (range && range.invalid) { res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + asset.length }); res.end(); return }
            const start = range ? range.start : 0, end = range ? range.end : asset.length - 1
            res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': Math.max(0, end - start + 1), ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + asset.length } : {}) })
            if (req.method === 'HEAD' || end < start) { res.end(); return }
            const stream = asset.stream(start, end)
            res.on('close', () => stream.destroy())
            stream.on('error', () => res.destroy())
            stream.pipe(res)
            return
          }
          if (readsRuntimeAsset) {
            const asset = await resolveTavernRuntimeAsset(pathname)
            // The stage kit is unversioned fork code; pinned vendor files stay immutable.
            await serveAssetFile(req, res, asset.file, asset.mediaType,
              pathname.includes('/stage-kit/') || pathname.endsWith('/pixi-spine.js') || pathname.endsWith('/pixi-live2d-display-cubism4.min.js') ? 'no-cache' : 'public, max-age=31536000, immutable',
              { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' })
            return
          }
          const readiness = await runtimeReadiness
          if (!readiness.ok) throw readiness.error
          if (await fontLibrary.serve(req, res)) return
          if (req.method === 'GET' && pathname.startsWith(LIVE2D_ROUTE_PREFIX + 'core/')) { // private fork: galgame stage Live2D assets
            const file = live2dFiles ? await live2dFiles.read(decodeURIComponent(pathname.slice(LIVE2D_ROUTE_PREFIX.length))) : undefined
            if (file === undefined) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); return }
            res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.body.byteLength, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
            res.end(file.body)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/card-image') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = await fileResources.cardImagePreview(query.get('path'))
            if (image === undefined) {
              res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            // Revalidate instead of re-sending: the list mounts every thumbnail on each visit.
            if (req.headers['if-none-match'] === image.revision) {
              res.writeHead(304, { ETag: image.revision, 'Cache-Control': 'private, no-cache' })
              res.end()
              return
            }
            const body = await image.read()
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.byteLength, 'Cache-Control': 'private, no-cache', ETag: image.revision, 'X-Content-Type-Options': 'nosniff' })
            res.end(body)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/mobile-card-thumbnail') {
            const query = new URL(req.url, 'http://x').searchParams
            let thumbnail
            try { thumbnail = await mobileCardImport.thumbnail(query.get('id')) } catch { thumbnail = undefined }
            // JSON cards, unreadable images and unusual PNG variants fall back to a text placeholder.
            if (thumbnail === undefined) {
              res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': thumbnail.body.byteLength, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' })
            res.end(thumbnail.body)
            return
          }
          if (TAVERN_RELEASE_CAPABILITIES.sceneImages && req.method === 'GET' && pathname === '/api/dsh-tavern/scene-image-artist-preview') {
            const image = await sceneIllustrations.readArtistPreview(new URL(req.url, 'http://x').searchParams.get('id'))
            // The URL carries the preview revision, so a replaced image gets a new URL.
            res.writeHead(200, { 'Content-Type': image.mediaType, 'Content-Length': image.data.byteLength, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.data)
            return
          }
          if (TAVERN_RELEASE_CAPABILITIES.sceneImages && req.method === 'GET' && pathname === '/api/dsh-tavern/scene-image') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = await sceneIllustrations.readImage(query.get('sessionId'), Number(query.get('turn')), query.get('key'), query.get('versionId'))
            res.writeHead(200, { 'Content-Type': image.ref.mediaType, 'Content-Length': image.data.byteLength, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.data)
            return
          }
          if (TAVERN_RELEASE_CAPABILITIES.sceneImages && req.method === 'GET' && pathname === '/api/dsh-tavern/scene-image-stored') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = await sceneIllustrations.readStoredImage(query.get('chatId'), query.get('key'), query.get('versionId'))
            res.writeHead(200, { 'Content-Type': image.ref.mediaType, 'Content-Length': image.data.byteLength, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.data)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/plugin-media') {
            const query = new URL(req.url, 'http://x').searchParams
            const file = await readPluginMediaFile(query.get('sessionId'), query.get('id'))
            const headers = { 'Content-Type': file.mediaType, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }
            if (file.mediaType === 'application/octet-stream') headers['Content-Disposition'] = 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(file.name || 'file')
            if (file.data) {
              res.writeHead(200, { ...headers, 'Content-Length': file.length })
              res.end(file.data)
              return
            }
            const range = pluginMediaRange(req.headers.range, file.length)
            if (range && range.invalid) {
              res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + file.length })
              res.end()
              return
            }
            const aborter = new AbortController()
            res.on('close', () => aborter.abort())
            const start = range ? range.start : 0, end = range ? range.end : file.length - 1
            res.writeHead(range ? 206 : 200, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Length': Math.max(0, end - start + 1), ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + file.length } : {}) })
            try {
              for await (const chunk of slicePluginMediaStream(file.stream(aborter.signal), start, end)) {
                if (!res.write(chunk)) await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve) })
                if (aborter.signal.aborted) return
              }
              res.end()
            } catch { res.destroy() }
            return
          }
          if (readsOfficialMvu) {
            const asset = await readOfficialMvuBundle()
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'ETag': asset.etag,
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff',
              'X-DSH-Tavern-MVU-Commit': asset.commit
            })
            res.end(asset.body)
            return
          }
          if (readsCachedAsset) {
            const asset = await tavernRemoteAssets.readCached(cachedAssetMatch[1])
            if (!asset) {
              res.writeHead(404, { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            const body = projectCachedResourceBody({ url: asset.url, mediaType: asset.mediaType, body: Buffer.from(asset.content, 'utf8') })
            res.writeHead(200, {
              'Content-Type': str(asset.mediaType) + '; charset=utf-8',
              'Content-Length': body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff'
            })
            res.end(body)
            return
          }
          if (readsStaticAsset) {
            const target = new URL(req.url ?? '/', 'http://x')
            const asset = await tavernStaticResources.get(target.searchParams.get('url'))
            const body = projectCachedResourceBody(asset)
            res.writeHead(200, {
              'Content-Type': str(asset.mediaType),
              'Content-Length': body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff',
              'X-DSH-Tavern-Cache': asset.cache
            })
            res.end(body)
            return
          }
          const method = pathname.slice('/api/dsh-tavern'.length + 1)
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          // Ordinary scene-image calls carry ids and text: a hand-written prompt may be
          // 12000 characters (36 KB of Chinese) and a gallery batch delete 500 items.
          const sceneImageBodyLimit = method === 'saveSceneImageSettings' ? 2 * 1024 * 1024 : 256 * 1024
          const bodyChunks = []
          let bodyBytes = 0
          for await (const chunk of req) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            bodyBytes += bytes.length
            if (bodyBytes > DEFAULT_RPC_BODY_LIMIT) throw new Error('RPC request exceeds 80 MiB')
            if (assetGenerationRoute && bodyBytes > (method === 'prepareAssetGeneration' ? 45 * 1024 * 1024 : method === 'setAssetGenPrompt' ? 64 * 1024 : 16384)) throw new Error('素材生成请求过大')
            if (gameplayRoute && bodyBytes > 2 * 1024 * 1024) throw new Error('游戏 API 请求超过 2 MB')
            if (sceneImageRoute && bodyBytes > sceneImageBodyLimit) {
              throw new Error(method === 'saveSceneImageSettings'
                ? '无法保存生图配置：工作流与配置数据超过当前 2 MB 请求大小限制。请精简工作流后重试；这不是图片尺寸或显存不足。'
                : '生图请求数据超过 256 KB 大小限制，请缩短提示词或减少一次批量删除的图片后重试；这不是图片尺寸或显存不足。')
            }
            bodyChunks.push(bytes)
          }
          // HTTP chunks may split a UTF-8 code point. Decode only after joining bytes;
          // decoding each chunk corrupts Chinese snapshots and causes false conflicts.
          const body = Buffer.concat(bodyChunks, bodyBytes).toString('utf8')
          let args = {}
          try {
            args = body.trim() === '' ? {} : JSON.parse(body)
          } catch (err) {
            res.writeHead(400)
            res.end('bad json')
            return
          }
          const host = req.headers.host
          const origin = req.headers.origin
          const trustedOrigin = typeof origin === 'string' && [`http://${host}`, `https://${host}`].includes(origin) ? origin : undefined
          const result = await dispatch(method, args, {origin:trustedOrigin})
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(Object.assign({ ok: true }, result, { runtimeGeneration })))
        } catch (err) {
          if (readsOfficialMvu || readsFullTemplate || readsRuntimeAsset) {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
            res.end(JSON.stringify({ ok: false, error: redactMvuLoadError(err && err.message || err) }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: str(err && err.message || err),
            errorCode: typeof err?.code === 'string' ? err.code : undefined }))
        }
      }
  }
}
