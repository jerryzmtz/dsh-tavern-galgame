// private fork: exercise the bundled Cubism settings, not a mock URL resolver.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {EventEmitter} from 'node:events'
import * as url from 'node:url'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-live2d.js',import.meta.url),'utf8')
const vendor = await readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/live2d/pixi-live2d-display-cubism4.min.js',import.meta.url),'utf8')
function browser() {
  const context = {console,window:{Live2DCubismCore:{}},PIXI:{utils:{EventEmitter,url},Point:class {},Matrix:class {},Container:class {},Transform:class {}}}
  vm.runInNewContext(vendor,context)
  context.window.PIXI = context.PIXI
  vm.runInNewContext(source.slice(0,source.indexOf('// Mouth level')),context)
  return context
}

test('Live2D runtime preserves browser-owned Blob URLs for model dependencies and deferred files',async()=>{
  const context = browser(), pixi = await context.forkLoadLive2dRuntime('/core.js')
  const settings = new pixi.live2d.Cubism4ModelSettings({url:'blob:http://localhost:43120/model',Version:3,FileReferences:{Moc:'blob:http://localhost:43120/moc',Textures:['blob:http://localhost:43120/texture']}})
  for (const name of ['moc','texture','physics','pose','motion','expression']) {
    const resource = 'blob:http://localhost:43120/'+name
    assert.equal(settings.resolveURL(resource),resource)
  }
  assert.equal(await context.forkLoadLive2dRuntime('/core.js'),pixi)
})

// private fork: the stage scene is the only Live2D renderer since the unused ForkLive2dCanvas was removed.
test('known model network failures use localized diagnostics in the stage renderer',async()=>{
  const context = browser()
  for (const message of ['Network error.','Network error','Failed to fetch','Load failed']) {
    assert.equal(context.forkLive2dLoadError(new Error(message)),'模型加载失败：资源读取失败，请重试')
  }
  assert.equal(context.forkLive2dLoadError(new Error('模型格式无效')),'模型加载失败：模型格式无效')
  const scene = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js',import.meta.url),'utf8')
  assert.match(scene,/onError\(forkLive2dLoadError\(error\)\)/)
})

test('location label reads the background display name, never its opaque asset ID',async()=>{
  const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js',import.meta.url),'utf8')
  assert.match(stage,/const place = pack\.scene\?\.backgroundName \|\| '';/)
})

test('non-Blob references retain the existing resolver and its model base URL',async()=>{
  const context = browser(), pixi = await context.forkLoadLive2dRuntime('/core.js')
  const settings = new pixi.live2d.Cubism4ModelSettings({url:'http://localhost:43120/models/model.model3.json',Version:3,FileReferences:{Moc:'model.moc3',Textures:['textures/face.png']}})
  assert.equal(settings.resolveURL('textures/face.png'),'http://localhost:43120/models/textures/face.png')
  assert.equal(settings.resolveURL('https://example.test/model.moc3'),'https://example.test/model.moc3')
})
