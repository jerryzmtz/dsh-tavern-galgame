import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createTavernStaticResourceCache,
  normalizeCacheableResourceUrl,
  projectCachedResourceBody
} from '../tavern-plugin/lib/domain/tavern-static-resource-cache.js'

import { verifyPublicHostname } from '../tavern-plugin/lib/http/public-hostname.js'

function response(body, mediaType, url) {
  const bytes = Buffer.from(body)
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: function (name) { return String(name).toLowerCase() === 'content-type' ? mediaType : (String(name).toLowerCase() === 'content-length' ? String(bytes.length) : null) } },
    arrayBuffer: async function () { return bytes }
  }
}

test('缓存的 ESM、CSS 和 HTML 子资源继续改写到本地缓存入口', function () {
  const moduleBody = projectCachedResourceBody({
    url: 'https://cdn.example.test/pkg/main.js',
    mediaType: 'application/javascript',
    body: Buffer.from('import x from "/dep.js"; import("https://other.example/a.js")')
  }).toString('utf8')
  assert.match(moduleBody, /static-assets\?url=https%3A%2F%2Fcdn\.example\.test%2Fdep\.js/)
  assert.match(moduleBody, /static-assets\?url=https%3A%2F%2Fother\.example%2Fa\.js/)

  const cssBody = projectCachedResourceBody({
    url: 'https://cdn.example.test/css/all.min.css',
    mediaType: 'text/css',
    body: Buffer.from('@import url(theme/base.css); @import "../shared/tokens.css"; @font-face{src:url(../webfonts/icons.woff2)}')
  }).toString('utf8')
  assert.match(cssBody, /static-assets\?url=https%3A%2F%2Fcdn\.example\.test%2Fcss%2Ftheme%2Fbase\.css/)
  assert.match(cssBody, /static-assets\?url=https%3A%2F%2Fcdn\.example\.test%2Fshared%2Ftokens\.css/)
  assert.match(cssBody, /static-assets\?url=https%3A%2F%2Fcdn\.example\.test%2Fwebfonts%2Ficons\.woff2/)

  const htmlBody = projectCachedResourceBody({
    url: 'https://cards.example.test/ui/index.html',
    mediaType: 'text/plain',
    body: Buffer.from('<link href="/ui.css"><img src="https://img.example/cg.png"><a href="https://example.org">原链接</a><iframe src="https://app.example/hud/"></iframe>')
  }).toString('utf8')
  assert.match(htmlBody, /static-assets\?url=https%3A%2F%2Fcards\.example\.test%2Fui\.css/)
  assert.match(htmlBody, /static-assets\?url=https%3A%2F%2Fimg\.example%2Fcg\.png/)
  assert.match(htmlBody, /<a href="https:\/\/example\.org">/)
  assert.match(htmlBody, /<iframe src="https:\/\/app\.example\/hud\/">/)
})

test('URL normalization requires HTTPS without credentials; network admission is a separate boundary', function () {
  assert.throws(() => normalizeCacheableResourceUrl('http://example.com/a.js'), /HTTPS/)
  assert.throws(() => normalizeCacheableResourceUrl('https://user:password@localhost/a.js'), /凭据/)
  for (const host of ['localhost', 'device.local', '127.0.0.1', '10.0.0.1', '192.168.1.2', '[::1]', '[fdfe:dcba:9876::52]', '[fd00::1]', '[fe80::1]']) {
    assert.equal(normalizeCacheableResourceUrl('https://' + host + '/a.js'), 'https://' + host + '/a.js')
  }
})

test('static cache rejects private DNS answers and IP literals before fetching, including redirects', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-private-cache-'))
  t.after(() => rm(rootDir, {recursive:true, force:true}))
  const calls = [], resolved = []
  const verifyHostname = url => verifyPublicHostname(url, async hostname => {
    resolved.push(hostname)
    return hostname === 'private.example' ? [{address:'93.184.215.14'}, {address:'192.168.1.2'}] : [{address:'93.184.215.14'}]
  })
  const cache = createTavernStaticResourceCache({rootDir, verifyHostname, fetch: async url => {
    calls.push(url)
    if (url.endsWith('/redirect.js')) return {status:302,headers:{get:()=> 'https://[fd00::52]/module.js'}}
    return response('export const ready=true;', 'application/javascript', url)
  }})
  for (const host of ['127.0.0.1', '192.168.1.2', '10.0.0.1', '172.16.0.1', '169.254.1.1', '0.0.0.0', '[::]', '[::1]', '[::ffff:127.0.0.1]', '[fd00::1]', '[fe80::1]', 'private.example']) {
    await assert.rejects(cache.get('https://' + host + '/module.js'), /private or reserved/)
  }
  assert.deepEqual(calls, [])
  assert.deepEqual(resolved, ['private.example'], 'IP literals do not pass through DNS')
  await assert.rejects(cache.get('https://cdn.example/redirect.js'), /private or reserved/)
  assert.deepEqual(calls, ['https://cdn.example/redirect.js'])
  assert.match((await cache.get('https://cdn.example/module.js')).body.toString(), /ready=true/)
})
