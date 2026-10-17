// private fork: shared by the app adapter and the portable authoring CLI.
import {readFile} from 'node:fs/promises'
import {assetEmotionGuidance} from './asset-generation-emotions.js'
export const ASSET_PRODUCTION_DEFAULTS = Object.freeze({avatarMode:'individual',quality:'high',blink:true})
export const ASSET_REFERENCE_ROLES = Object.freeze({
  identity:'Approved identity settei: authority for cross-outfit face, body proportions, hair structure and inherent skin/eye/hair colours; outfit accessories are not identity traits',
  settei:'Approved outfit settei: authority for clothing, outfit colours and explicit hair/accessory differences against its parent identity version; not sheet layout',
  sprite:'Approved default variant sprite: match size, framing, camera and facing direction',
  emotionSprite:'Approved same-emotion sprite: expression and outfit details',
  avatar:'Default variant avatar: match face scale, eye height and framing',
  base:'Source sprite: preserve every pixel except the requested local edit'
})
const variables = new Set(['figureName','outfitName','identityAppearance','outfitAppearance','emotion','emotionGuidance','userPrompt','referenceRoles'])
export function renderAssetTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!variables.has(key)) throw Object.assign(new Error('Unknown asset template variable: '+key),{code:'INVALID_ARGUMENT'})
    return values[key] || ''
  })
}
export function assetOutput(kind, quality = 'high') {
  return {size:kind === 'sprite' ? '1024x1536' : kind === 'avatar' ? '1024x1024' : '1536x1024',background:['sprite','avatar','avatar-sheet','blink','mouth','prop','edit'].includes(kind) ? 'transparent' : 'opaque',quality:kind === 'avatar' ? 'high' : quality}
}
export function assetPrerequisites(kind, emotionId, {settei,defaultEmotion,defaultSprite,defaultAvatar,sameSprite}) {
  if (['sprite','avatar','avatar-sheet'].includes(kind) && !settei) return 'SETTEI_REQUIRED'
  if (kind === 'sprite' && emotionId !== defaultEmotion && !defaultSprite) return 'DEFAULT_SPRITE_REQUIRED'
  if (kind === 'avatar' && emotionId !== defaultEmotion && !defaultAvatar) return 'DEFAULT_AVATAR_REQUIRED'
  if (kind === 'avatar' && !sameSprite) return 'EMOTION_SPRITE_REQUIRED'
  return null
}
export function assetPromptValues({figure = {},outfit = {},emotions,emotion,userPrompt = '',references = []}) {
  return {figureName:figure.name,outfitName:outfit.label,identityAppearance:figure.identityAppearance,outfitAppearance:outfit.outfitAppearance,
    emotion:emotions ? emotions.map((e,index)=>`${index+1}. ${e.label}`).join('; ') : emotion?.label,
    emotionGuidance:emotions ? emotions.map(e=>`${e.label}: ${assetEmotionGuidance(e,figure)}`).join('\n') : emotion ? assetEmotionGuidance(emotion,figure) : '',
    userPrompt,referenceRoles:references.map((r,i)=>`Image ${i+1}: ${r.role}`).join('\n')}
}
export async function productionPrompt({kind,figure,outfit,emotionId,userPrompt = '',references = [],frame = ''}) {
  let template = await readFile(new URL(`../../presets/asset-gen/templates/${kind}.md`,import.meta.url),'utf8')
  if(kind==='avatar'&&figure?.avatarFraming?.mode==='match-reference')template=template.replace(/^Framing:.*$/m,'Framing: on the final normalized 1024x1024 canvas, match this outfit\'s installed default avatar. Head height, crown y, chin y and centre x must each stay within +/-3% of the canvas; side cropping follows that reference, including wide ears. Use the measured visible headwear top as crown only when an occlusion: headwear note is supplied. Do not apply the generic 70% head-height or generic headroom rule. Preserve natural proportions, neck and shoulders.')
  return renderAssetTemplate(template,assetPromptValues({figure,outfit,emotion:figure?.emotions?.find(row=>row.id===emotionId),
    ...(kind==='avatar-sheet'?{emotions:(figure.emotions||[]).filter(row=>!outfit.fallbackEmotions?.includes(row.id))}:{}),
    userPrompt:[userPrompt,frame && 'Mouth opening level: '+frame].filter(Boolean).join('\n'),references}))
}
