import test from 'node:test'
import assert from 'node:assert/strict'
import {generateSceneImage} from '../tavern-plugin/packages/dsh-image-gen/src/tavern/scene-image-provider.js'
import {assetImageCapability} from '../tavern-plugin/packages/dsh-image-gen/src/tavern/scene-image-channels.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64')
const input = {provider:'openai', protocol:'images', baseURL:'http://127.0.0.1:20129/v1', model:'cx/gpt-image-2.5', apiKey:'mock-secret', prompt:'Draw the selected character', assetOutput:{size:'1024x1536', background:'transparent', quality:'high'}}
const reference = {data:png, mediaType:'image/png'}

test('Images asset capability remains limited to OpenAI protocols', () => {
  assert.equal(assetImageCapability(input).supported,true)
  assert.equal(assetImageCapability({...input,protocol:'responses-image-tool'}).supported,true)
  for (const provider of ['gemini','novelai','banana']) assert.equal(assetImageCapability({...input,provider}).supported,false)
})

for (const size of ['1024x1536','1536x1024','1024x1024']) test('asset edits multipart preserves references and output: ' + size, async () => {
  let calls=0
  const result=await generateSceneImage({...input,assetOutput:{...input.assetOutput,size},referenceImages:Array(4).fill(reference)}, {fetch:async(url,init)=>{
    calls++
    assert.equal(url,input.baseURL+'/images/edits')
    assert.equal(init.headers.authorization,'Bearer mock-secret')
    assert.equal(init.headers['content-type'],undefined)
    assert.ok(init.body instanceof FormData)
    const form=await new Request(url,init).formData()
    assert.equal(form.get('model'),input.model)
    assert.equal(form.get('prompt'),input.prompt)
    assert.equal(form.get('background'),'transparent')
    assert.equal(form.get('size'),size)
    assert.equal(form.get('quality'),'high')
    assert.equal(form.get('n'),'1')
    assert.equal(form.get('output_format'),'png')
    assert.equal(form.getAll('image[]').length,4)
    for (const file of form.getAll('image[]')) {
      assert.equal(file.type,'image/png')
      assert.deepEqual(Buffer.from(await file.arrayBuffer()),png)
    }
    return Response.json({data:[{b64_json:png.toString('base64')}]})
  }})
  assert.equal(calls,1)
  assert.ok(result)
})

test('asset without references uses JSON generations with explicit background',async()=>{
  await generateSceneImage(input,{fetch:async(url,init)=>{
    assert.equal(url,input.baseURL+'/images/generations')
    assert.equal(init.headers['content-type'],'application/json')
    assert.deepEqual(JSON.parse(init.body),{model:input.model,prompt:input.prompt,n:1,...input.assetOutput,output_format:'png'})
    return Response.json({data:[{b64_json:png.toString('base64')}]})
  }})
})

test('invalid asset references are rejected before dispatch',async()=>{
  for(const referenceImages of [Array(5).fill(reference),[{...reference,data:Buffer.alloc(0)}],[{...reference,data:Buffer.alloc(8*1024**2+1)}],[{...reference,mediaType:'text/plain'}]]) {
    await assert.rejects(generateSceneImage({...input,referenceImages},{fetch:async()=>assert.fail('must not dispatch')}),error=>error.imageOutcome==='not_requested')
  }
})

test('Images errors preserve rejection versus possibly charged outcomes without retry',async()=>{
  for (const [status,code,outcome] of [[400,'content_policy_violation','rejected'],[401,'invalid_key','rejected'],[500,'upstream_error','unconfirmed'],[429,'rate_limit','unconfirmed']]) {
    let calls=0
    await assert.rejects(generateSceneImage({...input,referenceImages:[reference]}, {fetch:async()=>{
      calls++
      return Response.json({error:{code,message:'failure mock-secret'}},{status})
    }}),error=>{
      assert.equal(error.imageOutcome,outcome)
      assert.equal(error.imageFailure.httpStatus,status)
      if(status===400) assert.equal(error.code,'IMAGE_REFUSED')
      assert.doesNotMatch(error.message,/mock-secret/)
      return true
    })
    assert.equal(calls,1)
  }
  await assert.rejects(generateSceneImage(input,{fetch:async()=>{throw new Error('network lost')}}),error=>error.imageOutcome==='unconfirmed')
  await assert.rejects(generateSceneImage(input,{fetch:async()=>Response.json({data:[]})}),error=>error.code==='IMAGE_NO_RESULT'&&error.imageOutcome==='unconfirmed')
})
