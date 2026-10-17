// Adopt installed state, not candidate approval or an invented authoring version.
import {readFile} from 'node:fs/promises'
import {loadProject,transaction,atomic,safeProjectFile,productionError,mouthSourceStale} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {canonicalJson} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {readNativeSnapshot} from './baseline.mjs'
import {readImageInstall} from './image-install-state.mjs'
import {selectAnimations} from './animation-selection.mjs'
import {animationSource,animationState,animationCheck as check} from './animation-routing.mjs'
const same=(a,b)=>canonicalJson(a??null)===canonicalJson(b??null)
export async function adoptInstalledBlink(root,o) {
  const expected=JSON.parse(await readFile(o.expectedState,'utf8'))
  if(!o.reviewer?.trim())throw productionError('INVALID_ARGUMENT','Adoption requires --reviewer NAME')
  const action=async p=>{
    const {selection}=selectAnimations(p,{slots:o.slots,scope:'animation'})
    check(selection?.every(id=>p.slots[id].kind==='blink'),'Select explicit blink slots only')
    check(same(Object.keys(expected).sort(),selection),'Expected state must contain exactly the selected blink slot keys')
    const native=await readNativeSnapshot(o.library,p.id)
    check(native.revision===o.expectedRevision,'Installed revision changed; refresh before adoption')
    const state=await readImageInstall(root,p),adopted=[],receipts={}
    for(const id of selection) {
      const slot=p.slots[id],sourceId=[slot.character,slot.outfit,'sprite',slot.emotion].join('/'),base=p.slots[sourceId],source=p.blinkSources?.[sourceId]
      check(base?.kind==='sprite'&&source&&source.slot===sourceId,'Missing declared blink source: '+id)
      const binding={slot:sourceId,version:source.version,hash:source.hash}
      check(same(slot.sourceBinding,binding)&&!slot.stale&&!mouthSourceStale(p,slot),'Blink source binding changed: '+id)
      const character=p.characters.find(c=>c.key===base.character),outfit=native.figures[character?.id]?.outfits.find(x=>x.key===base.outfit)
      check(outfit?.sprite&&!outfit.fallbackEmotions?.includes(base.emotion),'Explicit installed source required: '+id)
      const read=async digest=>{const blob=native.manifest.blobs[digest];check(blob,'Missing installed media: '+digest);return readFile(await safeProjectFile(o.library,'packs/'+p.id+'/media/'+digest+'.'+blob.ext))}
      const current=await animationSource(native.sprites[outfit.sprite.manifestKey],base.emotion,outfit.sprite.assets,read)
      check(current.hash===source.hash&&current.routing===source.routing&&current.route.kind===source.route,'Installed source identity/routing changed: '+id)
      const blink=animationState(current.route,'blink',outfit.sprite.assets)
      check(blink&&same(blink,expected[id]),'Installed blink differs from expected state: '+id)
      const record={source:binding,blink},tracked=state.blinks?.[id],prior=state.blinkAdoptions?.[id]
      check(!tracked||same(tracked,record),'Cannot overwrite a different tracked blink: '+id)
      check(!prior||same(prior.record,record)&&prior.routing===source.routing,'Adoption evidence changed: '+id)
      const receipt=prior??{slot:id,record,routing:source.routing,reviewer:o.reviewer.trim(),adoptedAt:new Date().toISOString(),revision:native.revision}
      receipts[id]=receipt
      if(!tracked||!prior){(state.blinks||={})[id]=record;(state.blinkAdoptions||={})[id]=receipt;adopted.push(id)}
    }
    check(JSON.parse(await readFile(await safeProjectFile(o.library,'local/'+p.id+'.json'),'utf8')).revision===o.expectedRevision,'Installed revision changed during adoption')
    // One tracking write includes every selected base and its provenance; project.json stays untouched.
    if(!o.dryRun&&adopted.length)await atomic(root,'sources/image-install.json',Buffer.from(JSON.stringify(state,null,2)+'\n'))
    return {status:adopted.length?'adopted':'noop',dryRun:Boolean(o.dryRun),revision:native.revision,adopted,receipts}
  }
  return o.dryRun?action(await loadProject(root)):transaction(root,action)
}
