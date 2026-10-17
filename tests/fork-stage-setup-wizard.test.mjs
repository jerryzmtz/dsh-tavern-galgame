import test from 'node:test'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,rm,stat,cp} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {sealPack,jsonBytes,storedCopyHashes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {createCardBundleAdapter} from '../tavern-plugin/lib/fork-card-bundle.js'
import {createCardPreparation,rawData} from '../tavern-plugin/lib/domain/card-preparation.js'
import {detectStageSetupCharacters} from '../tavern-plugin/lib/domain/stage-setup-characters.js'
import {createCardAssetBoundary} from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import {figureCatalogue,resolution} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {CURATED_SLOTS,curatedEntries} from '../tavern-plugin/packages/dsh-asset-library/src/pack-catalogue/curated.js'
import {createCatalogueManager} from '../tavern-plugin/packages/dsh-asset-library/src/pack-catalogue/manager.js'
import {syntheticPack,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {Readable} from 'node:stream'
import {forkResolveBubbleMood} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure-emotions.js'

test('character detection handles adversarial whitespace and unterminated tags without blocking', () => {
  const moduleUrl = new URL('../tavern-plugin/lib/domain/stage-setup-characters.js', import.meta.url).href
  for (const attack of ["'\\n'.repeat(100000)", "'<name '.repeat(200000)"]) {
    // A subprocess deadline also stops synchronous regex hangs on the old implementation.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import {detectStageSetupCharacters} from ${JSON.stringify(moduleUrl)}
      const start = performance.now()
      assert.deepEqual(detectStageSetupCharacters({name:'Alice', description:${attack}}), [])
      for (const description of [
        '\\n - name: Alice\\n * age: 20',
        '{"name": "Alice", "age": 20}',
        '<name attribute="' + 'x'.repeat(1000) + '\\n">Alice</name><age>20</age>'
      ]) assert.deepEqual(detectStageSetupCharacters({name:'Alice', description}), [{name:'Alice',sources:['card']}])
      console.log(performance.now() - start)
    `], {encoding:'utf8', timeout:3000})
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stderr)
  }
})

async function fixture(t) {
  const temp = resolve('.tmp/pack-dedup'); await mkdir(temp,{recursive:true})
  const root = await mkdtemp(join(temp,'test-')), prep = createCardPreparation()
  let workspace = prep.create({kind:'import',payload:{name:'小红',extensions:{untouched:{value:1}}}}), fail = false
  const cards = createCardBundleAdapter({cardPreparation:prep,authorizeTarget:async path => path === 'cards/test.json' ? {cardId:workspace.meta.id} : null,
    readWorkspace:async () => structuredClone(workspace),withCardLock:async (_id,task) => task(),writeWorkspace:async (_path,value) => {if (fail) throw Error('card failed'); workspace = structuredClone(value)}})
  const service = createAssetPackService({assetRoot:join(root,'assets'),cardTransactions:cards})
  t.after(async () => {await service.dispose();await rm(root,{recursive:true,force:true})})
  const pack = await syntheticPack(), figure = pack.figures[FIGURE_ID]
  figure.name = '傲娇黑长直'; figure.aliases = ['小红同学']; figure.recall = {mode:'keyword'}
  pack.files.set(`figures/${FIGURE_ID}.json`,jsonBytes(figure)); pack.manifest.assets.find(a => a.kind === 'ambience').enabled = false
  await sealPack(pack.manifest,pack.files)
  const file = join(root,'source.zip')
  await writeZip(file,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data]) => ({path,data}))])
  const inspection = await service.inspectImport({bytes:await readFile(file)})
  await service.applyImport({inspectionId:inspection.inspectionId,expectedRevision:inspection.expectedRevision,decision:'install',acceptScriptRisk:true})
  const status = () => service.getStageSetupStatus({path:'cards/test.json'})
  const merge = async (selections,extra={}) => {const current = await status();return service.mergeStageSetupPack({path:current.path,expectedCardRevision:current.cardRevision,expectedLibraryRevision:current.libraryRevision,selections,...extra})}
  return {root,service,pack,status,merge,cards,workspace:() => workspace,fail:() => {fail=true}}
}

test('auto-open receipt survives a host restart without changing the card or requiring completion',async t => {
  const f = await fixture(t), before = structuredClone(f.workspace())
  assert.equal((await f.status()).shouldAutoOpen,true)
  await f.service.getStageSetupStatus({path:'cards/test.json',autoOpened:true})
  assert.equal((await f.status()).shouldAutoOpen,false)
  assert.deepEqual(f.workspace(),before)
  await f.service.dispose()
  const restarted = createAssetPackService({assetRoot:join(f.root,'assets'),cardTransactions:f.cards})
  t.after(() => restarted.dispose())
  assert.equal((await restarted.getStageSetupStatus({path:'cards/test.json'})).shouldAutoOpen,false)
})

test('wizard merge copies all kinds, binds atomically, preserves lamps, renames through the existing resolver and reuses its pack',async t => {
  const f = await fixture(t), first = await f.status()
  assert.equal(first.shouldAutoOpen,true); assert.equal(first.hasAssets,true); assert.equal(first.wizardPack,null)
  const second = await f.service.copyItems({sourcePackId:PACK_ID,itemRefs:[{kind:'music',id:'classroom'}],target:{newPackName:'Other source'}})
  await assert.rejects(f.service.mergeStageSetupPack({path:first.path,expectedCardRevision:first.cardRevision,expectedLibraryRevision:first.libraryRevision,selections:[]}),{code:'REVISION_CONFLICT'})
  const result = await f.merge([{packId:PACK_ID,itemRefs:[{kind:'figures',id:FIGURE_ID},...f.pack.manifest.assets.map(({kind,id}) => ({kind,id}))]},{packId:second.packId,itemRefs:[{kind:'music',id:'classroom'}]}])
  assert.equal(result.hasBoundPacks,true); assert.equal(result.shouldAutoOpen,false)
  const target = await f.service.getPackSnapshot({packId:result.wizardPack.packId})
  const id = result.copied.find(row => row.kind === 'figures').toId
  assert.notEqual(id,FIGURE_ID); assert.notEqual(id,target.figures[id].name)
  assert.deepEqual(target.figures[id].recall,{mode:'keyword'})
  assert.deepEqual(target.figures[id].extensions.dsh_tavern.copiedFrom,{packId:PACK_ID,figureId:FIGURE_ID})
  for (const asset of f.pack.manifest.assets) {
    const copied = target.manifest.assets.find(row => row.kind === asset.kind && row.id === asset.id)
    assert.equal(copied.enabled,asset.enabled); assert.deepEqual(copied.recall,asset.recall)
    assert.deepEqual(copied.extensions.dsh_tavern.copiedFrom,{packId:PACK_ID,kind:asset.kind,assetId:asset.id})
  }
  assert.ok(target.manifest.assets.some(row => row.kind === 'music' && row.id === 'classroom-2'))
  assert.deepEqual(rawData(f.workspace().raw).extensions.untouched,{value:1})
  assert.deepEqual(rawData(f.workspace().raw).extensions.dsh_tavern.assetBindings.boundPackIds,[target.manifest.id])
  const changed = await f.service.patchFigure({packId:target.manifest.id,expectedRevision:target.revision,figureId:id,patch:{name:'小红'}})
  const rows = figureCatalogue({snapshots:[changed.snapshot],bindings:{boundPackIds:[target.manifest.id]}})
  for (const name of ['小红','小红同学']) assert.equal(resolution.resolveFigureName(rows,name).ref.figureId,id)
  assert.equal(resolution.resolveFigureName(rows,'傲娇黑长直').status,'unknown')
  assert.equal(forkResolveBubbleMood('平和',changed.snapshot.figures[id].emotions).id,'calm')
  const again = await f.merge([{packId:PACK_ID,itemRefs:[{kind:'sfx',id:'bell'}]}])
  assert.equal(again.wizardPack.packId,target.manifest.id)
  assert.ok((await f.service.getPackSnapshot({packId:target.manifest.id})).manifest.assets.some(a => a.id === 'bell-2'))
  const before = await f.status(); f.fail()
  await assert.rejects(f.merge([{packId:PACK_ID,itemRefs:[{kind:'music',id:'classroom'}]}]),/card failed/)
  assert.deepEqual(await f.status(),before,'failed card write rolls back pack publication')
})

test('publication shares immutable bytes; edits, export/import, backup and deletion stay independent',async t => {
  const f = await fixture(t), result = await f.merge([{packId:PACK_ID,itemRefs:[{kind:'music',id:'classroom'}]}])
  const targetId = result.wizardPack.packId, asset = f.pack.manifest.assets.find(a => a.kind === 'music'), name = `media/${asset.media}.wav`
  const sourcePath = join(f.root,'assets/packs',PACK_ID,name), targetPath = join(f.root,'assets/packs',targetId,name)
  assert.equal((await stat(sourcePath)).ino,(await stat(targetPath)).ino)
  assert.ok((await stat(targetPath)).nlink >= 2)
  assert.equal(storedCopyHashes(new Map([['renamed',f.pack.files.get(name)]]),[f.pack]).get('renamed'),f.pack.manifest.files.find(file => file.path === name).sha256)
  const backup = join(f.root,'backup'); await cp(join(f.root,'assets/packs',targetId),backup,{recursive:true})
  assert.notEqual((await stat(join(backup,name))).ino,(await stat(targetPath)).ino)
  const exported = await f.service.exportPack({packId:targetId,expectedRevision:result.wizardPack.revision})
  const preview = await f.service.inspectImport({bytes:exported.bytes,copy:true})
  const imported = await f.service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'keep-both',acceptScriptRisk:true})
  const importPath = join(f.root,'assets/packs',imported.snapshot.manifest.id,name)
  assert.equal((await stat(importPath)).ino,(await stat(targetPath)).ino)
  await f.service.patchPack({packId:targetId,expectedRevision:result.wizardPack.revision,patch:{name:'Changed'}})
  const source = await f.service.getPackSnapshot({packId:PACK_ID})
  await f.service.removePack({packId:PACK_ID,expectedRevision:source.revision})
  assert.deepEqual(await readFile(targetPath),f.pack.files.get(name))
  assert.deepEqual(await readFile(importPath),await readFile(join(backup,name)))
})

test('imports, media updates and reimports share bytes while editing one pack leaves the others intact',async t => {
  const f = await fixture(t), source = await f.service.getPackSnapshot({packId:PACK_ID})
  const face = source.figures[FIGURE_ID].outfits[0].avatars.calm
  const mediaPath = join(f.root,'assets/packs',PACK_ID,`media/${face}.png`)
  const texturePath = join(f.root,'assets/packs',PACK_ID,'bundles/casual/textures/face.png')
  assert.equal((await stat(mediaPath)).ino,(await stat(texturePath)).ino,'first import also shares identical media across bundle paths')
  const copied = await f.merge([{packId:PACK_ID,itemRefs:[{kind:'music',id:'classroom'}]}])
  const targetId = copied.wizardPack.packId, original = source.manifest.assets.find(a => a.kind === 'music')
  const descriptor = source.manifest.blobs[original.media], bytes = Buffer.from(f.pack.files.get(`media/${original.media}.wav`))
  bytes[bytes.length-1] = 1
  const changed = await f.service.putBlob({packId:targetId,expectedRevision:copied.wizardPack.revision,bytes,descriptor})
  const target = await f.service.patchPack({packId:targetId,expectedRevision:changed.snapshot.revision,patch:{assets:changed.snapshot.manifest.assets.map(a => ({...a,media:changed.hash}))}})
  assert.deepEqual(await readFile(join(f.root,'assets/packs',PACK_ID,`media/${original.media}.wav`)),f.pack.files.get(`media/${original.media}.wav`))
  const duplicate = await f.service.putBlob({packId:PACK_ID,expectedRevision:source.revision,bytes,descriptor})
  const newPath = id => join(f.root,'assets/packs',id,`media/${changed.hash}.wav`)
  assert.equal((await stat(newPath(PACK_ID))).ino,(await stat(newPath(targetId))).ino,'ordinary updates use the same publication index')
  const exported = await f.service.exportPack({packId:targetId,expectedRevision:target.snapshot.revision})
  const preview = await f.service.inspectImport({bytes:exported.bytes,copy:true})
  const imported = await f.service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'keep-both',acceptScriptRisk:true})
  assert.equal((await stat(newPath(imported.snapshot.manifest.id))).ino,(await stat(newPath(targetId))).ino)
  await f.service.removePack({packId:PACK_ID,expectedRevision:duplicate.snapshot.revision})
  assert.deepEqual(await readFile(newPath(targetId)),bytes)
})

test('export/import remapping preserves origins even when a copy has returned to its source pack',async t => {
  const f=await fixture(t), source=await f.service.getPackSnapshot({packId:PACK_ID})
  const copied=await f.service.copyItems({sourcePackId:PACK_ID,itemRefs:[{kind:'music',id:'classroom'},{kind:'figures',id:FIGURE_ID}],target:{newPackName:'Round trip'}})
  const back=await f.service.copyItems({sourcePackId:copied.packId,itemRefs:copied.copied.map(row=>({kind:row.kind,id:row.toId})),target:{packId:PACK_ID,expectedRevision:source.revision}})
  const exported=await f.service.exportPack({packId:PACK_ID,expectedRevision:back.revision})
  const preview=await f.service.inspectImport({bytes:exported.bytes,copy:true})
  const imported=await f.service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'keep-both',acceptScriptRisk:true})
  assert.notEqual(imported.snapshot.manifest.id,PACK_ID)
  assert.deepEqual(imported.snapshot.manifest.assets.find(a=>a.id==='classroom-2'&&a.kind==='music').extensions.dsh_tavern.copiedFrom,{packId:PACK_ID,kind:'music',assetId:'classroom'})
  const figure=Object.values(imported.snapshot.figures).find(row=>row.extensions?.dsh_tavern?.copiedFrom)
  assert.deepEqual(figure.extensions.dsh_tavern.copiedFrom,{packId:PACK_ID,figureId:FIGURE_ID})
})

test('character suggestions require positive profile evidence, rank confidence and retain large casts',() => {
  const entry = (id,comment,content='') => ({id,comment,content})
  const raw = {spec:'chara_card_v3',data:{name:'星海物语',first_mes:'林舟向白羽打招呼。',character_book:{entries:[
    ...['世界观基调','时间线','pve敌人生成规则','骑士','装备系统','第一赛季','[mvu_update]变量输出格式','EJS/动态加载','对白格式','黄金一代','盗贼','散人'].map((name,i) => entry(100+i,name,'职业定位: 输出\n技能名称: 攻击')),
    entry(201,'林舟','姓名: 林舟\n职业: 船长\n生日: 五月'),
    entry(202,'白羽','性别：女\n年龄：18'),
    entry(203,'红帽子（择一）','<NAME>月野沙耶香</NAME>\n年龄: 15\n[外貌与装备]: 长发'),
    entry(204,'阿兰·贝尔','{"Name":"阿兰·贝尔","Age":20,"Gender":"Male"}'),
    entry(205,'Alice Gray','Name: Alice Gray\nAge: 20'),
    entry(206,'アリス','性别: 女\n年龄: 20\n性格: 活泼'),
    entry(207,'林舟（眼镜）','姓名: 林 舟 | Lin Zhou\n年龄: 18'),
    entry(208,'法师','姓名: 林舟\n性别: 男'),
    entry(209,'随机词','这段正文提到了年龄和姓名，但不是人物档案。'),
    entry(210,'NPC系统','姓名: 模板人\n性别: 男\n年龄: 20'),
    entry(211,'人物差分','旁白客（ID actor-other）：平和、喜悦'),
    entry(212,'星月山庄','<location_profile><name>星月山庄</name><description>住所</description></location_profile>'),
    entry(213,'夜之天灾','<NAME>夜之天灾</NAME><NATURE>无力</NATURE>'),
    entry(214,'次要角色','姓名: 山下 春\n年龄: 18\n外貌: 短发\n朋友: 宫野秋\n姓名: 雨宫 花\n年龄: 19\n外貌: 长发'),
  ]}}}
  const before = structuredClone(raw), found = detectStageSetupCharacters(raw)
  assert.equal(found[0].name,'林舟','greeting corroboration ranks above equally strong profiles')
  assert.deepEqual(new Set(found.map(row => row.name)),new Set(['林舟','白羽','月野沙耶香','阿兰·贝尔','Alice Gray','アリス','山下春','雨宫花']))
  assert.deepEqual(raw,before,'detection never edits the raw card')
  const many = {name:'星海物语',character_book:{entries:Array.from({length:80},(_,i) => entry(400+i,`Alice ${String.fromCharCode(65+i%26)}${String.fromCharCode(97+Math.floor(i/26))}`,'Age: 18\nGender: Female\nPersonality: Quiet'))}}
  const uncapped = detectStageSetupCharacters(many)
  assert.equal(uncapped.length,80)
  assert.deepEqual(uncapped.map(row => row.name),many.character_book.entries.map(row => row.comment))
  assert.deepEqual(uncapped,detectStageSetupCharacters(many),'equal-confidence order stays deterministic')
  assert.deepEqual(detectStageSetupCharacters({name:'星海物语',description:'姓名: 林舟\n性别: 男\n年龄: 18'}),[],'world title does not inherit another person\'s profile')
})

test('calibration A accepts only explicit portrayal or corroborated person headings',() => {
  const book = (name,content) => [{entries:[{id:701,name,content}]}]
  assert.deepEqual(detectStageSetupCharacters({name:'Neo-sama',description:'你将扮演 Neo-sama（虚构角色）。'}),[{name:'Neo-sama',sources:['card-portrayal']}])
  for (const description of ['故事提到你将扮演 Neo-sama。','你将扮演 Neo-samaExtra。']) {
    assert.deepEqual(detectStageSetupCharacters({name:'Neo-sama',description}),[])
  }
  for (const content of ['<Profile>\n林清雪（次要角色）\n外貌：黑发\n性格：认真','林清雪（人物）\n17岁。\n性格：认真']) {
    const found = detectStageSetupCharacters({},book('林清雪',content))
    assert.deepEqual(found.map(row => row.name),['林清雪'])
    assert.ok(found[0].sources.includes('title-heading'))
  }
  for (const [name,content] of [
    ['春日城','春日城（地点）\n年龄：100\n性格：温暖'],
    ['骑士','骑士（职业）\n性别：男\n性格：勇敢'],
    ['林清雪','林清雪（人物）\n性格：认真'],
    ['林清雪','苏明月（人物）\n外貌：黑发\n性格：认真'],
    ['林清雪','序言。林清雪（人物）\n外貌：黑发\n性格：认真'],
  ]) assert.deepEqual(detectStageSetupCharacters({},book(name,content)),[],name)
  // Two generic fields score only four without person evidence; lowering the threshold admits places.
  assert.deepEqual(detectStageSetupCharacters({},book('春日城','年龄：100\n性格：温暖')),[])
  assert.deepEqual(detectStageSetupCharacters({},book('乐队','成员：林清雪（主唱）/ 苏明月（鼓）')),[],'proposal B stays excluded')
})

test('single-character profiles and bound worldbooks stay read-only behind the existing RPC boundary',async () => {
  const prep = createCardPreparation({id:() => 'card-fixture-42',now:() => 1})
  const card = prep.create({kind:'import',payload:{name:'小蓝鲸',description:'小蓝鲸是一位少女。\n【外貌】蓝色头发\n【性格】开朗',character_book:{entries:[{id:41,comment:'人物差分',content:'青山月（ID actor-support-83）：平和、喜悦'}]}}})
  const before = structuredClone(card), paths = [], boundary = createCardAssetBoundary({ctx:{get:() => undefined},listCards:async () => [{path:'cards/fixture-42.json'}],readWorkspace:async () => card,
    readCharacterBook:async path => {paths.push(path);return {entries:{'entry-93':{comment:'山野春乃',content:'姓名: 山野春乃\n性别: 女\n年龄: 17'}}}},updateCard:() => assert.fail('detection must not write')})
  const result = await boundary.detectCharacters({path:'cards/fixture-42.json'})
  assert.equal(result.path,'cards/fixture-42.json'); assert.equal(typeof result.revision,'string')
  assert.deepEqual(new Set(result.candidates.map(row => row.name)),new Set(['小蓝鲸','青山月','山野春乃']))
  assert.deepEqual(paths,['cards/fixture-42.json']); assert.deepEqual(card,before)
  await assert.rejects(boundary.detectCharacters({path:'cards/not-owned.json'}),{code:'NOT_FOUND'})
})

test('heuristic uses names rather than fixture IDs and curated releases use the existing catalogue',async () => {
  const raw = {spec:'chara_card_v2',data:{name:'小红',characters:[{id:'actor-123',name:'小明'}],character_name:'小红',character_book:{entries:[{id:102,name:'老师'},{id:103,comment:'小明',content:'姓名: 小明\n年龄: 18'},{id:104,name:'多行\n正文'}]}}}
  assert.deepEqual(detectStageSetupCharacters(raw),[{name:'小红',sources:['card','character']},{name:'小明',sources:['character','worldbook']}])
  assert.equal(curatedEntries().length,0,'unpublished slots are hidden')
  const slots = CURATED_SLOTS.map((slot,i) => ({...slot,source:{id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title:slot.title,version:'1.0.0',size:12,sha256:'a'.repeat(64),licence:{id:'CC0-1.0'},credits:[],requires:[],downloads:[{id:'main',label:'Main',url:'https://example.com/'+slot.id+'.zip'}]}}))
  const body = Buffer.from(JSON.stringify({format:'dsh-pack-catalogue',schemaVersion:1,id:'official',title:'官方精选',updatedAt:'2026-10-15T00:00:00Z',packs:[...curatedEntries(slots),{...slots[0].source,id:PACK_ID}]}))
  const manager = createCatalogueManager({assetRoot:resolve('.tmp/pack-dedup'),limits:{spoolBytes:1024*1024},settings:{read:() => ({values:{sources:[{sourceId:'official',url:'https://example.com/catalogue.json',enabled:true,official:true}]}})},network:async () => ({status:200,headers:{},body:Readable.from([body])}),listInstalled:async () => []})
  try {
    const result = await manager.methods.refreshCatalogue({sourceId:'official',curated:true})
    assert.deepEqual(result.packs.map(p => p.title),CURATED_SLOTS.map(p => p.title))
    assert.equal((await manager.methods.refreshCatalogue({sourceId:'official'})).packs.length,7)
  } finally {await manager.dispose()}
})
