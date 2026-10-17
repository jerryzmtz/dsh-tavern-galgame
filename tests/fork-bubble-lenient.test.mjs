// private fork: owner regression; transcript and stage share the tolerant reader.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { forkParseBubbles, forkResolveBubbleMood, forkBubbleDisplayName } from '../tavern-plugin/src/client/fork-bubble-line.cjs'
import { stageParagraphs } from '../tavern-plugin/lib/domain/stage-paragraphs.js'
import { cleanDirectorText } from '../tavern-plugin/lib/domain/stage-director-text.js'
import { resolveBubbleMood, effectiveBubbleMoods } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'

const config = { characters: [{ alias: 'dafeiyu', name: '大肥鱼' }], emotions: [{id:'nervous',label:'紧张'}, { id: 'eating', label: '吃饭（扒饭）' }] }
const lines = [
  '@bubble:dafeiyu|大肥鱼|紧张|唔……这、这是能量补给时间呀！',
  '@bubble:dafeiyu|大肥鱼|吃饭|饭不吃饱，脑子转不动嘛。…',
]
const shared = readFileSync(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')
const stage = readFileSync(new URL('../tavern-plugin/src/client/fork-stage-display-units.cjs', import.meta.url), 'utf8')
const client = vm.runInNewContext(shared + stage + '; ({parse:forkParseBubbles,units:forkStageDisplayUnits})')

test('owner bare lines retain speaker, emotion and text in transcript and host/client stage', () => {
  const moods = effectiveBubbleMoods(config)
  for (const line of lines) {
    const transcript = forkParseBubbles(line, false)[0]
    assert.equal(transcript.kind, 'bubble')
    assert.equal(transcript.alias, 'dafeiyu')
    assert.equal(transcript.name, '大肥鱼')
    assert.equal(transcript.text, line.split('|').slice(3).join('|'))
    for (const units of [stageParagraphs(line), client.units([{kind:'markdown',text:line}])]) {
      assert.equal(units.length, 1)
      assert.equal(units[0].kind, 'line')
      assert.deepEqual(forkParseBubbles(units[0].text, false)[0], transcript)
    }
    assert.deepEqual(JSON.parse(JSON.stringify(client.parse(line, false)[0])), transcript)
    assert.equal(forkResolveBubbleMood(transcript.mood, moods).id, resolveBubbleMood(transcript.mood, config).id)
    assert.doesNotMatch(cleanDirectorText(line), /@bubble/)
  }
  assert.equal(resolveBubbleMood('吃饭', config).id, 'eating')
  assert.equal(resolveBubbleMood('吃饭（扒饭）', config).id, 'eating')
  assert.equal(resolveBubbleMood('紧张', config).id,'nervous');assert.equal(resolveBubbleMood('紧张', {}),null) // private fork: only declared vocabulary resolves
  assert.equal(resolveBubbleMood('', config), null)
  assert.equal(resolveBubbleMood('unrecognised', config), null)
  assert.equal(cleanDirectorText('@bubble:DaFeiYu|大肥鱼|吃饭|[你好]'), '大肥鱼〔DaFeiYu〕（吃饭）：你好')
})

test('pipes, thoughts, bracketed and bilingual syntax keep existing semantics', () => {
  for (const pipe of ['|', '｜']) {
    for (const body of ['[台词]', '台词', '[*心声*]']) {
      const line = ['@bubble：dafeiyu', '大肥鱼', '吃饭', body].join(pipe)
      const segment = forkParseBubbles(line, false)[0]
      assert.equal(segment.text, body.includes('心声') ? '心声' : '台词')
      assert.equal(segment.thought, body.includes('心声'))
      assert.equal(stageParagraphs(line)[0].kind, 'line')
    }
  }
  const segment = forkParseBubbles('@bubble:dafeiyu|大肥鱼|吃饭|[你好]|[Hello]', false)[0]
  assert.equal(segment.text, '你好')
  assert.equal(segment.speech, 'Hello')
  assert.equal(forkParseBubbles('@bubble:dafeiyu|大肥鱼|吃饭|[*心', true)[0].streaming, true)
  assert.equal(forkParseBubbles('@bubble:dafeiyu|大肥鱼|吃饭|[*心', false)[0].kind, 'markdown')
  assert.equal(forkParseBubbles('普通旁白', false)[0].kind, 'markdown')
  assert.equal(forkParseBubbles(lines[0], true)[0].streaming, true)
  assert.equal(forkParseBubbles(lines[0] + '\n旁白', true)[0].streaming, false)
})

test('stage name plate prefers the card display name and never exposes the alias', () => {
  assert.equal(forkBubbleDisplayName({alias:'dafeiyu',name:'dafeiyu'}, config), '大肥鱼')
  assert.equal(forkBubbleDisplayName({alias:'dafeiyu',name:'错误名字'}, config), '大肥鱼')
  assert.equal(forkBubbleDisplayName({alias:'guest',name:'客人'}, config), '客人')
  assert.equal(forkBubbleDisplayName({alias:'guest',name:'guest'}, config), '')
  assert.equal(forkBubbleDisplayName({alias:'guest'}, config), '')
  const source = readFileSync(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
  assert.match(source, /const name = current && current.kind === "line" \? forkBubbleDisplayName\(current, config\)/)
  const transcript = readFileSync(new URL('../tavern-plugin/src/client/fork-bubbles.js', import.meta.url), 'utf8')
  assert.match(transcript, /const name = forkBubbleDisplayName\(segment, config\)/)
})

// private fork (B4, promo v3 §1): Gemini closes a line with Markdown emphasis after `]`. The shared reader keeps the
// speaker/voice; a line that still fails is narration without its prefix, never raw syntax, on host and client alike.
test('trailing emphasis after the bracket parses; unparseable @bubble lines degrade to narration', () => {
  const line = '@bubble:f_efed52c1c67556e0|大肥鱼|喜悦|[哇啊！是猪脚饭！居然还有冰奶茶！]*'
  for (const parse of [forkParseBubbles, client.parse]) {
    const [bubble] = parse(line, false)
    assert.equal(JSON.stringify([bubble.kind, bubble.alias, bubble.name, bubble.mood, bubble.text, bubble.thought]), JSON.stringify(['bubble', 'f_efed52c1c67556e0', '大肥鱼', '喜悦', '哇啊！是猪脚饭！居然还有冰奶茶！', false]))
    assert.equal(parse('**@bubble:dafeiyu|大肥鱼|平和|[*好饿*]**', false)[0].thought, true)
    assert.equal(parse('@bubble:dafeiyu|大肥鱼|平和|[显示]|[こんにちは]*', false)[0].speech, 'こんにちは')
  }
  const broken = '前文。\n@bubble:dafeiyu|大肥鱼|[字段不够]\n@bubble:dafeiyu'
  for (const units of [stageParagraphs(line + '\n\n' + broken), client.units([{ kind: 'markdown', text: line + '\n\n' + broken }])]) {
    assert.equal(JSON.stringify(units.map(unit => [unit.kind, unit.alias || null])), JSON.stringify([['line', 'f_efed52c1c67556e0'], ['narration', null]]))
    assert.equal(units[1].text, '前文。\n字段不够')
  }
  assert.ok(!forkParseBubbles(broken, false).some(segment => /@bubble/.test(segment.text)))
  assert.match(cleanDirectorText(line), /^大肥鱼〔f_efed52c1c67556e0〕（喜悦）：哇啊/)
})