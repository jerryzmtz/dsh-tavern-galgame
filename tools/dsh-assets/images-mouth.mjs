import {createProjectImageReader} from '../../tavern-plugin/lib/domain/asset-production-project.js'
// Scoped static-sprite patches. Installed source snapshots never become approved sprite slots.
import {productionError,slotAccepted} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {canonicalJson} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {spriteResourcePaths} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/sprite.js'
export const mouthFrames=['closed','small','mid','open']
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
export const sameMouthValue=(a,b)=>canonicalJson(a)===canonicalJson(b)
const mouthValue=state=>{if(!state)return null;const value=structuredClone(state);delete value.binding.mouth.set;return value}
const sameMouthState=(a,b)=>sameMouthValue(mouthValue(a),mouthValue(b))
export function staticMouthDocument(doc,emotion) {
  if(doc?.kind==='hybrid-face-sprites')doc=doc.emotions[emotion]?.render?.kind==='whole'?doc.emotions[emotion].render.legacy:null
  return doc?.kind==='static-sprites'&&doc.emotions[emotion]?.src?doc:null
}
export function nativeMouthState(doc,emotion,assets) {
  const binding=doc?.emotions[emotion]?.binding
  if(!binding)return null
  const set=doc.rig.mouthSets[binding.mouth.set]
  const bound=structuredClone(binding)
  if(bound.mouth.cover)bound.mouth.cover.src=assets[bound.mouth.cover.src]
  return {binding:bound,set:{...set,frames:Object.fromEntries(Object.entries(set.frames).map(([frame,src])=>[frame,assets[src]]))}}
}
export async function requireImageMouth(root,options) {
  return (await import('./animation-declare.mjs')).requireAnimation(root,options,'mouth')
}
export function staleMouthSource(p,id) {
  const source=p.mouthSources?.[id],base=p.slots[id]
  return Boolean(source&&base&&!base.installed&&(base.artifact?.hash!==source.hash||base.version!==source.version))
}
export function validateMouthGroups(p,{accepted=false,skipStale=false}={}) {
  const groups=[]
  for(const [id,source]of Object.entries(p.mouthSources||{})) {
    if(staleMouthSource(p,id)) {if(skipStale)continue;check(false,'STALE_REFERENCES: mouth source changed: '+id)}
    const base=p.slots[id],slots=mouthFrames.map(frame=>p.slots[[base.character,base.outfit,'mouth',base.emotion,frame].join('/')])
    if(!slots.some(s=>s?.artifact)) {if(accepted)check(false,'Missing mouth frames: '+id);continue}
    check(slots.every(s=>s?.artifact&&!s.stale),'Complete all four current mouth frames: '+id)
    const rect=slots[0].artifact.rect
    check(Array.isArray(rect)&&rect.length===4&&rect.every(Number.isInteger)&&rect[0]>=0&&rect[1]>=0&&rect[2]>0&&rect[3]>0&&rect[2]<=512&&rect[3]<=512&&rect[0]+rect[2]<=source.width&&rect[1]+rect[3]<=source.height,'Invalid mouth rectangle: '+id)
    for(const s of slots) {
      check(sameMouthValue(s.sourceBinding,{slot:id,version:source.version,hash:source.hash})&&s.artifact.baseHash===source.hash,'STALE_REFERENCES: mouth source changed: '+s.id)
      check(sameMouthValue(s.artifact.rect,rect)&&s.artifact.width===rect[2]&&s.artifact.height===rect[3],'Mouth frames require a shared rectangle: '+id)
      if(accepted)check(slotAccepted(s),'Accept the current mouth frame hash/version: '+s.id)
    }
    groups.push({id,source,base,slots,rect})
  }
  if(accepted)check(groups.length,'No declared mouth frames to install')
  return groups
}
export async function applyImageMouths(root,p,{readImage=createProjectImageReader(root),manifest,figures,sprites,files,inventory,ownSprite,skipStale=false}) {
  const groups=validateMouthGroups(p,{skipStale}),installedMouths={},written=[]
  for(const {id,source,base,slots,rect} of groups) {
    const c=p.characters.find(c=>c.key===base.character),f=figures[c.id],o=f?.outfits.find(o=>o.key===base.outfit)
    let doc=staticMouthDocument(sprites[o?.sprite?.manifestKey],base.emotion)
    check(doc&&o.sprite.assets[doc.emotions[base.emotion].src]===source.hash,'STALE_REFERENCES: installed sprite changed: '+id)
    const current=nativeMouthState(doc,base.emotion,o.sprite.assets),setId='mouth-'+base.emotion
    // Opaque contextual patches overlay the original mouth, including the closed/silent frame.
    const binding={canvas:[source.width,source.height],mouth:{set:setId,anchor:{x:rect[0],y:rect[1],scale:1,rotation:0},surface:'mouthless'}}
    const blends=Object.fromEntries(slots.filter(s=>s.artifact.blend).map(s=>[s.frame,s.artifact.blend]))
    const target={binding,set:{canvas:[rect[2],rect[3]],pivot:[0,0],frames:Object.fromEntries(slots.map(s=>[s.frame,s.artifact.hash])),...(Object.keys(blends).length?{blends}:{})}}
    installedMouths[id]={source:{slot:id,version:source.version,hash:source.hash},mouth:target}
    if(sameMouthState(target,source.mouth)||sameMouthState(current,target))continue
    check(sameMouthState(current,source.mouth),'Mouth three-way conflict for figure '+c.id+': '+id)
    // Inventory includes real mouth frames; absence is a gap, not an absent sprite/avatar row.
    for(const s of slots)check(inventory.some(r=>r.figure.id===c.id&&r.outfit.key===o.key&&r.emotion===base.emotion&&r.kind==='mouth'&&r.frame===s.frame),'Missing mouth inventory row: '+s.id)
    written.push(...slots.map(s=>s.id))
    const key=ownSprite(c,o)
    doc=staticMouthDocument(sprites[key],base.emotion)
    check(!doc.rig?.mouthSets?.[setId]||doc.emotions[base.emotion].binding?.mouth?.set===setId&&!Object.entries(doc.emotions).some(([id,s])=>id!==base.emotion&&s.binding?.mouth?.set===setId),'Reserved/shared mouth set exists: '+setId)
    const frames={}
    for(const s of slots) {
      const a=s.artifact,src='authoring/mouth/'+base.emotion+'/'+s.frame+'-'+a.hash+'.png',bytes=await readImage(a)
      frames[s.frame]=src;o.sprite.assets[src]=a.hash
      manifest.blobs[a.hash]={ext:'png',mime:'image/png',size:bytes.length};files.set('media/'+a.hash+'.png',bytes)
    }
    const oldSet=doc.emotions[base.emotion].binding?.mouth?.set
    doc.emotions[base.emotion].binding=binding;doc.rig||={mouthSets:{}}
    doc.rig.mouthSets[setId]={canvas:target.set.canvas,pivot:target.set.pivot,frames,...(target.set.blends?{blends:target.set.blends}:{})}
    if(oldSet&&oldSet!==setId&&!Object.values(doc.emotions).some(s=>s.binding?.mouth?.set===oldSet))delete doc.rig.mouthSets[oldSet]
    const used=new Set(spriteResourcePaths(sprites[key]))
    for(const src of Object.keys(o.sprite.assets))if(!used.has(src))delete o.sprite.assets[src]
    files.set(manifest.sprites[key],Buffer.from(JSON.stringify(sprites[key],null,2)+'\n'))
    files.set('figures/'+c.id+'.json',Buffer.from(JSON.stringify(f,null,2)+'\n'))
  }
  return {installedMouths,written}
}
