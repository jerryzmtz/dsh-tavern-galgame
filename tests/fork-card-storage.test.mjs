import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createCardStorage, safeAssetPath, checkedAssetPath } from '../tavern-plugin/lib/fork-card-storage.js'

test('shared card queue serializes owners, permits another card and recovers after failure',async () => {
  const storage = createCardStorage({dataRoot:process.cwd()}), events = []
  let release, entered
  const barrier = new Promise(resolve => {release = resolve}), ready = new Promise(resolve => {entered = resolve})
  const first = storage.withCardLock('card-a',async () => {
    events.push('first'); entered(); await barrier
    assert.throws(() => storage.withCardLock('card-a',async () => {}),{code:'LOCK_REENTRY'})
    events.push('finish'); throw new Error('failed owner')
  })
  const rejected = assert.rejects(first,/failed owner/)
  await ready
  const second = storage.withCardLock('card-a',async () => {events.push('second')})
  await storage.withCardLock('card-b',async () => {events.push('other-card')})
  assert.deepEqual(events,['first','other-card'])
  release(); await rejected; await second
  assert.deepEqual(events,['first','other-card','finish','second'])
  assert.equal(storage.pack,undefined)
})

test('retained path helpers reject Windows escapes and reparse ancestors without creating links',async () => {
  const root = process.cwd()
  for(const value of ['../a','/a','C:/a','a\\b','a//b','a/./b','a/../b','a/%2e%2e/b','a/CON.png','a/end.','a/x:ads','a/nul','a/COM1']) assert.throws(() => safeAssetPath(root,value),/path/)
  for(const reparse of [path.dirname(root),root,path.join(root,'media')]) {
    await assert.rejects(checkedAssetPath(root,'media/file.png',async file => ({isSymbolicLink:() => file === reparse})),/symlinks/)
  }
})
