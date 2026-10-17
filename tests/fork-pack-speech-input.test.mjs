// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: include source literally, without String.replace replacement-token expansion.
// private fork: speech text gates survive the service-owned voice cutover; no browser voice registry.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with {type:'json'}
const read = name => readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
const bubbles = (await read('fork-bubbles.js')).split('// @include-protocol figure-resolution.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs', import.meta.url), 'utf8')).split('// @include fork-bubble-line.cjs').join(await read('fork-bubble-line.cjs')).replace('__TAVERN_BUBBLE_MOODS__',JSON.stringify(moods))
const voice = await read('fork-voice.js')
const ctx = {}
vm.runInNewContext(bubbles.slice(0,bubbles.indexOf('// Per-session bubble settings'))+'\n'+voice.slice(voice.indexOf('function forkPackSpeechInput('),voice.indexOf('function useForkVoiceBubbles(')),ctx)
const config = {stage:{textLanguage:'zh'},characters:[{alias:'actor',voice:'service-voice-id',voiceLanguage:'ja'}]}
const input = (text,settings=config,streaming=false) => ctx.forkPackSpeechInput(ctx.forkParseBubbles(text,streaming)[0],settings)

test('figure voice input requires a resolved figure voice and a complete translation', () => {
  const full = '@bubble-voice:actor|Actor|joy|[display]|[translated]'
  assert.equal(input(full).text,'translated'); assert.equal(input(full).mood,'joy')
  assert.equal(input(full,{...config,characters:[]}),null)
  assert.equal(input(full,{...config,characters:[{alias:'actor',voice:''}]}),null)
  // private fork: removed per-card mute is not a runtime gate.
  assert.equal(input(full,{...config,characters:[{...config.characters[0],voiceEnabled:false}]}).text,'translated')
  for (const text of ['@bubble:actor|Actor|calm|[display]','@bubble-voice:actor|Actor|calm|[display]','@bubble-voice:actor|Actor|calm|[display]|[partial','@bubble-voice:actor|Actor|calm|[display]|[]']) assert.equal(input(text),null,text)
  assert.equal(input(full,config,true).text,'translated','closed translations can play during reply streaming')
})
test('thought text strips markers, preserves custom moods and never speaks incomplete or oversized lines', () => {
  const same = {...config,stage:{textLanguage:'ja'},emotions:[{id:'custom',label:'Custom'}]}
  assert.equal(input('@bubble:actor|Actor|Custom|[*thought*]',same).text,'thought')
  assert.equal(input('@bubble:actor|Actor|Custom|[*thought*]',same).mood,'custom')
  assert.equal(input('@bubble:actor|Actor|Unknown|[line]',same).mood,null) // private fork: no undeclared default
  assert.equal(input('@bubble:actor|Actor|calm|[*partial',same,true),null)
  assert.equal(input('@bubble:actor|Actor|calm|['+'a'.repeat(1501)+']',same),null)
})
