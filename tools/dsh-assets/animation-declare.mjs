import {readFile} from 'node:fs/promises'
import {loadProject,transaction,slotAccepted,atomic,safeProjectFile} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {readNativeSnapshot} from './baseline.mjs'
import {animationSource,animationState,animationCheck as check} from './animation-routing.mjs'
import {nativeMouthState} from './images-mouth.mjs'
export async function requireAnimation(root,{sprites,library,expectedRevision,rebind=false,dryRun=false},kind) {
  check(typeof sprites==='string'&&sprites.split(',').every(s=>s.trim()),'Requires --sprites SPRITE_SLOT,... (figure/outfit/emotion scope)')
  check(library&&expectedRevision,'Requires --library and --expected-revision')
  const action=async p=>{
    check(p.baseline?.scope==='images','Scoped animation declarations require an images baseline')
    const native=await readNativeSnapshot(library,p.id),added=[],rebound=[],sources=[],copies=new Map(),field=kind==='mouth'?'mouthSources':'blinkSources'
    check(native.revision===expectedRevision,'Installed revision changed; refresh before declaring animation')
    for(const id of [...new Set(sprites.split(',').map(s=>s.trim()))]) {
      const s=p.slots[id];check(s?.kind==='sprite','Unknown sprite slot: '+id)
      const c=p.characters.find(c=>c.key===s.character),o=native.figures[c.id]?.outfits.find(o=>o.key===s.outfit)
      check(o?.sprite&&!o.fallbackEmotions?.includes(s.emotion),'Explicit installed emotion required: '+id)
      const read=async h=>{const b=native.manifest.blobs[h];check(b,'Missing source media: '+h);return readFile(await safeProjectFile(library,'packs/'+p.id+'/media/'+h+'.'+b.ext))}
      const resolved=await animationSource(native.sprites[o.sprite.manifestKey],s.emotion,o.sprite.assets,read)
      if(!s.installed)check(slotAccepted(s)&&s.registered&&s.artifact.hash===resolved.hash&&!s.stale,'Accept/register/install exact source sprite first: '+id)
      const old=p[field]?.[id],version=s.installed?native.revision:s.version
      if(old&&old.hash===resolved.hash&&(!old.routing||old.routing===resolved.routing)&&(s.installed||old.version===version)){sources.push(old);continue}
      check(!old||rebind,'Animation source changed; use --rebind after owner approval: '+id)
      const file='sources/'+kind+'/'+resolved.hash+'.png'
      const source={slot:id,version,hash:resolved.hash,path:file,width:resolved.width,height:resolved.height,nativeRevision:native.revision,mouth:kind==='mouth'&&resolved.route.kind==='static'?nativeMouthState(resolved.route.doc,s.emotion,o.sprite.assets):animationState(resolved.route,kind,o.sprite.assets),routing:resolved.routing,route:resolved.route.kind}
      if(kind==='mouth'&&resolved.route.kind==='layered'&&source.mouth?.atlas) {
        source.atlasPath='sources/mouth-atlas/'+source.mouth.atlas.src+'.png'
        copies.set(source.atlasPath,await read(source.mouth.atlas.src))
      }
      ;(p[field]||={})[id]=source;copies.set(file,resolved.bytes);sources.push(source)
      for(const frame of kind==='mouth'?['closed','small','mid','open']:[null]) {
        const key=[s.character,s.outfit,kind,s.emotion,frame].filter(Boolean).join('/'),previous=p.slots[key]
        if(previous){check(old,'Existing animation lacks a source snapshot: '+key);previous.version++;previous.stale=true;for(const k of ['accepted','acceptedVersion','acceptedBy','approved'])delete previous[k];rebound.push(key)}
        else {p.slots[key]={id:key,character:s.character,outfit:s.outfit,kind,emotion:s.emotion,...(frame?{frame}:{}),version:0};added.push({slot:key,expected_version:0})}
        p.slots[key].sourceBinding={slot:id,version,hash:resolved.hash}
      }
    }
    check(JSON.parse(await readFile(await safeProjectFile(library,'local/'+p.id+'.json'))).revision===expectedRevision,'Installed revision changed during declaration')
    if(!dryRun)for(const [file,bytes]of copies)await atomic(root,file,bytes)
    return {kind,semantics:'source-bound',added,rebound,sources,dryRun}
  }
  return dryRun?action(await loadProject(root)):transaction(root,action)
}
