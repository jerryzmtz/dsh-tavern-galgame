import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { connectGameplay } from '../lib/api.mjs'

async function fixture(t, startBrowser) {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'tavern-api-client-'))
  t.after(() => rm(runtimeHome, { recursive: true, force: true }))
  await mkdir(path.join(runtimeHome, 'logs'))
  await writeFile(path.join(runtimeHome, 'logs/tavern.pid.json'), JSON.stringify({ port: 3081 }))
  await writeFile(path.join(runtimeHome, 'logs/tavern.log'), '')
  const calls = []
  let sequence = 0
  const api = await connectGameplay({ runtimeHome, startBrowser, fetcher: async (url, options) => {
    if (url === 'http://127.0.0.1:3081/') return new Response('', { headers: { 'set-cookie': 'test-auth=value; HttpOnly' } })
    const method = url.split('.').at(-1), args = JSON.parse(options.body)
    calls.push({ method, args })
    let result = {}
    if (method === 'capabilities') result = { version: 1 }
    if (method === 'create') result = { sessionId: 'session-' + ++sequence, chat: { id: 'chat-' + sequence, mode: args.mode }, requiresBrowser: args.sourceCard === 'script.json' }
    return Response.json({ ok: true, ...result })
  } })
  return { api, calls }
}

test('card editing and unsupported helper scripts do not start a template-only browser', async t => {
  const { api } = await fixture(t, async () => { assert.fail('unexpected template browser') })
  await api.create({ action: 'card' }, {})
  const result = await api.create({ action: 'play', sourceCard: 'script.json' }, {})
  assert.equal(result.requiresBrowser, true)
  await api.close()
})
