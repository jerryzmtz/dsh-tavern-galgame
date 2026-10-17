// private fork: one pure avatar resolver for transcript, stage faces and pack UI.
// Precedence per emotion (owner, card-centric merge): an uploaded avatar image for that emotion, then the crop of
// that emotion's own sprite state (manual state > manual outfit > auto > default crop), then the outfit's calm
// uploaded avatar, then the crop of the calm/fallback state. Uploaded avatars are already framed (crop null).
// @include-shared sprite-emotions.cjs
function packSpriteEmotions() {
    return typeof window === 'undefined' && typeof require === 'function' ? require('../../shared/sprite-emotions.cjs') : {resolveSpriteEmotion, spriteEmotionEntries};
}
const PACK_AVATAR_DEFAULT_CROP = Object.freeze({x:0.3,y:0,w:0.4,h:0.21});
// private fork: card appearance is intent; missing media only lowers the effective form.
// Callers validate the choice and select an enabled outfit before resolving its media.
// private fork (new-user journey 2026-10): `live2d` false (no Cubism Core installed) makes every Live2D view count as
// missing, so the figure takes the same ladder step as an outfit without a model.
// private fork (docs/fork/spine-figures.md): `spine` false (no Spine runtime on this machine, e.g. the public build) does
// the same for Spine. Spine sits between Live2D and sprite: both are animated rigs, sprites are the universal floor.
function packAppearance(outfit, appearance, live2d = true, spine = true) {
    const forms = ['live2d','spine','sprite','avatar'], missing = [];
    for (const form of forms.slice(forms.indexOf(appearance))) {
        if (form === 'avatar' || outfit?.[form] && (live2d || form !== 'live2d') && (spine || form !== 'spine')) return {form,missing};
        missing.push(form);
    }
}
function packAvatarState(outfit, manifest, emotion = outfit?.defaultEmotion || 'calm', defaultEmotion = outfit?.defaultEmotion || 'calm') {
    return packSpriteEmotions().resolveSpriteEmotion(manifest, emotion, [defaultEmotion,emotion]).state;
}
function packAvatarSlots(outfit, emotion) {
    return [emotion];
}
function packAvatarImage(outfit, emotion, exactOnly = false, defaultEmotion = outfit?.defaultEmotion || 'calm') {
    const slots = [...packAvatarSlots(outfit,emotion),...(exactOnly ? [] : [defaultEmotion])];
    const stateId = slots.find(slot => outfit?.avatars?.[slot]);
    // Avatar media is already framed; sprite crop coordinates must not be applied.
    return stateId ? {hash:outfit.avatars[stateId],stateId,crop:null} : null;
}
function selectPackAvatar({outfit,manifest,state,avatarSource,defaultEmotion = outfit?.defaultEmotion || 'calm',emotion = state?.id || defaultEmotion,spriteOnly = false}) {
    if (avatarSource) return selectPackAvatar(avatarSource);
    const exactImage = packAvatarImage(outfit,emotion,true);
    if (exactImage) return exactImage;
    const body = candidate => candidate?.stage?.src || candidate?.src;
    const available = candidate => outfit?.sprite?.assets?.[body(candidate)];
    const selected = [state,packAvatarState(outfit,manifest,emotion,defaultEmotion),packAvatarState(outfit,manifest,defaultEmotion,defaultEmotion)].find(available);
    const hash = available(selected);
    const exactState = selected && selected.id === emotion;
    const crop = () => ({hash,stateId:selected.id,crop:outfit.sprite.avatarCrop?.[selected.id] || outfit.avatarCrop || outfit.sprite.avatarCropAuto?.[selected.id] || PACK_AVATAR_DEFAULT_CROP});
    if (hash && exactState) return crop();
    const fallbackImage = packAvatarImage(outfit,emotion,false,defaultEmotion);
    if (fallbackImage && (hash || !spriteOnly)) return fallbackImage;
    return hash ? crop() : null;
}
function selectFigureAvatar(figure, sprites = {}, {outfitKey,emotion} = {}) {
    if (!figure?.enabled || !Array.isArray(figure.outfits)) return null;
    if (figure.emotions?.length === 1 && figure.emotions[0].label === undefined) emotion = figure.emotions[0].id;
    const selected = outfitKey === undefined ? figure.outfits.find(outfit => outfit.enabled) : figure.outfits.find(outfit => outfit.key === outfitKey);
    if (!selected?.enabled) return null;
    const identity = typeof window === 'undefined' && typeof require === 'function' ? require('../../packages/dsh-asset-library/lib/shared/emotion-identity.cjs').forkResolveBubbleMood : forkResolveBubbleMood;
    emotion = identity(emotion,figure.emotions || [])?.id || emotion || selected.defaultEmotion || figure.emotions?.[0]?.id;
    // private fork (gen-ui r12, owner U3): 缺图时用 — a 差分 with neither its own avatar nor its own sprite state shows its stand-in.
    const use = selected.fallbackTo?.[emotion];
    if (use && !selected.avatars?.[emotion] && packSpriteEmotions().resolveSpriteEmotion(sprites[selected.sprite?.manifestKey], emotion, [selected.defaultEmotion ?? figure.emotions?.[0]?.id ?? 'calm', emotion]).missing) emotion = use;
    // Missing avatars never borrow a different outfit's appearance.
    for (const outfit of [selected]) {
        const manifest = sprites[outfit.sprite?.manifestKey], defaultEmotion=outfit.defaultEmotion ?? figure.emotions?.[0]?.id ?? 'calm', state = packAvatarState(outfit,manifest,emotion,defaultEmotion);
        const avatar = selectPackAvatar({outfit,manifest,state,emotion,defaultEmotion,spriteOnly:true});
        if (avatar) return {...avatar,outfitKey:outfit.key,avatarSource:{outfit,...(manifest ? {manifest} : {}),state,emotion,defaultEmotion,spriteOnly:true}};
    }
    for (const outfit of [selected]) {
        const avatar = packAvatarImage(outfit,emotion,false,outfit.defaultEmotion ?? figure.emotions?.[0]?.id ?? 'calm');
        if (avatar) return {...avatar,outfitKey:outfit.key,avatarSource:{outfit,emotion,defaultEmotion:outfit.defaultEmotion ?? figure.emotions?.[0]?.id}};
    }
    return null;
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {DEFAULT_AVATAR_CROP:PACK_AVATAR_DEFAULT_CROP,selectPackAvatar,selectFigureAvatar,packAvatarState,packAppearance};
