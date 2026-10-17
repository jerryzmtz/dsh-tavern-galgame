import {itemCatalogue,selectItem,reconcileItems,inventoryContext} from './logic.js'

const categoryView=(catalogue,settings)=>itemCatalogue(catalogue,{categories:settings.values?.categories,layer:settings.layers?.categories})
function itemCommand(manifest,view) {
  const command=structuredClone(manifest.commands[0])
  command.params.properties.genre={type:'string',enum:view.genres}
  return command
}
export function commandSchema({manifest}) {
  return [structuredClone(manifest.commands[0])]
}
export function configure({manifest,catalogue,settings={},bindings={}}) {
  const view=categoryView(catalogue,settings),command=itemCommand(manifest,view)
  if(!view.genres.length)return {commands:[]}
  command.admission={requires:[{field:'action',values:['gain','lose'],available:bindings.inventory?.source==='mvu',code:'MOD_DEPENDENCY_MISSING'}],names:[{field:'name',scope:'genre',force:'force',unknown:'ITEM_UNKNOWN',ambiguous:'ITEM_AMBIGUOUS',groups:view.genres.map(genre=>{
      const rows=view.rows.filter(row=>row.recalled && row.genre===genre),terms=new Map()
      for(const row of rows)for(const term of row.terms) {
        const names=terms.get(term) || []
        if(!names.some(value=>value.key===row.nameKey))names.push({key:row.nameKey,name:row.name})
        terms.set(term,names)
      }
      return {value:genre,terms:[...terms].map(([term,names])=>({term,names:names.map(row=>row.name)})),candidates:[...new Set(rows.map(row=>row.name))].slice(0,3)}
    })}]}
  return {commands:[command]}
}
export async function prepare(_input,host,context) {
  const settings=await host.settings.get({})
  if(!settings.values.s4)return null
  const result=await host.variables.getTurn({turn:context.turn})
  if(!result.ok)return null
  const text=inventoryContext(result.value.values.inventory?.value,context.variableBindings?.inventory,{enabled:true})
  return text?{sections:[{id:'inventory-context',text}]}:null
}
export async function command({params},host,context) {
  const settings=await host.settings.get({})
  const catalogue=itemCatalogue(await host.library.snapshot({}),{categories:settings.values?.categories,layer:settings.layers?.categories})
  const payload=selectItem(catalogue,params,{binding:context.variableBindings?.inventory})
  return host.stage.place({id:'item',kind:'dsh.items.item',payload,...(params.action==='show' || context.variableBindings?.inventory?.source!=='mvu'?{}:{pairing:{readId:'inventory',path:[]}})})
}
export async function settled(settlement,host) {
  const revisions=reconcileItems(settlement)
  if(!revisions.length)return null
  return host.stage.reviseAfterSettlement({settlementRevision:settlement.settlementRevision,revisions})
}
export function dispose() {}
