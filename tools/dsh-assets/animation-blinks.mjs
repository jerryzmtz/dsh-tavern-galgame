import {assertCandidateAdmission} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
import {createProjectImageReader} from '../../tavern-plugin/lib/domain/asset-production-project.js'
// One accepted closed-eye patch is a complete native blink; half is optional at runtime.
import {slotAccepted,prerequisites,animationDependenciesCurrent,productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {inspectMedia} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {spriteResourcePaths,validateBlink} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/sprite.js'
import {staticMouthDocument,sameMouthValue} from './images-mouth.mjs'
const check=(ok,message)=>{if(!ok)throw productionError('CONFLICT',message)}
const nativeBlink=(state,assets)=>state?.blink?{...state.blink,closed:assets[state.blink.closed],...(state.blink.half?{half:assets[state.blink.half]}:{})}:null
export async function applyAnimationBlinks(root,p,{readImage=createProjectImageReader(root),manifest,figures,sprites,files,ownSprite,tracked,installedSlots,skipped}) {
  const installedBlinks={},written=[]
  for(const s of Object.values(p.slots).filter(s=>s.kind==='blink'&&!s.installed&&!s.sourceBinding)) {
    if(!slotAccepted(s)){skipped.push({slot:s.id,reason:s.artifact?'UNACCEPTED_BLINK':'MISSING_BLINK'});continue}
    assertCandidateAdmission(p,s,root)
    const id=[s.character,s.outfit,'sprite',s.emotion].join('/'),base=p.slots[id],a=s.artifact
    check(base?.artifact&&!base.stale&&!s.stale&&animationDependenciesCurrent(p,s)&&a.baseHash===base.artifact.hash,'STALE_REFERENCES: blink source version/hash changed: '+s.id)
    check(!prerequisites(p,s).length&&!a.redo&&a.qa?.pass!==false,'Unfinished blink pipeline: '+s.id)
    const bytes=await readImage(a)
    const size=await inspectMedia(bytes,{ext:'png',mime:'image/png',size:bytes.length})
    check(size.width===a.width&&size.height===a.height&&a.rect?.[2]===a.width&&a.rect?.[3]===a.height,'Blink dimensions changed: '+s.id)
    const c=p.characters.find(c=>c.key===s.character),f=figures[c.id],o=f?.outfits.find(o=>o.key===s.outfit)
    let doc=staticMouthDocument(sprites[o?.sprite?.manifestKey],s.emotion)
    check(doc&&o.sprite.assets[doc.emotions[s.emotion].src]===base.artifact.hash&&!o.fallbackEmotions?.includes(s.emotion),'STALE_REFERENCES: installed blink source changed: '+id)
    const local=nativeBlink(doc.emotions[s.emotion],o.sprite.assets),target={closed:a.hash,rect:a.rect,...(a.blend?{blend:a.blend}:{})},previous=tracked.blinks?.[s.id]?.blink??null
    validateBlink({...target,closed:'blink.png'},s.id,[base.artifact.width,base.artifact.height])
    installedSlots.push({slot:s.id,version:s.version,hash:a.hash})
    installedBlinks[s.id]={source:{slot:id,version:base.version,hash:base.artifact.hash},blink:target}
    // An unchanged authored target does not revert a local native edit.
    if(sameMouthValue(target,previous)||sameMouthValue(local,target))continue
    check(sameMouthValue(local,previous),'Blink three-way conflict: '+s.id)
    const key=ownSprite(c,o),src='authoring/blink/'+s.emotion+'-'+a.hash+'.png'
    doc=staticMouthDocument(sprites[key],s.emotion)
    doc.emotions[s.emotion].blink={...target,closed:src}
    o.sprite.assets[src]=a.hash;manifest.blobs[a.hash]={ext:'png',mime:'image/png',size:bytes.length};files.set('media/'+a.hash+'.png',bytes)
    const used=new Set(spriteResourcePaths(sprites[key]))
    for(const resource of Object.keys(o.sprite.assets))if(!used.has(resource))delete o.sprite.assets[resource]
    files.set(manifest.sprites[key],Buffer.from(JSON.stringify(sprites[key],null,2)+'\n'))
    files.set('figures/'+c.id+'.json',Buffer.from(JSON.stringify(f,null,2)+'\n'))
    written.push(s.id)
  }
  return {installedBlinks,written}
}
