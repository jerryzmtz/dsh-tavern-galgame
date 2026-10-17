import { promptSection } from './prompt-section.js'
import figureResolution from '../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'
const { figureSpeakerHandle } = figureResolution
// private fork: optional height fields never infer a height for legacy characters.
import { forkFigureCharacter } from './figure-scale.js'
import { forkResolveBubbleMood, forkFigureBubbleMoods, forkBubbleCharacter } from '../../src/client/fork-bubble-line.cjs'
import { validateFigureEmotions } from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
import { forkNormalizeWidgetTuning } from '../../src/client/fork-widget-contracts.cjs'
import { updateWorldBookDocument } from './worldbook-resource.js'
import { normalizeSpriteDialogue } from './layered-sprite-dialogue.js'
import { normalizeStageBudget } from './stage-incremental.js'
import { estimateDirectorTokens } from './stage-director-tokens.js'
// private fork: stage.theme accepts exactly the built-in skin registry's ids.
import skinContract from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
// Private fork (docs/fork/dialogue-bubbles.md): per-card dialogue bubbles.
// The model writes `@bubble:alias|name|mood|[line]` (inner thoughts as `[*...*]`);
// the client renders them as avatar bubbles. This module owns the per-card
// configuration (aliases, names, colors, avatars incl. mood variants), stored in
// profile data keyed by card path, and keeps the format rules as one ordinary
// constant entry in the card's bound world book, where the user can see and edit it.
import { createHash } from 'node:crypto'

const moods = [] // private fork: no implicit variant vocabulary
import { normalizeBubbleInjection } from './dialogue-bubble-presets.js'

// Prompt prose source (private fork). Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "Each entry is `name (handle): variant options`. Parentheses after a variant give guidance, not part of its value.\n",
  p002: "- Spoken lines: `@bubble:handle|name|variant|[text]`, e.g. `@bubble:lin_yue|林月|喜悦|[你好。]`.",
  p003: "- For words attributed to a person in any medium, use spoken lines with that person's handle; narrate the surrounding actions.",
  p004: "- Inner thoughts: `@bubble:handle|name|variant|[*text*]`, e.g. `@bubble:lin_yue|林月|喜悦|[*终于赶上了。*]`.",
  p005: "- Copy name and handle from the speaker roster below; choose a listed variant, or leave variant empty if none are listed. For an unlisted speaker, use their name and an empty variant; make a handle from a lowercase name or romanization with underscores for spaces, reuse it, and add _2, _3 for collisions.",
  p006: "- Line rules: one sentence per marked line; no `|`, `[` or `]` within each bracketed text field, and no backticks around the line.",
  p007: "- Without variant options, leave variant empty: `@bubble:handle|name||[text]`.",
  p008: "- Narration and actions: plain prose, unmarked.",
  p009: "- Keep each character's voice: self-reference, sentence endings, verbal tics, tone and forms of address. For characters from existing works, follow how they speak in the original.",
  p011: "- For a character assigned a voice language, append a translation: `@bubble:handle|name|variant|[display text]|[voice text]`, e.g. `@bubble:lin_yue|林月|喜悦|[你好。]|[こんにちは。]` for Japanese. Everyone else keeps one text field.",
  p012: "- Their inner thoughts: `@bubble:handle|name|variant|[*display text*]|[*voice text*]`.",
  p013: "- The voiced field says what the displayed line says, as natural speech in the voice language.",
  p014: "- Keep the character's voice in both fields: self-reference, sentence endings, verbal tics, tone and forms of address. For characters from existing works, follow how they speak in the voice language in the original.",
  p015: "- The voiced field feeds speech synthesis, so write it with no reading ambiguity. For Japanese, write personal names, place names and proper nouns in hiragana or katakana (まどか、ほむら、みたきはら、キュゥべえ); rewrite kanji words with several or rare readings in kana (今日→きょう, 一日→ついたち/いちにち, 何→なに/なん, 上手→じょうず); spell numbers as read (三人→さんにん); use no romaji, bracketed readings or emoji. Common kanji with a single reading may stay.",
  p017: "Write narration and actions as plain prose; mark speech and inner thoughts as below. Each marked line becomes a speech bubble. Fields: handle identifies the speaker; name is their displayed name; variant selects an expression, mood or pose; text is their words.\n",
  p018: " [Voice language: ",
  p019: "A `[Voice language: ...]` tag after the handle gives the translation language.\n"
})

export const BUBBLE_MOOD_GROUPS = moods
const MOOD_IDS = new Set(BUBBLE_MOOD_GROUPS.map(group => group.id))
export const CUSTOM_EMOTION_ID = /^[a-z][a-z0-9_-]{0,23}$/

export function normalizeBubbleEmotions(value) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 256) throw new Error('差分最多 256 个')
  const ids = new Set(MOOD_IDS)
  const labels = new Set(BUBBLE_MOOD_GROUPS.flatMap(group => [group.label, ...group.words.split(/\s+/)]))
  const foldedLabels = new Set([...labels].map(label => label.toLowerCase()))
  const emotions = value.map(raw => {
    const id = typeof raw?.id === 'string' ? raw.id : ''
    const label = typeof raw?.label === 'string' ? raw.label.trim() : ''
    const note = typeof raw?.note === 'string' ? raw.note.trim() : ''
    const foldedLabel = label.toLowerCase()
    if (!CUSTOM_EMOTION_ID.test(id) || ids.has(id) || foldedLabels.has(id)) throw new Error('差分 ID 无效、重复或与名称冲突')
    if (!label || [...label].length > 6 || /[|｜\[\]\r\n]/.test(label) || labels.has(label) || ids.has(foldedLabel)) throw new Error('差分名称须为 1–6 字，且不能与已有名称或 ID 重复')
    if ((raw.note != null && typeof raw.note !== 'string') || [...note].length > 60) throw new Error('差分提示最多 60 字')
    ids.add(id); labels.add(label); foldedLabels.add(foldedLabel)
    if (raw.words != null && typeof raw.words !== 'string') throw new Error('Emotion words must be a string')
    const words = (raw.words || '').trim().split(/\s+/).filter(Boolean)
    if (words.length > 16 || words.some(word => [...word].length > 24 || /[|｜\[\]]/.test(word))) throw new Error('Invalid emotion words')
    return { id, label, ...(words.length ? {words:[...new Set(words)].join(' ')} : {}), ...(note ? { note } : {}) }
  })
  // private fork: every label, ID and synonym has exactly one owner.
  const owners = new Map()
  for (const emotion of [...BUBBLE_MOOD_GROUPS, ...emotions]) {
    for (const word of [emotion.id, emotion.label, ...(emotion.words || '').split(/\s+/).filter(Boolean)]) {
      const key = word.toLowerCase()
      if (owners.has(key) && owners.get(key) !== emotion.id) throw new Error('Conflicting emotion word: ' + word)
      owners.set(key, emotion.id)
    }
  }
  return emotions
}

export function effectiveBubbleMoods(config, alias) {
  const base = [...BUBBLE_MOOD_GROUPS.map(({note, ...group}) => ({ ...group })),
    ...normalizeBubbleEmotions(config?.emotions).map(emotion => ({ ...emotion, color: '#888888' }))]
  // private fork: natural speaker aliases and ref keys share the browser identity resolver.
  return forkFigureBubbleMoods(base, forkBubbleCharacter(config, alias)?.emotions)
}

// Historical detailed words remain aliases, even though new instructions use only labels.
export function resolveBubbleMood(value, config, alias) {
  return forkResolveBubbleMood(value, effectiveBubbleMoods(config, alias))
}
const ALIAS = /^[a-z0-9_]{1,32}$/
const VOICE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/
const BACKEND_VOICE_ID = /^[a-z0-9][a-z0-9_-]{0,39}(?:\/[a-z0-9][a-z0-9_-]{0,39})?$/
const IMAGE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/
const MAX_IMAGE_CHARS = 400 * 1024
const MAX_CHARACTERS = 60

// Full-size portraits live as files beside the settings and are served by URL.
const FULL_URL = /^\/api\/dsh-tavern\/bubble-image\?card=[A-Za-z0-9_-]{24}&key=[a-z0-9_]{1,32}(@[a-z][a-z0-9_-]{0,23})?&v=\d{1,16}$/

function str(value, max = 200) { return (typeof value === 'string' ? value : '').trim().slice(0, max) }
const ASSET_IMAGE = /^(?:avatars\/[A-Za-z0-9_@.-]+\.(?:webp|png|jpeg)|\/api\/dsh-tavern\/card-assets\/[a-z0-9][a-z0-9_-]{0,63}\/avatars\/[A-Za-z0-9_@.%~-]+\.(?:webp|png|jpeg)\?v=[A-Za-z0-9-]+)$/
function image(value) { return typeof value === 'string' && ((value.length <= MAX_IMAGE_CHARS && IMAGE.test(value)) || ASSET_IMAGE.test(value)) ? value : '' }
function fullUrl(value) { return typeof value === 'string' && (FULL_URL.test(value) || ASSET_IMAGE.test(value)) ? value : '' }
function cardKey(cardPath) { return createHash('sha256').update(String(cardPath || '')).digest('hex').slice(0, 24) }

export function normalizeBubbleConfig(value) {
  const input = value && typeof value === 'object' ? value : {}
  const emotions = normalizeBubbleEmotions(input.emotions)
  const effectiveMoods = effectiveBubbleMoods({ emotions })
  const seen = new Set()
  const characters = []
  for (const raw of Array.isArray(input.characters) ? input.characters.slice(0, MAX_CHARACTERS) : []) {
    const alias = str(raw && raw.alias, 32).toLowerCase()
    if (!ALIAS.test(alias) || seen.has(alias)) continue
    seen.add(alias)
    // private fork: sparse figure rows survive normalization, including an empty guidance field.
    const figureEmotions = structuredClone(validateFigureEmotions(raw.emotions || []))
    const moodIds = new Set(forkFigureBubbleMoods(effectiveMoods, figureEmotions).map(group => group.id))
    const moods = {}
    for (const [key, data] of Object.entries(raw.moods && typeof raw.moods === 'object' ? raw.moods : {})) {
      if (moodIds.has(key) && image(data)) moods[key] = image(data)
    }
    const full = {}
    for (const [key, url] of Object.entries(raw.full && typeof raw.full === 'object' ? raw.full : {})) {
      if ((key === 'default' || moodIds.has(key)) && fullUrl(url)) full[key] = url
    }
    characters.push({
      alias,
      ...(raw.ref ? {ref:structuredClone(raw.ref),aliases:structuredClone(raw.aliases || []),recall:structuredClone(raw.recall)} : {}),
      ...forkFigureCharacter(raw),
      appearance: ['live2d', 'sprite', 'avatar'].includes(raw.appearance) ? raw.appearance : 'live2d',
      emotions: figureEmotions,
      ...(Array.isArray(raw.promptEmotionIds) ? {promptEmotionIds:[...raw.promptEmotionIds]} : {}),
      name: str(raw.name, 40),
      // Any well-formed voice-library ID is kept, even if that voice is offline or retired:
      // the binding must survive until the user changes it (docs/fork/dialogue-voice.md).
      voice: BACKEND_VOICE_ID.test(str(raw.voice, 82)) ? str(raw.voice, 82) : '',
      // private fork: the figure's voice language (binding.language || voice.language) as its primary tag; any language a
      // voice can speak (ko / yue / de …) survives, so injection and TTS read the same value.
      voiceLang: voicePrimaryLanguage(raw.voiceLang) || 'ja',
      // Portrait-library (Live2D) model bound for the galgame stage; kept even if the model is missing.
      portrait: VOICE_ID.test(str(raw.portrait, 40)) ? str(raw.portrait, 40) : '',
      outfitLabel: str(raw.outfitLabel, 12),
      // Extra outfits (label → portrait model); the stage director picks one per scene, portrait is the default.
      outfits: (Array.isArray(raw.outfits) ? raw.outfits : []).map(item => ({ label: str(item && item.label, 12), model: str(item && item.model, 40) }))
        .filter((item, index, list) => item.label && VOICE_ID.test(item.model) && list.findIndex(other => other.label === item.label) === index).slice(0, 12),
      color: /^#[0-9a-f]{6}$/i.test(str(raw.color, 7)) ? str(raw.color, 7).toLowerCase() : '',
      avatar: image(raw.avatar),
      moods,
      full
    })
  }
  // Galgame stage (docs/fork/galgame-stage.md): which background tag groups this card uses and its default background.
  const stage = input.stage && typeof input.stage === 'object' ? input.stage : {}
  const directorModel = stage.directorModel && typeof stage.directorModel === 'object' && str(stage.directorModel.provider, 200) && str(stage.directorModel.model, 200)
    ? { provider: str(stage.directorModel.provider, 200), model: str(stage.directorModel.model, 200) } : null
  return { version: 1, ...(typeof input.pack?.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.pack.id) ? { pack: { id: input.pack.id } } : {}), enabled: input.enabled === true, characters, emotions, moods: effectiveMoods, injection: normalizeBubbleInjection(input.injection), voice: input.voice == null ? null : { enabled: input.voice.enabled === true },
    stage: { textLanguage: ['zh', 'ja', 'en'].includes(stage.textLanguage) ? stage.textLanguage : 'zh', director: stage.director === true, directorModel, directorBudget: normalizeStageBudget(stage.directorBudget), music: stage.music === true, widgets: stage.widgets === true, widgetTuning: forkNormalizeWidgetTuning(stage.widgetTuning), theme: Object.hasOwn(skinContract.BUILTIN_STAGE_SKINS, stage.theme) ? stage.theme : 'classic', directorPrompt: str(stage.directorPrompt, 4000).trim(),
      face: ['always', 'offstage', 'off'].includes(stage.face) ? stage.face : 'always', background: /^[a-z0-9][a-z0-9_-]{0,39}$/.test(str(stage.background, 40)) ? str(stage.background, 40) : '' } }
}

const LANGUAGE_NAMES = new Proxy(Object.freeze({ zh: '中文', ja: '日语', en: '英语', ko: '韩语', yue: '粤语' }), {
  get: (names, tag) => typeof tag !== 'string' ? undefined : names[tag] || languageDisplayName(tag)
})
function voicePrimaryLanguage(tag) {
  const primary = typeof tag === 'string' ? tag.split('-')[0].toLowerCase() : ''
  return /^[a-z]{2,3}$/.test(primary) ? primary : ''
}
function languageDisplayName(tag, locale = 'zh-CN') {
  try { return new Intl.DisplayNames([locale], {type:'language'}).of(tag) || tag } catch { return tag }
}

// The character owns the language. Capabilities only validate it or supply a legacy default.
export function resolveBubbleVoiceConfig(config, voices = []) {
  const current = normalizeBubbleConfig(config)
  const voiceWarnings = []
  for (const character of current.characters) {
    if (!character.voice) continue
    const voice = voices.find(item => item.id === character.voice)
    const languages = voice?.languages?.length ? voice.languages : ['ja', 'zh', 'en']
    const requested = config?.characters?.find(item => item.alias === character.alias)?.voiceLang
    if (requested && !languages.includes(requested)) voiceWarnings.push('角色 ' + character.alias + ' 的配音语言不受该声音支持，已回退为' + LANGUAGE_NAMES[languages[0]])
    character.voiceLang = languages.includes(requested) ? requested : languages[0]
  }
  const spriteDialogue = normalizeSpriteDialogue(current, config?.spriteDialogue)
  return { ...current, ...(spriteDialogue.length ? { spriteDialogue } : {}), ...(voiceWarnings.length ? { voiceWarnings } : {}) }
}

export const BUBBLE_WORLDBOOK_COMMENT = '对白格式（由「对话气泡」设置维护）'
// Earlier entry names; an unmarked entry with one of them is still ours, and sync renames it.
export const LEGACY_BUBBLE_WORLDBOOK_COMMENTS = Object.freeze(['对话气泡格式（由「对话气泡」设置维护）'])

export function bubbleInstruction(config, options = {}) {
  return bubbleInstructionPreview(config, options).instruction
}

// private fork: one constant roster groups identical variant sets; only prompt identities use short handles.
// The worldbook sync and prompt view consume the same rendering.
export function bubbleFigureEntries(config, options = {}) {
  const current = options.voices ? resolveBubbleVoiceConfig(config, options.voices) : normalizeBubbleConfig(config)
  return figureEmotionEntries(current, options.speakerRows)
}
function figureEmotionEntries(current, speakerRows = current.characters, characters = current.characters.filter(row => row.ref)) {
  if (!current.enabled) return []
  const groups = new Map(), packIds = []
  let hasTranslation = false
  for (const character of characters) {
    const translated = current.voice?.enabled && character.voice && character.voiceLang !== current.stage.textLanguage
    if (translated) hasTranslation = true
    const name = (character.name || character.alias) + ' (' + figureSpeakerHandle(speakerRows, character) + ')'
      + (translated ? PROMPT_PROSE.p018 + languageDisplayName(character.voiceLang, 'en') + ']' : '')
    const rows = effectiveBubbleMoods(current, character.alias)
      .filter(row => !character.promptEmotionIds || character.promptEmotionIds.includes(row.id))

    // private fork: the migration's exact stock sentence is not authored guidance.
    const variants = rows.map(row => {
      const note = row.guidance?.trim() || row.note?.trim() || ''
      return {label:row.label, note:['用于' + row.label + '的表情或动作。', '用于' + row.label + '的动作。'].includes(note) ? '' : note}
    })
    const key = JSON.stringify(variants.map(row => row.label))
    if (!groups.has(key)) groups.set(key, {names:[], variants, guidance:new Map()})
    const group = groups.get(key)
    group.names.push(name)
    for (const row of variants) if (row.note) {
      if (!group.guidance.has(row.label)) group.guidance.set(row.label, new Map())
      const notes = group.guidance.get(row.label)
      if (!notes.has(row.note)) notes.set(row.note, [])
      notes.get(row.note).push(name)
    }
    if (character.ref && !packIds.includes(character.ref.packId)) packIds.push(character.ref.packId)
  }
  if (!groups.size) return []
  const lines = [...groups.values()].map(group => '- ' + group.names.join('、') + ':' + (group.variants.length ? ' ' : '') + group.variants.map(row => {
    const notes = [...(group.guidance.get(row.label) || [])].map(([note, names]) =>
      names.length === group.names.length ? note : names.join('、') + '：' + note)
    return row.label + (notes.length ? '（' + notes.join('；') + '）' : '')
  }).join('、'))
  return [{figure:'common-roster', packIds, name:'说话人名单', comment:'说话人名单',
    content:promptSection('speaker_roster', PROMPT_PROSE.p001 + (hasTranslation ? PROMPT_PROSE.p019 : '') + lines.join('\n')), constant:true, primaryKeys:[]}]

}
// private fork (提示词 view): exactly what the story model receives from these settings — the synced worldbook entries in
// order (the generic 对白格式 entry, then each figure's emotion entry), with the director's local token estimate so both
// stages compare. `{{user}}` is shown as this chat's player name; nothing when bubbles are off.
export function bubbleInjection(config, options = {}) {
  if (!normalizeBubbleConfig(config).enabled) return []
  const preview = bubbleInstructionPreview(config, {...options, table:false}), text = preview.instruction
  const voice = preview.sections.find(section => section.key === 'voice')?.text || ''
  return [{key:'format', text, tokens:estimateDirectorTokens(text), ...(voice ? {voice:{tokens:estimateDirectorTokens(voice)}} : {})},
    ...bubbleFigureEntries(config, options).map(entry => ({key:'figure', figure:entry.figure, ...(entry.packIds ? {packs:entry.packIds} : {}), name:entry.name, constant:entry.constant, text:entry.content, tokens:estimateDirectorTokens(entry.content)}))]
}

// Preview and injection share the same generated blocks; custom templates retain bubble_format's voice rules.
export function bubbleInstructionPreview(config, options = {}) {
  const current = options.voices ? resolveBubbleVoiceConfig(config, options.voices) : normalizeBubbleConfig(config)
  const translated = current.characters.filter(character => current.voice?.enabled && character.voice && character.voiceLang !== current.stage.textLanguage)
  const roster = figureEmotionEntries(current, options.speakerRows, current.characters.filter(character => options.table !== false || !character.ref))[0]?.content || ''
  const format = [
    PROMPT_PROSE.p008,
    PROMPT_PROSE.p002,
    PROMPT_PROSE.p004,
    PROMPT_PROSE.p003,
    PROMPT_PROSE.p005,
    PROMPT_PROSE.p006,
    ...(current.characters.some(row=>row.emotions?.length===1 && row.emotions[0].label===undefined) ? [PROMPT_PROSE.p007] : []),
    ...(translated.length ? [] : [PROMPT_PROSE.p009])
  ].join('\n')
  // Voice languages belong to the shared roster, including separately injected figures.
  const voice = (translated.length ? [
      PROMPT_PROSE.p011,
      PROMPT_PROSE.p012,
      PROMPT_PROSE.p013,
      PROMPT_PROSE.p014,
      PROMPT_PROSE.p015
    ] : []).join('\n')
  const userName = str(options.userName, 80) || '你'
  const replacements = {
    bubble_format: [format, voice].filter(Boolean).join('\n'),
    bubble_player: '',
    user: userName,
    // private fork: visual variants belong to presentation, never to the writer's emotion vocabulary.
    bubble_emotions: '', // private fork: the merged figure section owns this generated guidance.
    bubble_characters: roster
  }
  const sections = [
    { key: 'format', title: '格式规则', text: PROMPT_PROSE.p017 + format },
    { key: 'voice', title: '配音规则', text: voice },
    { key: 'emotions', title: '差分', text: replacements.bubble_emotions },
    { key: 'characters', title: '角色表', text: replacements.bubble_characters },
    { key: 'extra', title: '补充要求', text: current.injection.extra }
  ]
  const custom = current.injection.template
  const segments = custom ? [
    { key: 'custom', title: '自定义模板', text: custom.replace(/^[\t ]*\{\{bubble_emotions\}\}[\t ]*\r?\n/gm, '').replace(/\{\{(bubble_format|bubble_emotions|bubble_characters|bubble_player|user)\}\}/g, (_, key) => replacements[key]).replace(/(?:\r?\n[\t ]*)+$/, '') },
    sections.at(-1)
  ].filter(section => section.text) : sections.filter(section => section.text)
  return { instruction: current.enabled ? promptSection('dialogue_format', segments.map(section => section.text).join('\n')) : '', sections, segments: current.enabled ? segments : [] }

}

export function normalizeVoicePrefs(input) {
  return { version: 1, enabled: input && typeof input.enabled === 'boolean' ? input.enabled : null }
}

function bubbleBookKey(source, cardPath) {
  return source.kind === 'card' ? (source.cardPath === cardPath ? 'card' : 'card:' + source.cardPath) : 'standalone:' + source.path
}
function entryPlacement(entry) {
  return { position: entry.position === 'before_char' ? 0 : entry.position === 'after_char' ? 1 : Number(entry.position), depth: entry.depth ?? 4, role: entry.role ?? 0, order: entry.order ?? 100 }
}
async function bubbleBooks(worldBooks, cardPath) {
  const binding = await worldBooks.binding(cardPath)
  const books = binding.kind === 'multiple' ? (binding.books || []) : binding.source ? [binding] : []
  if (books.some(book => book.available === false)) throw new Error('绑定的世界书不可用，未保存设置；请恢复绑定后重试')
  const sources = books.length ? books.map(book => book.source) : [{ kind: 'card', cardPath }]
  return Promise.all([...new Map(sources.map(source => [bubbleBookKey(source, cardPath), source])).values()].map(async source => ({ source, record: await worldBooks.get(source) })))
}
export async function readDialogueBubblePlacement(worldBooks, cardPath, applied = {}) {
  const records = await bubbleBooks(worldBooks, cardPath)
  const books = records.map(({ source, record }) => ({ key: bubbleBookKey(source, cardPath), name: record.view.displayName || '本卡世界书', source }))
  // private fork (提示词 view): every enabled dialogue-bubble entry the bound books hold — this card's and ones another
  // card left behind (own:false, e.g. after the card was copied) — since the story model receives all of them.
  const entries = records.flatMap(({ source, record }) => (record.view.entries || []).flatMap(entry => {
    const owner = entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles
    return owner?.version === 1 && entry.enabled !== false ? [{ book: bubbleBookKey(source, cardPath), bookName: record.view.displayName || '本卡世界书', comment: str(entry.comment, 200), text: String(entry.content || ''),
      constant: entry.constant === true, own: owner.cardKey === cardKey(cardPath), ...(owner.figure ? { figure: owner.figure } : {}) }] : []
  }))
  for (const { source, record } of records) {
    const entry = record.view.entries.find(entry => {
      const owner = entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles
      return owner?.version === 1 && owner.cardKey === cardKey(cardPath)
    })
    if (!entry) continue
    const current = { book: bubbleBookKey(source, cardPath), name: record.view.displayName, ...entryPlacement(entry) }
    return { books, current, manual: Object.entries(applied).some(([key, value]) => current[key] !== value), entries }
  }
  return { books, current: null, manual: false, entries }
}

// Only inspect currently bound books. Exact legacy entries in shared books are
// ambiguous: without ownership metadata we must not claim another card's rule.
export async function syncDialogueBubbleWorldbook(worldBooks, cardPath, config) {
  const current = normalizeBubbleConfig(config)
  const key = cardKey(cardPath)
  const records = await bubbleBooks(worldBooks, cardPath)
  const placement = current.injection.placement || {}
  const destination = placement.book === undefined ? null : records.find(book => bubbleBookKey(book.source, cardPath) === placement.book)
  if (placement.book !== undefined && !destination) throw new Error('目标世界书不在本卡绑定列表中，未修改条目')
  const patch = Object.fromEntries(Object.entries(placement).filter(([key]) => key !== 'book'))
  const owned = [], legacy = [], figureEntries = []
  for (const book of records) {
    for (const entry of book.record?.view?.entries || []) {
      const extra = entry.rawEntry?.extensions?.dsh_tavern_helper_extra || {}
      const owner = extra.forkDialogueBubbles
      if (owner) { if (owner.version === 1 && owner.cardKey === key) (owner.figure ? figureEntries : owned).push({ ...book, entry, extra }); continue }
      if (entry.comment === BUBBLE_WORLDBOOK_COMMENT || LEGACY_BUBBLE_WORLDBOOK_COMMENTS.includes(entry.comment)) legacy.push({ ...book, entry, extra })
    }
  }
  if (legacy.length > 1 || legacy.some(item => item.source.kind !== 'card' || item.source.cardPath !== cardPath)) {
    throw new Error('旧版气泡格式条目归属不明确，请在世界书库确认归属后重试；未修改条目')
  }
  const matches = [...owned, ...legacy]
  const keeper = matches[0]
  const moving = keeper && destination && bubbleBookKey(keeper.source, cardPath) !== bubbleBookKey(destination.source, cardPath)
  const plans = new Map(records.map(book => [book, []]))
  function plan(item, op) { const book = records.find(book => book.record === item.record); plans.get(book).push(op) }
  let removed = 0, updated = 0
  for (const item of matches) {
    if (!current.enabled || item !== keeper || moving) { plan(item, { op: 'delete', ref: item.entry.ref }); removed++ }
  }
  if (current.enabled) {
    // Worldbooks are shared across chats; the runtime projection resolves this macro per chat.
    // private fork: generic grammar and the merged figure roster are separate constant entries.
    const content = bubbleInstruction(config, { userName: '{{user}}', table: false })
    const helperExtra = { ...(keeper?.extra || {}), forkDialogueBubbles: { version: 1, cardKey: key } }
    if (keeper && !moving) {
      if (keeper.entry.content !== content || keeper.entry.comment !== BUBBLE_WORLDBOOK_COMMENT || !keeper.entry.enabled || !keeper.entry.constant || !keeper.extra.forkDialogueBubbles || Object.entries(patch).some(([key, value]) => entryPlacement(keeper.entry)[key] !== value)) {
        plan(keeper, { op: 'update', ref: keeper.entry.ref, patch: { comment: BUBBLE_WORLDBOOK_COMMENT, content, enabled: true, constant: true, helperExtra, ...patch } }); updated++
      }
    } else {
      plans.get(destination || records[0]).push({ op: 'add', entry: { ...(moving ? keeper.entry : {}), comment: BUBBLE_WORLDBOOK_COMMENT, content, enabled: true, constant: true, primaryKeys: [], order: 100, ...(moving ? entryPlacement(keeper.entry) : {}), helperExtra, ...patch } }); updated++
    }
  }
  const wantedFigures = new Set()
  for (const {figure, comment, content, constant, primaryKeys} of figureEmotionEntries(current)) {
    wantedFigures.add(figure)
    const entry = {comment,content,enabled:true,
      constant,primaryKeys,...patch,order:Number(patch.order ?? (keeper ? entryPlacement(keeper.entry).order : 100)) + 1,
      helperExtra:{forkDialogueBubbles:{version:1,cardKey:key,figure}}}
    const matches = figureEntries.filter(item => item.extra.forkDialogueBubbles.figure === figure)
    const old = matches.find(item => !destination || bubbleBookKey(item.source,cardPath) === bubbleBookKey(destination.source,cardPath))
    for (const item of matches) if (item !== old) {plan(item,{op:'delete',ref:item.entry.ref});removed++}
    if (!old) {plans.get(destination || records[0]).push({op:'add',entry});updated++}
    else if (old.entry.comment !== entry.comment || old.entry.content !== entry.content || old.entry.constant !== entry.constant || !old.entry.enabled || JSON.stringify(old.entry.primaryKeys) !== JSON.stringify(primaryKeys) || Object.entries({...patch,order:entry.order}).some(([key,value]) => entryPlacement(old.entry)[key] !== value)) {
      plan(old,{op:'update',ref:old.entry.ref,patch:entry});updated++
    }
  }
  for (const item of figureEntries) if (!wantedFigures.has(item.extra.forkDialogueBubbles.figure)) {plan(item,{op:'delete',ref:item.entry.ref});removed++}
  // Snapshot both books before a move; roll back every attempted write on failure.
  const snapshots = new Map()
  if (moving) {
    if (!worldBooks.export || !worldBooks.replaceNative) throw new Error('世界书接口不支持安全移动，未修改条目')
    for (const [book, operations] of plans) if (operations.length) snapshots.set(book, (await worldBooks.export(book.source)).document)
  }
  const attempted = []
  let completed = 0
  try {
    for (const [book, operations] of plans) if (operations.length) {
      attempted.push(book)
      if (moving) {
        const nativeOperations = operations.map(operation => operation.ref && book.source.kind === 'card'
          ? { ...operation, ref: 'entry:' + book.record.view.entries.find(entry => entry.ref === operation.ref).sourceUid } : operation)
        let document = updateWorldBookDocument(snapshots.get(book), { operations: nativeOperations }).document
        if (book === destination && current.enabled) {
          const origin = records.find(book => book.record === keeper.record)
          const raw = Object.values(snapshots.get(origin).entries).find(entry => entry.uid === Number(keeper.entry.sourceUid))
          const added = Object.values(document.entries).find(entry => entry.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles?.cardKey === key)
          if (!raw || !added) throw new Error('移动条目快照不完整')
          document.entries[String(added.uid)] = { ...raw, uid: added.uid, extensions: { ...raw.extensions, ...added.extensions } }
          document = updateWorldBookDocument(document, { operations: [{ op: 'update', ref: 'entry:' + added.uid, patch: operations.find(op => op.op === 'add').entry }] }).document
        }
        await worldBooks.replaceNative(book.source, document)
      } else await worldBooks.update(book.record.source || book.source, { operations })
      completed++
    }
  } catch (error) {
    if (moving) {
      const failures = []
      for (const book of attempted.reverse()) {
        try { await worldBooks.replaceNative(book.source, snapshots.get(book)) } catch (rollback) { failures.push(rollback.message) }
      }
      throw new Error((failures.length ? '移动失败且回滚失败：' + failures.join('；') : '移动失败，已回滚世界书') + '；' + error.message)
    }
    throw new Error((completed ? '部分世界书已更新，设置未保存；请重试：' : '世界书更新失败，设置未保存；请重试：') + error.message)
  }
  const target = destination || keeper || records[0]
  return { source: target.record.source || target.source, name: target.record?.view?.displayName || '', changed: Boolean(removed || updated), removed, updated }
}
