// private fork: optimized browser authentication must preserve stored canonical bytes exactly.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {canonicalJson} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-pack-json.js'
const source=fs.readFileSync(new URL('../tavern-plugin/src/client/fork-stage-director-source.cjs',import.meta.url),'utf8')
const canonical=vm.runInNewContext(source+'\nstageDirectorCanonical')
test('browser canonical ordering equals protocol scalar ordering, including astral keys and prefixes',()=>{
  const keys=['actor','actors','0','9','10','\ue000','\ud800\udc00','\ud800\udc00x','\ud800\udc01','\u4eba','\u4ebax','', 'x\udbff\udfff']
  for(let n=0;n<keys.length;n++) {
    const ordered=keys.slice(n).concat(keys.slice(0,n)).reverse()
    const value={nested:Object.fromEntries(ordered.map((key,i)=>[key,[true,null,i,{[key]:'text'}]]))}
    assert.equal(canonical(value),canonicalJson(value))
  }
})
