import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolveTavernRuntimeAsset, TAVERN_RUNTIME_ASSET_PREFIX, importSpineRuntime } from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'
import { createCubismCore } from '../tavern-plugin/lib/fork-cubism-core.js'
import { decodeRuntimeInput } from '../tavern-plugin/lib/fork-runtime-archive.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

const core = 'var Live2DCubismCore={Moc:0,Model:0,Version:0,csmGetVersion:0,csmReviveMocInPlace:0};throw Error("never execute")'
const display = 'var PIXI={Live2DModel:0,CubismModel:0,Live2DCubismCore:0};throw Error("never execute")'
const input = (name, body) => ({ name, base64: Buffer.from(body).toString('base64'), consent: true })
const zip = entries => writeZipEntries(entries.map(([path, content]) => ({ path, content })))
function tar(name, content) {
  const h = Buffer.alloc(512), data = Buffer.from(content)
  h.write(name); h.write('0000644\0',100); h.write('0000000\0',108); h.write('0000000\0',116)
  h.write(data.length.toString(8).padStart(11,'0')+'\0',124); h.write('00000000000\0',136); h.fill(32,148,156); h[156]=48
  h.write('ustar\0',257); h.write('00',263)
  h.write([...h].reduce((n,v)=>n+v,0).toString(8).padStart(6,'0')+'\0 ',148)
  return gzipSync(Buffer.concat([h,data,Buffer.alloc((512-data.length%512)%512),Buffer.alloc(1024)]))
}

test('runtime selection handles publisher ZIP/tgz, rejects unsafe archives before writes and never executes', async t => {
  await mkdir(path.resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(path.resolve('.tmp/runtime-archive-'))
  t.after(() => rm(root,{recursive:true,force:true}))
  const runtime = createCubismCore(root,{displayVendor:path.join(root,'absent')})
  const good = zip([['SDK/Core/live2dcubismcore.js',core],['SDK/Core/live2dcubismcore.min.js',core],['release/dist/cubism4.min.js',display],['readme.txt','ignore']])
  assert.deepEqual(decodeRuntimeInput(input('sdk.zip',good)).map(x=>x.kind),['core','display'])
  assert.equal(decodeRuntimeInput(input('display.tgz',tar('package/dist/cubism4.min.js',display)))[0].kind,'display')
  for (const bad of [
    zip([['../Core/live2dcubismcore.min.js',core]]),
    zip([['/Core/live2dcubismcore.min.js',core]]),
    zip([['C:/Core/live2dcubismcore.min.js',core]]),
    zip([['a\\cubism4.min.js',display]]),
    zip([['a/cubism4.min.js',display],['b/cubism4.min.js',display]]),
    zip([['a.txt','x'.repeat(100000)]]),
    good.subarray(0,good.length-3),
    zip([['Core/live2dcubismcore.min.js',core],['dist/cubism4.min.js','invalid runtime']])
  ]) await assert.rejects(runtime.importFile(input('bad.zip',bad)))
  const encrypted=Buffer.from(good),cd=encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));encrypted.writeUInt16LE(1,cd+8)
  await assert.rejects(runtime.importFile(input('bad.zip',encrypted)))
  const symlink=Buffer.from(good);symlink.writeUInt32LE((0xa1ff*65536)>>>0,cd+38)
  await assert.rejects(runtime.importFile(input('bad.zip',symlink)))
  const oversized=Buffer.from(good);oversized.writeUInt32LE(151*1024*1024,cd+24)
  await assert.rejects(runtime.importFile(input('bad.zip',oversized)))
  const many=Buffer.from(good);many.writeUInt16LE(10001,many.length-14);many.writeUInt16LE(10001,many.length-12)
  await assert.rejects(runtime.importFile(input('bad.zip',many)),/数量/)
  const bomb=Buffer.from(good);bomb.writeUInt32LE(1,cd+24)
  await assert.rejects(runtime.importFile(input('bad.zip',bomb)),/归档无效/)
  const corrupt=Buffer.from(good);corrupt.writeUInt32LE(0,cd+16)
  await assert.rejects(runtime.importFile(input('bad.zip',corrupt)),/校验/)
  const linkedTar=tar('package/dist/cubism4.min.js',display)
  assert.throws(()=>decodeRuntimeInput(input('broken.tgz',linkedTar.subarray(0,linkedTar.length-4))),/归档无效/)
  await assert.rejects(runtime.importFile(input('bad.tgz',tar('../cubism4.min.js',display))))
  await assert.rejects(runtime.importFile(input('bad.tgz',gzipSync(Buffer.alloc(1024*1024)))))
  assert.deepEqual(await readdir(root),[])
  const first = await runtime.importFile(input('display.tgz',tar('package/dist/cubism4.min.js',display)))
  assert.deepEqual(first.missing,['core'])
  const results = await Promise.all([runtime.importFile(input('sdk.zip',good)),runtime.importFile(input('sdk.zip',good))])
  assert.ok(results.every(x=>x.installed && !x.missing.length))
  assert.equal(await readFile(path.join(root,'core/pixi-live2d-display-cubism4.min.js'),'utf8'),display)
  assert.equal((await readdir(path.join(root,'core'))).length,2)
})

test('private vendor wins without reimport', async t => {
  await mkdir(path.resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(path.resolve('.tmp/runtime-fallback-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const vendor=path.join(root,'local.js');await writeFile(vendor,'owner local runtime')
  const runtime=createCubismCore(root,{displayVendor:vendor})
  assert.equal((await runtime.status()).displayInstalled,true)
  await runtime.importFile(input('live2dcubismcore.min.js',core))
  assert.equal((await runtime.status()).installed,true)
  assert.deepEqual(await readdir(path.join(root,'core')),['live2dcubismcore.min.js'])
  const vendorRoot = pathToFileURL(path.join(root,'vendor') + path.sep)
  for (const [relative, imported] of [
    ['live2d/pixi-live2d-display-cubism4.min.js','live2d/core/pixi-live2d-display-cubism4.min.js'],
    ['spine/pixi-spine.js','runtime-imports/spine/pixi-spine.js']
  ]) {
    const url = TAVERN_RUNTIME_ASSET_PREFIX + relative
    const target = path.join(root,imported)
    await mkdir(path.dirname(target),{recursive:true})
    if (relative.startsWith('spine/')) {
      const source='this.PIXI.spine={SpineParser:0,TextureAtlas:0,SkeletonBinary:0,AnimationState:0,Spine:0}'
      await importSpineRuntime(input('pixi-spine.umd.js',source),target)
    } else await writeFile(target,display)
    assert.equal((await resolveTavernRuntimeAsset(url,root,vendorRoot)).file,target)
    const local=new URL(relative,vendorRoot)
    await mkdir(path.dirname(fileURLToPath(local)),{recursive:true})
    await writeFile(local,'private copy')
    assert.equal((await resolveTavernRuntimeAsset(url,root,vendorRoot)).file.href,local.href)
    assert.equal(await readFile(target,'utf8') === 'private copy',false)
  }
})
