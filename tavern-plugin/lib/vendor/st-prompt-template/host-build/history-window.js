import {diffJson} from '../../../domain/json-mutation.js'
const windows=new WeakMap()
export const templateHistoryIndices=chat=>windows.get(chat)?.loaded()

// A real array preserves absolute floors and synchronous upstream reads. Internal
// snapshots contain loaded rows only, so bookkeeping never activates accessors.
export function createTemplateHistoryWindow({window,rows,read}) {
 const values=new Map(),base=new Map(),chat=new Array(window.messageCount)
 function install(id,row){base.set(id,structuredClone(row));values.set(id,structuredClone(row))}
 rows.forEach((row,index)=>install(window.from+index,row))
 for(let id=0;id<chat.length;id++)Object.defineProperty(chat,String(id),{
  enumerable:true,configurable:false,
  get(){if(!values.has(id))install(id,read(id,window));return values.get(id)},
  set(row){if(!values.has(id))install(id,read(id,window));values.set(id,row)}
 })
 const api={chat,loaded:()=>[...values.keys()].sort((a,b)=>a-b),
  changes(){
   if(chat.length!==window.messageCount)throw Error('模板不能改变聊天楼层数量')
   return [...values].flatMap(([id,row])=>diffJson(base.get(id),row).map(change=>({...change,path:['chat',id,...change.path]})))
  },
  baseline(){const rows=new Array(chat.length);for(const [id,row] of base)rows[id]=structuredClone(row);return rows},
  materialize(){const rows=new Array(chat.length);for(const [id,row] of values)rows[id]=structuredClone(row);return rows},
  acknowledge(submitted,saved,reconcile){for(const id of values.keys()){
   if(!submitted[id])continue
   reconcile(values.get(id),submitted[id],saved[id]);base.set(id,structuredClone(saved[id]))
  }}
 }
 windows.set(chat,api)
 return api
}
