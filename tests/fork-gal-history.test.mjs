// private fork: include source literally, without String.replace replacement-token expansion.
import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const stage = await read('fork-gal-stage.js'), history = await read('fork-gal-history.js'), voice = await read('fork-voice.js')
const code = history + '\n' + (stagePageSource + '\n' + stage.slice(stage.indexOf('// Plain reading text'), stage.indexOf('// The stage is a full-screen mode')))
const api = {}
vm.runInNewContext(code + '\n' + voice.slice(voice.indexOf('function forkStageVoiceWindow'), voice.indexOf('function useForkVoiceBubbles')), api)
const plain = value => JSON.parse(JSON.stringify(value))
const part = (turn, text = 'One.\n\nTwo.') => ({ turn, index: 0, text, streaming: false, segments: [{ kind: 'markdown', text }] })

test('continuous reading inserts one transition, crosses three boundaries, and back from zero reaches the prior last page', () => {
  const turns = [1, 3, 4, 9]
  let at = { turn: 1, page: 0 }, transitions = 0
  for (let i = 0; i < 10; i++) {
    at = api.forkGalTurnStep(turns, at.turn, at.page, 2, 1, at.transition)
    if (at.transition) transitions++
  }
  assert.deepEqual(plain(at), { turn: 9, page: 1 })
  assert.equal(transitions, 3)
  assert.equal(api.forkGalTurnStep(turns, 9, 1, 2, 1), null)
  assert.deepEqual(plain(api.forkGalTurnStep(turns, 4, 0, 2, -1)), { turn: 3, page: -1 })
  assert.deepEqual(plain(api.forkGalTurnStep(turns, 3, 1, 2, -1, true)), { turn: 3, page: 1 })
})

test('header resumes an older bookmark unless there is an unseen new reply; explicit paragraph entry wins', () => {
  const saved = { turn: 2, latestSeenTurn: 20 }
  const turns = [1, 2, 20]
  assert.equal(api.forkGalResumeTurn(saved, turns), 2)
  assert.equal(api.forkGalResumeTurn(saved, [...turns, 21]), 21)
  assert.equal(api.forkGalResumeTurn(saved, [...turns, 21], { turn: 1, para: 4 }), 1)
  assert.equal(api.forkGalResumeTurn({ turn: 2 }, turns), 20)
  assert.equal(api.forkGalResumeTurn({ turn: 99, latestSeenTurn: 100 }, turns), 20)
})

test('paragraph entry uses the same paragraph/offset anchors as restore, across markdown parts and dialogue', () => {
  const parts = [part(2, 'First.\n\n' + 'Long sentence! '.repeat(20)), { turn: 2, index: 3, text: 'line', segments: [{ kind: 'bubble', text: 'Hello', alias: 'a' }] }]
  const pages = api.forkGalPages(parts)
  assert.equal(api.forkGalPageAtPara(pages, 2), 1)
  assert.equal(api.forkGalPageAtPara(pages, 3), pages.length - 1)
  const at = api.forkGalPositionAnchors(pages)[2]
  assert.equal(api.forkGalPageAtPara(pages, at.para, at.offset), 2)
  const digest = api.forkGalTextDigest(parts)
  const restored = api.forkGalRestorePosition({ turn: 2, page: 2, anchor: at, latestSeenTurn: 20, textDigest: digest }, 2, pages.length, digest, pages)
  assert.equal(restored.latestSeenTurn, 20)
  assert.equal(restored.page, 2)
})

test('voice look-ahead crosses sparse historical turns without paginating them and cancels on skip/jump', () => {
  const parts = Array.from({ length: 20 }, (_, i) => ({ ...part(i + 1), segments: [{ kind: 'bubble', text: 'Line', alias: 'a' }], voices: { 0: { owner: 'o' + i, id: 'line' } } }))
  const grouped = api.forkGalTurnIndex(parts), turns = [...grouped.keys()]
  const pages = api.forkGalPages(grouped.get(1))
  const window = api.forkGalHistoryVoiceWindow(grouped, turns, 1, pages, 0, false)
  assert.equal(window.length, 8)
  assert.deepEqual(plain(window.map(item => item.owner)), Array.from({ length: 8 }, (_, i) => 'o' + i))
  // private fork: native prefetch consumes reading order, not host queue priorities.
  assert.deepEqual(plain(api.forkGalHistoryVoiceWindow(grouped, turns, 1, pages, 0, true)), [])
  assert.equal(api.forkGalHistoryVoiceWindow(grouped, turns, 19, api.forkGalPages(grouped.get(19)), 0, false).length, 2)
})

// private fork: the digest-keyed page LRU (forkGalTurnPages/forkGalLru) had no production caller and was removed;
// the stage pages each turn through the session text index (fork-stage-history-navigation covers its 200-turn LRU).

// private fork: F removes the IO hook. Exercise the shared host/source/resource runner instead.
test('history reads and revisits never create a director task',async t=>{
  const {harness,drain}=await import('./helpers/stage-resource-harness.mjs')
  const h=await harness(t)
  h.store.dispatch({type:'HISTORY_JUMP',source:h.source,text:h.store.getSnapshot().text,anchor:h.store.getSnapshot().text.pages[1].anchor})
  await drain();assert.equal(h.f.calls.length,0)
  await h.direct();const calls=h.f.calls.length
  h.store.dispatch({type:'PAGE',index:0});h.store.dispatch({type:'DIRECTOR_WAKE'});await drain()
  assert.equal(h.f.calls.length,calls);assert.equal(h.store.getSnapshot().director.phase,'done')
})
test('settled direction remains observed and a same-source retry appears without re-entry',async t=>{
  const {harness,drain}=await import('./helpers/stage-resource-harness.mjs')
  const h=await harness(t);await h.direct();const generation=h.store.getSnapshot().director.generation
  await h.f.director.retry(h.f.read(),1);await h.f.director.drain();await drain()
  assert.ok(h.store.getSnapshot().director.generation>generation)
  assert.equal(h.store.getSnapshot().director.phase,'done')
  assert.equal(h.store.getSnapshot().source,h.source)
})

test('chat entry wrappers share stage paragraph numbers across narration, rules, bubbles, and part offsets', async () => {
  const bubbles = (await read('fork-bubbles.js')).split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')).replace('__TAVERN_BUBBLE_MOODS__', '[]')
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
  const entered = [], env = { React: { createElement: h, useMemo: fn => fn(), useRef: value => ({ current: value }), useSyncExternalStore: (_, get) => get() }, useForkStageSelector:(_id,select)=>select({textIndex:new Map()}), useForkVoiceBubbles: () => ({}), TavernColoredMarkdown: 'Markdown', forkGalEnter: (...args) => entered.push(args) }
  env.forkGalActive = { subscribe() {}, get: () => '' }; // private fork: hidden-chat colour suspension.
  vm.runInNewContext(history + '\n' + await read('fork-gal-chat-entry.js') + '\n' + (stagePageSource + '\n' + code.slice(code.indexOf('// Plain reading text'), code.indexOf('// Film cards'))) + '\n' + bubbles, env)
  env.useForkBubbles = () => ({ config: { enabled: true, characters: [] } })
  const text = 'Narration.\n\n---\n\n@bubble:a|A|calm|[Hello]\n\nTail.'
  const element = env.ForkBubblePublication({ sessionId: 's', voiceScope: '7:2', stageParaBase: 4, text })
  const content = element.type(element.props)
  const tree = content.type(content.props)
  const wrappers = tree.children.flat(Infinity).filter(node => node?.type === env.ForkStageParagraph)
  assert.deepEqual(wrappers.map(node => [node.props.turn, node.props.para]), [[7, 6]])
  const markdown = tree.children.filter(node => node?.type === env.ForkStageMarkdown)
  assert.deepEqual(markdown.map(node => [node.props.turn, node.props.base]), [[7, 4], [7, 6]])
  assert.equal(markdown[0].props.markdownProps.text, markdown[0].props.text, 'Markdown is passed intact, not split/reparsed per paragraph')
  assert.deepEqual(plain(env.forkGalParagraphTargets(['First paragraph.', 'Second paragraph.'], ['First paragraph.', 'Second paragraph.'], 4)), [5, 6])
  assert.deepEqual(plain(env.forkGalParagraphTargets(['- First item.\n- Second item.', 'Tail.'], ['First item.', 'Second item.', 'Tail.'], 0)), [1, 1, 2])
  assert.equal(env.forkGalParagraphCount(text), 3)
  const button = env.ForkStageEnterHere({ sessionId: 's', turn: 7, para: 6 })
  assert.equal(button.props.className, 'fork-stage-enter-here'); assert.equal(button.props['aria-label'], '从这里进入舞台')
  assert.equal(button.props.title, '从这里进入舞台'); assert.deepEqual(button.children, [], 'icon-only: the glyph is CSS, the paragraph text gains no label')
  let stopped = 0; button.props.onClick({ preventDefault() {}, stopPropagation() { stopped++ } })
  assert.deepEqual(plain(entered), [['s', { turn: 7, para: 6 }]]); assert.equal(stopped, 1)
})

test('chat entry is a bare glyph: invisible round-cornered hit area, no pill border or fill', async () => {
  const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
  const btn = '.fork-stage-paragraph .fork-stage-enter-here.fork-stage-enter-here'
  const ruleAt = at => css.slice(at, css.indexOf('}', at))
  const base = ruleAt(css.indexOf(`${btn} {`))
  assert.match(base, /--enter-glyph: 14px; --enter-hit: 24px;/, '14px glyph inside a larger 24px hit area')
  assert.match(base, /color: var\(--fork-ink-2\);/, 'muted ink at rest')
  const shared = css.indexOf(`${btn}::before,\n${btn}::after {`)
  assert.ok(shared > 0, 'shared hit area + glyph rule')
  assert.match(ruleAt(shared), /border: 0; border-radius: 6px; corner-shape: round; background: none;/, 'the host sets `*, ::before, ::after { corner-shape: superellipse(1.5) }`; the focus ring follows the hit area shape')
  assert.match(css, new RegExp(`${btn.replace(/\./g, '\\.')}:is\\(:hover, :focus-visible\\) \\{ color: var\\(--fork-accent\\); \\}`), 'accent on hover and focus')
  assert.match(css, /enter-here:focus-visible::before \{ outline: [^}]*var\(--fork-accent\)/, 'focus ring on the invisible hit area')
  assert.doesNotMatch(css, /enter-here[^{]*::before \{[^}]*(?:border: 1px|background: color-mix)/, 'no pill border or fill')
  assert.doesNotMatch(css, /enter-here:hover::before/, 'no pill hover fill')
})

test('stage paragraph hooks are namespaced separately from turn-action toolbar hooks', async () => {
  const marked = []
  const node = { setAttribute: (name, value) => marked.push([name, value]) }
  const env = { React: {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: value => [value, () => {}], useRef: () => ({ current: { querySelectorAll: () => [node] } }),
    useLayoutEffect: fn => fn(), useEffect() {}
  } }
  vm.runInNewContext(history, env)
  const paragraph = env.ForkStageParagraph({ turn: 62, para: 5 })
  assert.equal(paragraph.props['data-fork-stage-turn'], 62)
  assert.equal(paragraph.props['data-fork-stage-para'], 5)
  assert.equal(paragraph.props['data-fork-turn'], undefined)
  assert.deepEqual(marked, [['data-fork-stage-turn', 62], ['data-fork-stage-para', 5]])
  for (const file of ['fork-gal-chat-entry.js', 'fork-gal-history.js', 'fork-gal-backlog.js', 'fork-gal-stage.js']) {
    const source = await read(file)
    assert.doesNotMatch(source, /data-fork-(?:turn|para)\b/, file)
    assert.match(source, /data-fork-stage-turn/, file)
    assert.match(source, /data-fork-stage-para/, file)
  }
  const toolbar = await read('fork-turn-actions.js')
  for (const action of ['edit', 'receipt', 'regen', 'more']) assert.ok(toolbar.includes('"data-fork-turn": "' + action + '"'))
})
