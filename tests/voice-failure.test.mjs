import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {voiceFixture} from './fixtures/native-voice-player.mjs'
import {createQwenAdapter, qwenVoices} from '../tavern-plugin/packages/dsh-tts/src/providers/qwen.js'
import {BUILTIN_PRESETS} from '../tavern-plugin/packages/dsh-tts/src/providers/presets.js'
import {migrateVoice} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/voice-migration.js'
import {resolveVoiceSpec, chooseService} from '../tavern-plugin/packages/dsh-tts/src/voice-resolver.js'

test('Mengbao is Bella: migration preserves the authored voice and model, never chooses a different preset', () => {
  assert.equal(qwenVoices().find(v => v.id === 'Bella').label, '萌宝')
  const old = {kind:'qwen',label:'大肥鱼（萌宝）',params:{voice:'Bella',model:'qwen3-tts-instruct-flash'}}
  const {voice} = migrateVoice(old, 'zh')
  const result = resolveVoiceSpec({voice,binding:{voice:'figure-voice'},figureIdentity:'pack:figure'})
  assert.deepEqual(result.effective.voice.params, old.params)
  assert.equal(chooseService(voice.sources.qwen, [{id:'unrelated',kind:'azure'}]), undefined)
  assert.equal(chooseService(voice.sources.qwen, [{id:'one',kind:'qwen'},{id:'two',kind:'qwen'}]), undefined)
  const builtin = BUILTIN_PRESETS.find(p => p.id === 'qwen/bella')
  assert.deepEqual(builtin.params, {voice:'Bella',model:'qwen3-tts-flash'})
})

test('unresolved descriptor warns without synthesizing a default voice', async () => {
  const f = voiceFixture()
  assert.equal(await f.player.prefetch({available:false,diagnostics:['VOICE_NOT_FOUND']}, f.input('one')), false)
  assert.equal(f.player.getError(f.input('one')), 'VOICE_NOT_FOUND')
  assert.equal(f.synths.length, 0)
  f.player.dispose()
})

// Private fork: neither look-ahead failure nor a retired playback lease may hide a line warning.
test('prefetch failure stays on its line, survives stop, and clears after successful retry', async () => {
  const f = voiceFixture()
  const synthesize = f.client.synthesize
  f.client.synthesize = async () => { throw Object.assign(new Error('safe summary'), {code:'QWEN_RESOURCE_NOT_FOUND'}) }
  let updates = 0
  f.player.subscribe(() => updates++)
  assert.equal(await f.prefetch('one'), false)
  assert.equal(f.player.get(), null)
  assert.equal(f.player.getError(f.input('one')), 'QWEN_RESOURCE_NOT_FOUND')
  assert.equal(f.player.getError(f.input('other')), null)
  assert.ok(updates > 0)
  f.player.stop()
  assert.equal(f.player.getError(f.input('one')), 'QWEN_RESOURCE_NOT_FOUND')
  f.client.synthesize = synthesize
  assert.equal(await f.play('one'), true)
  assert.equal(f.player.getError(f.input('one')), null)
  f.player.dispose()
})

test('cancelled look-ahead never creates a warning', async () => {
  const f = voiceFixture()
  f.client.synthesize = async (_, {signal}) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {once:true})
  })
  const pending = f.prefetch('one')
  f.player.cancelPrefetch()
  assert.equal(await pending, false)
  assert.equal(f.player.getError(f.input('one')), null)
  f.player.dispose()
})

test('line voice button displays a prefetch warning with provider summary, not another line failure', () => {
  const source = readFileSync(new URL('../tavern-plugin/src/client/fork-voice.js', import.meta.url), 'utf8')
  const h = (type, props, ...children) => ({type,props,children})
  const context = {React:{createElement:h}}
  vm.runInNewContext(source.slice(source.indexOf('function ForkVoiceButton(')) + ';this.Button=ForkVoiceButton;', context)
  const button = context.Button({voice:{owner:'one',id:'line',error:'QWEN_RESOURCE_NOT_FOUND',click(){}}})
  assert.equal(button.props['data-voice-state'], 'error')
  assert.equal(button.children[0].children[0], '\u26a0')
  assert.match(button.props.title, /Qwen.*404/)
  assert.equal(button.props.disabled, false)
  const clean = context.Button({voice:{owner:'two',id:'line',player:{owner:'one',id:'line',error:'QWEN_RESOURCE_NOT_FOUND'}}})
  assert.equal(clean.props['data-voice-state'], 'idle')
})

test('live Qwen missing-model response becomes an explicit model warning without silently changing the preset', async () => {
  let calls = 0
  const adapter = createQwenAdapter({warn(){},fetch:async () => {
    calls++
    return Response.json({code:'InvalidParameter',message:'Model not exist.'}, {status:404})
  }})
  await assert.rejects(adapter.synthesize({config:{region:'cn'}}, {key:'test'}, {text:'Hi',mood:'calm',params:{voice:'Bella',model:'qwen3-tts-instruct-flash'}}),
    {code:'QWEN_MODEL_NOT_FOUND',message:'Qwen 当前服务无法访问此配音模型（404），请在百炼控制台检查模型开通状态与区域'})
  assert.equal(calls, 1)
})

for (const [status, code] of [[404, 'QWEN_MODEL_NOT_FOUND'], [400, 'QWEN_REQUEST_FAILED']]) test('Qwen HTTP ' + status + ' stays a per-line warning without fallback', async () => {
  const f = voiceFixture()
  let calls = 0
  const adapter = createQwenAdapter({warn(){}, fetch:async () => {
    calls++
    return Response.json({code:'InvalidParameter', message:'Model not exist.'}, {status})
  }})
  f.client.synthesize = async () => adapter.synthesize({config:{region:'cn'}}, {key:'test'}, {text:'Hi',mood:'joy',params:{voice:'Bella',model:'qwen3-tts-instruct-flash'}})
  try {
    assert.equal(await f.prefetch('one'), false)
    assert.equal(f.player.getError(f.input('one')), code)
    assert.equal(f.player.getError(f.input('other')), null)
    assert.equal(calls, 1)
    const source = readFileSync(new URL('../tavern-plugin/src/client/fork-voice.js', import.meta.url), 'utf8')
    const context = {React:{createElement:(type, props, ...children) => ({type,props,children})}}
    vm.runInNewContext(source.slice(source.indexOf('function ForkVoiceButton(')) + ';this.Button=ForkVoiceButton;', context)
    const button = context.Button({voice:{owner:'one',id:'line',error:f.player.getError(f.input('one')),click(){}}})
    assert.equal(button.props['data-voice-state'], 'error')
    assert.equal(button.children[0].children[0], '\u26a0')
    if (status === 404) {
      assert.match(button.props.title, /404/)
      assert.doesNotMatch(button.props.title, /模型不存在/)
    }
  } finally { f.player.dispose() }
})

for (const phase of ['synthesis','audio']) test('Qwen 404 identifies ' + phase + ' without exposing response or signed URL', async () => {
  const logs = [], calls = []
  const adapter = createQwenAdapter({warn: message => logs.push(message), fetch:async (url, options) => {
    calls.push({url,options})
    if (phase === 'audio' && calls.length === 1) return Response.json({output:{audio:{url:'https://example.test/audio.wav?Signature=private'}}})
    return Response.json({code:'NotFound',message:'private'}, {status:404})
  }})
  await assert.rejects(adapter.synthesize({config:{region:'cn'}}, {key:'test'}, {text:'Hi',mood:'calm',params:{model:'qwen3-tts-instruct-flash',voice:'Bella'}}),
    {code:phase === 'audio' ? 'QWEN_AUDIO_NOT_FOUND' : 'QWEN_RESOURCE_NOT_FOUND'})
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  assert.equal(JSON.parse(calls[0].options.body).input.voice, 'Bella')
  assert.match(logs[0], new RegExp('phase=' + phase))
  assert.doesNotMatch(logs.join(''), /private|Signature|example\.test/)
})

// Automatic attempts are demand-driven; a poll/remount never bypasses backoff or the cap.
test('HTTP classes bound automatic retries and explicit replay resets the budget', async t => {
  for (const status of [400,401,403,404,408,429,500,503,undefined]) {
    const f=voiceFixture();t.after(()=>f.player.dispose())
    let calls=0
    f.client.synthesize=async()=>{calls++;throw Object.assign(new Error('PROVIDER_FAILURE'),{status})}
    const permanent=status>=400 && status<500 && status!==408 && status!==429
    assert.equal(await f.prefetch('line'),false)
    await f.prefetch('line');await f.play('line',{automatic:true});assert.equal(calls,1)
    f.advance(1000);await f.prefetch('line');assert.equal(calls,permanent?1:2)
    f.advance(1000);await f.prefetch('line');assert.equal(calls,permanent?1:2,'second backoff doubles')
    f.advance(1000);await f.play('line',{automatic:true});assert.equal(calls,permanent?1:3)
    for(let minute=0;minute<5;minute++){f.advance(60000);await f.prefetch('line');await f.play('line',{automatic:true})}
    assert.equal(calls,permanent?1:3)
    assert.equal(f.player.getError(f.input('line')),'PROVIDER_FAILURE')
    await f.play('line');assert.equal(calls,permanent?2:4)
    f.advance(1000);await f.prefetch('line');assert.equal(calls,permanent?2:5,'manual replay starts a new budget')
  }
})
