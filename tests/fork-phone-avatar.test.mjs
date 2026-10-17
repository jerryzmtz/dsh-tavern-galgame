import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {forkWidgetAvatarSquare}=createRequire(import.meta.url)('../tavern-plugin/src/client/fork-widget-source.cjs')

test('phone thumbnail covers portrait, landscape and configured crops before canvas scaling',()=>{
  assert.deepEqual(forkWidgetAvatarSquare(200,600),{x:0,y:60,width:200,height:200})
  assert.deepEqual(forkWidgetAvatarSquare(600,200),{x:200,y:0,width:200,height:200})
  assert.deepEqual(forkWidgetAvatarSquare(400,800,{x:.25,y:.1,w:.5,h:.5}),{x:100,y:110,width:200,height:200})
  assert.deepEqual(forkWidgetAvatarSquare(64,64),{x:0,y:0,width:64,height:64})
})
