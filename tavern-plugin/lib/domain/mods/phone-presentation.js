import {wallpaperChoices,phoneDevices} from '../../../../fork/mods/phone/logic.js'

// The configured collection is private phone presentation state, not an asset pack or director catalogue.
export const PHONE_WALLPAPER_MAX=8
export function phoneWallpaperSet(value,layer) {
  const rows=(Array.isArray(value)?value:value?.file?[{file:value.file}]:[]).filter(row=>typeof row?.file==='string' && /^files\/[0-9a-f-]{36}\.(png|webp|jpg)$/.test(row.file)).slice(0,PHONE_WALLPAPER_MAX)
  if(!['global','card'].includes(layer) || !rows.length)return null
  const marked=rows.findIndex(row=>row.default===true),first=marked<0?0:marked
  return {layer,packId:'config.'+layer,rows:rows.map((row,i)=>({entryId:row.file.slice(6,42),file:row.file,name:typeof row.name==='string' && row.name.trim()?row.name.trim():'壁纸 '+(i+1),default:i===first}))}
}
export function withPhoneWallpaperSet(catalogue,set) {
  if(!catalogue || !set || !phoneDevices(catalogue).length)return catalogue
  const wallpapers=set.rows.map(row=>{
    const ref={modId:'dsh.phone',packId:set.packId,kind:'wallpaper',entryId:row.entryId}
    return {id:JSON.stringify([ref.modId,ref.packId,ref.kind,ref.entryId]),ref,name:row.name,image:row.file}
  })
  return {...catalogue,phone:{...catalogue.phone,wallpapers}}
}

export function phoneSourceView(catalogue) {
  const device=phoneDevices(catalogue)[0]
  return device ? {device,wallpapers:wallpaperChoices(catalogue)} : null
}

// The first-party source view shares the stage's source/thread/media owner, not the widget catalogue.
export function phoneViewDocument(files) {
  return files.get('view/index.html').toString('utf8')
    .replace('<meta charset="utf-8">','<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">')
    .replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+files.get('view/style.css').toString('utf8')+'</style>')
    // private fork (settings-ux r2): every view script is inlined (battery.js holds the battery levels shared with the settings preview).
    .replace(/<script src="([a-z0-9-]+\.js)"><\/script>/g,(_,name)=>'<script>'+files.get('view/'+name).toString('utf8').replace(/<\/script/gi,'<\\/script')+'</script>')
}
export function phonePresentation({view,settings,document,version,wallpaper=null}) {
  return {ref:view.device,sourceOnly:true,modSource:true,state:{},wallpaperChoices:view.wallpapers,
    mediaPolicy:{music:false,sfx:true},
    definition:{modId:'dsh.phone',title:'手机',thirdParty:true,contentIdentity:'dsh.phone:'+version,srcDoc:document,settings,
      settingAssets:{},inlineSettingAssets:wallpaper?{wallpaper}:{},assets:{},document:{presentation:{
        open:{width:280,height:607,minWidth:220,minHeight:477,anchor:'center-card',aspectRatio:280/607},
        compact:{width:320,height:104,minWidth:220,minHeight:88,anchor:'top-center'},notifications:'changes'}}}}
}
