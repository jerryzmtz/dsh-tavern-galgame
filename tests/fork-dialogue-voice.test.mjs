// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: include source literally, without String.replace replacement-token expansion.
import {bubbleResolutionSource} from './helpers/bubble-resolution-source.mjs' // private fork
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }
import { readFile } from "node:fs/promises"

import {voiceFixture, tick} from './fixtures/native-voice-player.mjs'

test('双语与半行解析：隐藏日语，跨语言必须有译文，没有绑定不配音', async () => {
  const bubbles = (await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js', import.meta.url), 'utf8')).split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')).replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
  const voices = await readFile(new URL('../tavern-plugin/src/client/fork-voice.js', import.meta.url), 'utf8')
  const context = { window: {}, localStorage: {}, React: {} }
  vm.runInNewContext(bubbleResolutionSource + voices.slice(voices.indexOf('function forkPackSpeechInput'),voices.indexOf('// private fork: native handles')) + ';this.parse=forkParseBubbles;this.spec=forkPackSpeechInput;', context)
  const parse = text => context.parse(text, true)[0]
  const prefs = { aliases: 'homura', voiceLanguage: 'ja' }
  const partial = parse('@bubble-voice:homura|晓美焰|平静|[你好]|[こんに')
  assert.equal(partial.text, '你好'); assert.equal(context.spec(partial), null)
  const full = parse('@bubble-voice:homura|晓美焰|平静|[你好]|[こんにちは]')
  assert.equal(full.text, '你好'); assert.equal(full.speech, 'こんにちは')
  const config = { characters: [{ alias: 'f_homura', aliases:['homura'], name:'晓美焰', ref:{packId:'pack',figureId:'homura'}, voice: 'homura', voiceLang: 'ja' }] }
  assert.equal(config.characters[0].voiceLang, 'ja')
  assert.deepEqual(JSON.parse(JSON.stringify(context.spec(full,config))),{text:'こんにちは',mood:'calm'}) // private fork: distinct canonical ID and Chinese mood.
  assert.equal(context.spec(full), null, 'no legacy name-based voice fallback')
  assert.equal(context.spec(parse('@bubble:homura|晓美焰|平静|[你好]'), config), null, 'cross-language bindings require translation')
  assert.equal(context.spec(parse('@bubble:homura|晓美焰|平静|[*秘密*]')), null)
  assert.equal(context.spec(parse('@bubble:madoka|鹿目圆|平静|[你好]')), null)
})

// private fork: builtin card-registry/audition routing was deleted. CARD voice IDs are
// passed by openAssetPackVoice; tests/asset-packs-service-voice covers exact ID forwarding.
test('native playback ignores interrupted play promises and retired failures but reports active denial',async t=>{
  const pending=[];const f=voiceFixture({play:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))})
  t.after(()=>f.player.dispose())
  const first=f.play('a');await tick();f.player.get().audio.pause()
  pending.shift().reject(Object.assign(new Error('Interrupted'),{name:'AbortError'}));await first
  assert.equal(f.player.get().audio.paused,true);assert.equal(f.player.get().error,undefined)
  const old=f.play('a');await tick();const next=f.play('b');await tick()
  pending.shift().reject(new Error('Retired failure'));await old
  assert.equal(f.player.get().id,'b');assert.equal(f.player.get().error,undefined)
  pending.shift().reject(Object.assign(new Error('Denied'),{name:'NotAllowedError'}));await next
  assert.match(f.player.get().error,/Denied/)
})
test('native replay and concurrent prefetch retain prepared clips without another host request',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose());await f.play('a');f.player.stop();await f.play('a')
  assert.equal(f.synths.length,1);assert.equal(f.reads.length,1)
  await Promise.all([f.prefetch('b'),f.prefetch('b')]);assert.equal(f.synths.length,2)
  await f.play('b');assert.equal(f.reads.length,2)
})
test('native voice speed preserves pitch and retimes both current and prefetched clips',async t=>{
  const f=voiceFixture();t.after(()=>f.player.dispose());f.rate(1.5);await f.play('a');await f.prefetch('b')
  assert.equal(f.player.get().audio.playbackRate,1.5);assert.equal(f.player.get().audio.preservesPitch,true)
  f.rate(1.2);assert.ok(f.audios.every(audio=>audio.playbackRate===1.2&&audio.preservesPitch))
  const launcher=await readFile(new URL('../tavern-plugin/src/client/fork-asset-launcher.js',import.meta.url),'utf8')
  assert.match(launcher,/forkStageReading.subscribe/);assert.match(launcher,/forkVoicePlayer.setRate/)
})


test('punctuation-only dialogue has no speech request in any language; words and numbers still speak',async()=>{
  const voices=await readFile(new URL('../tavern-plugin/src/client/fork-voice.js',import.meta.url),'utf8');
  const context={};
  vm.runInNewContext(bubbleResolutionSource+voices.slice(voices.indexOf('function forkPackSpeechInput'),voices.indexOf('// private fork: native handles')),context);
  const config={characters:[{alias:'f_7',name:'Alice',voice:'v',voiceLanguage:'zh'}],stage:{textLanguage:'zh'}};
  const line=text=>({kind:'bubble',alias:'f_7',text});
  for(const text of ['……','...','！？','「——」','♪ 🤔',''])assert.equal(context.forkPackSpeechInput(line(text),config),null);
  for(const text of ['啊……','12:07','こんにちは','Hello'])assert.equal(context.forkPackSpeechInput(line(text),config).text,text);
  config.characters[0].voiceLanguage='ja';
  assert.equal(context.forkPackSpeechInput({...line('你好'),speech:'……'},config),null);
  assert.equal(context.forkPackSpeechInput({...line('……'),speech:'はい'},config).text,'はい');
});
