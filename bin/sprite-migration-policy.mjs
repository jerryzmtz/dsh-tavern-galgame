// private fork: vocabulary belongs only to the one-shot migration, never runtime ingress.
import {importFigureVariants} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/import-figure-variants.js'
export const LEGACY_FIGURE_EMOTIONS=importFigureVariants({}, {legacy:{outfits:[{}]}}, {}).figures.legacy.emotions.sort((a,b)=>Number(b.id==='calm')-Number(a.id==='calm'))
const moods=LEGACY_FIGURE_EMOTIONS
const groups = {
  calm:['calm','default','neutral','平和','平静','基准','默认','普通','站立','中性母版','平静微笑','待命'],
  joy:['joy','happy','laughing','喜悦','开心','笑','微笑','大笑','开怀大笑','兴奋','欣喜','捂嘴笑','闭眼微笑','柔和开心','happysoft'],
  anger:['anger','angry','愤怒','生气'],sad:['sad','sadness','悲伤','难过'],
  anxious:['anxious','nervous','紧张','不安','担忧','慌张'],shy:['shy','embarrassed','害羞','脸红'],
  disgust:['disgust','嫌弃','厌恶','嫌恶'],love:['love','affection','喜欢','爱恋','爱心眼','比心','喜爱','亲近','爱意','亲爱','温柔亲近'],crying:['crying','哭','哭泣','擦泪哭泣','tearwipingcry']
}
const distinct = {
  surprise:['惊讶','吃惊','漫画式震惊'],determined:['认真坚定','认真','严肃'],thinking:['思考'],
  singing:['唱歌','演唱'],performing:['演奏'],smug:['得意','叉腰得意'],tired:['疲惫'],
  offering:['分享','赠礼','offering-food'],greeting:['招呼'],walking:['行走'],lying:['趴卧'],
  'head-tilt':['歪头'],alert:['警戒'],recoil:['退避'],warning:['警告'],eating:['吃饭','馋嘴'],makeup:['美妆'],stargazing:['观星'],phone:['接听'],pleading:['挽留'],business:['公务']
}
export const labelToken = value => String(value || '').replace(/^基准\s*[·・:：-]\s*/u,'').split(/[·・（(]/u)[0].trim().toLowerCase()
const match = (table, value) => Object.entries(table).find(([id, words]) => id === value || words.includes(value))?.[0]
export function spriteMigrationMeaning(state, rows) {
  const label = labelToken(state.label || state.emotion || state.id)
  const standard = match(groups,label) || moods.find(row => row.label === label || row.words.split(/\s+/).includes(label))?.id
  if(standard) return {kind:'standard',id:standard,label}
  const existing = rows.find(row => row.id === label || labelToken(row.label) === label)
  if(existing) return {kind:'custom',id:existing.id,label:existing.label,existing:true}
  const category = match(distinct,label)
  if(category) {
    const equivalent = rows.find(row => match(distinct,labelToken(row.label)) === category || row.id === category)
    return equivalent ? {kind:'custom',id:equivalent.id,label:equivalent.label,existing:true} : {kind:'custom',id:category,label:distinct[category][0],guidance:'用于'+distinct[category][0]+'的表情或动作。'}
  }
  const suggestions = {'羞恼':'redundant:shy','漫画式威压':'distinct:intimidating','怀疑':'redundant:disgust','大喊':'redundant:anger','咬牙':'redundant:anger','回应':'distinct:greeting','辩解':'redundant:anxious','唐笑':'redundant:joy','哈？！':'redundant:surprise','不会！':'redundant:joy','委屈质问':'redundant:sad','欲言':'redundant:shy','卖萌':'distinct:cute-pose','好奇':'distinct:curious','邀约':'distinct:inviting','俯视':'redundant:smug','客套':'redundant:calm','决绝':'redundant:disgust','质问':'redundant:anger','慌忙辩白':'redundant:anxious','恳求':'redundant:anxious','入迷':'redundant:joy','回避':'distinct:hiding','生无可恋':'redundant:sad'}
  return {kind:'uncertain',label,suggestion:suggestions[label] || 'distinct:needs-owner-name'}
}
export function spriteMigrationCanonical(id) {
  const aliases={default:'calm',neutral:'calm',sadness:'sad',nervous:'anxious',embarrassed:'shy',affection:'love',happy:'joy',angry:'anger',happysoft:'joy',tearwipingcry:'crying'}
  return aliases[id] || id
}
// Conservative near-duplicates: compare visible pixels and local blocks, not file identity.
export function compareSpritePixels(a,b) {
  if(!a || !b || Math.abs(a.aspect-b.aspect)>0.002) return null
  const x=a.pixels,y=b.pixels,blocks=new Float64Array(1024),counts=new Uint32Array(1024)
  let total=0,changed=0,visible=0
  for(let i=0;i<x.length;i+=4){
    if(x[i+3]<8&&y[i+3]<8)continue
    let d=Math.abs(x[i+3]-y[i+3])/255
    for(let c=0;c<3;c++)d+=Math.abs(x[i+c]*x[i+3]-y[i+c]*y[i+3])/65025
    d/=4;total+=d;visible++;if(d>0.04)changed++
    const p=i/4,k=Math.floor(p/128/4)*32+Math.floor(p%128/4);blocks[k]+=d;counts[k]++
  }
  const mean=total/Math.max(visible,1),changedFraction=changed/Math.max(visible,1),maxBlock=Math.max(...blocks.map((sum,i)=>sum/Math.max(counts[i],1)))
  return {mean,changedFraction,maxBlock,near:visible>0&&mean<=0.003&&changedFraction<=0.01&&maxBlock<=0.01}
}
