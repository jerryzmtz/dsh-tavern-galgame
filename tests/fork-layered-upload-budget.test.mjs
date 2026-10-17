import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createAssetPackTransport} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/transport.js'
test('atomic layered uploads use bounded file-ticket quota, not the 16 import-preview quota',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'layered-upload-')),routes=new Map()
  const host=createAssetPackTransport({assetRoot:root,limits:{previews:1,uploads:24,spoolBytes:128}})
  const stop=host.attach({fetch:{register(route){routes.set(route.path,route);return()=>routes.delete(route.path)}}})
  t.after(async()=>{stop();await host.service.dispose();await rm(root,{recursive:true,force:true})})
  const request=(route,body,type)=>routes.get('/api/dsh-asset-library/v2/'+route).fetch(new Request('http://dsh.internal/api/dsh-asset-library/v2/'+route,{method:'POST',headers:{host:'localhost:123',origin:'http://localhost:123','sec-fetch-site':'same-origin','content-type':type},body}))
  const upload=bytes=>request('upload',bytes,'application/octet-stream'),tickets=[]
  for(let i=0;i<24;i++){const r=await upload(new Uint8Array([1]));assert.equal(r.status,200);tickets.push((await r.json()).ticket)}
  assert.equal((await upload(new Uint8Array([1]))).status,413)
  assert.equal((await request('control',JSON.stringify({method:'discardUpload',args:{ticket:tickets[0]}}),'application/json')).status,200)
  assert.equal((await upload(new Uint8Array(110))).status,413,'Shared byte budget remains enforced')
  assert.equal((await upload(new Uint8Array([1]))).status,200,'Released ticket restores count capacity')
})
