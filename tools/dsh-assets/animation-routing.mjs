import hybrid from '../../tavern-plugin/packages/dsh-asset-library/lib/shared/hybrid-sprite.cjs'
import {composeHybridPreview} from '../../tavern-plugin/lib/domain/hybrid-sprite-preview.js'
import {hash,productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {imageDimensions} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
import {canonicalJson} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
export const animationCheck=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
export function animationRoute(doc,emotion) {
  if(doc?.kind==='hybrid-face-sprites') {
    const r=doc.emotions[emotion]?.render
    if(r?.kind==='parts') {
      const resolved=hybrid.resolveHybridSprite(doc,emotion)
      animationCheck(resolved.available,'STALE_REFERENCES: missing/stale rest parts: '+emotion)
      return {kind:'parts',doc,render:r,rig:doc.rigs[r.rig],recipe:doc.rigs[r.rig].recipes[r.recipe],resolved}
    }
    doc=r?.kind==='whole'?r.legacy:null
  }
  const state=doc?.emotions[emotion]
  animationCheck(state&&['static-sprites','layered-static-sprites'].includes(doc.kind),'Unsupported installed animation source: '+emotion)
  return {kind:doc.kind==='static-sprites'?'static':'layered',doc,state,view:state.stage||state}
}
export async function animationSource(doc,emotion,assets,read) {
  const route=animationRoute(doc,emotion)
  if(route.kind==='parts') {
    const {bytes,width,height}=await composeHybridPreview(doc,emotion,src=>read(assets[src]))
    // Rest-layer identity excludes animation mappings and recipe revision: installing
    // one animation must not invalidate the other or a pre-existing rest preview.
    const identity={kind:'parts',rig:route.render.rig,baseRevision:route.rig.baseRevision,canvas:route.rig.canvas,drawOrder:route.rig.drawOrder,selection:route.recipe.selection,layers:route.resolved.layers.map(({src,...part})=>({...part,hash:assets[src]}))}
    return {route,bytes,width,height,hash:hash(bytes),routing:hash(canonicalJson(identity))}
  }
  const digest=assets[route.view.src],bytes=await read(digest),[width,height]=imageDimensions(bytes,'png')
  return {route,bytes,width,height,hash:digest,routing:hash(canonicalJson({kind:route.kind,hash:digest,width,height}))}
}
export function animationState(route,kind,assets) {
  if(route.kind==='parts') {
    const frames=route.recipe[kind==='mouth'?'mouthFrames':'blinkFrames']
    return frames?{frames:Object.fromEntries(Object.entries(frames).map(([frame,id])=>{const {src,...part}=route.rig.parts[id]||{};return [frame,{...part,hash:assets[src]??null}]}))}:null
  }
  if(kind==='blink')return route.view.blink?{...route.view.blink,closed:assets[route.view.blink.closed],...(route.view.blink.half?{half:assets[route.view.blink.half]}:{})}:null
  if(route.kind==='static') {
    const binding=route.state.binding;if(!binding)return null
    const set=route.doc.rig.mouthSets[binding.mouth.set],bound=structuredClone(binding);delete bound.mouth.set
    if(bound.mouth.cover)bound.mouth.cover.src=assets[bound.mouth.cover.src]
    return {binding:bound,set:{...set,frames:Object.fromEntries(Object.entries(set.frames).map(([k,v])=>[k,assets[v]]))}}
  }
  const s=route.state,a=s.mouthSet?route.doc.mouthSets?.[s.mouthSet]:route.doc.mouthAtlas
  if(!route.view.mouth)return null
  return {atlas:a?{...a,src:assets[a.src]}:null,mouth:route.view.mouth,mouthByFrame:route.view.mouthByFrame??null,mouthFrames:route.view.mouthFrames??s.mouthFrames??{},closedMouthFrame:s.closedMouthFrame??null,mask:assets[route.view.mouthOcclusionMask]??null}
}
