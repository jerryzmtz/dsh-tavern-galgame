// private fork: native deletion is one CAS across declarations, renderers, bindings and resource closure.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {syntheticPack,png,PACK_ID,FIGURE_ID,OTHER_FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {sealPack,jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {createRequire} from 'node:module'
const publication=createRequire(import.meta.url)('../tavern-plugin/shared/asset-image-publication.cjs') // private fork (avatar-actions)
async function fixture(t,{shared=false,last=false}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'sprite-delete-')),pack=await syntheticPack(),figure=pack.figures[FIGURE_ID]
 // private fork: fixtures keep their declarations and explicitly enable the new row.
 figure.emotions.push({id:'proud',label:'得意'})
 const bytes=png([100,110,120]),hash=createHash('sha256').update(bytes).digest('hex')
 pack.manifest.blobs[hash]={ext:'png',mime:'image/png',size:bytes.length};pack.files.set('media/'+hash+'.png',bytes)
 figure.outfits[0].sprite.assets['assets/stage-special.png']=hash
 figure.outfits[0].sprite.assets['assets/special-atlas.png']=hash
 const school=pack.sprites.school;school.emotions.proud=school.emotions.crying;delete school.emotions.crying
 figure.outfits[0].avatars.proud=figure.outfits[0].avatars.crying;delete figure.outfits[0].avatars.crying
 figure.outfits[0].sprite.avatarCrop={proud:{x:0,y:0,w:1,h:1}}
 figure.outfits[1].live2d.emotionMap.proud={expression:'smile'}
 figure.voice.emotionVariants={proud:'normal'}
 if(last){pack.sprites.casual.emotions.proud=pack.sprites.casual.emotions.calm;delete pack.sprites.casual.emotions.calm}
 if(shared){pack.figures[OTHER_FIGURE_ID]={...structuredClone(figure),id:OTHER_FIGURE_ID,name:'Other'};pack.manifest.figures.push(OTHER_FIGURE_ID)}
 for(const [id,value]of Object.entries(pack.figures))pack.files.set('figures/'+id+'.json',jsonBytes(value))
 for(const [key,value]of Object.entries(pack.sprites))pack.files.set(pack.manifest.sprites[key],jsonBytes(value))
 await sealPack(pack.manifest,pack.files)
 const zip=path.join(root,'pack.zip');await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
 const service=createAssetPackService({assetRoot:path.join(root,'assets')});t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true})})
 const inspect=await service.inspectImport({bytes:await readFile(zip)});const {snapshot}=await service.applyImport({inspectionId:inspect.inspectionId,expectedRevision:null,decision:'install'})
 return {service,before:snapshot,input:{packId:PACK_ID,figureId:FIGURE_ID,emotionId:'proud',expectedRevision:snapshot.revision}}
}
test('custom deletion retires private body/atlas assets, bindings and measurements without touching shared media',async t=>{
 const {service,before,input}=await fixture(t),original=before.figures[FIGURE_ID],retired=original.outfits[0].sprite.assets['assets/stage-special.png']
 const {snapshot:next}=await service.removeFigureEmotion(input),figure=next.figures[FIGURE_ID]
 // private fork: deleting one ordinary declaration preserves all the others.
 assert.deepEqual(figure.emotions,original.emotions.filter(e=>e.id!=='proud'));assert.equal(figure.outfits[0].avatars.proud,undefined);assert.equal(figure.outfits[0].sprite.avatarCrop?.proud,undefined)
 assert.equal(figure.outfits[1].live2d.emotionMap.proud,undefined);assert.equal(figure.voice.emotionVariants.proud,undefined)
 assert.equal(next.sprites.school.emotions.proud,undefined);assert.equal(next.sprites.school.mouthSets,undefined);assert.ok(next.sprites.school.mouthAtlas)
 assert.equal(next.manifest.blobs[retired],undefined);assert.ok(next.manifest.blobs[original.outfits[0].avatars.calm])
 assert.equal(next.figures[FIGURE_ID].outfits.length,original.outfits.length)
 await assert.rejects(service.removeFigureEmotion(input),{code:'REVISION_CONFLICT'})
 assert.equal((await service.getPackSnapshot({packId:PACK_ID})).revision,next.revision)
})
test('shared renderer is copied only for the edited figure; other users and their image bytes survive',async t=>{
 const {service,before,input}=await fixture(t,{shared:true}),{snapshot:next}=await service.removeFigureEmotion(input)
 assert.deepEqual(next.figures[OTHER_FIGURE_ID],before.figures[OTHER_FIGURE_ID]);assert.deepEqual(next.sprites.school,before.sprites.school)
 const key=next.figures[FIGURE_ID].outfits[0].sprite.manifestKey;assert.notEqual(key,'school');assert.equal(next.sprites[key].emotions.proud,undefined)
 assert.ok(next.manifest.blobs[before.figures[FIGURE_ID].outfits[0].sprite.assets['assets/stage-special.png']])
})
test('last picture removes the sprite binding, not the outfit; unknown IDs are rejected atomically',async t=>{
 const {service,before,input}=await fixture(t,{last:true})
 // private fork: former builtin IDs are ordinary, so only unknown IDs reject.
 await assert.rejects(service.removeFigureEmotion({...input,emotionId:'missing'}),{code:'ASSET_UNAVAILABLE'})
 assert.deepEqual(await service.getPackSnapshot({packId:PACK_ID}),before)
 const {snapshot:next}=await service.removeFigureEmotion(input)
 assert.equal(next.figures[FIGURE_ID].outfits[1].sprite,undefined);assert.equal(next.manifest.sprites.casual,undefined);assert.equal(next.figures[FIGURE_ID].outfits.length,2)
})
// private fork (avatar-actions, owner 2026-10): the editor's 「删除这张立绘…」 on a talking 差分 (own mouth set, portrait) — only
// that outfit's picture goes, with its unused mouth set and media; the 差分, its avatar and every other state stay.
test('deleting one talking 立绘 keeps the 差分 and its avatar, and passes the pack closure',async t=>{
 const {service,before}=await fixture(t),figure=before.figures[FIGURE_ID],outfit=figure.outfits[0],retired=outfit.sprite.assets['assets/stage-special.png']
 const {removeSpriteEmotion}=publication.create({emotionState:()=>null,newResourceKey:p=>p+'-x'})
 const made=removeSpriteEmotion(outfit,before.sprites.school,'proud');assert.ok(made?.manifest)
 assert.equal(removeSpriteEmotion(outfit,before.sprites.school,'nothing'),null)
 const files=new Map([[before.manifest.sprites.school,jsonBytes(made.manifest)],['figures/'+FIGURE_ID+'.json',jsonBytes({...figure,outfits:figure.outfits.map(o=>o.key===outfit.key?made.outfit:o)})]])
 const {snapshot:next}=await service.patchPack({packId:PACK_ID,expectedRevision:before.revision,patch:{},fileUpdates:files}),after=next.figures[FIGURE_ID]
 assert.equal(next.sprites.school.emotions.proud,undefined);assert.equal(next.sprites.school.mouthSets,undefined);assert.ok(next.sprites.school.mouthAtlas)
 assert.deepEqual(Object.keys(next.sprites.school.emotions),Object.keys(before.sprites.school.emotions).filter(id=>id!=='proud'))
 assert.ok(after.emotions.some(e=>e.id==='proud'),'the 差分 stays');assert.equal(after.outfits[0].avatars.proud,figure.outfits[0].avatars.proud,'its avatar stays')
 assert.equal(after.outfits[0].sprite.avatarCrop,undefined);assert.equal(next.manifest.blobs[retired],undefined)
})
