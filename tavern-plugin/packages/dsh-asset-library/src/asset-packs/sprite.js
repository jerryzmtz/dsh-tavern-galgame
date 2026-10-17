import layeredContract from '../shared/layered-sprite.cjs'
import { validateHybridSprite } from './hybrid-sprite.js'
import { assertJson, check, shape, text, oneOf, integer, array, unique, record, relativePath, validateStateId, validateShortId } from './common.js'
const rectKeys = ['x', 'y', 'w', 'h']
const events = ['closed', 'a', 'i', 'u', 'e', 'o']
function source(value, path) { relativePath(value, path); check(/\.(png|webp)$/i.test(value), path, 'Sprite sources must be PNG/WebP paths') }
function rect(value, path) { shape(value, rectKeys, rectKeys, path) }
// private fork: optional authored blink patch, drawn over the base at a fixed base-canvas rect
// (the same overlay contract as the flat mouth cover). Decoded sizes are verified at import.
export function validateBlink(value, path, canvas) {
  shape(value, ['closed', 'half', 'rect', 'blend'], ['closed', 'rect'], path)
  if (value.blend !== undefined) oneOf(value.blend, ['replace'], path + '.blend')
  source(value.closed, path + '.closed')
  if (value.half !== undefined) { source(value.half, path + '.half'); check(value.half !== value.closed, path + '.half') }
  array(value.rect, path + '.rect', 4)
  const [x, y, w, h] = value.rect
  check(value.rect.length === 4 && value.rect.every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && w <= 1024 && h <= 1024, path + '.rect')
  if (canvas) check(x + w <= canvas[0] && y + h <= canvas[1], path + '.rect', 'Blink rect outside the sprite')
}
function view(value, path) {
  shape(value, ['src', 'width', 'height', 'mouth', 'mouthByFrame', 'mouthOcclusionMask', 'mouthFrames', 'blink'], ['src', 'width', 'height'], path)
  source(value.src, path + '.src')
  if (value.blink !== undefined) validateBlink(value.blink, path + '.blink', [value.width, value.height])
  // private fork: view-specific event mappings resolve within the selected state atlas.
  if (value.mouthFrames !== undefined) record(value.mouthFrames, path + '.mouthFrames', (id, p, key) => { oneOf(key, events, p); validateShortId(id, p) })
  if (value.mouth !== undefined) rect(value.mouth, path + '.mouth')
  if (value.mouthByFrame !== undefined) record(value.mouthByFrame, path + '.mouthByFrame', rect)
  if (value.mouthOcclusionMask !== undefined) source(value.mouthOcclusionMask, path + '.mouthOcclusionMask')
}
function atlas(value, path) {
  shape(value, ['src', 'width', 'height', 'frames', 'defaultFrames'], ['src', 'width', 'height', 'frames'], path)
  source(value.src, path + '.src'); record(value.frames, path + '.frames', (frame, p) => {
    shape(frame, [...rectKeys, 'replace'], rectKeys, p)
    if (frame.replace !== undefined) check(typeof frame.replace === 'boolean', p + '.replace')
  })
  if (value.defaultFrames !== undefined) record(value.defaultFrames, path + '.defaultFrames', (id, p, key) => { oneOf(key, events.slice(1), p); validateShortId(id, p) })
}
export function validateSpriteManifest(value, path = '$') {
  assertJson(value)
  if (value?.kind === 'hybrid-face-sprites') return validateHybridSprite(value, path, validateSpriteManifest)
  const flat = value?.kind === 'static-sprites'
  shape(value, flat ? ['version','kind','emotions','rig'] : ['version','kind','character','closedBehavior','mouthAtlas','mouthSets','emotions'], ['version','kind','emotions'], path)
  const entries = [], sets = new Set()
  record(value.emotions, path + '.emotions', (entry, p, id) => {
    check(/^[a-z][a-z0-9_-]{0,23}$/.test(id) && id !== 'default', p, 'Canonical figure emotion ID required')
    shape(entry, flat ? ['src','talk','binding','blink'] : ['initialPhoneme','mouthSet','mouthFrames','closedMouthFrame','stage','portrait'], flat ? ['src'] : ['stage'], p)
    entries.push({id, ...entry})
    if (entry.mouthSet !== undefined) sets.add(entry.mouthSet)
    if (entry.binding?.mouth) sets.add(entry.binding.mouth.set)
  })
  check(entries.length > 0 && Object.keys(value.emotions).length <= 17, path + '.emotions', 'One sprite per figure emotion; at most nine builtins and eight custom emotions')
  const library = flat ? value.rig?.mouthSets : value.mouthSets
  for (const key of Object.keys(library || {})) check(sets.has(key), path + '.mouthSets.' + key, 'Unused mouth set cannot be installed')
  if (value.mouthAtlas) check(entries.some(entry => entry.mouthSet === undefined), path + '.mouthAtlas', 'Unused mouth atlas cannot be installed')
  const {emotions, ...render} = value
  validateSpriteRenderManifest({...render, states:entries, defaultState:entries.find(entry => entry.id === 'calm')?.id || entries[0].id}, path)
  return value
}
function validateSpriteRenderManifest(value, path = '$') {
  assertJson(value)
  if (value?.kind === 'static-sprites') return validateStaticSprite(value, path)
  shape(value, ['version', 'kind', 'character', 'closedBehavior', 'defaultState', 'mouthAtlas', 'mouthSets', 'states'], ['version', 'kind', 'character', 'closedBehavior', 'states'], path)
  oneOf(value.version, [1, 2], path + '.version'); oneOf(value.kind, ['layered-static-sprites'], path + '.kind')
  shape(value.character, ['id', 'name'], ['id', 'name'], path + '.character'); validateShortId(value.character.id); text(value.character.name, path + '.character.name', 160)
  oneOf(value.closedBehavior, value.version === 1 ? ['restore-base', 'restore-base except explicit surprise closed override'] : ['restore-base'], path + '.closedBehavior')
  if (value.mouthAtlas !== undefined) atlas(value.mouthAtlas, path + '.mouthAtlas')
  if (value.mouthSets !== undefined) record(value.mouthSets, path + '.mouthSets', (set, p, key) => { validateStateId(key, p); atlas(set, p) })
  array(value.states, path + '.states', 48); check(value.states.length > 0, path + '.states')
  for (const [i, state] of value.states.entries()) {
    const p = `${path}.states[${i}]`
    shape(state, ['id', 'label', 'emotion', 'initialPhoneme', 'mouthSet', 'mouthFrames', 'closedMouthFrame', 'stage', 'portrait'], ['id', 'stage'], p)
    validateStateId(state.id, p + '.id')
    if (state.label !== undefined) text(state.label, p + '.label', 160)
    if (state.emotion !== undefined) validateStateId(state.emotion, p + '.emotion')
    view(state.stage, p + '.stage'); if (state.portrait !== undefined) view(state.portrait, p + '.portrait')
  }
  unique(value.states.map(s => s.id), path + '.states')
  const defaultState = value.defaultState === undefined ? (value.states.some(s => s.id === 'calm') ? 'calm' : value.states[0].id) : value.defaultState
  check(value.states.some(s => s.id === defaultState), path + '.defaultState')
  // Reuse the established pixel/atlas checks without its lossy normalization.
  // Surrogate IDs avoid imposing the existing parser's narrower state-name limit.
  const ids = new Map(value.states.map((s, i) => [s.id, 'state_' + i]))
  const candidate = { ...value, defaultState: ids.get(defaultState), states: value.states.map(s => ({ ...s, id: ids.get(s.id), portrait: s.portrait || s.stage })) }
  let imageCount
  try { imageCount = layeredContract.forkSpriteAssets(layeredContract.forkSpriteManifest(candidate)).size } catch (error) { check(false, path, 'Invalid layered sprite: ' + error.message) }
  check(imageCount <= 128, path, 'Sprite image limit', 'LIMIT_EXCEEDED')
  return value
}
// Flat stills retain optional talk images and the existing flat-mouth geometry,
// but embed the rig rather than assigning it another asset identity.
function validateStaticSprite(value, path) {
  shape(value, ['version', 'kind', 'defaultState', 'states', 'rig'], ['version', 'kind', 'defaultState', 'states'], path)
  oneOf(value.version, [1], path + '.version'); array(value.states, path + '.states', 48); check(value.states.length > 0, path)
  const dimensions = (pair, p, max) => { array(pair, p, 2); check(pair.length === 2, p); pair.forEach(n => integer(n, p, 1, max)) }
  if (value.rig !== undefined) {
    shape(value.rig, ['mouthSets'], ['mouthSets'], path + '.rig')
    check(Object.keys(value.rig.mouthSets || {}).length > 0 && Object.keys(value.rig.mouthSets).length <= 16, path + '.rig')
    record(value.rig.mouthSets, path + '.rig.mouthSets', (set, p, id) => {
      validateStateId(id, p); shape(set, ['canvas', 'pivot', 'frames', 'blends'], ['canvas', 'pivot', 'frames'], p); dimensions(set.canvas, p, 512)
      if (set.blends !== undefined) record(set.blends, p + '.blends', (blend, q, frame) => { oneOf(frame, ['closed','small','mid','open'], q); oneOf(blend, ['replace'], q) })
      array(set.pivot, p, 2); check(set.pivot.length === 2 && set.pivot.every((n, i) => Number.isFinite(n) && n >= 0 && n <= set.canvas[i]), p)
      shape(set.frames, ['closed', 'small', 'mid', 'open'], ['closed', 'small', 'mid', 'open'], p); Object.values(set.frames).forEach(v => source(v, p))
    })
  }
  for (const state of value.states) {
    shape(state, ['id', 'label', 'emotion', 'src', 'talk', 'binding', 'blink'], ['id', 'src'], path + '.states')
    validateStateId(state.id); source(state.src, path)
    if (state.blink !== undefined) validateBlink(state.blink, path + '.blink', state.binding?.canvas)
    if (state.label !== undefined) text(state.label, path, 160)
    if (state.emotion !== undefined) validateStateId(state.emotion)
    if (state.talk !== undefined) source(state.talk, path)
    if (state.binding !== undefined) {
      const b = state.binding, m = b.mouth
      shape(b, ['canvas', 'mouth'], ['canvas', 'mouth'], path); dimensions(b.canvas, path, 4096)
      shape(m, ['set', 'anchor', 'surface', 'cover'], ['set', 'anchor', 'surface'], path)
      check(Object.hasOwn(value.rig?.mouthSets || {}, m.set), path, 'Missing mouth set')
      shape(m.anchor, ['x', 'y', 'scale', 'rotation'], ['x', 'y', 'scale', 'rotation'], path)
      const ranges = { x: [0, b.canvas[0]], y: [0, b.canvas[1]], scale: [0.1, 4], rotation: [-45, 45] }
      for (const [k, [lo, hi]] of Object.entries(ranges)) check(Number.isFinite(m.anchor[k]) && m.anchor[k] >= lo && m.anchor[k] <= hi, path + '.' + k)
      if (value.rig.mouthSets[m.set].blends) check(value.rig.mouthSets[m.set].pivot.every(Number.isInteger) && m.anchor.scale === 1 && m.anchor.rotation === 0 && Number.isInteger(m.anchor.x) && Number.isInteger(m.anchor.y), path, 'Source-bound replacement mouths require an unscaled integer source anchor')
      oneOf(m.surface, ['patch', 'neutral', 'mouthless'], path)
      if (m.surface === 'patch') {
        shape(m.cover, ['src', 'rect'], ['src', 'rect'], path); source(m.cover.src, path); array(m.cover.rect, path, 4)
        const [x, y, w, h] = m.cover.rect
        check(m.cover.rect.length === 4 && m.cover.rect.every(Number.isInteger) && w > 0 && h > 0 && w <= b.canvas[0] && h <= b.canvas[1] && x >= -w && y >= -h && x < b.canvas[0] && y < b.canvas[1], path)
      } else check(m.cover === undefined, path)
    }
  }
  unique(value.states.map(s => s.id), path + '.states'); check(value.states.some(s => s.id === value.defaultState), path + '.defaultState')
  // Blink patches are bounded by the state count and do not consume the established image budget.
  const blinkPaths = new Set(value.states.flatMap(s => s.blink ? [s.blink.closed, s.blink.half].filter(Boolean) : []))
  check(spriteResourcePaths(value).filter(p => !blinkPaths.has(p)).length <= 128, path, 'Sprite image limit', 'LIMIT_EXCEEDED')
  return value
}
export function spriteResourcePaths(value) {
  if (value.kind === 'hybrid-face-sprites') return [...new Set([
    ...Object.values(value.rigs).flatMap(rig => Object.values(rig.parts).map(part => part.src)),
    ...Object.values(value.emotions).flatMap(entry => entry.render.kind === 'parts' && entry.render.preview ? [entry.render.preview] : []),
    ...Object.values(value.emotions).filter(entry => entry.render.kind === 'whole').flatMap(entry => spriteResourcePaths(entry.render.legacy))
  ])]
  const paths = new Set()
  const walk = item => { if (item && typeof item === 'object') for (const [key, v] of Object.entries(item)) {
    if (['src', 'talk', 'mouthOcclusionMask'].includes(key)) paths.add(v)
    else if (key === 'blink') { paths.add(v.closed); if (v.half) paths.add(v.half) }
    else if (key === 'frames' && value.kind === 'static-sprites') Object.values(v).forEach(src => paths.add(src))
    else walk(v)
  } }
  walk(value); return [...paths]
}
