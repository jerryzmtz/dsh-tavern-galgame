// private fork: expand the shared emotion dependency in isolated client fragments.
import {withSpriteEmotionSource} from './helpers/sprite-emotion-source.mjs'
// private fork: character-v3 uses a card choice with downward-only media fallback.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import avatar from '../tavern-plugin/lib/domain/pack-avatar.cjs'

const source = withSpriteEmotionSource(await readFile(new URL('../tavern-plugin/lib/domain/pack-avatar.cjs', import.meta.url), 'utf8'))
const browser = vm.createContext({window:{}})
vm.runInContext(source, browser)
const resolvers = {
  node:avatar.packAppearance,
  browser:(outfit, appearance) => JSON.parse(JSON.stringify(browser.packAppearance(outfit, appearance))),
}

for (const [environment, resolve] of Object.entries(resolvers)) {
  for (let mask = 0; mask < 8; mask++) {
    const outfit = Object.freeze({key:'daily', enabled:true,
      ...(mask & 1 ? {live2d:{bundleKey:'model'}} : {}),
      ...(mask & 2 ? {sprite:{manifestKey:'body', assets:{}}} : {}),
      ...(mask & 4 ? {avatars:{calm:'face'}} : {}),
    })
    for (const appearance of ['live2d','sprite','avatar']) {
      test(`${environment}: ${appearance} with media mask ${mask} keeps intent and only falls down`, () => {
        const before = structuredClone(outfit)
        const expected = appearance === 'avatar' ? {form:'avatar', missing:[]}
          : appearance === 'sprite' ? mask & 2 ? {form:'sprite', missing:[]} : {form:'avatar', missing:['sprite']}
          : mask & 1 ? {form:'live2d', missing:[]}
          : mask & 2 ? {form:'sprite', missing:['live2d','spine']}
          : {form:'avatar', missing:['live2d','spine','sprite']}
        assert.deepEqual(resolve(outfit, appearance), expected)
        assert.deepEqual(outfit, before)
      })
    }
  }
  test(`${environment}: absent outfit still resolves to dialogue-only avatar`, () => {
    assert.deepEqual(resolve(null, 'live2d'), {form:'avatar', missing:['live2d','spine','sprite']}) // private fork: Spine sits between Live2D and sprite
    assert.deepEqual(resolve(undefined, 'sprite'), {form:'avatar', missing:['sprite']})
    assert.deepEqual(resolve(null, 'avatar'), {form:'avatar', missing:[]})
  })
}
