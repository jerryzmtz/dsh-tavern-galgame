// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: include source literally, without String.replace replacement-token expansion.
import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { cleanDirectorText } from '../tavern-plugin/lib/domain/stage-director-text.js'
import { projectDisplayParts } from '../tavern-plugin/lib/domain/display-source.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import {stageParagraphs} from '../tavern-plugin/lib/domain/stage-paragraphs.js'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }

const readClient = file => readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')
const bubbles = (await readClient('fork-bubbles.js')).split('// @include-protocol figure-resolution.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs', import.meta.url), 'utf8')).split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')).replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
const voice = await readClient('fork-voice.js')
const stage = await readClient('fork-gal-stage.js')
const backlog = await readClient('fork-gal-backlog.js')
const history = await readClient('fork-gal-history.js')
const context = {
  // private fork: pack revision is inert in this text/voice-only fixture.
  useForkPackRevision: () => 0,
  // private fork: text-only rows have no media session; use the current subscription seam.
  forkStageSessions: {get:()=>null}, forkGalActive: {subscribe:()=>()=>{},get:()=>null},
  forkVoicePlayer: {get:()=>null,subscribe:()=>()=>{}},
  React: {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useRef: value => ({ current: value }), useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useEffect() {}, useLayoutEffect() {}, useMemo: fn => fn(), useSyncExternalStore: (_subscribe,get) => get()
  },
  useLiveTavernView: () => null, ForkHelpTip() {}, ForkIcon() {}
}
// private fork: real colour hook; this structural React fixture intentionally does not run effects.
vm.runInNewContext(history + bubbles + voice.slice(voice.indexOf('function forkPackSpeechInput'),voice.indexOf('function useForkVoiceBubbles')) + voice.slice(voice.indexOf('function ForkVoiceButton')) + (stagePageSource + '\n' + stage.slice(stage.indexOf('// Plain reading text'), stage.indexOf('// Film cards'))) + backlog + `
this.parse = forkParseBubbles; this.spec = (segment, _prefs, config) => forkPackSpeechInput(segment, config);
this.pages = forkGalPages; this.window = forkStageVoiceWindow;
this.rows = forkGalBacklogEntries; this.earlier = forkGalBacklogTurns;
this.bubble = ForkBubbleRow; this.backlog = ForkGalBacklog;
`, context)
const config = { stage: { textLanguage: 'zh' }, characters: [{ alias: 'a', voice: 'v', voiceLang: 'en' }] }
const sameLanguage = { ...config, stage: { textLanguage: 'en' } }
const plain = value => JSON.parse(JSON.stringify(value))
function nodes(node) {
  return node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : []
}

test('thought voice specs follow bindings, strip both or display-only markers, and preserve mood', () => {
  for (const body of ['[*display*]|[*translated*]', '[*display*]|[translated]', '[*display*]|[ * translated * ]']) {
    const source = '@bubble-voice:a|A|joy|' + body
    const segment = context.parse(source, false)[0]
    assert.equal(segment.thought, true)
    assert.equal(segment.text, 'display')
    assert.equal(segment.speech, 'translated')
    assert.deepEqual(plain(context.spec(segment, {}, config)), { text: 'translated', mood: 'joy' })
    assert.equal(context.spec(segment, {}, { ...config, characters: [{ alias: 'a', voice: '' }] }), null)
    assert.equal(stageParagraphs(source)[0].kind, 'line', 'host stage parser accepts translated thoughts')
  }
  for (const marker of ['@bubble', '@bubble-voice']) {
    const segment = context.parse(marker + ':a|A|calm|[*display*]', false)[0]
    assert.equal(segment.thought, true)
    assert.equal(context.spec(segment, {}, sameLanguage).text, 'display')
    assert.equal(context.spec(segment, {}, config), null, 'cross-language thoughts still require a translation')
  }
})

test('unfinished and empty thoughts never synthesize or fall back to the display text', () => {
  for (const [source, streaming] of [
    ['@bubble:a|A|calm|[*partial', true],
    ['@bubble-voice:a|A|calm|[*display*]', true],
    ['@bubble-voice:a|A|calm|[*display*]|[*partial', true],
    ['@bubble-voice:a|A|calm|[*display*]|[*partial', false],
    ['@bubble-voice:a|A|calm|[*display*]|[**]', false],
    ['@bubble-voice:a|A|calm|[*display*]|[* *]', false],
    ['@bubble:a|A|calm|[**]', false]
  ]) assert.equal(context.spec(context.parse(source, streaming)[0], {}, sameLanguage), null, source)
  const endedLine = context.parse('@bubble-voice:a|A|calm|[*display*]\n', true)[0]
  assert.equal(context.spec(endedLine, {}, sameLanguage).text, 'display')
  const translated = context.parse('@bubble-voice:a|A|calm|[*display*]|[*translated*]', true)[0]
  assert.equal(context.spec(translated, {}, config).text, 'translated', 'a closed translation is ready during streaming')
})

for (const marker of ['@bubble', '@bubble-voice']) test(marker + ': bubble, stage and backlog keep thought styling and expose the same playable voice', () => {
  const segment = context.parse(marker + ':a|A|calm|[*display*]|[*translated*]', false)[0]
  assert.ok(context.spec(segment, {}, config))
  let clicks = 0, stopped = 0
  const handle = { owner: 'owner', id: 'thought', click() { clicks++ } }
  const part = { turn: 1, index: 0, segments: [segment], voices: { 0: handle } }
  const pages = context.pages([part])
  assert.equal(pages[0].thought, true)
  assert.equal(pages[0].text, '\uff08display\uff09')
  assert.equal(pages[0].voice, handle)
  // private fork: native handles retain playback callbacks; the host priority queue is gone.
  assert.equal(context.window(pages, 0, false)[0], handle)
  const earlier = context.earlier([part], 2)
  const row = context.rows(earlier, 2, [], 0, {}).find(row => row.type === 'page')
  assert.equal(row.thought, true)
  assert.equal(row.voice, handle, 'historical backlog retains the thought voice')
  const bubble = context.bubble({ segment, config, voice: handle })
  assert.match(bubble.props.className, /fork-bubble-thought/)
  assert.ok(nodes(bubble).some(node => node.type?.name === 'ForkVoiceButton'))
  const view = context.backlog({ turn: 1, pages, page: 0, colorOf: () => '', avatarOf: () => '', nameOf: () => '', onJump() {}, onClose() {} })
  assert.ok(nodes(view).some(node => /is-thought/.test(node.props.className)))
  const button = nodes(view).find(node => node.type?.name === 'ForkVoiceButton')
  assert.ok(button, 'thought backlog row renders its voice button')
  button.props.voice.click({ stopPropagation() { stopped++ } })
  assert.equal(clicks, 1)
  assert.equal(stopped, 1, 'replay does not jump the stage')
})

for (const thought of [false, true]) test('five-field bubbles match legacy voice semantics: thought=' + thought, () => {
  const display = thought ? '*display*' : 'display'
  const speech = thought ? '*translated*' : 'translated'
  for (const streaming of [false, true]) for (const ending of ['[' + speech + ']', '[' + speech, '[', '', '[**]', '[* *]']) {
    const body = ':a|A|joy|[' + display + ']|' + ending
    const source = '@bubble' + body
    const segment = context.parse(source, streaming)[0]
    const legacy = context.parse('@bubble-voice' + body, streaming)[0]
    assert.deepEqual(plain(segment), plain(legacy), source)
    assert.equal(segment.text, 'display')
    assert.equal(segment.thought, thought)
    assert.equal(segment.voiced, true)
    const complete = ending === '[' + speech + ']'
    for (const settings of [config, sameLanguage]) {
      const spec = context.spec(segment, {}, settings)
      assert.equal(spec && spec.text, complete ? 'translated' : null, 'same-language dual text also uses second field')
    }
    assert.equal(context.spec(segment, {}, { ...config, characters: [] }), null)
    const parts = projectDisplayParts('Before\n\n' + source + '\n\n<div>hidden UI</div>\n\nAfter').parts
    const units = stageParagraphs('', parts)
    assert.deepEqual(units.map(unit => unit.kind), ['narration', 'line', 'narration'])
    assert.equal(units[1].text, source)
    if (complete) assert.equal(cleanDirectorText(units[1].text), 'A〔a〕（joy）：' + (thought ? '（心声）' : '') + 'display')
  }
  const plainLine = '@bubble:a|A|joy|[' + display + ']'
  assert.equal(context.spec(context.parse(plainLine, false)[0], {}, config), null, 'cross-language four-field bubbles stay unvoiced')
  assert.equal(context.spec(context.parse(plainLine, false)[0], {}, sameLanguage).text, 'display')
})

for (const quote of ['`', '``']) test('whole-line code quote preserves bubble, voice, stage and backlog semantics: ' + quote.length, () => {
  for (const marker of ['@bubble', '@bubble-voice']) for (const thought of [false, true]) for (const translated of [false, true]) {
    const body = thought ? '*display `code`*' : 'display `code`';
    const speech = thought ? '*spoken `code`*' : 'spoken `code`';
    const source = marker + ':a|A|joy|[' + body + ']' + (translated ? '|[' + speech + ']' : '');
    const wrapped = '  ' + quote + source + quote + '  ';
    for (const streaming of [false, true]) {
      const expected = context.parse(source, streaming);
      const actual = context.parse(wrapped, streaming);
      assert.deepEqual(plain(actual), plain(expected));
      assert.deepEqual(plain(context.spec(actual[0], {}, sameLanguage)), plain(context.spec(expected[0], {}, sameLanguage)));
      assert.equal(actual[0].text, 'display `code`');
      if (translated) assert.equal(actual[0].speech, 'spoken `code`');
      const parts = [{ turn: 1, index: 0, segments: actual }];
      const pages = context.pages(parts);
      assert.equal(pages[0].text, thought ? '（display `code`' + (actual[0].streaming ? '' : '）') : 'display `code`');
      assert.equal(context.rows(context.earlier(parts, 2), 2, [], 0, {}).find(row => row.type === 'page').thought, thought);
    }
    const projection = projectDisplayParts('Before\n\n' + wrapped + '\n\n<div>UI</div>\n\nAfter');
    const units = stageParagraphs('', projection.parts);
    assert.deepEqual(units.map(unit => unit.kind), ['narration', 'line', 'narration']);
    assert.equal(units[1].text, wrapped.trim(), 'source remains lossless');
    assert.equal(cleanDirectorText(wrapped), cleanDirectorText(source));
    assert.equal(cleanDirectorText(wrapped), 'A〔a〕（joy）：' + (thought ? '（心声）' : '') + 'display `code`');
  }
});

test('leading code quote during streaming never consumes backticks inside unfinished text', () => {
  for (const marker of ['@bubble', '@bubble-voice']) for (const ending of ['[partial `', '[*partial `', '[display]|[speech `', '[display]|[speech]', '[display]|']) {
    const source = marker + ':a|A|calm|' + ending;
    for (const streaming of [false, true]) {
      const expected = plain(context.parse(source, streaming));
      // private fork (B4): an unparseable @bubble line degrades to the same narration with or without its code quote.
      assert.deepEqual(plain(context.parse(' `' + source, streaming)), expected);
    }
  }
  assert.equal(context.parse('`@bubble:a|A|calm|[partial `', true)[0].text, 'partial `');
  assert.deepEqual(plain(context.parse('`@bubble:a|', true)), []);
  const prose = 'ordinary `code` and an inline `@bubble:a|A|joy|[text]` example';
  assert.deepEqual(plain(context.parse(prose, false)), [{ kind: 'markdown', text: prose }]);
});

test('quoted bubble display repair recognizes missing now_plot without changing source or session', () => {
  for (const quote of ['', '`', '``']) {
    const source = '  ' + quote + '@bubble:a|A|calm|[text]' + quote;
    const result = projectReplyLayers(source, { placement: 2, regexScripts: [{
      enabled: true, placement: [2], markdownOnly: true,
      findRegex: '/<now_plot>([\\s\\S]*)<\\/now_plot>/g',
      replaceString: '<div>@bubble renderer: $1</div>'
    }] });
    assert.equal(result.sourceText, source);
    assert.equal(result.sessionText, source);
    assert.equal(result.displayMode, 'html');
    assert.equal(result.warnings.length, 1);
  }
});
