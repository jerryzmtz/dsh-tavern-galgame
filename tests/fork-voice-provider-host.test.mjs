import test from 'node:test'
import assert from 'node:assert/strict'

import { spawnSync } from 'node:child_process'
import { createAzureAdapter, azureSsml } from '../tavern-plugin/lib/domain/voice-providers/azure.js'
import { createVolcengineAdapter, parseVolcengine, volcengineError } from '../tavern-plugin/lib/domain/voice-providers/volcengine.js'
import { createGptSovitsAdapter } from '../tavern-plugin/lib/domain/voice-providers/gpt-sovits-api.js'

import { pcmWav, normalizeWav } from '../tavern-plugin/lib/domain/voice-providers/audio.js'
import { presetParams } from "../tavern-plugin/lib/domain/voice-providers/params.js"

const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })

const tick = () => new Promise(resolve => setImmediate(resolve))

const azure = { id: 'azure', kind: 'azure', label: 'Azure', config: { region: 'eastasia' } }

const spec = { text: 'A & <B> "C"', language: 'zh', mood: 'joy', params: { voiceName: 'zh-CN-XiaoxiaoNeural', pitch: 5, rate: -3 } }
function sine(count = 4096, amplitude = 1000) { const pcm = Buffer.alloc(count * 2); for (let i = 0; i < count; i++) pcm.writeInt16LE(Math.round(amplitude * Math.sin(i * 0.1)), i * 2); return pcmWav(pcm) }

test('Azure request headers, escaped SSML, built-in/default styles and catalog locale mapping', async () => {
  const calls = [], adapter = createAzureAdapter({ fetch: async (url, init) => { calls.push({ url, init }); return init.method === 'GET' ? json([{ ShortName: 'en-US-TestMultilingualNeural', LocalName: 'Test', Locale: 'en-US', SecondaryLocaleList: ['zh-CN', 'ja-JP', 'de-DE'], Gender: 'Female', StyleList: ['cheerful'] }]) : new Response(sine()) } })
  const catalog = await adapter.catalog(azure, { key: 'fake-key' })
  assert.deepEqual(catalog.items[0].languages, ['en', 'zh', 'ja', 'de-DE']); assert.ok(catalog.items[0].note)
  await adapter.synthesize(azure, { key: 'fake-key' }, spec)
  const call = calls[1]
  assert.equal(call.url, 'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1')
  assert.equal(call.init.headers['Ocp-Apim-Subscription-Key'], 'fake-key')
  assert.equal(call.init.headers['X-Microsoft-OutputFormat'], 'riff-24khz-16bit-mono-pcm')
  assert.equal(call.init.headers['User-Agent'], 'dsh-tavern'); assert.equal(call.init.redirect, 'error')
  assert.match(call.init.body, /A &amp; &lt;B&gt; &quot;C&quot;/)
  assert.match(call.init.body, /style="cheerful"/); assert.match(call.init.body, /pitch="\+5%" rate="-3%"/)
  assert.match(azureSsml({ ...spec, params: { voiceName: 'en-US-TestNeural' }, styles: ['cheerful'] }), /express-as/)
  assert.doesNotMatch(azureSsml({ ...spec, mood: 'custom', styles: ['cheerful'] }), /express-as/)
  assert.doesNotMatch(azureSsml({ ...spec, params: { voiceName: 'en-US-AshleyNeural' }, styles: ['cheerful'] }), /express-as/)
  for (const status of [401, 403, 429, 500]) await assert.rejects(createAzureAdapter({ fetch: async () => new Response('do not expose this secret', { status }) }).synthesize(azure, { key: 'fake-key' }, spec), e => !e.message.includes('secret'))
})

test('Volcengine request, SSE/NDJSON PCM assembly, language, emotions and safe errors', async () => {
  let call
  const chunks = Buffer.from([1, 0, 2, 0]), response = 'event: message\ndata: {"code":0,"data":"' + chunks.subarray(0, 2).toString('base64') + '"}\n\n{"code":0,"data":"' + chunks.subarray(2).toString('base64') + '"}\n{"code":20000000}\n'
  const adapter = createVolcengineAdapter({ fetch: async (url, init) => { call = { url, init }; return new Response(response) } })
  const p = { id: 'volc', config: { appId: '123', resourceId: 'seed-tts-2.0' } }
  const result = await adapter.synthesize(p, { accessKey: 'fake-access' }, { ...spec, mood: 'anger', params: { speaker: 'manual_speaker', speechRate: 23 } })
  assert.deepEqual(result.subarray(44), chunks); assert.equal(result.readUInt32LE(24), 24000)
  assert.equal(call.init.headers['X-Api-Access-Key'], 'fake-access'); assert.match(call.init.headers['X-Api-Request-Id'], /^[0-9a-f-]{36}$/)
  const body = JSON.parse(call.init.body)
  assert.equal(body.req_params.audio_params.emotion, 'angry'); assert.equal(body.req_params.audio_params.speech_rate, 23)
  assert.equal(body.req_params.additions.explicit_language, 'zh'); assert.equal(body.user.uid, 'dsh-tavern')
  for (const mood of ['love', 'shy', 'custom']) { await adapter.synthesize(p, { accessKey: 'fake' }, { ...spec, mood, params: { speaker: 'x', speechRate: 0 } }); assert.equal(JSON.parse(call.init.body).req_params.audio_params.emotion, undefined) }
  assert.equal((await adapter.catalog()).items.length, 12); assert.equal((await adapter.catalog()).manual, true)
  assert.match(volcengineError(45000000), /未授权/); assert.match(volcengineError(1, 'quota exceeded'), /额度/)
  assert.match(volcengineError(1, 'grant not found'), /凭据/); assert.match(volcengineError(1, 'Init Engine Instance failed'), /不匹配/)
  assert.throws(() => parseVolcengine('{"code":45000000}\n'), /未授权/)
  assert.throws(() => parseVolcengine('{"code":0,"data":"AQACAA=="}\n'), /不完整/)
  await adapter.probe(p, { accessKey: 'fake' }); assert.equal(call.init.method, 'HEAD'); assert.equal(call.init.body, undefined)
  await createVolcengineAdapter({ fetch: async () => new Response(null, { status: 405 }) }).probe(p, { accessKey: 'fake' })
  await assert.rejects(createVolcengineAdapter({ fetch: async () => new Response(null, { status: 403 }) }).probe(p, { accessKey: 'fake' }), /凭据/)
})

test('api_v2 serializes weights switching and synthesis, skips unchanged weights, parses HTTP 400', async () => {
  const calls = []; let active = 0, maximum = 0
  const adapter = createGptSovitsAdapter({ fetch: async (url, init) => { calls.push({ url, init }); active++; maximum = Math.max(maximum, active); await tick(); active--; return url.endsWith('/tts') ? new Response(sine()) : json({}) } })
  const p = { id: 'api', config: { url: 'http://localhost:9880' } }, params = presetParams('gpt-sovits-api', { refAudioPath: '/refs/a.wav', promptText: 'hello', promptLang: 'en', gptWeights: '/weights/a.ckpt', sovitsWeights: '/weights/a.pth' })
  await Promise.all([adapter.synthesize(p, {}, { ...spec, params }), adapter.synthesize(p, {}, { ...spec, params })])
  assert.equal(maximum, 1); assert.equal(calls.length, 4)
  assert.match(calls[0].url, /set_gpt_weights\?weights_path=%2Fweights%2Fa.ckpt/); assert.match(calls[1].url, /set_sovits_weights/)
  assert.deepEqual(JSON.parse(calls[2].init.body), { text: spec.text, text_lang: 'zh', ref_audio_path: '/refs/a.wav', prompt_text: 'hello', prompt_lang: 'en', media_type: 'wav', streaming_mode: false, speed_factor: 1, text_split_method: 'cut5' })
  await adapter.synthesize(p, {}, { ...spec, params: { ...params, gptWeights: '/weights/b.ckpt' } }); assert.match(calls[4].url, /b.ckpt/)
  assert.deepEqual(await adapter.catalog(p), { items: [], manual: true })
  await assert.rejects(createGptSovitsAdapter({ fetch: async () => new Response('{"message":"missing reference"}', { status: 400 }) }).synthesize(p, {}, { ...spec, params }), /missing reference/)
})

test('PCM16 loudness uses voiced 512-sample frames, excludes silence and caps peaks', () => {
  const pcm = Buffer.alloc(8192 * 2)
  for (let i = 4096; i < 8192; i++) pcm.writeInt16LE(i % 2 ? -500 : 500, i * 2)
  const result = normalizeWav(pcmWav(pcm))
  assert.equal(result.readInt16LE(44), 0)
  assert.ok(Math.abs(Math.abs(result.readInt16LE(44 + 4096 * 2)) / 32768 - 0.1) < 1 / 32768)
  const spike = Buffer.alloc(2048 * 2); spike.writeInt16LE(30000, 0); spike.fill(0, 2)
  const capped = normalizeWav(pcmWav(spike)); assert.ok(capped.readInt16LE(44) / 32768 <= 10 ** (-1 / 20) + 1 / 32768)
  assert.deepEqual(normalizeWav(pcmWav(Buffer.alloc(1024))), pcmWav(Buffer.alloc(1024)))
  assert.deepEqual(normalizeWav(pcmWav(Buffer.from([1, 0]))), pcmWav(Buffer.from([1, 0])))
  assert.throws(() => normalizeWav(Buffer.from('bad')), /WAV/)
})

test('loudness matches Python serve.py normalization within PCM16 quantization', async t => {
  if (!(await import('node:fs')).existsSync(new URL('../scripts/tts/serve.py', import.meta.url))) return t.skip('Optional local Python worker source is not distributed')
  const python = process.env.TTS_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const pcm = sine(4096, 700).subarray(44)
  const script = "import ast,json,sys,numpy as np\np='scripts/tts/serve.py'\nt=ast.parse(open(p,encoding='utf-8').read())\nf=next(n for n in t.body if isinstance(n,ast.FunctionDef) and n.name=='normalize_loudness')\nns={'TARGET_RMS_DB':-20.,'PEAK_CEILING':10**(-1./20)}\nexec(compile(ast.Module(body=[f],type_ignores=[]),p,'exec'),ns)\na=np.array(json.load(sys.stdin),dtype=np.int16)\nprint(json.dumps(ns['normalize_loudness'](a).tolist()))"
  const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2))
  const run = spawnSync(python, ['-c', script], { input: JSON.stringify(samples), encoding: 'utf8' })
  if (run.error?.code === 'ENOENT') return t.skip('Python interpreter unavailable')
  assert.equal(run.status, 0, run.stderr)
  const expected = JSON.parse(run.stdout), actual = normalizeWav(pcmWav(pcm)).subarray(44)
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual.readInt16LE(i * 2) / 32768 - expected[i]) <= 1 / 32768)
})
