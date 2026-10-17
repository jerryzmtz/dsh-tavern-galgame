import {tmpdir as publicTmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readdir,rm} from 'node:fs/promises'
import {planModConfigMigration} from '../tavern-plugin/lib/domain/mods/config-migration.js'
import {createModConfigMigration} from '../tavern-plugin/lib/fork-mod-config-migration.js'
const schemas={'dsh.phone':{fields:[{key:'clockText',valueType:'string',default:'09:41'},{key:'battery',valueType:'number',default:80}]},'dsh.items':{fields:[{key:'inventory',valueType:'array',default:[]}]}}
function fixture() {
  const extension={
    variableBindings:{version:1,entries:[{target:{kind:'mods',modId:'dsh.items',slot:'inventory'},variable:{source:'mvu',path:'/所持品'}}]},
    modBindings:{version:1,mods:{'dsh.phone':{settings:{clockText:'07:00'},boundPackIds:[]}}},
  }
  return {
    native:{value:{global:{enabledModIds:['dsh.phone'],mods:{'dsh.phone':{settings:{battery:76}}}}}},
    cards:[{cardId:'card-92',name:'背包测试',workspace:{raw:{name:'背包测试',extensions:{dsh_tavern:extension}}}}],
    configs:{global:{},cards:{}},
  }
}
test('single exact migration moves sparse settings and references, retires storage, keeps global switch',()=>{
  const source=fixture(),before=structuredClone(source),plan=planModConfigMigration(source,schemas)
  assert.deepEqual(source,before)
  assert.deepEqual(plan.next.configs.cards['card-92']['dsh.items'].values.inventory,{ref:{source:'mvu',path:'/所持品'}})
  assert.deepEqual(plan.next.configs.cards['card-92']['dsh.phone'].values.clockText,{fixed:'07:00'})
  assert.deepEqual(plan.next.configs.global['dsh.phone'].values.battery,{fixed:76})
  assert.equal(plan.next.cards[0].workspace.raw.extensions.dsh_tavern.variableBindings,undefined)
  assert.equal(plan.next.native.value.global.mods['dsh.phone'].settings,undefined)
  assert.deepEqual(plan.next.native.value.global.enabledModIds,['dsh.phone'])
  assert.equal(planModConfigMigration(plan.next,schemas).changed,false)
  source.configs.cards['card-92']={'dsh.items':{version:1,values:{inventory:{ref:{source:'mvu',path:'/Other'}}}}}
  assert.throws(()=>planModConfigMigration(source,schemas),{code:'CONFIG_MIGRATION_CONFLICT'})
})
test('dry-run writes nothing; apply uses one complete backup and atomic owner CAS; rerun no-op',async t=>{
  const backupRoot=await mkdtemp(publicTmpdir()+'/mod-config-migration-');t.after(()=>rm(backupRoot,{recursive:true,force:true}))
  let source=fixture(),writes=0,failOnce=true
  const controller=createModConfigMigration({schemas,backupRoot,snapshot:async()=>structuredClone(source),assertIdle:async()=>{},publish:async({before,next})=>{assert.deepEqual(source,before);if(failOnce){failOnce=false;throw Error('Interrupted before publication')}source=next;writes++}})
  const dry=await controller.run({apply:false});assert.equal(dry.changes.length,3);assert.equal(writes,0);assert.deepEqual(await readdir(backupRoot),[])
  await assert.rejects(controller.run({apply:true}),/Interrupted/);assert.equal(writes,0);assert.equal((await readdir(backupRoot)).length,1)
  const result=await controller.run({apply:true});assert.equal(result.verified,true);assert.equal(writes,1);assert.equal((await readdir(backupRoot)).length,1)
  assert.deepEqual((await controller.readBackup(result.backup)).before,fixture())
  assert.equal((await controller.run({apply:true})).writes,0);assert.equal(writes,1)
})
