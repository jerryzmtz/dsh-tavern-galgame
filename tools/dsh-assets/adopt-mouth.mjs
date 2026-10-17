// Adopt only a proven historical publish; candidate approvals and native data stay untouched.
import {readFile} from 'node:fs/promises'
import {loadProject,transaction,atomic,safeProjectFile,productionError,slotAccepted,createProjectImageReader} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {canonicalJson} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {readNativeSnapshot} from './baseline.mjs'
import {readImageInstall} from './image-install-state.mjs'
import {nativeMouthState,staticMouthDocument,mouthFrames} from './images-mouth.mjs'
const check=(v,m)=>{if(!v)throw productionError('CONFLICT',m)}
const same=(a,b)=>canonicalJson(a??null)===canonicalJson(b??null)
export async function adoptInstalledMouth(root,o) {
  const expected=JSON.parse(await readFile(o.expectedState,'utf8'))
  const action=async p=>{
    const base=p.slots[o.slot],bound=p.mouthSources?.[o.slot]
    check(base?.kind==='sprite','Select one source sprite slot')
    const historical=await loadProject(o.sourceRoot),history=await readImageInstall(o.sourceRoot,historical)
    check(historical.id===p.id,'Foreign historical project')
    const evidence=history.mouths?.[o.slot],source=bound??{slot:o.slot,version:base.version,hash:base.artifact?.hash}
    check(evidence&&same(evidence.source,{slot:o.slot,version:source.version,hash:source.hash}),'Historical source binding differs')
    check(expected&&same(evidence.mouth,expected),'Expected installed state differs from historical receipt')
    const native=await readNativeSnapshot(o.library,p.id)
    check(native.revision===o.expectedRevision,'Installed revision changed; refresh before adoption')
    const character=p.characters.find(c=>c.key===base.character),outfit=native.figures[character?.id]?.outfits.find(x=>x.key===base.outfit)
    const doc=staticMouthDocument(native.sprites[outfit?.sprite?.manifestKey],base.emotion)
    check(doc&&outfit.sprite.assets[doc.emotions[base.emotion].src]===source.hash,'Installed source sprite changed')
    check(same(nativeMouthState(doc,base.emotion,outfit.sprite.assets),expected),'Installed mouth differs from expected state')
    const readImage=createProjectImageReader(o.sourceRoot),records={}
    for(const frame of mouthFrames) {
      const id=[base.character,base.outfit,'mouth',base.emotion,frame].join('/'),old=historical.slots[id],record=history.slots[id]
      check(p.slots[id]?.kind==='mouth'&&old&&slotAccepted(old)&&!old.stale,'Historical mouth must be accepted: '+id)
      check(record&&record.revision===o.historicalRevision&&record.version===old.version&&record.hash===old.artifact?.hash&&record.hash===expected.set.frames[frame],'Historical install revision/version/hash differs: '+id)
      const historicalBase=historical.mouthSources?.[o.slot]??historical.slots[o.slot]?.artifact
      check(old.artifact.baseHash===source.hash&&historicalBase?.hash===source.hash&&(old.sourceBinding?same(old.sourceBinding,evidence.source):historical.slots[o.slot]?.version===source.version),'Historical frame source differs: '+id)
      await readImage(old.artifact)
      records[id]=record
    }
    const state=await readImageInstall(root,p),prior=state.mouthAdoptions?.[o.slot]
    check(!state.mouths?.[o.slot]||prior&&same(state.mouths[o.slot],evidence),'Cannot overwrite a tracked mouth base')
    for(const [id,record]of Object.entries(records))check(!state.slots[id]||same(state.slots[id],record),'Cannot overwrite tracked mouth slot: '+id)
    const receipt={id:p.id,slot:o.slot,historicalRevision:o.historicalRevision,source:evidence.source,mouth:expected,slots:records,revision:native.revision,contentHash:native.manifest.contentHash}
    if(prior)check(same(prior.source,receipt.source)&&same(prior.mouth,receipt.mouth)&&same(prior.slots,records)&&prior.historicalRevision===o.historicalRevision,'Adoption evidence changed')
    check(JSON.parse(await readFile(await safeProjectFile(o.library,'local/'+p.id+'.json'),'utf8')).revision===o.expectedRevision,'Installed revision changed during adoption')
    if(!o.dryRun&&!prior) {
      Object.assign(state.slots,records);(state.mouths||={})[o.slot]=evidence
      ;(state.mouthAdoptions||={})[o.slot]=receipt
      // Tracking and its exact receipt are a single atomic write, so interrupted replay is safe.
      await atomic(root,'sources/image-install.json',Buffer.from(JSON.stringify(state,null,2)+'\n'))
    }
    return {status:prior?'noop':'adopted',dryRun:Boolean(o.dryRun),receipt:prior??receipt}
  }
  return o.dryRun?action(await loadProject(root)):transaction(root,action)
}
