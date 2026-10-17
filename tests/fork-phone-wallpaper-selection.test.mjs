import test from 'node:test'
import assert from 'node:assert/strict'
import {selectPhoneWallpaperRequest} from '../tavern-plugin/lib/domain/mods/phone-selection.js'
import {widgetChatFixture} from './fixtures/widget-variable-chat.mjs'
import {initialAssetPackStage} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'

test('phone picker uses native journal CAS, retains source/event identities and rejects stale or unavailable writes',async t=>{
  const h=await widgetChatFixture(t),ref={modId:'dsh.phone',packId:'wallpapers',kind:'wallpaper',entryId:'blue'},choice={id:JSON.stringify(Object.values(ref)),ref,name:'Blue',image:'media/blue.png'}
  const greenRef={...ref,entryId:'green'},green={...choice,id:JSON.stringify(Object.values(greenRef)),ref:greenRef,name:'Green',image:'media/green.png'},choices=[choice,green]
  const state=initialAssetPackStage({}),record={format:state.format,complete:true,binding:{target:{turn:1},mods:{commands:[{modId:'dsh.phone',commandId:'wallpaper',admission:{state:{parameter:'choice',choices:choices.map(row=>({value:row.id,patch:{wallpaper:row.ref}}))}}}]}},baseline:state,entries:[],end:state,diagnostics:[],digest:'a'.repeat(64)}
  await h.mutate(chat=>{chat.messages[0].stageDirectionAssetPacks=record})
  const direction=chat=>({record:chat.messages[0].stageDirectionAssetPacks,through:1,token:{sourceKey:'native-source',bindingKey:'binding',generation:1,digest:chat.messages[0].stageDirectionAssetPacks.digest}})
  let writes=0,published=0,available=true,busy=false,revision=1,beforeWrite
  const deps={readChat:()=>h.db.read('fixture'),readDirection:async chat=>direction(chat),readAuthority:async()=>({revision}),busy:()=>busy,
    readPresentation:async({direction})=>[{modSource:true,wallpaperChoices:available?choices:[],wallpaperSelection:choices.find(row=>row.ref.entryId===direction.record.end.modState?.['dsh.phone']?.wallpaper?.entryId)?.id || ''}],
    patch:async(...args)=>{await beforeWrite?.();writes++;return h.db.patch(...args)},publish:()=>published++}
  const chat=await h.db.read('fixture'),input={sessionId:'fixture',turn:1,at:1,expectedDirectionToken:direction(chat).token,choice:choice.id}
  const result=await selectPhoneWallpaperRequest(input,deps)
  assert.equal(result.widgets[0].wallpaperSelection,choice.id)
  assert.equal(writes,1);assert.equal(published,1)
  const saved=await h.db.read('fixture')
  assert.deepEqual(saved.messages[0].stageDirectionAssetPacks.end.modState,{'dsh.phone':{wallpaper:ref}})
  assert.deepEqual(saved.messages[0].text,chat.messages[0].text)
  assert.deepEqual(saved.timeline,chat.timeline)
  assert.deepEqual(saved.updatedAt,chat.updatedAt)
  assert.equal(h.dispatches(),0)
  await assert.rejects(selectPhoneWallpaperRequest(input,deps),{code:'REVISION_CONFLICT'})
  let current={...input,expectedDirectionToken:direction(saved).token}
  assert.equal((await selectPhoneWallpaperRequest(current,deps)).status,'ready')
  assert.equal(writes,1,'An unchanged selection is a zero-write operation')
  const second=await selectPhoneWallpaperRequest({...current,choice:green.id,expectedDirectionToken:result.token},deps)
  assert.equal(second.widgets[0].wallpaperSelection,green.id)
  current={...current,choice:green.id,expectedDirectionToken:second.token}
  assert.equal((await h.db.read('fixture')).messages[0].stageDirectionAssetPacks.entries.length,1,'Selections replace only the previous user increment')
  assert.equal(writes,2);assert.equal(published,2)
  available=false
  await assert.rejects(selectPhoneWallpaperRequest(current,deps),{code:'MOD_PERMISSION_DENIED'})
  available=true;busy=true
  await assert.rejects(selectPhoneWallpaperRequest(current,deps),{code:'REVISION_CONFLICT'})
  busy=false
  await assert.rejects(selectPhoneWallpaperRequest({...current,cardId:'other'},deps),{code:'ARG_INVALID'})
  // A race after the domain recheck is still rejected by the actual native owner CAS.
  await h.mutate(chat=>{chat.messages[0].stageDirectionAssetPacks=record})
  beforeWrite=()=>h.mutate(chat=>{chat.title='Independent edit'})
  await assert.rejects(selectPhoneWallpaperRequest(input,deps))
  const final=await h.db.read('fixture')
  assert.equal(final.messages[0].stageDirectionAssetPacks.end.modState,undefined)
  assert.equal(final.title,'Independent edit')
  assert.equal(published,2)
})
