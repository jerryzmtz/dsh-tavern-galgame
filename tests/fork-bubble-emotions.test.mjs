// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: include source literally, without String.replace replacement-token expansion.
// private fork: filename-based avatar binding is removed; P5 tests cover explicit figure targets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }
import {bubbleResolutionSource} from './helpers/bubble-resolution-source.mjs' // private fork

const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const bubbles = (await read('fork-bubbles.js')).split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')).replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
const bubblesHead = bubbleResolutionSource
const assets = '' // private fork: v1 source editor removed
const modes = await read('fork-bubble-modes.js')
const settingsUi = await read('fork-settings-ui.js')
const modal = await read('fork-modal.js')
const voices = await read('fork-voice.js')
const galStage = await read('fork-gal-stage.js')
const plain = value => JSON.parse(JSON.stringify(value))
function load(context, ...sources) { vm.runInNewContext(sources.join('\n;\n'), context); return context }
const avatarImport = ''
const helpers = () => load({}, assets.slice(0, assets.indexOf('// ---------- Stores')), bubblesHead, avatarImport, modes.slice(0, modes.indexOf('// ---------- Components')))
const CUSTOM = { emotions: [{ id: 'cabc12', label: '傲娇', note: '嘴硬心软' }], moods: [...moods.map(item => ({ ...item, builtin: true })), { id: 'cabc12', label: '傲娇', note: '嘴硬心软', color: '#888888', builtin: false }] }

test('mood parsing: builtin detailed words keep their group, a custom label maps to its id, unknown words stay unknown', () => {
  const ctx = helpers()
  const list = ctx.forkBubbleMoodList(CUSTOM)
  assert.deepEqual(plain(list.map(item => [item.id, item.builtin])), [...moods.map(item => [item.id, true]), ['cabc12', false]])
  assert.equal(list.at(-1).color, '#888888', 'custom colours are neutral (the host colour)')
  assert.equal(ctx.forkBubbleMood('傲娇', list).id, 'cabc12')
  assert.equal(ctx.forkBubbleMood('cabc12', list).id, 'cabc12')
  assert.equal(ctx.forkBubbleMood('窘迫', list).id, 'shy', 'detailed words map to their builtin group')
  assert.equal(ctx.forkBubbleMood('喜悦', list).id, 'joy')
  // private fork: smug belongs to a card state, not the builtin joy aliases.
  assert.equal(ctx.forkBubbleMood('得意'), null)
  assert.equal(ctx.forkEmotionLabelError('得意'), '')
  assert.equal(ctx.forkBubbleMood('得意', ctx.forkBubbleMoodList({emotions:[{id:'smug',label:'得意'}]})).id, 'smug')
  assert.equal(ctx.forkBubbleMood('不存在的情绪', list), null, 'callers fall back to calm / default')
  assert.equal(ctx.forkBubbleMood('傲娇'), null, 'without the card list only the builtin 9 are known')
  // Emotions in the draft win over the host's derived list; a host list alone still yields its custom ones.
  assert.deepEqual(plain(ctx.forkBubbleMoodList({ ...CUSTOM, emotions: [] }).map(item => item.id)), moods.map(item => item.id))
  assert.deepEqual(plain(ctx.forkBubbleMoodList({ moods: CUSTOM.moods }).map(item => item.id)).at(-1), 'cabc12')
  assert.equal(ctx.forkBubbleMoodList({ emotions: [{ id: 'cnew01', label: '中二' }] }).at(-1).color, ctx.FORK_CUSTOM_MOOD_COLOR ?? '#8b8f99')
  assert.equal(ctx.forkBubbleMoodList(null).length, 9)
  // private fork: raw card words work even without a host-derived moods list.
  assert.equal(ctx.forkBubbleMood('昂首', ctx.forkBubbleMoodList({emotions:[{id:'stand',label:'站立',words:'昂首'}]})).id, 'stand')
  // Avatar-pack file names use custom labels / ids too.
})

test('voice uses normalized card moods and the stage consumes host-owned visual variants', () => {
  // private fork: native speech inputs have no browser voice registry.
  const input = voices.slice(voices.indexOf('function forkPackSpeechInput('),voices.indexOf('function useForkVoiceBubbles('));
  const ctx = load({},bubblesHead,input);
  const config = { ...CUSTOM, characters: [{ alias: 'hero', voice: 'v1', voiceLang: 'zh' }], stage: { textLanguage: 'zh' } }
  const spec = mood => ctx.forkPackSpeechInput(ctx.forkParseBubbles('@bubble:hero|主角|' + mood + '|[你好]', false)[0], config)
  assert.equal(spec('傲娇').mood, 'cabc12')
  assert.equal(spec('窘迫').mood, 'shy')
  assert.equal(spec('莫名其妙').mood, null) // private fork: no undeclared default
  // private fork: the host freezes source-derived expression variants; the stage does not reselect them.
  assert.doesNotMatch(galStage,/const emotions =|useForkPackPresentation/);
  assert.match(galStage,/forkStageVoiceHandle\(sessionId,page.voice,config/);
})

// private fork: one label resolver for transcript, portrait title and stage nameplate.
test('emotion badges use current card labels and hide unknown state IDs', () => {
  const ctx = helpers(), list = ctx.forkBubbleMoodList({emotions:[
    {id:'smug',label:'得意'}, {id:'singing',label:'唱歌'}, {id:'eating',label:'吃饭（扒饭）'}]})
  for (const [id,label] of [['smug','得意'],['singing','唱歌'],['eating','吃饭（扒饭）'],['joy','喜悦']]) {
    assert.equal(ctx.forkBubbleMoodLabel(id,list),label)
    assert.equal(ctx.forkBubbleMoodLabel(label,list),label)
  }
  // private fork: metadata wins over prefixes; labels never expose unknown IDs.
  const config = {characters:[{alias:'f_hero',aliases:['hero'],ref:{packId:'pack',figureId:'hero'}},{alias:'f_other',aliases:['other'],ref:{packId:'pack',figureId:'other'}}],spriteDialogue:[{alias:'f_hero',states:[
    {id:'pose_a',emotion:'calm'}, {id:'pose_b',parent:'pose_a'},
    {id:'joy-override',emotion:'smug'}, {id:'cycle_a',parent:'cycle_b'}, {id:'cycle_b',parent:'cycle_a'}]},
    {alias:'f_other',states:[{id:'pose_a',emotion:'anger'}]}]}
  for (const [id,label] of [['calm_variant','平和'],['calm_variant_2','平和'],['joy-wide','喜悦'],['smug_variant','得意'],['pose_a','平和'],['pose_b','平和'],['joy-override','得意'],['cycle_a',''],['calmish_variant','']]) {
    assert.equal(ctx.forkBubbleMoodLabel(id,list,config,'hero'),label,id)
  }
  assert.equal(ctx.forkBubbleMoodLabel('pose_a',list,config,'other'),'愤怒')
  assert.equal(ctx.forkBubbleMoodLabel('calm_variant',[...list,{id:'calm_variant',label:'自定义'}]),'自定义')
  assert.equal(ctx.forkParseBubbles('@bubble:hero|角色|calm_variant|[你好]',false)[0].mood,'calm_variant')
  assert.equal(ctx.forkBubbleMoodLabel('unknown_state',list),'')
  assert.equal(ctx.forkBubbleMoodLabel('',list),'')
  assert.equal(ctx.forkBubbleMoodLabel('smug',ctx.forkBubbleMoodList({emotions:[{id:'smug',label:'自豪'}]})),'自豪')
  assert.match(bubbles,/moodLabel \? h\("span", \{ className: "fork-bubble-mood" \}, moodLabel\)/)
  assert.match(bubbles,/forkBubbleMoodLabel\(props.mood, props.moods, props.config, props.alias\)/)
  assert.match(galStage,/mood: forkBubbleMoodLabel\(current.mood, moodList, config, speaker\)/)
})

// private fork: exercise the actual badge and portrait click path, not only the resolver.
test('bubble rows omit unknown badges and portrait titles use resolved labels', () => {
  const h = (type,props,...children) => ({type,props:props || {},children:children.flat().filter(x => x != null)})
  let title = ''
  // private fork: DOM colour application is covered by figure-auto-color-browser; this fixture inspects element props.
  const ctx = load({useForkFigureTextContrast(){},React:{createElement:h,useState:v => [v,()=>{}],useRef:v => ({current:v}),useEffect(){}},
    useForkBubbleMedia:() => ({src:'image'}), ForkPackImage:()=>{},
    forkShowPortrait:(_media,value) => {title = value}, forkPortraitPreview:()=>({})},
    bubblesHead,bubbles.slice(bubbles.indexOf('function ForkBubbleAvatar('),bubbles.indexOf('// Drop-in for TavernColoredMarkdown')))
  const walk = node => node && typeof node === 'object' ? [node,...node.children.flatMap(walk)] : []
  for (const [mood,label] of [['calm_variant','平和'],['unmapped_internal_id','']]) {
    const tree = ctx.ForkBubbleRow({segment:{alias:'hero',name:'角色',mood,text:'你好'},config:{}})
    const badges = walk(tree).filter(node => node.props.className === 'fork-bubble-mood')
    assert.equal(badges.length,label ? 1 : 0)
    if (label) assert.equal(badges[0].children[0],label)
    const avatar = walk(tree).find(node => node.type === ctx.ForkBubbleAvatar)
    ctx.ForkBubbleAvatar(avatar.props).props.onClick({currentTarget:{}})
    assert.equal(title,'角色' + (label ? ' · ' + label : ''))
  }
})

test('custom emotion rules: generated ids, label checks against actual declarations, at most 256, delete strips images', () => {
  const ctx = helpers()
  const random = (...values) => () => values.shift() ?? 0.25
  const id = ctx.forkNewEmotionId([], random(0.5))
  assert.match(id, /^c[0-9a-z]{5}$/)
  assert.notEqual(ctx.forkNewEmotionId([id], random(0.5, 0.75)), id, 'taken ids are skipped')
  const error = (label, list = [], editing = '') => ctx.forkEmotionLabelError(label, list, editing)
  assert.equal(error('傲娇'), '')
  assert.match(error(''), /请填写/)
  assert.match(error('一二三四五六七'), /最多 6/)
  assert.equal(error('一二三四五六'), '')
  assert.match(error('a|b'), /不能含/)
  for (const reserved of ['cabc12']) assert.match(error(reserved, [{ id: 'cabc12', label: 'x' }]), /编号/, reserved) // private fork
  assert.equal(error('calm'),''); assert.equal(error('joy'),'') // private fork
  assert.ok(!['default', 'neutral'].includes(ctx.forkNewEmotionId([], random(0.5))))
  assert.equal(error('喜悦'), '') // private fork
  assert.equal(error('窘迫'), '') // private fork
  assert.match(error('中二', [{ id: 'c1', label: '中二' }]), /同名/)
  assert.equal(error('中二', [{ id: 'c1', label: '中二' }], 'c1'), '', 'editing keeps its own label')
  const eight = Array.from({ length: 256 }, (_, i) => ({ id: 'c0000' + i, label: '情' + i }))
  assert.throws(() => ctx.forkEmotionUpsert(eight, { label: '多一个' }), /最多 256/) // private fork
  assert.deepEqual(plain(ctx.forkEmotionUpsert(eight, { id: 'c00003', label: '改名', note: ' 提示 ' })[3]), { id: 'c00003', label: '改名', note: '提示' })
  const config = { emotions: [{ id: 'cabc12', label: '傲娇' }], characters: [{ alias: 'a', name: '甲', moods: { cabc12: 'x', joy: 'y' }, full: { cabc12: 'z' } }, { alias: 'b', name: '乙' }] }
  assert.deepEqual(plain(ctx.forkEmotionUsers(config, 'cabc12')), ['甲'])
  const removed = plain(ctx.forkEmotionRemove(config, 'cabc12'))
  assert.deepEqual(removed.emotions, [])
  assert.deepEqual(removed.characters, [{ alias: 'a', name: '甲', moods: { joy: 'y' }, full: {} }, { alias: 'b', name: '乙' }])
})

test('outgoing config: injection controls without retired fields, no derived moods, emotions as { id, label, note }', () => {
  const ctx = helpers()
  const out = plain(ctx.forkBubbleOutgoing({ enabled: true, injection: { presetId: 'simple', name: '简洁八类', emotionMode: 'simple', bilingual: true, template: 'T' }, ...CUSTOM, stage: { theme: 'gothic', worldview: 'x' } }))
  assert.deepEqual(out.injection, { template: 'T', extra: '' })
  assert.equal('moods' in out, false)
  assert.deepEqual(out.emotions, [{ id: 'cabc12', label: '傲娇', note: '嘴硬心软' }])
  assert.equal('worldview' in out.stage, false)
  assert.deepEqual(plain(ctx.forkBubbleOutgoing({}).injection), { template: '', extra: '' })
})

test('popover placement: never under the modal nav or past the viewport; flips up and sideways; at least its min width', () => {
  const { forkPopoverPlace: place } = load({}, settingsUi)
  const viewport = { width: 1000, height: 700 }
  // The reported case: an 800px modal, nav on the left (x 100–160), content from x 160; the voice button sits
  // at the left of the content near the bottom. The old menu opened up and to the LEFT, under the nav.
  const body = { left: 160, right: 900, top: 100, bottom: 650 }
  const trigger = { left: 190, right: 300, top: 560, bottom: 588 }
  let at = place(trigger, { width: 240, height: 300 }, viewport, { bounds: body, minWidth: 260 })
  assert.equal(at.up, true, 'not enough room below: opens upward')
  assert.ok(at.left >= body.left + 8, 'starts inside the content area, right of the nav')
  assert.equal(at.width, 260, 'at least the minimum width')
  assert.equal(at.top, 560 - 6 - 300)
  // Right edge: flips to end at the trigger's right edge, then clamps to the content area / viewport.
  at = place({ left: 820, right: 880, top: 200, bottom: 228 }, { width: 300, height: 200 }, viewport, { bounds: body })
  assert.equal(at.up, false)
  assert.equal(at.left, 880 - 300, 'flipped to align with the trigger\'s right edge')
  at = place({ left: 500, right: 520, top: 200, bottom: 228 }, { width: 700, height: 200 }, viewport, { bounds: body })
  assert.deepEqual([at.left, at.left + at.width], [body.right - 8 - 700, body.right - 8], 'neither side fits: clamped to the content area')
  // A content area too narrow for the menu: it floats over it but stays inside the viewport.
  at = place({ left: 190, right: 220, top: 100, bottom: 120 }, { width: 380, height: 100 }, viewport, { bounds: { left: 160, right: 400 } })
  assert.equal(at.width, 380)
  assert.ok(at.left >= 8 && at.left + at.width <= 992)
  // Viewport edges and height.
  at = place({ left: 2, right: 30, top: 10, bottom: 30 }, { width: 2000, height: 2000 }, viewport, {})
  assert.deepEqual([at.left, at.width, at.up, at.maxHeight], [8, 984, false, 700 - 8 - 36])
  at = place({ left: 400, right: 440, top: 650, bottom: 680 }, { width: 200, height: 900 }, viewport, {})
  assert.equal(at.up, true); assert.equal(at.maxHeight, 650 - 6 - 8); assert.equal(at.top, 8)
})

test('modal nav goes compact under 900px wide', () => {
  const ctx = load({}, modal)
  assert.equal(ctx.forkModalCompact(800), true)
  assert.equal(ctx.forkModalCompact(899), true)
  assert.equal(ctx.forkModalCompact(900), false)
  assert.equal(ctx.forkModalCompact(0), false, 'not measured yet')
})
