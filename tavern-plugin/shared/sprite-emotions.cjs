// private fork: each stored emotion owns its image; missing images rest only at calm.
// private fork (layered pilot phase 1): a `hybrid-face-sprites` manifest mixes whole emotions (their own legacy
// layered-static-sprites render) with parts emotions (one rig, five groups drawn underlay → pose → face → mouth → front).
// Every reader sees one transient layered-static-sprites view: whole emotions keep their legacy state, parts emotions
// carry `parts` (the resolved closure of the recipe, lip-sync and blink frames), and missing/broken ones are absent, so
// they count as missing images everywhere (editor ✦ tile, 「缺 N」, the stage's visible fallback notice).
const HYBRID_SPRITE_KIND = 'hybrid-face-sprites';
const HYBRID_SPRITE_GROUPS = Object.freeze(['underlay', 'pose', 'face', 'mouth', 'front']);
const HYBRID_MOUTH_FRAMES = ['closed', 'a', 'i', 'u', 'e', 'o'], HYBRID_BLINK_FRAMES = ['half', 'closed'];
const hybridSpriteViews = new WeakMap();
// One emotion of a hybrid manifest: {kind:'whole', legacy} | {kind:'parts', parts} | {kind:'missing', missing:[...]}.
// Optional animation frames that are absent or stale are dropped (the rest face stays); core groups must resolve.
// private fork (layered renderer fix, CONTRACT.md): a whole may be either native whole kind (layered-static-sprites or
// static-sprites); a part may carry `clearRect` (cleared right before that part is drawn); `render.preview` is used only
// with a `render.previewRevision` equal to the native resolver's rest revision (never a stale bake).
const HYBRID_WHOLE_KINDS = ['layered-static-sprites', 'static-sprites'];
const hybridRect = (r, canvas) => Array.isArray(r) && r.length === 4 && r.every(Number.isInteger) && r[0] >= 0 && r[1] >= 0 && r[2] > 0 && r[3] > 0 && r[0] + r[2] <= canvas[0] && r[1] + r[3] <= canvas[1];
function hybridSpriteRender(manifest, emotion) {
    const missing = [], fail = (kind, id, code, group) => { missing.push({kind, id, code, ...(group ? {group} : {})}); return {kind:'missing', missing}; };
    const render = manifest?.emotions && Object.hasOwn(manifest.emotions, emotion) ? manifest.emotions[emotion]?.render : null;
    if (!render || render.kind === 'missing') return fail('emotion', emotion, 'MISSING_EMOTION');
    if (render.kind === 'whole') {
        const legacy = render.legacy, own = legacy?.emotions && Object.hasOwn(legacy.emotions, emotion) ? legacy.emotions[emotion] : null;
        return HYBRID_WHOLE_KINDS.includes(legacy?.kind) && own ? {kind:'whole', legacy, state:own} : fail('emotion', emotion, 'UNSUPPORTED_WHOLE');
    }
    if (render.kind !== 'parts') return fail('emotion', emotion, 'UNKNOWN_RENDER');
    const rig = manifest.rigs && Object.hasOwn(manifest.rigs, render.rig) ? manifest.rigs[render.rig] : null;
    if (!rig) return fail('rig', render.rig, 'MISSING_RIG');
    const canvas = rig.canvas, sized = Array.isArray(canvas) && canvas.length === 2 && canvas.every(n => Number.isInteger(n) && n > 0 && n <= 4096);
    if (!sized || JSON.stringify(rig.drawOrder) !== JSON.stringify(HYBRID_SPRITE_GROUPS)) return fail('rig', render.rig, 'BAD_RIG');
    const recipe = rig.recipes && Object.hasOwn(rig.recipes, render.recipe) ? rig.recipes[render.recipe] : null;
    if (!recipe?.selection) return fail('recipe', render.recipe, 'MISSING_RECIPE');
    const parts = {};
    const usable = (id, group) => {
        const part = typeof id === 'string' && rig.parts && Object.hasOwn(rig.parts, id) ? rig.parts[id] : null, r = part?.rect;
        if (!part) return 'MISSING_PART';
        if (part.baseRevision !== rig.baseRevision) return 'STALE_PART';
        if (part.group !== group || typeof part.src !== 'string' || !hybridRect(r, canvas) || part.clearRect !== undefined && !hybridRect(part.clearRect, canvas)) return 'BAD_PART';
        parts[id] = {group, src:part.src, rect:[...r], ...(part.clearRect ? {clearRect:[...part.clearRect]} : {}), revision:part.revision ?? 0};
        return '';
    };
    const selection = {};
    for (const group of HYBRID_SPRITE_GROUPS) {
        const id = recipe.selection[group];
        if (id === 'none' && group !== 'underlay' && group !== 'face') { selection[group] = 'none'; continue; }
        const code = usable(id, group);
        if (code) fail('part', id, code, group); else selection[group] = id;
    }
    if (missing.length) return {kind:'missing', missing};
    const frames = (field, keys, group) => Object.fromEntries(keys.filter(key => recipe[field] && Object.hasOwn(recipe[field], key) && !usable(recipe[field][key], group)).map(key => [key, recipe[field][key]]));
    const mouthFrames = frames('mouthFrames', HYBRID_MOUTH_FRAMES, 'mouth'), blinkFrames = frames('blinkFrames', HYBRID_BLINK_FRAMES, 'face');
    const revision = JSON.stringify([render.rig, rig.baseRevision, render.recipe, recipe.revision ?? 0, Object.entries(parts).map(([id, part]) => [id, part.src, part.revision, part.clearRect || null]).sort()]);
    // The native resolver's rest identity (shared/hybrid-sprite.cjs resolveHybridSprite(...).revision, same string).
    const rest = HYBRID_SPRITE_GROUPS.filter(group => selection[group] !== 'none').map(group => [selection[group], rig.parts[selection[group]].revision]);
    const restRevision = JSON.stringify([render.rig, rig.baseRevision, render.recipe, recipe.revision, rest]);
    const preview = typeof render.preview === 'string' && render.preview && render.previewRevision === restRevision ? render.preview : '';
    return {kind:'parts', preview, parts:{rig:render.rig, recipe:render.recipe, canvas:[...canvas], drawOrder:[...HYBRID_SPRITE_GROUPS], selection, mouthFrames, blinkFrames, parts, revision, restRevision}};
}
// The layered-static-sprites view of any sprite manifest (identity for every other kind). Cached per manifest object.
function spriteViewManifest(manifest) {
    if (manifest?.kind !== HYBRID_SPRITE_KIND) return manifest;
    if (hybridSpriteViews.has(manifest)) return hybridSpriteViews.get(manifest);
    const emotions = {}, mouthSets = {}, rigSets = {}, missing = {};
    let character = null;
    for (const id of Object.keys(manifest.emotions || {})) {
        const result = hybridSpriteRender(manifest, id);
        if (result.kind === 'missing') { missing[id] = result.missing; continue; }
        if (result.kind === 'parts') { emotions[id] = {parts:result.parts, ...(result.preview ? {src:result.preview} : {})}; continue; }
        const legacy = result.legacy, entry = {...result.state};
        if (legacy.kind === 'static-sprites') {
            // A flat whole keeps its still/talk/blink and its flat mouth rig binding (set renamed only on collision);
            // readers dispatch per state: no `stage` and no `parts` = the flat static path.
            const set = entry.binding?.mouth?.set, rig = set !== undefined ? legacy.rig?.mouthSets?.[set] : null;
            if (rig) {
                const key = !Object.hasOwn(rigSets, set) ? set : set + '-' + id;
                rigSets[key] = rig; entry.binding = {...entry.binding, mouth:{...entry.binding.mouth, set:key}};
            }
            emotions[id] = entry; continue;
        }
        character ||= legacy.character;
        // Each whole emotion brings its own mouth atlas; keep its key unless another emotion already took it.
        const atlas = entry.mouthSet !== undefined ? legacy.mouthSets?.[entry.mouthSet] : legacy.mouthAtlas;
        if (atlas) {
            const base = entry.mouthSet ?? id;
            const key = !Object.hasOwn(mouthSets, base) ? base : base + '-' + id;
            mouthSets[key] = atlas; entry.mouthSet = key;
        }
        emotions[id] = entry;
    }
    const view = {version:2, kind:'layered-static-sprites', character:character || {id:'figure', name:'figure'}, closedBehavior:'restore-base',
        ...(Object.keys(mouthSets).length ? {mouthSets} : {}), ...(Object.keys(rigSets).length ? {rig:{mouthSets:rigSets}} : {}), emotions, hybrid:{missing}};
    hybridSpriteViews.set(manifest, view);
    return view;
}
function spriteEmotionEntries(manifest) {
    return Object.entries(spriteViewManifest(manifest)?.emotions || {});
}
function spriteEmotionState(manifest, emotion) {
    manifest = spriteViewManifest(manifest);
    const entry = typeof emotion === 'string' && manifest?.emotions && Object.hasOwn(manifest.emotions, emotion) ? manifest.emotions[emotion] : null;
    return entry ? {id:emotion, ...entry} : null;
}
// private fork (gen-ui r12, owner U3): `fallbackTo` (outfit 缺图时用) names the canonical 差分 shown when the requested
// one has no state of its own; without one (or when it has none either) the outfit default stands in, as before.
function resolveSpriteEmotion(manifest, requested, order, fallbackEmotions = [], fallbackTo = {}) {
    // Callers with a figure supply its declarations, headed by the outfit default.
    const unrestricted = order === undefined;
    order ??= ['calm'];
    requested ??= order[0];
    const own = unrestricted || order.includes(requested) ? spriteEmotionState(manifest,requested) : null;
    const id = order[0];
    const state = own || fallbackTo?.[requested] && spriteEmotionState(manifest,fallbackTo[requested]) || spriteEmotionState(manifest,id);
    return {requestedEmotion:requested, resolvedEmotion:state?.id || null, missing:!own, intentionalFallback:!own && requested !== id && fallbackEmotions.includes(requested) && Boolean(state),
        reason:own ? 'own' : state ? 'missing-emotion' : 'missing-sprite', state};
}
function resolveSpriteDisplay(manifest, requested, order, fallbackEmotions = [], fallbackTo = {}) {
    const base=resolveSpriteEmotion(manifest,requested,order,fallbackEmotions,fallbackTo);
    return {...base,fallback:base.missing ? base.state ? 'first-emotion' : 'avatar' : null};
}
// The raster compositor consumes a transient projection, never a persisted pool.
function spriteRenderManifest(manifest) {
    manifest = spriteViewManifest(manifest);
    if (!manifest) return null;
    const {emotions, ...render} = manifest;
    const states = spriteEmotionEntries(manifest).map(([id, value]) => ({id, ...value}));
    return {...render, defaultState:resolveSpriteEmotion(manifest,undefined,states.map(row=>row.id)).resolvedEmotion, states};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {HYBRID_SPRITE_KIND, HYBRID_SPRITE_GROUPS, hybridSpriteRender, spriteViewManifest, spriteEmotionEntries, spriteEmotionState, resolveSpriteEmotion, resolveSpriteDisplay, spriteRenderManifest};
