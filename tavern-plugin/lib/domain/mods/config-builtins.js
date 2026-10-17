import {variableGuessHints} from '../variable-bindings/index.js'
import {ITEM_CATEGORIES} from '../../../../fork/mods/items/categories.js'
export const PHONE_TONES=Object.freeze([{value:'drop',label:'水滴'},{value:'chime',label:'叮咚'},{value:'pop',label:'轻响'},{value:'none',label:'静音'}])
export function builtinConfigSchemas(manifests) {
  const schemas={}
  for(const manifest of manifests) {
    const fields=manifest.settingsSchema.fields.map(field=>({
      key:field.key,label:field.label,valueType:field.type==='toggle'?'boolean':field.type==='slider'?'number':field.type==='colour' || field.type==='text' || field.type==='segmented'?'string':'object',
      default:field.default,scope:'default+card',...(field.default===null?{nullable:true}:{}),
      ...(field.min===undefined?{}:{min:field.min,max:field.max}),...(field.maxLength?{maxLength:field.maxLength}:{}),
      ...(field.choices?{choices:field.choices.map(row=>row.value)}:{}),
      ui:{...(field.type==='colour'?{control:'colour'}:field.type==='segmented'?{control:'choice',choices:field.choices}:field.type==='text'?{control:'text'}:{}),...(field.unit?{unit:field.unit}:{}),...(field.type==='slider'?{integer:Number.isInteger(field.step)}:{})},
    }))
    if(manifest.id==='dsh.phone') {
      // private fork (mod-pages, owner 2026-10): the settings page names what the player sees on the phone.
      Object.assign(fields.find(row=>row.key==='clockText'),{label:'状态栏时间',guessHints:variableGuessHints.time,ui:{control:'time'}})
      Object.assign(fields.find(row=>row.key==='cutout'),{label:'机型'})
      Object.assign(fields.find(row=>row.key==='battery'),{label:'电量',min:0})
      // 来信提示音: a few built-in sounds (view/assets/<value>.wav), 静音 = none.
      Object.assign(fields.find(row=>row.key==='sound'),{valueType:'string',default:'drop',choices:PHONE_TONES.map(row=>row.value),ui:{control:'choice',choices:PHONE_TONES}})
      Object.assign(fields.find(row=>row.key==='accentColor'),{label:'主题色',default:'#6f8fd8',autoRef:{source:'stage',path:'/mainCharacterColor'},autoLabel:'主角形象色'})
      Object.assign(fields.find(row=>row.key==='surfaceColor'),{default:'#f4f2ec',autoRef:{source:'stage',path:'/skin/surface'},autoLabel:'舞台皮肤'})
      Object.assign(fields.find(row=>row.key==='bodyColor'),{default:'#3b3a38',autoRef:{source:'stage',path:'/skin/line'},autoLabel:'舞台皮肤'})
      fields.find(row=>row.key==='battery').ui={unit:'%',integer:true}
      // 壁纸: a set of up to 8 uploaded images — the default (marked, else first) on the phone, all of them the director's
      // candidates. 本卡's set replaces 全局's set as a whole (phone-presentation.js).
      fields.push({key:'wallpaper',label:'壁纸',valueType:'array',default:[],ui:{control:'images'}})
      fields.push({key:'dateText',label:'日期',valueType:'string',default:'',guessHints:variableGuessHints.date})
      fields.push({key:'weekdayText',label:'星期',valueType:'string',default:'',guessHints:variableGuessHints.weekday})
      fields.push({key:'signal',label:'信号',valueType:'number',default:4,min:0,max:4,ui:{integer:true}})
      fields.push({key:'carrier',label:'运营商',valueType:'string',default:'',maxLength:64})
      // Contacts come from the card's characters (stage alias); a fixed value overrides 备注名 / 头像 per alias:
      // {[alias]:{name?:string,avatar?:{file}}}. Avatar files live in the same layer's files/.
      fields.push({key:'contacts',label:'联系人',valueType:'object',default:{},records:{name:'text',avatar:'image'}})
    }
    for(const slot of manifest.variableSlots || [])if(manifest.id!=='dsh.items' && !fields.some(field=>field.key===slot.id))fields.push({key:slot.id,label:slot.label,valueType:slot.valueType,default:[],fieldMapping:slot.fieldMapping || {}})
    if(manifest.id==='dsh.items')fields.push({key:'inventory',label:'背包',valueType:'array',default:[],fieldMapping:manifest.variableSlots.find(row=>row.id==='inventory').fieldMapping,guessHints:variableGuessHints.inventory})
    if(manifest.id==='dsh.items')fields.push({key:'categories',label:'分类',valueType:'array',default:structuredClone(ITEM_CATEGORIES),ui:{control:'categories'}})
    schemas[manifest.id]={fields}
  }
  return schemas
}
export const stageConfigExports=[
  ['background','object','当前背景'],['timeOfDay','string','当前时段'],['characters','array','在场人物及形象色'],['contacts','array','手机联系人'],['speaker','string','当前说话人身份'],['mainCharacterColor','string','主角形象色'],['bgm','object','当前背景音乐'],['skin','object','舞台皮肤颜色'],
].map(([key,type,description])=>({path:'/'+key,name:key,type,description}))
