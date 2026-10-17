import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createCache } from '../src/cache.js'
import { pcmWav } from '../src/providers/audio.js'
import { Settings, validateSettings } from '../src/settings.js'

const day = 86400000, audio = pcmWav(Buffer.alloc(100)), key = 'a'.repeat(64), other = 'b'.repeat(64)
const limits = settings => ({maxBytes:settings.cacheMaxGB * 1024 ** 3,maxAgeDays:settings.cacheMaxAgeDays})
async function directory(t) {
  const dataDir = await mkdtemp(publicJoin(publicTmpdir(), '.cache-test-'))
  t.after(() => rm(dataDir,{recursive:true,force:true}))
  return dataDir
}

test('cache expires unused entries on load and deletes audio and manifests',async t => {
  const dataDir = await directory(t), root = join(dataDir,'cache','audio-v2')
  let now = 0; t.mock.method(Date,'now',() => now)
  await createCache({dataDir}).put(key,audio,['card'])
  now = 31 * day
  const cache = createCache({dataDir})
  assert.equal((await cache.stats()).count,0)
  assert.equal(await cache.get(key),null)
  assert.deepEqual(await readdir(root),[])
})

test('cache hit persists last use and extends retention across reload',async t => {
  const dataDir = await directory(t)
  let now = 0; t.mock.method(Date,'now',() => now)
  const cache = createCache({dataDir})
  await cache.put(key,audio,[])
  now = 29 * day
  assert.deepEqual(await cache.get(key,'card'),audio)
  const entry = JSON.parse(await readFile(join(dataDir,'cache','audio-v2',key + '.json'),'utf8'))
  assert.equal(entry.access,now); assert.deepEqual(entry.scopes,['card'])
  now = 31 * day
  const reloaded = createCache({dataDir})
  assert.equal((await reloaded.stats()).count,1)
  now = 60 * day
  assert.equal(await reloaded.get(key),null)
})

// private fork: a hit is checked by size and WAV structure, not by rehashing the clip.
test('cache treats a torn or non-WAV clip as a miss and removes it',async t => {
  const dataDir = await directory(t), root = join(dataDir,'cache','audio-v2')
  await createCache({dataDir}).put(key,audio,[])
  await createCache({dataDir}).put(other,audio,[])
  await writeFile(join(root,key + '.wav'),audio.subarray(0,audio.length - 2))
  await writeFile(join(root,other + '.wav'),Buffer.alloc(audio.length))
  const cache = createCache({dataDir})
  assert.equal(await cache.get(key),null)
  assert.equal(await cache.get(other),null)
  assert.deepEqual(await readdir(root),[])
})

test('cache trims expired entries after writes without evicting fresh entries',async t => {
  let now = 0; t.mock.method(Date,'now',() => now)
  const cache = createCache({maxBytes:audio.length * 2,maxAgeDays:1})
  await cache.put(key,audio,[])
  now = 2 * day
  await cache.put(other,audio,[])
  assert.equal((await cache.stats()).count,1)
  assert.deepEqual(await cache.get(other),audio)
  assert.equal(await cache.get(key),null)
})

test('size setting uses GiB and evicts least recently used clips after writes',async t => {
  const settings = Settings({cacheMaxGB:0.1}), cache = createCache(limits(settings))
  const large = pcmWav(Buffer.alloc(28 * 1024 ** 2)), keys = ['a','b','c','d'].map(c => c.repeat(64))
  let now = 0; t.mock.method(Date,'now',() => ++now)
  for (const key of keys.slice(0,3)) await cache.put(key,large,[])
  await cache.get(keys[0])
  await cache.put(keys[3],large,[])
  const stats = await cache.stats()
  assert.equal(stats.maxBytes,0.1 * 1024 ** 3); assert.equal(stats.count,3)
  assert.ok(stats.bytes <= stats.maxBytes)
  assert.equal(await cache.get(keys[1]),null)
  assert.deepEqual(await cache.get(keys[0]),large)
})

test('load trims to its size limit and configuration changes immediately trim age then LRU',async t => {
  const dataDir = await directory(t)
  let now = 0; t.mock.method(Date,'now',() => now)
  const cache = createCache({dataDir})
  await cache.put(key,audio,[])
  now = 2 * day
  await cache.put(other,audio,[])
  const reloaded = createCache({dataDir,maxBytes:audio.length})
  assert.equal((await reloaded.stats()).count,1)
  assert.equal(await reloaded.get(key),null)
  await cache.configure({maxBytes:audio.length,maxAgeDays:1})
  assert.equal((await cache.stats()).count,1)
  assert.equal(await cache.get(key),null)
  await cache.configure({maxBytes:audio.length - 1,maxAgeDays:1})
  assert.equal((await cache.stats()).count,0)
  await assert.rejects(cache.put(key,audio,[]),{code:'CACHE_FULL'})
})

test('native cache settings have defaults, labels and bounded numeric validation',() => {
  const defaults = Settings({})
  assert.equal(defaults.cacheMaxGB,1); assert.equal(defaults.cacheMaxAgeDays,30)
  assert.equal(Settings.dict.cacheMaxGB.meta.description,'\u7f13\u5b58\u4e0a\u9650\uff08GB\uff09')
  assert.equal(Settings.dict.cacheMaxAgeDays.meta.description,'\u7f13\u5b58\u4fdd\u7559\u5929\u6570')
  for (const value of [0.1,0.5,100]) assert.equal(validateSettings(Settings({cacheMaxGB:value})).cacheMaxGB,value)
  for (const value of [1,3650]) assert.equal(validateSettings(Settings({cacheMaxAgeDays:value})).cacheMaxAgeDays,value)
  for (const [field,values] of [['cacheMaxGB',[0,0.09,101,NaN,Infinity,'1',null]],['cacheMaxAgeDays',[0,3651,1.5,NaN,Infinity,'30',null]]]) {
    for (const value of values) {
      assert.throws(() => validateSettings({...defaults,[field]:value}),{code:'INVALID_INPUT'})
      if (value !== null) assert.throws(() => validateSettings(Settings({[field]:value})))
    }
  }
})
