// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,stat} from 'node:fs/promises'
import {validateModManifest} from '../tavern-plugin/lib/domain/mods/manifest.js'
import {modCatalogue} from '../tavern-plugin/lib/domain/mods/catalogue.js'
import {compileModPrompts} from '../tavern-plugin/lib/domain/mods/prompts.js'
import {configure,command} from '../fork/mods/phone/runtime.js'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {activeWidgetKeys} from '../tavern-plugin/lib/domain/widget-availability.js'
import {selectPhoneWallpaper,selectPhoneWallpaperRequest} from '../tavern-plugin/lib/domain/mods/phone-selection.js'
import {phoneSourceView,phoneViewDocument,phoneWallpaperSet,withPhoneWallpaperSet} from '../tavern-plugin/lib/domain/mods/phone-presentation.js'
import {forkWidgetThread} from '../tavern-plugin/src/client/fork-widget-thread.cjs'
import directorCommands from '../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'
import {prepareAssetPackDirector,buildAssetPackRequest,createAssetPackTransaction,readAssetPackRecord,assetPackStateAt} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {syntheticPack,cardExtension,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {modelHandle} from './helpers/director-model-call.mjs'
import {wallpaperChoices,selectWallpaper,projectWallpaper} from '../fork/mods/phone/logic.js'
const root=new URL('../fork/mods/phone/',import.meta.url)
const manifest=validateModManifest(JSON.parse(await readFile(new URL('manifest.json',root),'utf8')))
const files=['files/11111111-1111-4111-8111-111111111111.png','files/22222222-2222-4222-8222-222222222222.png'];
function fixture() {
  const catalogue=withPhoneWallpaperSet(modCatalogue(manifest,[],[],''),phoneWallpaperSet(files.map((file,i)=>({file,name:['Blue paper','Garden paper'][i]})),'global'));
  return {catalogue};
}

test('phone release owns device/SE and only UI-managed wallpapers, with no library or wallpaper grammar',async()=>{
  for(const file of manifest.files)assert.equal((await stat(new URL(file.path,root))).size,file.size,file.path);
  assert.deepEqual(manifest.assetKinds,[]);assert.deepEqual(manifest.defaultPacks,[]);assert.deepEqual(manifest.commands.map(row=>row.id),['mark']);
  const {catalogue}=fixture();assert.deepEqual(catalogue.packs,[]);assert.deepEqual(catalogue.recalled,[]);
  const commands=configure({manifest,catalogue}).commands.map(row=>({...row,modId:manifest.id}));
  assert.deepEqual(commands.map(row=>row.id),['mark']);
  const prompt=await readFile(new URL('prompts/phone.txt',root),'utf8');
  assert.doesNotMatch(compileModPrompts([manifest],()=>prompt,'director',commands).map(row=>row.text).join('\n'),/wallpaper|壁纸/);
  assert.ok(manifest.settingsSchema.fields.every(field=>field.scope==='global' && !field.bindable));
  await assert.rejects(command({commandId:'wallpaper',params:{choice:'anything'}},{},{}),{code:'MOD_API_UNSUPPORTED'});
});

test('phone choices follow its own collection; removal hides without mutating saved wallpaper',()=>{
  const {catalogue}=fixture(),choices=wallpaperChoices(catalogue),state={wallpaper:selectWallpaper(catalogue,choices[1].id)},saved=structuredClone(state);
  assert.equal(projectWallpaper(catalogue,state).id,choices[1].id);
  assert.throws(()=>selectWallpaper(catalogue,'unlisted'),{code:'MOD_PERMISSION_DENIED'});
  assert.equal(projectWallpaper(modCatalogue(manifest,[],[],''),state),null);
  assert.deepEqual(state,saved);assert.equal(projectWallpaper(catalogue,state).name,'Garden paper');
});

test('phone runtime acknowledges canonical marks without reading director-sealed source',async()=>{
  const catalogue=fixture().catalogue,calls=[]
  const host={library:{snapshot:async()=>catalogue},source:{window:()=>assert.fail('No sealed source enters a mod')},stage:{place:async value=>calls.push(value)}}
  const marker={contact:'actor_guest',side:'in',form:'voice'}
  await command({commandId:'mark',params:marker},host,{command:{at:7}})
  assert.deepEqual(calls[0].payload.marker,{op:'phone.message',...marker})
  assert.equal(calls.length,1)
})

test('built-in phone works without a pack binding and has no recall gate',()=>{
  const catalogue=modCatalogue(manifest,[],[],'');assert.ok(phoneSourceView(catalogue).device);
  assert.deepEqual(configure({manifest,catalogue}).commands.map(row=>row.id),['mark']);assert.deepEqual(wallpaperChoices(catalogue),[]);
});

test('director admits dialogue and narrated phone marks before sealing; rejects wrong direction and duplicate marks',async()=>{
  const pack=await syntheticPack()
  pack.figures[FIGURE_ID].name='Guest name'
  const commands=configure({manifest,catalogue:fixture().catalogue}).commands.map(row=>({...row,modId:manifest.id}))
  const prepared=prepareAssetPackDirector({snapshots:[{...pack,revision:'r1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'c1',engine:{widgetsEnabled:false},target:{sourceKey:'source',branchId:'branch',revision:1,turn:1},
    units:[{kind:'line',alias:'Speaker',text:'Original message.'},'Narration only.'],mods:{revision:'1',commands}})
  const canonical=prepared.context.phone.characters[0].alias
  assert.notEqual(canonical,'Guest name')
  const transaction=()=>createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
  const mark={op:'mod.dsh.phone.mark',contact:'Guest name',side:'in',form:'voice'}
  const submit=(tx,ops,at=1)=>tx.submit({sequence:1,through:2,done:true,beats:[{at,ops}]})
  for(const [op,at] of [[{...mark,side:'out'},1],[{...mark,contact:'Invented'},1],[{...mark,contact:'Invented'},2]]) {
    const tx=transaction(),result=submit(tx,[op],at)
    assert.equal(result.ok,false)
    assert.equal(tx.savepoint().state.entries.length,0,'Invalid source never reaches the sealed record')
  }
  for(const side of ['in','out']) {
    const tx=transaction(),result=submit(tx,[{...mark,side}],2)
    assert.equal(result.ok,true,JSON.stringify(result.errors))
    assert.deepEqual(tx.effect().entries[0].ops,[{op:'mod.command',modId:manifest.id,commandId:'mark',params:{contact:canonical,side,form:'voice'}}])
    assert.doesNotMatch(JSON.stringify(tx.effect().entries),/Narration only/,'Narration remains source-owned, not copied into the receipt')
  }
  for (const form of [undefined,'audio']) {
    const op={...mark};if(form===undefined)delete op.form;else op.form=form;
    const result=submit(transaction(),[op]);
    assert.equal(result.ok,false,'New commands require an explicit supported form');
    assert.match(JSON.stringify(result.errors),/form/,'Native errors identify the repairable field');
  }
  const tx=transaction(),result=submit(tx,[mark,mark])
  assert.equal(result.accepted,1)
  assert.equal(result.errors.length,1)
  assert.match(result.errors[0].message,/One source marker/)
  tx.finish()
  const saved=tx.effect()
  assert.deepEqual(saved.entries[0].ops,[{op:'mod.command',modId:manifest.id,commandId:'mark',params:{contact:canonical,side:'in',form:'voice'}}])
  assert.doesNotMatch(JSON.stringify(saved.entries),/Original message/)
  assert.deepEqual(readAssetPackRecord(saved).entries,saved.entries)
  const handle=modelHandle(tx.request,canonical)
  assert.notEqual(handle,canonical)
  for(const op of [{...mark,contact:handle},`phone-mark mark contact=${JSON.stringify(handle)} side=in form=voice`]) {
    const wire=transaction(),result=wire.submitModel({sequence:1,through:2,done:true,beats:[{at:1,ops:[op]}]})
    assert.equal(result.ok,true,JSON.stringify(result.errors))
    assert.deepEqual(wire.effect().entries[0].ops,saved.entries[0].ops,'JSON and DSL resolve the same advertised actor handle')
  }
})
test('phone peers without figures resolve from source and both owner-relative sides reach the same thread',async t=>{
  const pack=await syntheticPack(),source=await readFile(new URL('prompts/phone.txt',root),'utf8')
  const commands=configure({manifest,catalogue:fixture().catalogue}).commands.map(row=>({...row,modId:manifest.id}))
  const units=[{kind:'line',alias:'Speaker',name:'Synthetic figure',text:'请帮我检查。'},
    {kind:'line',alias:'qianwen',name:'千问',text:'好的，请发给我。'},
    {kind:'narration',text:'她又给千问发了一条消息。'}]
  const base={snapshots:[{...pack,revision:'r1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'c1',engine:{widgetsEnabled:false},
    target:{sourceKey:'source',branchId:'branch',revision:1,turn:1},units}
  const prepare=active=>prepareAssetPackDirector({...base,mods:{revision:'1',commands:active?commands:[],schemaCommands:commands},
    modPrompts:compileModPrompts([manifest],()=>source,'director',active?commands:[])})
  const prepared=prepare(true),tx=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
  const request=buildAssetPackRequest(prepared,true,undefined,'',true),off=buildAssetPackRequest(prepare(false),true,undefined,'',true)
  const contacts=JSON.parse(request.sections.find(row=>row.key==='contacts').text)
  const peer=contacts.find(row=>row.name==='千问')
  assert.ok(peer);assert.notEqual(peer.id,'qianwen');assert.notEqual(peer.id,'千问')
  assert.equal(prepared.context.phone.characters.filter(row=>row.name==='Synthetic figure').length,1,'Existing aliases use the single figure resolver')
  assert.equal(prepared.context.actors.qianwen,undefined,'A phone peer is not a stage actor')
  assert.deepEqual(request.tools,off.tools,'Installed mod syntax stays frozen across relevance changes')
  assert.equal(off.sections.some(row=>row.key==='contacts' || row.key.startsWith('mod.dsh.phone.')),false)
  assert.doesNotMatch(JSON.stringify(off),/先确定故事中谁在用手机/)
  assert.match(source,/owner.*other party/);assert.match(source,/Mark both sides' paragraphs/)
  const result=tx.submitModel({sequence:1,through:3,done:true,beats:units.map((_,i)=>({at:i+1,ops:[{op:'mod.dsh.phone.mark',contact:peer.id,side:i===1?'in':'out',form:'text'}]}))})
  assert.equal(result.ok,true,JSON.stringify(result.errors))
  const record={...tx.effect(),phase:'done',through:3,token:{bindingKey:'binding',generation:0}}
  const pages=units.map((unit,i)=>({...unit,para:i+1})),ref=phoneSourceView(fixture().catalogue).device
  const thread=forkWidgetThread({rows:[{turn:1,sourceKey:'source',record,pages}],ref,cursor:{turn:1,page:2,para:3},visibleText:'她又给千问',revealed:false})
  assert.deepEqual(thread.messages.map(row=>[row.contact,row.side]),[['qianwen','out'],['qianwen','in'],['qianwen','out']])
  assert.equal(thread.messages[1].name,'千问');assert.equal(thread.messages[2].text,'她又给千问')
  const native=[]
  await command({commandId:'mark',params:record.entries.find(row=>row.at===2).ops[0].params},
    {library:{snapshot:async()=>fixture().catalogue},source:{window:async()=>({unit:units[1],characters:prepared.context.phone.characters})},stage:{place:async row=>native.push(row)}},{command:{at:2}})
  assert.equal(native[0].payload.marker.contact,'qianwen')
  t.diagnostic(JSON.stringify({phonePromptBytes:Buffer.byteLength(source),toolSchemaBytes:Buffer.byteLength(JSON.stringify(request.tools[0].parameters)),sections:request.sections.filter(row=>row.key==='contacts' || row.key.startsWith('mod.dsh.phone.')).map(({key,bytes})=>({key,bytes}))}))
})
test('UI wallpaper writes a same-source state-only tail and carries across disabled turns without replay',async()=>{
  const {catalogue}=fixture(),choices=wallpaperChoices(catalogue),pack=await syntheticPack();
  const commands=configure({manifest,catalogue}).commands.map(row=>({...row,modId:manifest.id}));
  const base={snapshots:[{...pack,revision:'r1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'c1',engine:{widgetsEnabled:false},target:{sourceKey:'picker',branchId:'branch',revision:1,turn:1},units:['A garden.'],mods:{revision:'1',commands}};
  const prepared=prepareAssetPackDirector(base),tx=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding});
  assert.equal(tx.submit({sequence:1,through:1,done:true,beats:[]}).ok,true);
  const original=tx.effect(),saved=structuredClone(original),selected=selectPhoneWallpaper(original,choices,choices[0].id,1,1);
  assert.deepEqual(selected.entries.slice(0,-1),original.entries);assert.deepEqual(selected.entries.at(-1).ops,[]);
  assert.deepEqual(selected.binding,original.binding);assert.deepEqual(selected.baseline,original.baseline);
  assert.deepEqual(assetPackStateAt(selected,1).modState[manifest.id].wallpaper,choices[0].ref);
  assert.deepEqual(readAssetPackRecord(selected),selected);assert.deepEqual(original,saved);
  assert.equal(selectPhoneWallpaper(selected,choices,choices[0].id,1,1),null);
  const changed=selectPhoneWallpaper(selected,choices,choices[1].id,1,1);assert.equal(changed.entries.length,selected.entries.length);
  const next=prepareAssetPackDirector({...base,record:changed,target:{...base.target,turn:2,sourceKey:'next'},mods:{revision:'2',commands:[]}});
  const carry=createAssetPackTransaction({prepared:next,getCurrentBinding:()=>next.binding});
  assert.equal(carry.submit({sequence:1,through:1,done:true,beats:[]}).ok,true);
  assert.deepEqual(carry.effect().end.modState[manifest.id].wallpaper,choices[1].ref);
  assert.throws(()=>selectPhoneWallpaper(changed,[],choices[1].id,1,1),{code:'MOD_PERMISSION_DENIED'});
});

test('wallpaper request uses the existing chat CAS and rejects changed source/authority without retry',async()=>{
  const {catalogue}=fixture(),choices=wallpaperChoices(catalogue),token={generation:0};
  const chat={id:'chat',_storageRevision:'r1',timeline:{branchId:'b'},messages:[{role:'assistant',turn:1}]};
  const record={binding:{},baseline:{},end:{},entries:[]};let writes=0,authority=1,current=chat;
  const deps={readChat:async()=>current,busy:()=>false,readDirection:async()=>({record,token,through:1}),readAuthority:async()=>({revision:authority}),readPresentation:async()=>[{wallpaperChoices:choices}],publish:()=>{},patch:async(id,revision,ops)=>{writes++;assert.equal(id,'chat');assert.equal(revision,'r1');assert.deepEqual(ops[0].value.entries.at(-1).ops,[]);return true}};
  const args={sessionId:'s',turn:1,at:1,expectedDirectionToken:token,choice:choices[0].id};
  assert.equal((await selectPhoneWallpaperRequest(args,deps)).status,'ready');assert.equal(writes,1);
  await assert.rejects(selectPhoneWallpaperRequest({...args,expectedDirectionToken:{generation:1}},deps),{code:'REVISION_CONFLICT'});
  const changed={...deps,readPresentation:async()=>{authority++;return [{wallpaperChoices:choices}]}};
  await assert.rejects(selectPhoneWallpaperRequest(args,changed),{code:'REVISION_CONFLICT'});assert.equal(writes,1);
  current={...chat,messages:[{role:'assistant',turn:2}]};await assert.rejects(selectPhoneWallpaperRequest(args,deps),{code:'REVISION_CONFLICT'});
});

test('phone mod is registered once; retired phone widgets never enter the native executable catalogue',async()=>{
  const builtins=await createFirstPartyMods()
  assert.equal(builtins.catalogue().filter(row=>row.id==='dsh.phone').length,1)
  const pack={manifest:{id:'pack',assets:[{id:'phone',kind:'widgets',enabled:true},{id:'other',kind:'widgets',enabled:true}]},widgets:{phone:{namespace:'phone'},other:{namespace:'other'}}}
  const keys=activeWidgetKeys({packs:[pack],boundPackIds:['pack'],allowedPackIds:['pack'],widgetsEnabled:true})
  assert.equal(keys.has(JSON.stringify(['pack','widgets','phone'])),false)
  assert.equal(keys.has(JSON.stringify(['pack','widgets','other'])),true)
})
test('mod source thread reads only sealed canonical marks, shares the source cursor and rejects legacy phone ops',()=>{
  const ref=phoneSourceView(fixture().catalogue).device
  const pages=[{kind:'line',para:1,alias:'Speaker',text:'Already revealed'},{kind:'line',para:2,alias:'Speaker',text:'Future'}]
  const record={phase:'done',through:2,token:{bindingKey:'bound',generation:1},entries:[
    {at:1,ops:[{op:'widget.source',ref:{packId:'old',kind:'widgets',assetId:'phone'},contact:'Wrong',side:'in'},
      {op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'Canonical',side:'in'}}]},
    {at:2,ops:[{op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'Canonical',side:'in'}}]}]}
  const input={rows:[{turn:1,sourceKey:'source',pages,record}],ref,cursor:{turn:1,page:0,para:1},visibleText:'Already',revealed:false}
  const binding={commandSpecVersion:directorCommands.version,mods:{commands:[{modId:'dsh.phone',commandId:'mark'}]}}
  const mark=record.entries[0].ops[1]
  assert.deepEqual(directorCommands.recordOperation(mark,binding),mark,'The real client director adapter retains the bound canonical mod mark')
  assert.equal(directorCommands.recordOperation(mark,{commandSpecVersion:directorCommands.version,mods:{commands:[]}}),null)
  const saved=structuredClone(input),thread=forkWidgetThread(input)
  assert.deepEqual(thread.messages.map(row=>[row.contact,row.text]),[['Canonical','Already']])
  assert.equal(thread.current.revealed,false)
  assert.deepEqual(input,saved)
  record.token.bindingKey=''
  assert.equal(forkWidgetThread(input).messages.length,0)
})
test('accepted phone narration follows the revealed source cursor; other widgets remain dialogue-only',()=>{
  const ref=phoneSourceView(fixture().catalogue).device
  const pages=[{kind:'narration',para:1,text:'A message arrived.'},{kind:'narration',para:2,text:'Future message.'}]
  const record={phase:'partial',through:2,token:{bindingKey:'bound',generation:1},entries:pages.map(({para})=>({at:para,ops:[{op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'Canonical',side:'in',form:'text'}}]}))}
  const input={rows:[{turn:1,sourceKey:'source',pages,record}],ref,cursor:{turn:1,page:0,para:1},visibleText:'A message',revealed:false}
  const saved=structuredClone(input),thread=forkWidgetThread(input)
  assert.deepEqual(thread.messages.map(row=>[row.contact,row.text,row.form]),[['Canonical','A message','text']])
  assert.equal(thread.current.revealed,false)
  assert.deepEqual(input,saved,'Projection neither edits prose nor copies future paragraphs')
  record.through=0
  assert.equal(forkWidgetThread(input).messages.length,0,'Unsealed narration stays hidden')
  record.through=2
  input.ref={packId:'pack',kind:'widgets',assetId:'widget'}
  record.entries[0].ops=[{op:'widget.source',ref:input.ref,contact:'Canonical',side:'in'}]
  assert.equal(forkWidgetThread(input).messages.length,0,'Narration support is specific to the phone contract')
})
test('phone release document is self contained with an opaque no-network source sandbox',async()=>{
  const files=new Map(await Promise.all(manifest.files.map(async row=>[row.path,await readFile(new URL(row.path,root))])))
  const document=phoneViewDocument(files)
  assert.doesNotMatch(document,/<(?:link|script)[^>]+(?:href|src)=/)
  assert.match(document,/connect-src 'none'/)
  assert.match(document,/form-action 'none'/)
})
