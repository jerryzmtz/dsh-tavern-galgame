import {directionStyles} from './domain/direction-styles.js'
import {cardItemWidget} from './domain/item-widget.js'
import {figureCatalogue} from './domain/figure-catalogue.js' // private fork
import skinContract from '../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { CARD_ID } from './fork-card-storage.js'
import { effectiveCardStage } from './domain/card-stage-settings.js'
import { rawData } from './domain/card-preparation.js'
import { readCardAssetExtension } from './domain/card-asset-bindings.js'
import { hasCardAssetBindings } from './fork-card-asset-bindings.js'
import { normalizeBubbleConfig, effectiveBubbleMoods, syncDialogueBubbleWorldbook } from './domain/dialogue-bubbles.js'
import { selectPackFigure } from './domain/asset-pack-presentation.js'
import { assetPackDigest } from './domain/stage-asset-pack-catalogue.js'
import { collectSpriteDialogue } from './domain/layered-sprite-dialogue.js'
import { inspectWorldBookDocument, updateWorldBookDocument } from './domain/worldbook-resource.js'
import figureColors from '../shared/figure-auto-color.cjs'
import forkSurfaces from '../src/client/fork-surfaces.cjs'

// private fork (owner 2026-10, docs/fork/figure-auto-color.md): a character's one colour is its figure's 形象色 (the user's
// imageColor, else the autoColor sampled from its image); no palette, no collision avoidance, every consumer reads it. Its
// readable name inks for the chat schemes are computed once per figure asset (pack id + figure id at a pack revision).
const CHAT_BACKGROUNDS = {light:forkSurfaces.SURFACES['chat-light'].base.bgSolid, dark:forkSurfaces.SURFACES['chat-dark'].base.bgSolid}
const figureInkCache = new Map()
function figureInk(ref, revision, color) {
  const key = ref.packId + ':' + ref.figureId + '@' + revision
  let ink = figureInkCache.get(key)
  if (!ink) {
    ink = figureColors.figureInks(color, CHAT_BACKGROUNDS); figureInkCache.set(key, ink)
    if (figureInkCache.size > 512) figureInkCache.delete(figureInkCache.keys().next().value)
  }
  return ink
}

// private fork (owner 2026-10): the mini-preview palette of one skin option, read from the skin's own tokens (its
// default level's look, the panel `ui` over the textbox paint) - inert colours only, computed with the options list.
export function stageSkinPreview(document) {
  let look = document
  try { look = skinContract.stageSkinAppearance(document) || document } catch { look = document }
  const paint = {...look?.textbox?.paint, ...look?.ui}
  if (!paint.bg) return undefined
  const fg = paint.fg || paint.bg
  return {bg:paint.bg, fg, accent:paint.accent || look.textStyle?.emphasis || fg, border:paint.border || paint.fgMuted || fg}
}

// A voice's language tag ('ja', 'zh-CN') → its primary language, the only part the dialogue rules compare.
const figureVoiceLanguage = (figure, pack) => String(figure?.voice?.language || pack?.manifest.voiceLibrary?.voices[figure?.voice?.voice]?.language || '').split('-')[0].toLowerCase() || undefined
// Dialogue text is projected from Card Preparation; no card-local media catalogue.
export function cardBubbleConfig(raw, engine, packSnapshots = [], globalEnabledPackIds = []) {
  const extension = raw && hasCardAssetBindings(raw) ? readCardAssetExtension(raw) : null
  const stage = effectiveCardStage(extension, engine)
  const dialogue = engine.dialogue, models = []
  const rows = figureCatalogue({snapshots:packSnapshots,bindings:extension?.assetBindings,globalEnabledPackIds}).filter(row => row.enabled)
  const characters = rows.map(row => {
    const {actorKey:alias,figure,ref} = row
    const value = {name:figure.name,appearance:figure.appearance,aliases:figure.aliases || [],ref,recall:figure.recall}
    const pack = packSnapshots.find(pack => pack.manifest.id === ref.packId)
    const outfits = figure?.enabled ? figure.outfits.filter(outfit => outfit.enabled && outfit.sprite && pack.sprites?.[outfit.sprite.manifestKey]) : []
    // Read-only catalogue keys, not legacy portrait-library bindings or asset aliases.
    const sprites = outfits.map(outfit => {
      const model = 'sprite_' + models.length
      models.push({id:model, spritePack:pack.sprites[outfit.sprite.manifestKey]})
      return {model, label:outfit.label || outfit.key}
    })
    // private fork: the cast only binds a figure; its voice data comes from that pack. private fork (owner 2026-10 r3): the
    // figure's voice language is always projected (no 双语配音 switch); unknown means it speaks the text language.
    return {alias, ...value, emotions:figure?.enabled ? figure.emotions : undefined,
      voice:stage.voice && figure?.enabled ? figure.voice?.source !== null ? figure.voice?.voice || '' : '' : '', voiceLang:figureVoiceLanguage(figure, pack) || dialogue.textLanguage,
      ...(sprites.length ? {portrait:sprites[0].model, outfitLabel:sprites[0].label, outfits:sprites.slice(1)} : {})}
  })
  // private fork (owner 2026-10 r3): the one place bubbles are decided — the card's own switch; a card without stage
  // settings has no figures to show and writes plain text (no dialogue-format injection) until 「开启对话气泡」.
  const config = normalizeBubbleConfig({...dialogue, enabled:!!extension && stage.dialogue, characters,
    stage:{textLanguage:dialogue.textLanguage,theme:typeof stage.defaultSkin === 'string' ? stage.defaultSkin : 'classic',enabled:!!extension && stage.stage,director:!!extension && stage.stage,music:stage.music,widgets:stage.widgets}})
  config.characters = config.characters.map(({avatar, moods, full, ...character}) => {
    const row = rows.find(row => row.actorKey === character.alias), {ref,figure} = row
    const pack = packSnapshots.find(pack => pack.manifest.id === ref.packId)
    character.color = (figure.imageColor ?? figure.autoColor ?? '').toLowerCase(); if (character.color) character.ink = figureInk(ref, pack?.revision, character.color)
    // Transcript portraits use the bound figure's default outfit, not stage directions.
    const media = emotion => {
      const selected = selectPackFigure(figure, pack?.sprites || {}, {emotion}), hash = selected.avatar
      return hash ? {resource:true, kind:'media', ref:{...ref}, alias:character.alias, revision:pack.revision,
        hash, outfitKey:selected.avatarOutfitKey, stateId:selected.avatarStateId, crop:selected.avatarCrop, identity:`${ref.packId}:figures:${ref.figureId}:${hash}`} : null
    }
    const promptEmotionIds = (figure.emotions || []).map(row=>row.id)
    return {...character, promptEmotionIds, defaultEmotion:figure.outfits.find(outfit=>outfit.enabled)?.defaultEmotion || figure.emotions?.[0]?.id || null, ref, aliases:figure.aliases || [], recall:figure.recall, voiceKey:figure?.voice ? assetPackDigest({ref,voice:figure.voice,voiceSpec:pack?.manifest.voiceLibrary?.voices[figure.voice.voice],readings:extension?.readings || null}) : null, avatarMedia:{default:media(figure.outfits.find(o=>o.enabled)?.defaultEmotion || figure.emotions?.[0]?.id), moods:Object.fromEntries(effectiveBubbleMoods(config, character.alias).map(mood => [mood.id, media(mood.id)]))},
      voiceLanguage:figureVoiceLanguage(figure, pack) || dialogue.textLanguage}
  })
  config.stage.styles = directionStyles(packSnapshots, extension?.assetBindings.boundPackIds, globalEnabledPackIds)
  config.stage.defaultSkin = structuredClone(stage.defaultSkin);
  // private fork (owner 2026-10 r2): the 音效 / 环境音 switches are part of the session settings like BGM, so switching
  // one in 舞台设置 changes the settings key and the open stage re-projects its audio at once (not on the next turn).
  config.stage.sfx = stage.sfx; config.stage.ambience = stage.ambience;
  config.stage.items = cardItemWidget(raw,packSnapshots,globalEnabledPackIds).enabled;
  // private fork (owner 2026-10): every option carries a small palette for the CONFIG skin select's mini preview.
  config.stage.skinChoices = Object.values(skinContract.BUILTIN_STAGE_SKINS).map(document=>({value:document.id,label:document.label,preview:stageSkinPreview(document)}));
  for(const pack of packSnapshots) if(extension?.assetBindings.boundPackIds.includes(pack.manifest.id))
    for(const asset of pack.manifest.assets.filter(a=>a.kind==='skins')) {
      const document=pack.skins?.[asset.id];if(document)config.stage.skinChoices.push({value:{packId:pack.manifest.id,kind:'skins',assetId:asset.id},label:document.label,preview:stageSkinPreview(document)});
    }
  // Initial open needs a skin before any director record or media projection exists.
  const selection=typeof stage.defaultSkin==='object' ? stage.defaultSkin : null;
  const ref=selection ? {packId:selection.packId,kind:'skins',assetId:selection.assetId} : null, pack=ref && packSnapshots.find(p=>p.manifest.id===ref.packId);
  const asset=pack?.manifest.assets.find(a=>a.kind==='skins' && a.id===ref.assetId);
  const document=typeof stage.defaultSkin==='string' ? skinContract.BUILTIN_STAGE_SKINS[stage.defaultSkin] : asset && pack.skins?.[ref.assetId];
  config.stage.skin = document ? {document:structuredClone(document),...(ref?{ref}:{builtin:true})} : {builtin:true,document:structuredClone(skinContract.BUILTIN_STAGE_SKINS.classic)};
  config.stage.enabled = !!extension && stage.stage
  config.voice = {enabled:stage.voice && config.characters.some(character => character.voice)}
  config.spriteDialogue = collectSpriteDialogue(config, models)
  return config
}

// ZIP imports prepare the embedded book in memory before computing the commit proof.
// Reuse the existing ownership/placement rules; never acquire the pack or card gate here.
export async function syncPreparedCardBubbles(workspace, cardPath, engine, packSnapshots = []) {
  if (!hasCardAssetBindings(workspace.raw)) return
  const source = {kind:'card', cardPath}
  const worldBooks = {
    binding:async () => ({source}),
    get:async () => {
      const document = structuredClone(workspace.raw)
      rawData(document).character_book ||= {name:'', entries:[]}
      return {source, view:inspectWorldBookDocument(document)}
    },
    update:async (_source, request) => {
      const document = structuredClone(workspace.raw)
      rawData(document).character_book ||= {name:'', entries:[]}
      workspace.raw = updateWorldBookDocument(document, request).document
    }
  }
  return syncDialogueBubbleWorldbook(worldBooks, cardPath, cardBubbleConfig(workspace.raw, engine, packSnapshots))
}

// private fork: committed figure edits refresh every dependent card's managed writer entry.
// Serialize notifications (not pack writes); each task reads the latest figure and card data.
export function watchFigureBubbleBooks({service, listCards, readWorkspace, sync, onError, packSettings}) {
  let active = true, pending = Promise.resolve()
  const globals = () => packSettings?.read().values.globalEnabledPackIds || []
  function enqueue(packId) {
    pending = pending.then(async () => {
      for (const path of await listCards()) {
        if (!active) return
        try {
          const raw = (await readWorkspace(path))?.raw
          if (!active) return
          if (!raw || !hasCardAssetBindings(raw)) continue
          const bindings = readCardAssetExtension(raw).assetBindings
          if (!packId || bindings.boundPackIds.includes(packId) || globals().includes(packId)) await sync(path)
        } catch (error) { onError(error, path) }
      }
    }).catch(error => onError(error))
  }
  const stop = service.subscribe(event => {if (event.figures?.length) enqueue(event.packId)})
  // private fork: global pack changes affect all opted-in cards, not just explicit bindings.
  const stopSettings = packSettings?.subscribe(() => enqueue())
  return {drain:() => pending, dispose() {active = false; stop(); stopSettings?.()}}
}

export function createCardStage({profileData, chatForSession, getEngine, getAssetLibrary = () => null, getGlobalEnabledPackIds = () => []}) {
  async function workspace(cardPath) {
    if (typeof cardPath !== 'string' || !cardPath.startsWith('cards/') || cardPath.includes('\\') || cardPath.split('/').some(s => !s || s === '.' || s === '..' || /[:\x00-\x1f]/.test(s))) throw new Error('Invalid card path')
    return profileData.readJson('resources/' + cardPath)
  }
  async function resolve(cardPath) {
    const id = (await workspace(cardPath))?.meta?.id
    if (!CARD_ID.test(id || '')) throw new Error('Card has no identity')
    return id
  }
  const bubbles = {
    async read(cardPath) {
      const raw = cardPath ? (await workspace(cardPath))?.raw : null
      const extension = raw && hasCardAssetBindings(raw) ? readCardAssetExtension(raw) : null
      const service = getAssetLibrary(), packs = []
      for (const packId of new Set([...(extension?.assetBindings.boundPackIds || []),...getGlobalEnabledPackIds()])) {
        // Missing/offline packs retain cast names, but cannot supply figure-owned data.
        try { const pack = await service?.getPackSnapshot({packId}); if (pack) packs.push(pack) } catch { /* Optional library. */ }
      }
      return cardBubbleConfig(raw, getEngine(), packs, getGlobalEnabledPackIds())
    },
    async sync(worldBooks, cardPath) {
      return syncDialogueBubbleWorldbook(worldBooks, cardPath, await bubbles.read(cardPath))
    }
  }
  return {resolve, bubbles, async forSession(sessionId) {const chat = await chatForSession(sessionId); return {cardId:await resolve(chat?.cardPath)}}}
}
