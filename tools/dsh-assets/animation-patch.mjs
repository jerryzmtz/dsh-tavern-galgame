import {assertCandidateAdmission} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
import {compositePatch} from '../../tavern-plugin/lib/domain/sprite-blink-patch.js'
import {createProjectImageReader} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {partAlphaBox} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/part-bbox.js'
import {decodeAssetRgba,encodeAssetRgba} from '../../tavern-plugin/lib/domain/asset-image-processing.js'
import {hash,slotAccepted,prerequisites,mouthSourceStale} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {spriteResourcePaths} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/sprite.js'
import {canonicalJson} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {animationRoute,animationSource,animationState,animationCheck as check} from './animation-routing.mjs'
const same=(a,b)=>canonicalJson(a??null)===canonicalJson(b??null)
const events={closed:'closed',small:'i',mid:'e',open:'a'}
function paste(target,image,x,y) {for(let row=0;row<image.height;row++)target.data.set(image.data.subarray(row*image.width*4,(row+1)*image.width*4),((row+y)*target.width+x)*4)}
const blank=(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)})
async function buildTarget(route,kind,slots,source,assets,read,put) {
  const rect=slots[0].artifact.rect
  if(route.kind==='parts') {
    const group=kind==='mouth'?'mouth':'face',field=kind==='mouth'?'mouthFrames':'blinkFrames',rest=route.rig.parts[route.recipe.selection[group]]
    // Keep the entire selected rest part; only replace the measured patch. This is
    // a group replacement at the original draw depth, not a finished-frame overlay.
    const x=Math.min(rect[0],rest?.rect[0]??rect[0]),y=Math.min(rect[1],rest?.rect[1]??rect[1])
    const w=Math.max(rect[0]+rect[2],rest?rest.rect[0]+rest.rect[2]:0)-x,h=Math.max(rect[1]+rect[3],rest?rest.rect[1]+rest.rect[3]:0)-y
    const original=rest?decodeAssetRgba(await read(assets[rest.src])):null,frames={}
    for(const s of slots) {
      const image=blank(w,h);if(original)paste(image,original,rest.rect[0]-x,rest.rect[1]-y)
      // Preserve the artifact blend: source-bound mouths are already baked, not another opacity layer.
      const composed=compositePatch(image,s.pixels,[rect[0]-x,rect[1]-y,rect[2],rect[3]],s.artifact.blend)
      const bytes=encodeAssetRgba(composed),digest=hash(bytes),id='anim-'+group+'-'+digest.slice(0,24),src=put(bytes,'parts/'+id,digest)
      route.rig.parts[id]={group,src,rect:[x,y,w,h],bbox:partAlphaBox(bytes),revision:1,baseRevision:route.rig.baseRevision,...(rest?.clearRect?{clearRect:rest.clearRect}:{}),...(kind==='mouth'&&s.artifact.blend==='replace'?{replaceRect:rect}:{})}
      frames[kind==='mouth'?events[s.frame]:'closed']=id
    }
    if(kind==='mouth'){frames.u=frames.i;frames.o=frames.a}
    route.recipe[field]=frames
    return
  }
  if(kind==='blink') {route.view.blink={closed:put(slots[0].bytes,'blink',slots[0].artifact.hash),rect,...(slots[0].artifact.blend?{blend:slots[0].artifact.blend}:{})};return}
  check(route.kind==='layered','Static mouths use the canonical four-frame patcher')
  const s=route.state,old=source.mouth?.atlas,oldFrames=old?.frames||{},width=Math.max(old?.width||0,rect[2]*4),height=(old?.height||0)+rect[3]+1
  check(width<=4096&&height<=4096,'Animation atlas exceeds runtime dimensions')
  const atlas=blank(width,height),frames=structuredClone(oldFrames)
  if(old)paste(atlas,decodeAssetRgba(await read(old.src)),0,0)
  const mapped={}
  for(let i=0;i<slots.length;i++) {
    const slot=slots[i],id='anim-'+slot.frame+'-'+slot.artifact.hash.slice(0,12)
    paste(atlas,slot.pixels,i*rect[2],old?.height||0)
    frames[id]={x:i*rect[2],y:old?.height||0,w:rect[2],h:rect[3],...(slot.artifact.blend==='replace'?{replace:true}:{})}
    mapped[events[slot.frame]]=id
  }
  mapped.u=mapped.i;mapped.o=mapped.a
  if(!frames['anim-still'])frames['anim-still']={x:0,y:height-1,w:1,h:1}
  if(s.portrait&&!s.portrait.mouth) {
    s.portrait.mouth={x:0,y:0,w:1,h:1}
    s.portrait.mouthFrames=Object.fromEntries(['closed','a','i','u','e','o'].map(event=>[event,'anim-still']))
  }
  const previousSet=s.mouthSet,setId='anim-'+slots[0].emotion
  check(!route.doc.mouthSets?.[setId]||previousSet===setId&&!Object.values(route.doc.emotions).some(other=>other!==s&&other.mouthSet===setId),'Reserved/shared animation atlas exists: '+setId)
  // Freeze the portrait's original event routing before assigning the stage map.
  if(s.portrait?.mouth) {
    const previous={...(s.mouthFrames||{}),...(s.portrait.mouthFrames||{})}
    if(s.closedMouthFrame)previous.closed=s.closedMouthFrame
    for(const event of ['a','i','u','e','o'])if(!previous[event]){const id=old?.defaultFrames?.[event]||event;if(oldFrames[id])previous[event]=id;else if(previous.closed)previous[event]=previous.closed}
    s.portrait.mouthFrames=previous
  }
  s.mouthSet=setId;delete s.closedMouthFrame
  s.stage.mouth={x:rect[0],y:rect[1],w:rect[2],h:rect[3]};s.stage.mouthFrames=mapped;delete s.stage.mouthByFrame;delete s.stage.mouthOcclusionMask
  route.doc.mouthSets||={};route.doc.mouthSets[setId]={src:put(encodeAssetRgba(atlas),'atlas'),width,height,frames,...(old?.defaultFrames?{defaultFrames:old.defaultFrames}:{})}
  if(previousSet&&previousSet!==setId&&!Object.values(route.doc.emotions).some(s=>s.mouthSet===previousSet))delete route.doc.mouthSets[previousSet]
  if(route.doc.mouthAtlas&&!Object.values(route.doc.emotions).some(s=>s.mouthSet===undefined))delete route.doc.mouthAtlas
}
export async function applyScopedAnimations(root,p,ctx,{mouths=true,blinks=true}={}) {
  const {readImage=createProjectImageReader(root),manifest,figures,sprites,files,ownSprite,tracked,installedSlots,skipped}=ctx,installedMouths={},installedBlinks={},written=[]
  for(const kind of ['mouth','blink']) {
    if(kind==='mouth'&&!mouths||kind==='blink'&&!blinks)continue
    for(const [id,source]of Object.entries((kind==='mouth'?p.mouthSources:p.blinkSources)||{})) {
      if(kind==='mouth'&&(!source.route||source.route==='static'))continue
      const base=p.slots[id],slots=(kind==='mouth'?['closed','small','mid','open']:[null]).map(frame=>p.slots[[base.character,base.outfit,kind,base.emotion,frame].filter(Boolean).join('/')])
      if(!slots.every(slotAccepted)){skipped.push({source:id,reason:'INCOMPLETE_OR_UNACCEPTED_'+kind.toUpperCase()});continue}
      check(slots.every(s=>!s.stale&&!mouthSourceStale(p,s)&&!prerequisites(p,s).length&&!s.artifact.redo&&s.artifact.qa?.pass!==false&&s.artifact.baseHash===source.hash),'STALE_REFERENCES: animation source/QA changed: '+id)
      const c=p.characters.find(c=>c.key===base.character),f=figures[c.id],o=f.outfits.find(o=>o.key===base.outfit),key=o.sprite.manifestKey
      const read=async digest=>{const b=manifest.blobs[digest],bytes=b&&files.get('media/'+digest+'.'+b.ext);check(bytes,'Missing installed source media: '+digest);return bytes}
      const current=await animationSource(sprites[key],base.emotion,o.sprite.assets,read)
      check(current.hash===source.hash&&(!source.routing||source.routing===current.routing),'STALE_REFERENCES: installed animation source changed: '+id)
      const local=animationState(current.route,kind,o.sprite.assets),doc=structuredClone(sprites[key]),assets={...o.sprite.assets},media=new Map()
      let route=animationRoute(doc,base.emotion)
      if(route.kind==='parts') {
        const recipeId='anim-'+base.emotion
        check(!Object.entries(doc.emotions).some(([emotion,{render}])=>emotion!==base.emotion&&render.kind==='parts'&&render.rig===route.render.rig&&render.recipe===recipeId),'Shared animation recipe requires an independent declaration: '+recipeId)
        if(route.render.recipe!==recipeId) {check(!route.rig.recipes[recipeId],'Reserved animation recipe exists');route.rig.recipes[recipeId]=structuredClone(route.recipe);route.render.recipe=recipeId;route.recipe=route.rig.recipes[recipeId]}
      }
      const loaded=[]
      for(const s of slots) {
        assertCandidateAdmission(p,s,root)
        const a=s.artifact,bytes=await readImage(a),pixels=decodeAssetRgba(bytes),r=a.rect
        check(r?.[2]<=(kind==='mouth'?512:1024)&&r?.[3]<=(kind==='mouth'?512:1024)&&pixels.width===a.width&&pixels.height===a.height&&same(r,slots[0].artifact.rect)&&r?.length===4&&r.every(Number.isInteger)&&r[0]>=0&&r[1]>=0&&r[2]===a.width&&r[3]===a.height&&r[0]+r[2]<=source.width&&r[1]+r[3]<=source.height,'Animation patch bytes/rect changed: '+s.id)
        loaded.push({...s,bytes,pixels});installedSlots.push({slot:s.id,version:s.version,hash:a.hash})
      }
      const put=(bytes,label,digest=hash(bytes))=>{const src='authoring/animation/'+base.emotion+'/'+label+'-'+digest+'.png';assets[src]=digest;media.set(digest,bytes);return src}
      await buildTarget(route,kind,loaded,source,assets,async digest=>source.atlasPath&&digest===source.mouth?.atlas?.src?readImage({path:source.atlasPath,hash:digest}):read(digest),put)
      const target=animationState(route,kind,assets),record={source:{slot:id,version:source.version,hash:source.hash},[kind]:target},slot=slots[0].id
      if(kind==='mouth')installedMouths[id]=record;else installedBlinks[slot]=record
      const previous=(kind==='mouth'?tracked.mouths?.[id]?.mouth:tracked.blinks?.[slot]?.blink)??source.mouth
      if(same(target,previous)||same(local,target))continue
      check(same(local,previous),'Animation three-way conflict: '+slot)
      if(route.kind==='parts') {
        route.recipe.revision++
        // Rest pixels are unchanged; remove only stale preview metadata, not recipes.
        delete route.render.preview;delete route.render.previewRevision
        const used=new Set(Object.values(route.rig.recipes).flatMap(r=>[...Object.values(r.selection),...Object.values(r.mouthFrames||{}),...Object.values(r.blinkFrames||{})]))
        for(const id of Object.keys(route.rig.parts))if(/^anim-(mouth|face)-[a-f0-9]{24}$/.test(id)&&!used.has(id))delete route.rig.parts[id]
      }
      const ownKey=ownSprite(c,o);sprites[ownKey]=doc;o.sprite.assets=assets
      const used=new Set(spriteResourcePaths(doc));for(const src of Object.keys(assets))if(!used.has(src))delete assets[src]
      for(const [digest,bytes]of media){manifest.blobs[digest]={ext:'png',mime:'image/png',size:bytes.length};files.set('media/'+digest+'.png',bytes)}
      files.set(manifest.sprites[ownKey],Buffer.from(JSON.stringify(doc,null,2)+'\n'));files.set('figures/'+c.id+'.json',Buffer.from(JSON.stringify(f,null,2)+'\n'))
      written.push(...slots.map(s=>s.id))
    }
  }
  return {installedMouths,installedBlinks,written}
}
