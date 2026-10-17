import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createPromptTemplateGlobalVariables } from '../tavern-plugin/lib/domain/prompt-template-global-variables.js'
test('全局变量持久化、并发合并、删除与原子冲突保护',async t=>{
 const root=await mkdtemp(join(tmpdir(),'template-globals-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const open=()=>createPromptTemplateGlobalVariables(createProfileDataStore({dataRoot:root}))
 const store=open()
 await store.save({hp:1,other:2})
 const baseline=await store.read()
 await store.save({hp:1,other:3},baseline)
 await store.save({hp:2,other:2},baseline)
 assert.deepEqual(await open().read(),{hp:2,other:3})
 await assert.rejects(store.save({hp:4,other:2,newKey:9},baseline),{code:'PROMPT_TEMPLATE_GLOBAL_CONFLICT'})
 assert.deepEqual(await store.read(),{hp:2,other:3})
 await store.save({hp:2},{hp:2,other:3})
 assert.deepEqual(await open().read(),{hp:2})
})
