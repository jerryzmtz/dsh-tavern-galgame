import { analyzeVariableSchema } from './variable-bindings/index.js'
import { widgetVariableProjection } from './widget-variable-provider.js'
import { activeWidgetKeys, widgetIsActive } from './widget-availability.js'
// Inactive P4 consumer. P6 supplies authorized services and mounts its projections.
import {figureCatalogue, resolution} from './figure-catalogue.js' // private fork
import skinContract from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import performanceContract from '../../../fork/mods/performance/contract.cjs'
import { effectiveCardStage } from './card-stage-settings.js'
import { readCardAssetExtension } from './card-asset-bindings.js'
import { rawData } from './card-preparation.js'
import {expandPerformanceDependencies, performanceWidgetDefaults} from '../../../fork/mods/performance/projection.js'
import { assetPackDigest as jsonHash } from './stage-asset-pack-catalogue.js'
import { assetEntryEnabled } from '../../packages/dsh-presentation-protocol/src/asset-packs.js' // private fork (skin ui)
import { assetPackBackgroundVariant } from '../../packages/dsh-presentation-protocol/src/asset-pack-stage.js'
import {assetContent} from '../../packages/dsh-presentation-protocol/src/asset-variant-content.js'
import {selectAssetVariant} from '../../packages/dsh-presentation-protocol/src/asset-variants.js'
import {stageTimeLook} from '../../packages/dsh-presentation-protocol/src/stage-time.js'
import { triggerEvidence, normalizeCatalogueText, codepointCompare } from './asset-pack-lexical.js'
import spriteEmotions from '../../shared/sprite-emotions.cjs'
import {figureSingleImage,figureDefaultEmotion,forkResolveBubbleMood} from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'

import packAvatar from './pack-avatar.cjs'
import widgetContract from '../../src/client/fork-widget-contracts.cjs'
const {selectPackAvatar, selectFigureAvatar, packAvatarState, packAppearance, DEFAULT_AVATAR_CROP} = packAvatar
export {selectPackAvatar, selectFigureAvatar, DEFAULT_AVATAR_CROP}

const clone = value => structuredClone(value)
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const key = ref => JSON.stringify(ref && [ref.packId, ref.figureId || ref.kind, ref.assetId])
const error = code => Object.assign(new Error(code), {code})
const mediaIdentity = (ref, hash) => hash ? `${ref.packId}:${ref.kind || 'figures'}:${ref.assetId || ref.figureId}:${hash}` : null

// private fork: the figure editor's 差分 order (fork-asset-pack-figure-ui.js figureEditorEmotions): calm, the built-in
// moods, then the figure's own emotions.
export function figureEmotionOrder(figure, outfit) {return [...new Set([figureDefaultEmotion(figure,outfit),...(figure?.emotions || []).map(row=>row.id)].filter(Boolean))];}
// `live2d` false: the machine has no Cubism Core; the display falls down the ladder (never written to the record).
// `spine` false: likewise without the (non-redistributable) Spine runtime (docs/fork/spine-figures.md).
export function selectPackFigure(figure, sprites, {outfitKey, emotion, appearance = figure?.appearance || 'live2d', live2d = true, spine = true} = {}) {
  const diagnostics = []
  if (!figure?.enabled) return {form:null, outfit:null, diagnostics:['figure-unavailable']}
  const requested = figure.outfits.find(outfit => outfit.key === outfitKey && outfit.enabled)
  // private fork: retired costumes degrade only in projection; the recorded request stays intact.
  const outfit = requested || figure.outfits.find(outfit => outfit.enabled)
  if (!outfit) return {form:null, outfit:null, diagnostics:[figure.outfits.length ? 'outfit-unavailable' : 'voice-only']}
  const selected = outfit.key
  if (outfitKey !== undefined && !requested) diagnostics.push('outfit-fallback')
  emotion = figureSingleImage(figure) || forkResolveBubbleMood(emotion,figure.emotions || [])?.id || emotion || figureDefaultEmotion(figure,outfit)
  // private fork: the cast choice is retained; only this projection falls down the shared appearance ladder.
  const {form, missing} = packAppearance(outfit, appearance, live2d, spine)
  if (missing.length) diagnostics.push('stage-form-unavailable')
  if (!live2d && outfit.live2d && missing.includes('live2d')) diagnostics.push('live2d-core-missing')
  if (!spine && outfit.spine && missing.includes('spine')) diagnostics.push('spine-runtime-missing')
  // private fork (layered pilot): readers get the layered-static-sprites view of a hybrid manifest (sprite-emotions.cjs).
  const manifest = outfit.sprite ? spriteEmotions.spriteViewManifest(sprites[outfit.sprite.manifestKey]) : null
  // private fork: a missing calm never drops the figure; the display fallback is reported, never written.
  const resolved = spriteEmotions.resolveSpriteDisplay(manifest, emotion, figureEmotionOrder(figure,outfit),outfit.fallbackEmotions,outfit.fallbackTo)
  // private fork (gen-ui r12, owner U3): 缺图时用 — a model without this 差分 shows its stand-in before the default.
  const standIn = outfit.fallbackTo?.[emotion]
  // The stage's missing-image notice names what was asked for and what stood in (only when that happened).
  const label = id => figure.emotions?.find(row => row.id === id)?.label || id
  const spriteResolution = resolved.missing && form === 'sprite' ? {...resolved, labels:{figure:figure.name || '', [resolved.requestedEmotion]:label(resolved.requestedEmotion),
    ...(resolved.resolvedEmotion ? {[resolved.resolvedEmotion]:label(resolved.resolvedEmotion)} : {})}} : resolved
  const state = spriteResolution.state
  const avatar = selectFigureAvatar(figure, sprites, {outfitKey:selected, emotion})
  if (figure.heightCm === undefined && form !== 'avatar') diagnostics.push('height-defaulted')
  return {outfitKey:selected, outfit, appearance, form, missing, manifest, state, spriteResolution, avatar:avatar?.hash || null, avatarCrop:avatar?.crop || null,
    avatarStateId:avatar?.stateId || null, avatarOutfitKey:avatar?.outfitKey || null, ...(avatar?.avatarSource ? {avatarSource:avatar.avatarSource} : {}),
    live2dEmotion:outfit.live2d?.emotionMap?.[emotion] || standIn && outfit.live2d?.emotionMap?.[standIn] || outfit.live2d?.emotionMap?.[figureDefaultEmotion(figure,outfit)] || null, heightCm:figure.heightCm ?? null, heightBasis:figure.heightBasis || 'standing', elevationCm:figure.elevationCm || 0,
    ...(form === 'spine' ? {spineEmotion:outfit.spine.emotionMap?.[emotion] || standIn && outfit.spine.emotionMap?.[standIn] || outfit.spine.emotionMap?.[figureDefaultEmotion(figure,outfit)] || null} : {}),
    // private fork: old packs and uncalibrated outfits still produce JSON-safe replay frames.
    anatomy:(form === 'live2d' ? outfit.live2d?.anatomy : form === 'spine' ? outfit.spine.anatomy : form === 'sprite' ? outfit.sprite?.anatomy?.[state?.id] : null) ?? null, diagnostics}
}

// Key only media/geometry, never labels, leases, revisions, figure height or viewport.
export function packGeometryKey(selection, snapshot, view = 'stage', algorithm = 'figure-measure-v1') {
  const {outfit, state, manifest} = selection
  const form = view === 'portrait' ? (state?.portrait ? 'sprite' : selection.avatar ? 'avatar' : null) : selection.form
  if (!form) return null
  // private fork: a flat still's blink patch is part of its stage content (layered views carry it in stage).
  const fields = view === 'portrait' ? ['id','portrait'] : ['id','stage','src','talk','binding','blink','parts']
  const geometry = state && Object.fromEntries([...fields,'mouthFrames','initialPhoneme','closedMouthFrame','mouthSet'].filter(k => state[k] !== undefined).map(k => [k,state[k]]))
  // private fork: hash only the selected view's content closure, not unused outfits/assets.
  const content = value => typeof value === 'string' ? outfit.sprite.assets[value] || value : Array.isArray(value) ? value.map(content)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,content(v)])) : value
  // private fork: a Spine rest pose also depends on its display settings (hidden scenery, skin, frame, idle).
  const closure = form === 'live2d' ? snapshot.manifest.bundles[outfit.live2d.bundleKey]?.contentHash || null
    : form === 'spine' ? {bundle:snapshot.manifest.bundles[outfit.spine.bundleKey]?.contentHash || null, rest:outfit.spine.defaultAnimation,
      hideSlots:outfit.spine.hideSlots || [], skin:outfit.spine.skin || null, frame:outfit.spine.frame || null, bottomFade:outfit.spine.bottomFade ?? null}
    : form === 'avatar' ? selection.avatar : content({state:geometry, atlas:(state?.mouthSet === undefined ? manifest?.mouthAtlas : manifest?.mouthSets?.[state.mouthSet]) || null,
      rig:state?.binding ? manifest?.rig?.mouthSets?.[state.binding.mouth?.set] || null : null})
  return jsonHash({closure, form, state:form === 'sprite' ? state?.id || null : null, view, algorithm})
}

export function createAssetPackPresentation({raw, getEngine, getService, getAllowedPackIds, origin, scope, now = Date.now, onInvalidate = () => {}}) {
  if (!Object.hasOwn(rawData(raw)?.extensions?.dsh_tavern || {}, 'assetBindings')) return null
  let extension = readCardAssetExtension(raw), extensionView, variableSchema = analyzeVariableSchema(raw)
  let service, unsubscribe, epoch = 0, disposed = false
  const figures = new Map(), assets = new Map(), snapshots = new Map(), projections = new Map(), leases = new Map(), observers = new Set()
  function invalidate(event = {kind:'refresh', scope:{}}) {
    epoch++
    figures.clear(); assets.clear(); snapshots.clear(); projections.clear()
    const previous = service
    // Refresh invalidates candidates, not already acquired non-executable media.
    for (const [id, value] of leases) if (id.startsWith('widget:') || id.startsWith('source-avatar:') || event.kind === 'revoked' && (event.scope?.authority || event.scope?.packId && id.startsWith(event.scope.packId + ':'))) {
      value.then(lease => previous?.releaseLease(lease.ticket)).catch(() => {})
      leases.delete(id)
    }
    for (const fn of [onInvalidate, ...observers]) { try { fn(event) } catch { /* Notification failures cannot roll back invalidation. */ } }
  }
  function current() {
    if (disposed) throw error('ASSET_UNAVAILABLE')
    const next = getService()
    if (next !== service) {
      unsubscribe?.(); invalidate({kind:service ? 'revoked' : 'refresh', scope:{authority:true}, reason:'service-changed'}); service = next
      unsubscribe = service?.apiVersion === 2 ? service.subscribe(event => invalidate({kind:event.revision === null ? 'revoked' : 'refresh', scope:{packId:event.packId}, reason:event.revision === null ? 'pack-deleted' : 'pack-revision', event})) : undefined
    }
    if (!service || service.apiVersion !== 2) throw error('ASSET_UNAVAILABLE')
    return service
  }
  async function cached(map, id, task) {
    const s = current(), generation = epoch
    if (!map.has(id)) {
      const pending = Promise.resolve().then(() => task(s)).then(value => {
        if (disposed || getService() !== s || epoch !== generation) throw error('ASSET_STALE')
        return freeze(clone(value))
      })
      map.set(id, pending)
      pending.catch(() => { if (map.get(id) === pending) map.delete(id) })
      while (map.size > 256) map.delete(map.keys().next().value)
    }
    return map.get(id)
  }
  const resolveFigure = ref => cached(figures, key(ref), async s => (await s.resolveFigures({refs:[ref]}))[0])
  const resolveAsset = ref => cached(assets, key(ref), async s => {
    const result=(await s.resolveAssets({refs:[ref]}))[0]
    return result.value?{...result,value:{...result.value,...assetContent(result.value)}}:result
  })
  const snapshot = packId => cached(snapshots, packId, s => s.getPackSnapshot({packId}))
  async function lease(ref, revision, kind, id) {
    const s = current(), generation = epoch, cacheKey = [ref.packId, revision, kind, id].join(':')
    let promise = leases.get(cacheKey)
    if (promise) {
      const value = await promise
      if (disposed || getService() !== s || epoch !== generation) throw error('ASSET_STALE')
      if (value.expiresAt > now() + 1000) return value
      s.releaseLease(value.ticket); leases.delete(cacheKey)
    }
    promise = s[kind === 'media' ? 'leaseMedia' : 'leaseBundle']({packId:ref.packId, origin, scope, [kind === 'media' ? 'hash' : 'bundleKey']:id}).then(value => {
      if (disposed || getService() !== s || epoch !== generation || value.revision !== revision) { s.releaseLease(value.ticket); throw error('ASSET_STALE') }
      return value
    })
    leases.set(cacheKey, promise)
    promise.catch(() => { if (leases.get(cacheKey) === promise) leases.delete(cacheKey) })
    if (leases.size > 256) { const oldest = leases.keys().next().value; leases.get(oldest).then(value => s.releaseLease(value.ticket)).catch(() => {}); leases.delete(oldest) }
    return promise
  }
  async function media(ref, revision, hash) { return hash ? (await lease(ref, revision, 'media', hash)).url : null }
  async function audioTrack(ref, descriptors) {
    if (!ref) return null
    const resolved = await resolveAsset(ref)
    // private fork (audio editor): the entry's authored 音量 (0..1) travels with every BGM / SFX / ambience track; the
    // browser mixer applies it as a per-entry gain (forkStageAudio.bind authored.volume).
    return resolved.value?.enabled ? {ref, identity:mediaIdentity(ref,resolved.value.media), name:resolved.value.name, ...(typeof resolved.value.volume === 'number' ? {volume:resolved.value.volume} : {}), ...(ref.kind === 'sfx' ? {gainDb:resolved.value.gainDb ?? 0, ...(resolved.value.loudness ? {loudness:clone(resolved.value.loudness)} : {})} : {}), url:await resource(ref,resolved.revision,resolved.value.media,descriptors)} : null
  }
  // private fork: descriptors carry content identity; only the browser resource owner leases them.
  const resource = (ref, revision, hash, descriptors) => descriptors && hash
    ? {resource:true, kind:'media', ref:clone(ref), revision, hash, identity:mediaIdentity(ref,hash)}
    : media(ref,revision,hash)
  const api = {
    get extension() { return extensionView ||= freeze(clone(extension)) },
    rebind(raw) {
      const next = readCardAssetExtension(raw)
      extension = next; extensionView = undefined; variableSchema = analyzeVariableSchema(raw)
      invalidate({kind:'refresh', scope:{}, reason:'bindings-changed'})
    },
    available() { try { current(); return true } catch { return false } },
    subscribe(fn) { observers.add(fn); return () => observers.delete(fn) },
    refresh(event) { current(); invalidate(event) },
    resolveFigure, resolveAsset, media,
    async figureRows(roster = {}) {
      const allowed = getAllowedPackIds?.() || extension.assetBindings.boundPackIds
      const packs = await Promise.all(allowed.map(snapshot))
      return figureCatalogue({snapshots:packs.filter(Boolean),bindings:extension.assetBindings,globalEnabledPackIds:allowed,roster})
    },
    async resolveName(segment, roster = {}) {
      return resolution.resolveFigureName(await api.figureRows(roster),segment,roster)
    },
    // private fork: a pack can be replaced by a separate authoring process. Its
    // publication revision, not the process-local change event, owns these caches.
    async sync(refs) {
      const s = current(), generation = epoch
      const packs = await Promise.all([...new Set(refs.map(ref => ref.packId))].map(async packId => {
        const before = snapshots.get(packId) ? await snapshots.get(packId) : undefined
        return {packId, before, pack:await s.getPackSnapshot({packId})}
      }))
      if (disposed || getService() !== s || generation !== epoch) throw error('ASSET_STALE')
      if (packs.some(({before,pack}) => before !== undefined && before?.revision !== pack?.revision)) invalidate({kind:'refresh',scope:{},reason:'pack-revision-observed'})
      // Publication revisions own snapshot identity. Rechecking a sealed boundary must
      // not clone/freeze every installed atlas and figure again when nothing changed.
      for (const {packId,before,pack} of packs) snapshots.set(packId, Promise.resolve(before !== undefined && before?.revision === pack?.revision ? before : freeze(clone(pack))))
    },
    // private fork: only unavailable backgrounds use recall fallback. Explicit clear and
    // available recorded choices never enter this path; time of day stays with the story.
    async fallbackBackground(units) {
      const text = units.map(unit => normalizeCatalogueText(typeof unit === 'string' ? unit : unit.text || '')), candidates = []
      for (const packId of extension.assetBindings.boundPackIds) {
        const pack = await snapshot(packId)
        for (const asset of pack?.manifest.assets || []) if (asset.kind === 'backgrounds' && asset.enabled && !assetContent(asset).pendingMedia && assetContent(asset).media) {
          const ref = {packId,kind:'backgrounds',assetId:asset.id}
          const hit = triggerEvidence({name:asset.name,...asset.recall},text)
          if (asset.recall.mode === 'constant' || hit.matched) candidates.push({ref, ...hit})
        }
      }
      candidates.sort((a,b) => Number(b.matched) - Number(a.matched) || codepointCompare(key(a.ref),key(b.ref)))
      for (const {ref} of candidates) {
        const {value} = await resolveAsset(ref)
        if (value?.enabled && !value.pendingMedia && value.media) return ref
      }
      return null
    },
    // private fork: authorize today's transport for yesterday's exact content, never reselect it.
    async frozen(value) {
      async function walk(item) {
        if (!item || typeof item !== 'object') return item
        if (item.resource === true) {
          const pack = await snapshot(item.ref.packId)
          if (!pack || (item.kind === 'bundle' ? pack.manifest.bundles[item.bundleKey]?.contentHash !== item.hash : !pack.manifest.blobs[item.hash])) throw error('PLAYBACK_MEDIA_MISSING')
          return {...item,revision:pack.revision}
        }
        if (Array.isArray(item)) return Promise.all(item.map(walk))
        let currentAvatar
        if (item.ref?.figureId && item.outfit) {
          const pack = await snapshot(item.ref.packId)
          const figure = Object.values(pack?.figures || {}).find(figure => figure.id === item.ref.figureId)
          // private fork: crop authoring is live, but the recorded outfit/state and media stay frozen.
          const outfit = figure?.outfits?.find(outfit => outfit.key === (item.avatarOutfitKey || item.outfitKey))
          const manifest = pack?.sprites?.[outfit?.sprite?.manifestKey]
          const stateId = item.avatarStateId || item.avatarSource?.state?.id || item.state?.id
          const state = spriteEmotions.spriteEmotionState(manifest, stateId)
          if (figure?.enabled && outfit?.enabled && (state || !manifest && outfit.avatars?.[stateId])) {
            currentAvatar = selectPackAvatar({outfit,manifest,state,emotion:stateId})
          }
          const selected = selectPackFigure(figure, pack?.sprites || {}, {outfitKey:item.outfitKey, emotion:item.state?.id, appearance:item.form})
          if (selected.outfit) item = {...item,heightCm:selected.heightCm,heightBasis:selected.heightBasis,elevationCm:selected.elevationCm,anatomy:selected.anatomy}
        }
        if (item.outfit && (item.manifest || item.avatarSource) && item.media?.avatar) {
          // Reframe the recorded sprite, not today's outfit or the old baked face image.
          const recordedAvatar = selectPackAvatar(item)
          // private fork: a live crop applies only between like kinds (an uploaded avatar never reframes a sprite or vice versa).
          const avatar = recordedAvatar && currentAvatar && !currentAvatar.crop === !recordedAvatar.crop ? {...recordedAvatar,crop:currentAvatar.crop} : recordedAvatar
          const identity = mediaIdentity(item.ref,avatar?.hash)
          const url = avatar ? {resource:true,kind:'media',ref:item.ref,alias:item.alias,revision:item.revision,hash:avatar.hash,identity,crop:avatar.crop || null} : null
          item = {...item,avatar:avatar?.hash || null,avatarCrop:avatar?.crop || null,avatarUrl:url,media:{...item.media,avatar:{identity,url}}}
        } else if (item.media?.avatar && item.avatarUrl?.resource === true) {
          // Historical dedicated avatars have no sprite crop, but still need a cap.
          const recordedCrop = item.avatarCrop || item.avatarUrl.crop || null
          const crop = currentAvatar && !currentAvatar.crop === !recordedCrop ? currentAvatar.crop : recordedCrop
          const url = {...item.avatarUrl,crop}
          item = {...item,avatarCrop:crop,avatarUrl:url,media:{...item.media,avatar:{...item.media.avatar,url}}}
        }
        return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([key,value]) => [key,await walk(value)])))
      }
      const result = await walk(value), preferences = effectiveCardStage(extension, getEngine?.())
      if (result?.audio) {
        if (!preferences.music) result.audio.music = null
        if (!preferences.sfx) result.audio.sfx = []
        if (!preferences.ambience) result.audio.soundscape = {version:1,layers:[],warnings:[]}
      }
      return result
    },
    async character(alias, {actor, historical = false, emotion, live2d = true, spine = true} = {}) {
      const identity = actor?.figure ? resolution.resolveFigureName(await api.figureRows({[alias]:actor}),actor.figure) : !historical ? await api.resolveName(alias) : null
      const ref = identity?.status === 'resolved' ? identity.ref : null
      if (!ref || !(getAllowedPackIds?.() || extension.assetBindings.boundPackIds).includes(ref.packId)) return {alias, ref:null, form:null, diagnostics:['figure-unbound']}
      if (historical && !Object.hasOwn(actor, 'outfitKey')) return {alias, ref:clone(ref), form:null, diagnostics:['historical-outfit-missing']}
      {
        const resolved = await resolveFigure(ref)
        if (!resolved.value?.enabled) return {alias, ref:clone(ref), form:null, diagnostics:resolved.diagnostics}
        const pack = await snapshot(ref.packId)
        if (!pack || pack.revision !== resolved.revision) throw error('ASSET_STALE')
        const signature = JSON.stringify([alias,ref,resolved.revision,actor?.outfitKey,emotion,resolved.value.appearance,historical,live2d,spine])
        if (!projections.has(signature)) {
          const selection = selectPackFigure(resolved.value, pack.sprites, {outfitKey:actor?.outfitKey, emotion, appearance:resolved.value.appearance, live2d, spine})
          projections.set(signature, freeze({alias, ref:clone(ref), revision:resolved.revision, ...selection,
            contentHash:['live2d','spine'].includes(selection.form) ? pack.manifest.bundles[selection.outfit[selection.form].bundleKey].contentHash : null,
            geometry:{stage:packGeometryKey(selection,pack,'stage'), portrait:packGeometryKey(selection,pack,'portrait')}}))
          while (projections.size > 256) projections.delete(projections.keys().next().value)
        }
        const projected = projections.get(signature)
        return projected
      }
    },
    async materialize(character, {stage = true, portrait = true, descriptors = false} = {}) {
      if (!character.outfit) return character
      {
        const active = current(), generation = epoch
        const {ref, revision, outfit} = character, urls = new Map()
        const url = async hash => {
          if (!urls.has(hash)) urls.set(hash, Promise.resolve(resource(ref,revision,hash,descriptors)).then(value => descriptors && value ? {...value,alias:character.alias} : value))
          return urls.get(hash)
        }
        let spritePack = null, spriteUrls = null, modelUrl = null
        if (character.manifest && ((stage && character.form === 'sprite') || portrait && character.state?.portrait)) {
          const needed = new Set(), manifest = character.manifest, state = character.state
          const collect = value => { if (typeof value === 'string' && Object.hasOwn(outfit.sprite.assets,value)) needed.add(value)
            else if (value && typeof value === 'object') Object.values(value).forEach(collect) }
          // private fork (layered renderer fix): a flat static-sprites whole inside a hybrid view (no stage, no parts) leases
          // like a flat manifest: its still/talk/blink/cover and the bound mouth rig.
          if (manifest.kind === 'layered-static-sprites' && (state?.stage || state?.parts || !state)) {
            if (stage && character.form === 'sprite') { collect(state?.stage); collect(state?.parts); collect(state?.src) }
            if (portrait) collect(state?.portrait)
            collect(state?.mouthSet === undefined ? manifest.mouthAtlas : manifest.mouthSets?.[state.mouthSet])
          } else { collect(state); collect(manifest.rig?.mouthSets?.[state?.binding?.mouth?.set]) }
          // Preserve the complete manifest, but lease only resources used by this state/view.
          const mapping = Object.fromEntries(await Promise.all([...needed].map(async name => [name, await url(outfit.sprite.assets[name])])) )
          spriteUrls = mapping
          const project = value => typeof value === 'string' ? mapping[value] || value : Array.isArray(value) ? value.map(project)
            : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,project(v)])) : value
          spritePack = project(character.manifest)
        }
        // private fork: a Spine skeleton is leased like a Live2D model (one inert relative bundle tree).
        if (stage && ['live2d','spine'].includes(character.form)) {
          const bundleKey = outfit[character.form].bundleKey, hash = (await snapshot(ref.packId)).manifest.bundles[bundleKey].contentHash
          modelUrl = descriptors ? {resource:true, kind:'bundle', ref:clone(ref), alias:character.alias, revision, hash, bundleKey, identity:mediaIdentity(ref,hash)}
            : (await lease(ref, revision, 'bundle', bundleKey)).url
        }
        // private fork: avatar views own a cropped resource, not the stage sprite decode.
        const avatarSource = portrait ? await url(character.avatar) : null
        const avatarUrl = descriptors && avatarSource ? {...avatarSource,crop:character.avatarCrop || null} : avatarSource
        const mediaItems = {avatar:{identity:mediaIdentity(ref,character.avatar),url:avatarUrl},
          model:{identity:['live2d','spine'].includes(character.form) ? mediaIdentity(ref,character.contentHash) : null,url:modelUrl},
          sprite:{identity:mediaIdentity(ref,character.geometry.stage),url:null},
          resources:Object.fromEntries(Object.entries(spriteUrls || {}).map(([name,url]) => [name,{identity:mediaIdentity(ref,outfit.sprite.assets[name]),url}]))}
        const result = {...character, media:mediaItems, spritePack, spriteUrls, modelUrl, views:{stage:stage && character.form !== 'avatar',portrait}, avatarUrl}
        if (disposed || generation !== epoch || getService() !== active) throw error('ASSET_STALE')
        return result
      }
    },
    async readReference(ref, revision, hash) {
      const s = current(), value = await lease(ref, revision, 'media', hash)
      const request = new Request(new URL(value.url, origin), {headers:{Origin:origin, 'Sec-Fetch-Site':'same-origin'}})
      const response = await s.respondLease({ticket:value.ticket, resource:'media', request})
      if (!response.ok || Number(response.headers.get('content-length')) > 32 * 1024 ** 2) throw error('REFERENCE_UNAVAILABLE')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > 32 * 1024 ** 2 || getService() !== s) throw error('REFERENCE_UNAVAILABLE')
      return bytes
    },
    // private fork: the BGM player's list — enabled music of the card's bound packs (not globally enabled
    // packs), in binding order then pack order. Descriptors only; the browser resource owner leases them.
    async musicTracks() {
      const tracks = []
      for (const packId of extension.assetBindings.boundPackIds) {
        const pack = await snapshot(packId).catch(() => null)
        for (const asset of pack?.manifest.assets || []) if (asset.kind === 'music' && asset.enabled) {
          const value = await audioTrack({packId, kind:'music', assetId:asset.id}, true).catch(() => null)
          if (value) tracks.push({...value, pack:pack.manifest.name})
        }
      }
      return tracks
    },
    async performanceMetadata(refs) {
      await api.sync(refs)
      const packs = new Map()
      for (const ref of refs) if (!packs.has(ref.packId)) packs.set(ref.packId,await snapshot(ref.packId))
      const dependencies = [...packs.values()].flatMap(pack => Object.values(pack?.performances || {}).flatMap(document => Object.values(document.packs || {})))
      await api.sync(dependencies.map(packId => ({packId})))
      for (const packId of dependencies) if (!packs.has(packId)) packs.set(packId,await snapshot(packId))
      return [...packs.values()].filter(Boolean)
    },
    async verifyPerformanceMetadata(metadata) {
      await api.sync(metadata.map(pack => ({packId:pack.manifest.id})))
      for (const pack of metadata) if ((await snapshot(pack.manifest.id))?.revision !== pack.revision) throw error('ASSET_STALE')
    },
    async performance(plan, {snapshots: metadata, engine, isCurrent, snapshotOnly = false} = {}) {
      if (!plan) return null
      const packs = new Map(metadata.map(pack => [pack.manifest.id,pack]))
      const unavailable = ref => ({...plan,dependencies:[],executionDependencies:[],unavailable:{code:'PERFORMANCE_DEPENDENCY_UNAVAILABLE',ref:plan.ref,dependency:ref}})
      const widgetAllowed = (ref,asset,pack) => effectiveCardStage(extension, getEngine?.()).widgets && performanceWidgetDefaults(pack.widgets?.[ref.assetId]) !== null
      const expanded = expandPerformanceDependencies({ref:plan.ref,document:packs.get(plan.ref.packId)?.performances?.[plan.ref.assetId],snapshots:metadata,
        authorization:{boundPackIds:extension.assetBindings.boundPackIds,widgetAllowed}})
      if (expanded.unavailable) return {...unavailable(expanded.unavailable.dependency),unavailable:expanded.unavailable}
      const dependencies = [], executionDependencies = []
      for (const ref of expanded.refs) {
        const resolved = await resolveAsset(ref), asset = resolved.value
        if (!assetEntryEnabled(asset)) return unavailable(ref)
        if (asset.pendingMedia) throw error('ASSET_STALE')
        const pack = packs.get(ref.packId)
        if (ref.kind === 'widgets') {
          const document=pack.widgets[ref.assetId], state=performanceWidgetDefaults(document)
          // Executable capabilities stay host-only; the inert owner must never load them.
          const rows = snapshotOnly ? [] : await api.widgets({widgets:{dependency:{ref,state,slot:document.presentation.open.anchor || 'corner-right',bornStoryTime:0}}},{engine,isCurrent,strict:true})
          if (!snapshotOnly && rows.length !== 1) return unavailable(ref)
          executionDependencies.push({ref,state,slot:document.presentation.open.anchor || 'corner-right',...(rows[0] ? {definition:rows[0].definition,mediaPolicy:rows[0].mediaPolicy} : {})})
          continue
        }
        let value
        if (['skins','performances'].includes(ref.kind)) {
          const bundle = pack?.manifest.bundles[asset.bundleKey], document = pack?.[ref.kind]?.[ref.assetId]
          if (!bundle || !document) return unavailable(ref)
          const identity = mediaIdentity(ref,bundle.contentHash)
          value = {identity,document:clone(document),entry:asset.entry,url:{resource:true,kind:'bundle',ref,revision:resolved.revision,hash:bundle.contentHash,bundleKey:asset.bundleKey,identity}}
          // private fork: a theme borrows its owning performance's validated bundle/lease.
          if (ref.kind === 'performances' && document.theme) dependencies.push({role:'required',...value,ref:{packId:ref.packId,kind:'skins',assetId:document.theme.id},document:clone(document.theme)})
        } else if (ref.kind === 'looks') {
          const params = clone(asset.params || {})
          const walk = value => Array.isArray(value) ? value.map(item => item && typeof item === 'object' ? walk(item) : item) : Object.fromEntries(Object.entries(value).map(([name,item]) => [name,
            ['lut','texture'].includes(name) && typeof item === 'string' ? resource(ref,resolved.revision,item,true) : item && typeof item === 'object' ? walk(item) : item]))
          value = {identity:mediaIdentity(ref,jsonHash(params)),params:walk(params)}
        } else value = await audioTrack(ref,true)
        if (!value) return unavailable(ref)
        dependencies.push({role:'required',ref,...value})
      }
      const restoreDiagnostics = [], restoreRefs = [plan.restore?.directorRequest?.ref,plan.restore?.previous].filter(Boolean)
      for (const ref of restoreRefs) {
        try {
          if (!extension.assetBindings.boundPackIds.includes(ref.packId)) throw error('ASSET_UNAVAILABLE')
          const track = await audioTrack(ref,true)
          if (!track) throw error('ASSET_UNAVAILABLE')
          if (!dependencies.some(item => key(item.ref) === key(ref))) dependencies.push({role:'restore',...track})
        } catch (cause) {restoreDiagnostics.push({ref,code:cause.code || 'RESTORE_UNAVAILABLE'})}
      }
      const retiring = plan.retiring ? await api.performance(plan.retiring,{snapshots:metadata,engine,isCurrent,snapshotOnly}) : null
      if (!isCurrent()) throw error('ASSET_STALE')
      return {...plan,retiring:retiring?.unavailable ? null : retiring,dependencies,executionDependencies,restoreDiagnostics,unavailable:null}
    },
    async audio(state, ops = [], {descriptors = false} = {}) {
      const track = ref => audioTrack(ref, descriptors)
      const preferences = effectiveCardStage(extension, getEngine?.())
      const music = preferences.music ? await track(state?.music) : null, layers = []
      for (const [slot, layer] of Object.entries(preferences.ambience ? state?.soundscape || {} : {})) {
        const value = await track(layer)
        if (value) layers.push({...value,slot,id:key(value.ref),gain:1,lowpassHz:null})
      }
      const sfx = (await Promise.all((preferences.sfx ? ops : []).map(op => op.op === 'event' ? op.value : op).filter(op => op.op === 'sfx').map(op => track(op.value)))).filter(Boolean)
      return {music, soundscape:{version:1,layers,warnings:[]}, sfx}
    },
    async sourceAvatars({avatarSources,grantKey,isCurrent,authorizeSource}) {
      const active=current(),generation=epoch,cacheKey='source-avatar:'+grantKey
      const allowed=getAllowedPackIds?.() || extension.assetBindings.boundPackIds
      const historyAvatars = {}, avatarCache = new Map()
      for (const source of avatarSources) {
        // private fork: saved FigureRef is identity; today's colliding name cannot rebind history.
        const actor=source.actor, figure=actor?.figure
        if (!figure || !allowed.includes(figure.packId)) continue
        const identity=JSON.stringify([figure,actor.outfitKey])
        if (!avatarCache.has(identity)) {
          if (avatarCache.size>=8) continue
          avatarCache.set(identity,null)
          try {
            const character=await api.character(source.contact,{actor,historical:true})
            if (!character.avatar) continue
            const name=cacheKey+':avatar:'+identity
            let pendingAvatar=leases.get(name)
            if (pendingAvatar && (await pendingAvatar).expiresAt<=now()+1000) {active.releaseLease((await pendingAvatar).ticket);leases.delete(name);pendingAvatar=null}
            if (!pendingAvatar) {
              pendingAvatar=active.leaseMedia({packId:figure.packId,hash:character.avatar,origin,scope,
                authorize:async()=>!disposed && generation===epoch && getService()===active && isCurrent() && leases.get(name)===pendingAvatar && await authorizeSource()})
              leases.set(name,pendingAvatar)
              if (leases.size>256) {const oldest=leases.keys().next().value;leases.get(oldest).then(value=>active.releaseLease(value.ticket)).catch(()=>{});leases.delete(oldest)}
              pendingAvatar.catch(()=>{if(leases.get(name)===pendingAvatar)leases.delete(name)})
            }
            const avatarLease=await pendingAvatar
            avatarCache.set(identity,{url:avatarLease.url,crop:character.avatarCrop})
          } catch { /* Missing decoration never withholds readable history. */ }
        }
        if (avatarCache.get(identity)) historyAvatars[source.turn+':'+source.para]=avatarCache.get(identity)
      }
      return disposed || generation!==epoch || !isCurrent() ? {} : historyAvatars
    },
    async widgets(state, {engine, isCurrent, strict = false, sourceRefs = [], grantKey = '', authorizeSource, avatarSources = []}) {
      if (!effectiveCardStage(extension, getEngine?.()).widgets || !state) return []
      const result = [], active = current(), generation = epoch
      const allowedPackIds = getAllowedPackIds?.() || extension.assetBindings.boundPackIds
      const packs = (await Promise.all(allowedPackIds.map(id => snapshot(id).catch(() => null)))).filter(Boolean)
      const activeWidgets = activeWidgetKeys({packs,boundPackIds:extension.assetBindings.boundPackIds,allowedPackIds,widgetsEnabled:true})
      const requested = new Map(Object.entries(state.widgets).map(([id,widget])=>[id,widget]))
      for(const ref of sourceRefs) requested.set([ref.packId,ref.kind,ref.assetId].join('/'),{ref,state:{},sourceOnly:true,bornStoryTime:0})
      for (const [widgetId, widget] of requested) {
        const ref = widget.ref, id = [ref.packId,ref.kind,ref.assetId].join('/')
        try {
          const resolved = await resolveAsset(ref), asset = resolved.value, pack = await snapshot(ref.packId), document=pack?.widgets?.[ref.assetId]
          if (!asset?.enabled || !document || !widgetIsActive(activeWidgets,ref)) continue
          const override = widgetVariableProjection(extension.variableBindings,ref,document,variableSchema)
          let resolvedSettings
          try { resolvedSettings = widgetContract.forkWidgetResolveSettings(document,asset.settingsDefaults,override) }
          catch { continue } // Optional settings failure cannot block even a strict stage projection.
          const cachePrefix = 'widget:' + id + ':' + resolved.revision + ':', cacheKey = cachePrefix + grantKey
          if (grantKey) for (const [name,value] of leases) if (name.startsWith(cachePrefix) && name !== cachePrefix && name !== cacheKey && !name.startsWith(cacheKey+':avatar:')) {
            leases.delete(name); value.then(lease => active.releaseLease(lease.ticket)).catch(() => {})
          }
          let pending = leases.get(cacheKey)
          if (pending && (await pending).expiresAt <= now() + 1000) { active.releaseLease((await pending).ticket); leases.delete(cacheKey); pending = null }
          if (!pending) {
            pending = active.leaseWidget({ref, expectedRevision:resolved.revision, origin, scope,
              authorize:async () => !disposed && generation === epoch && getService() === active && isCurrent() && (!authorizeSource || await authorizeSource()) && !disposed && generation === epoch && isCurrent() && (!grantKey || leases.get(cacheKey) === pending)})
            leases.set(cacheKey, pending)
            pending.catch(() => { if (leases.get(cacheKey) === pending) leases.delete(cacheKey) })
            if (leases.size > 256) {const oldest=leases.keys().next().value;leases.get(oldest).then(value=>active.releaseLease(value.ticket)).catch(()=>{});leases.delete(oldest)}
          }
          const lease = await pending
          if (disposed || generation !== epoch || !isCurrent() || grantKey && leases.get(cacheKey) !== pending) { active.releaseLease(lease.ticket); continue }
          const directory=asset.entry.includes('/') ? asset.entry.slice(0,asset.entry.lastIndexOf('/')+1) : ''
          const base=lease.url.slice(0,lease.url.indexOf('/', '/api/dsh-asset-library/v2/lease/'.length)+1)
          const assets=Object.fromEntries(Object.entries(document.assets || {}).map(([name,value])=>{
            const path=directory+value.path, descriptor=pack.manifest.files.find(file=>file.path === 'bundles/'+asset.bundleKey+'/'+path)
            return [name,{kind:value.kind,url:base+path.split('/').map(encodeURIComponent).join('/'),identity:descriptor.sha256}]
          }))
          const preferences=effectiveCardStage(extension, getEngine?.())
          const settingAssets = {}, allowed = getAllowedPackIds?.() || extension.assetBindings.boundPackIds
          for (const field of document.settingsSchema?.fields || []) if (field.type === 'pack-asset') {
            const selected = resolvedSettings.settings[field.key]; settingAssets[field.key] = null
            if (!selected) continue
            try {
              if (!allowed.includes(selected.packId)) throw error('ASSET_UNAVAILABLE')
              const selectedAsset = await resolveAsset(selected), selectedPack = await snapshot(selected.packId)
              const hash = selectedAsset.value?.media, blob = selectedPack?.manifest.blobs[hash]
              if (!selectedAsset.value?.enabled || !blob) throw error('ASSET_UNAVAILABLE')
              if (!['image/png','image/jpeg','image/webp'].includes(blob.mime)) throw error('image-format')
              if (blob.size > 8 * 1024 * 1024) throw error('image-bytes')
              settingAssets[field.key] = {kind:'image',url:await media(selected,selectedAsset.revision,hash),identity:hash,size:blob.size,mime:blob.mime}
            } catch (failure) {
              resolvedSettings.settings[field.key] = null; resolvedSettings.diagnostics[field.key] = ['image-format','image-bytes'].includes(failure.code) ? failure.code : 'asset-unavailable'
            }
          }
          const historyAvatars = await api.sourceAvatars({avatarSources,grantKey:cacheKey,isCurrent,authorizeSource})
          if (disposed || generation !== epoch || !isCurrent()) continue
          result.push({...clone(widget), historyAvatars, widgetId, slot:widget.slot || document.presentation.open.anchor || 'corner-right', originKey:id+':'+widget.bornStoryTime, bornAt:widget.bornStoryTime, order:result.length,
            mediaPolicy:{music:preferences.music && engine.dimensions.music !== false,sfx:preferences.sfx && engine.dimensions.sfx !== false},
            definition:{id, ref:clone(ref), title:asset.name, note:asset.directorNote, thirdParty:true, url:lease.url, revision:resolved.revision, contentIdentity:pack.manifest.bundles[asset.bundleKey].contentHash,
              document:clone(document), assets, ...resolvedSettings, settingsFeedback:widgetContract.forkWidgetSettingsFeedback(resolvedSettings), settingAssets, settingsDefaults:clone(asset.settingsDefaults || {}), settingsOverride:clone(override), stateSchema:document.stateSchema, samples:document.samples, caps:document.caps, slot:document.presentation.open.anchor}})
        } catch (cause) {
          if (strict && cause.code !== 'ASSET_UNAVAILABLE') throw cause
        }
      }
      return result
    },
    // private fork: only the chosen image enters projection/playback, never the full variant catalogue.
    async cg(requested, {descriptors = false} = {}) {
      if (!requested) return null
      const resolved = await resolveAsset(requested.ref), asset = resolved.value
      if (!asset?.enabled || asset.kind !== 'cg') return null
      let variant
      try {variant=selectAssetVariant(asset,requested.variant ?? undefined)}
      catch(cause) {if(cause.code!=='REF_UNAVAILABLE')throw cause;variant=selectAssetVariant(asset)}
      const content=variant?.content ?? asset,selected=variant?.id ?? null
      const focus = content.focusHints?.find(f => f.key === requested.focus) || {key:'full',x:0.5,y:0.5,zoom:1}
      return {ref:clone(requested.ref),variant:selected,focus:clone(focus),label:asset.name,
        media:{identity:mediaIdentity(requested.ref,content.media),url:await resource(requested.ref,resolved.revision,content.media,descriptors)},
        diagnostics:[...(selected !== requested.variant ? ['cg-variant-defaulted'] : []),...(focus.key !== requested.focus ? ['cg-focus-defaulted'] : [])]}
    },
    async scene(state, {snap = false, timeTransitionMs = 0, descriptors = false, skinAllowed = true} = {}) {
      const diagnostics = [], scene = state.scene
      let active, generation
      active = current(); generation = epoch
      async function resolve(ref) {
        if (!ref) return null
        const result = await resolveAsset(ref); diagnostics.push(...result.diagnostics); return assetEntryEnabled(result.value) ? result : null
      }
      const background = await resolve(scene?.background)
      // private fork: defaults are presentation-only; skin.off (null) restores the card skin.
      const defaultSkin=effectiveCardStage(extension, getEngine?.()).defaultSkin
      const override=skinAllowed && state.skin?.ref
      const selectedSkin=override ? state.skin : typeof defaultSkin==='string' ? defaultSkin : {ref:defaultSkin}
      const builtin=typeof selectedSkin === 'string' ? selectedSkin : null
      let skin = builtin ? {builtin:true,document:clone(skinContract.BUILTIN_STAGE_SKINS[builtin])} : null
      if (selectedSkin?.ref) try {
        const pack = await snapshot(selectedSkin.ref.packId)
        // A migrated alias is historical-only: it never turns into a selectable card theme.
        const owner = override && performanceContract.performanceThemeOwner(pack,selectedSkin.ref.assetId,{historical:true})
        const resourceRef = owner ? {packId:selectedSkin.ref.packId,kind:'performances',assetId:owner.id} : selectedSkin.ref
        const resolved = await resolve(resourceRef)
        if (resolved) {
          const document = owner?.theme || pack.skins?.[selectedSkin.ref.assetId]
          const bundle = pack.manifest.bundles[resolved.value.bundleKey]
          if (document && bundle) skin = {ref:clone(selectedSkin.ref), ...(selectedSkin.level === undefined ? {} : {level:selectedSkin.level}), document:clone(document), entry:resolved.value.entry, identity:mediaIdentity(resourceRef,bundle.contentHash),
            url:descriptors ? {resource:true,kind:'bundle',ref:clone(resourceRef),revision:resolved.revision,hash:bundle.contentHash,bundleKey:resolved.value.bundleKey,identity:mediaIdentity(resourceRef,bundle.contentHash)}
              : (await lease(resourceRef,resolved.revision,'bundle',resolved.value.bundleKey)).url}
        }
      } catch (cause) {
        diagnostics.push('skin-unavailable:' + (cause.code || 'RESOLUTION_FAILED'))
      }
      const variant = background ? assetPackBackgroundVariant(background.value, scene) : {media:null, timeMatched:false, diagnostics:[]}
      diagnostics.push(...variant.diagnostics)
      const time=stageTimeLook(getEngine?.()?.dimensions?.['lighting.time']===false?null:scene?.timeOfDay ?? null)
      const mood = await resolve(state.lighting?.mood)
      const validMood = mood?.value.layer === 'mood' ? mood : null
      if (mood && !validMood) diagnostics.push('mood-look-layer-changed')
      async function look(result) {
        if (!result) return null
        const params = clone(result.value.params || {})
        async function walk(object) { for (const [k,v] of Object.entries(object)) {
          if (['lut','texture'].includes(k) && typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)) object[k] = await resource(result.ref,result.revision,v,descriptors)
          else if (v && typeof v === 'object') await walk(v)
        } }
        await walk(params); return {ref:result.ref, params}
      }
      {
        const backgroundMedia = {identity:background ? mediaIdentity(background.ref,variant.media) : null,url:background ? await resource(background.ref,background.revision,variant.media,descriptors) : null}
        const result = {skin,skinDefault:override ? null : clone(defaultSkin),...(background && assetContent(background.value,variant.variant ?? undefined).stageTheme ? {stageTheme:clone(assetContent(background.value,variant.variant ?? undefined).stageTheme)} : {}),backgroundMedia,background:background?.ref || scene?.background || null, backgroundName:background?.value.name || '', backgroundUrl:background ? await resource(background.ref,background.revision,variant.media,descriptors) : null,
          timeOfDay:scene?.timeOfDay ?? null, timeMatched:variant.timeMatched, time, mood:await look(validMood),
          compensateBackground:variant.compensateBackground===true && getEngine?.()?.dimensions?.['lighting.time']!==false, timeTransitionMs:snap ? 0 : timeTransitionMs, diagnostics}
        if (disposed || active && (generation !== epoch || getService() !== active)) throw error('ASSET_STALE')
        return result
      }
    },
    dispose() { if (disposed) return; disposed = true; unsubscribe?.(); invalidate({kind:'revoked',scope:{authority:true},reason:'disposed'}); observers.clear() }
  }
  return api
}
