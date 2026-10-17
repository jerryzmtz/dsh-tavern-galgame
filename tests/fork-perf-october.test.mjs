import test from 'node:test'
import assert from 'node:assert/strict'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {cardExtension,PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {chromium} from 'playwright'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'

test('revision probes reuse frozen pack snapshots, but still observe external replacement and revocation',async()=>{
  let revision='one', reads=0, copies=0, notify, selected
  const service={apiVersion:2,subscribe:fn=>{notify=fn;return()=>{}},async getPackSnapshot(){reads++;return revision===null?null:{revision,manifest:{id:PACK_ID,get assets(){copies++;return []}},performances:{},skins:{}}}}
  selected=service
  const consumer=createAssetPackPresentation({raw:{extensions:{dsh_tavern:cardExtension()}},getService:()=>selected})
  try {
    const ref={packId:PACK_ID,kind:'performances',assetId:'fixture'}
    const first=(await consumer.performanceMetadata([ref]))[0]
    assert.ok(Object.isFrozen(first.manifest));assert.equal(copies,1)
    for(let i=0;i<100;i++)assert.equal((await consumer.performanceMetadata([ref]))[0],first)
    assert.equal(reads,101,'each read still probes publication revision');assert.equal(copies,1,'stable metadata is not deep-cloned per boundary')
    revision='two';const second=(await consumer.performanceMetadata([ref]))[0]
    assert.notEqual(second,first);assert.equal(second.revision,'two');assert.equal(copies,2)
    notify({packId:PACK_ID,revision:'two'});assert.notEqual((await consumer.performanceMetadata([ref]))[0],second)
    revision=null;assert.deepEqual(await consumer.performanceMetadata([ref]),[])
    selected=null;await assert.rejects(consumer.performanceMetadata([ref]),{code:'ASSET_UNAVAILABLE'})
  } finally {consumer.dispose()}
})

test('entering film mode snaps subtitle width while preserving animated letterbox bars',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1600,height:866}})
  await page.setContent('<div class="fork-gal-stage" data-theme="classic"><div class="fork-gal-letterbox"><i></i><i></i></div><div class="fork-gal-box"><div class="fork-gal-text">Subtitle width</div></div></div>')
  await page.addStyleTag({content:await forkThemeCss()})
  await page.waitForTimeout(50)
  const widths=await page.evaluate(async()=>{
    const stage=document.querySelector('.fork-gal-stage'),box=stage.querySelector('.fork-gal-box'),text=stage.querySelector('.fork-gal-text')
    const before=text.getBoundingClientRect().width;stage.classList.add('is-film');const widths=[]
    for(let i=0;i<10;i++){await new Promise(requestAnimationFrame);widths.push(text.getBoundingClientRect().width)}
    return {before,widths,properties:getComputedStyle(box).transitionProperty,bars:getComputedStyle(stage.querySelector('.fork-gal-letterbox i')).transitionProperty}
  })
  assert.ok(widths.before>1100);assert.ok(widths.widths.every(w=>Math.abs(w-1100)<1),JSON.stringify(widths))
  assert.ok(!widths.properties.split(',').map(x=>x.trim()).includes('width'))
  assert.match(widths.bars,/transform/)
})
