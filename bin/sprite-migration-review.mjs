// private fork: offline pixel evidence and thumbnails, with the installed browser decoder.
import fs from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright'
import {spriteMigrationMeaning,spriteMigrationCanonical} from './sprite-migration-policy.mjs'
import {LEGACY_FIGURE_EMOTIONS as FIGURE_EMOTIONS} from './sprite-migration-policy.mjs'
export async function createSpritePixelReader(library, out) {
  const browser=await chromium.launch({headless:true}),page=await browser.newPage()
  await page.goto('about:blank')
  return {close:()=>browser.close(),async read(input){
    const result={},cache=new Map()
    for(const figure of Object.values(input.figures))for(const outfit of figure.outfits){
      if(!outfit.sprite)continue
      const key=outfit.sprite.manifestKey,manifest=input.sprites[key]
      // Pure canonical builtin outfits have no orphans. All other outfits retain full pixel evidence.
      if(new Set(manifest.states.map(s=>s.id)).size===manifest.states.length&&manifest.states.every(s=>FIGURE_EMOTIONS.some(row=>row.id===s.id)&&spriteMigrationCanonical(s.emotion||s.id)===s.id&&spriteMigrationMeaning(s,FIGURE_EMOTIONS).id===s.id))continue
      if(result[key])continue
      result[key]={}
      for(const state of manifest.states){
        const src=state.stage?.src||state.src,hash=outfit.sprite.assets[src],blob=input.manifest.blobs[hash]
        if(!blob)throw new Error('Missing image for pixel review: '+key+'/'+state.id)
        let image=cache.get(hash)
        if(!image){
          const bytes=await fs.readFile(path.join(library,'packs',input.manifest.id,'media',hash+'.'+blob.ext))
          image=await page.evaluate(async({data,mime})=>{
            const img=new Image();img.src='data:'+mime+';base64,'+data;await img.decode()
            const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128
            const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,128,128)
            const rgba=ctx.getImageData(0,0,128,128).data
            const thumb=document.createElement('canvas');thumb.width=180;thumb.height=240
            const scale=Math.min(180/img.width,240/img.height);thumb.getContext('2d').drawImage(img,(180-img.width*scale)/2,0,img.width*scale,img.height*scale)
            return {pixels:btoa(String.fromCharCode(...rgba)),aspect:img.width/img.height,thumbnail:thumb.toDataURL('image/png').split(',')[1]}
          },{data:bytes.toString('base64'),mime:blob.mime})
          image={...image,pixels:Buffer.from(image.pixels,'base64')};cache.set(hash,image)
        }
        result[key][state.id]=image
        const target=path.join(out,'thumbnails',input.manifest.id,key,state.id+'.png')
        await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,Buffer.from(image.thumbnail,'base64'))
      }
    }
    return result
  }}
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export async function writeSpriteMigrationReview(out,plans){
  const counts=r=>['A','fills','redundant','custom','newCustomEmotions','uncertain','fillList'].map(k=>'<td>'+r[k].length+'</td>').join('')
  const thumbnail=(input,row,state=row.state)=>{
    const outfit=input.figures[row.figureId].outfits.find(o=>o.key===row.outfitKey)
    return 'thumbnails/'+input.manifest.id+'/'+outfit.sprite.manifestKey+'/'+state+'.png'
  }
  const totals=Object.fromEntries(['A','fills','redundant','custom','newCustomEmotions','uncertain','fillList'].map(key=>[key,plans.reduce((sum,{next})=>sum+next.report[key].length,0)]))
  const examples=[...new Set(plans.flatMap(({next})=>next.report.newCustomEmotions.map(row=>row.label)))].slice(0,6)
  const ownerSummary='<section><h2>这次会做什么</h2><p>先找回 '+totals.A+' 处本来就有的图片；多出来的图片里，'+totals.fills+' 张补进标准差分，'+totals.redundant+' 张重复或同义图移到包外归档，'+totals.custom+' 张明确不同的图保留为自定义差分。剩下 '+totals.uncertain+' 张难判断的图，也默认放进可恢复的包外归档，不会悄悄丢掉。</p><p>预计新增 '+totals.newCustomEmotions+' 个自定义差分定义，例如「'+examples.map(escape).join('」「')+'」。定义属于人物；只有服装自己有图，才会出现在该服装的选择里。'+totals.fillList+' 个标准缺图槽继续缺图，以后慢慢补，不生成图片，也不拿别的差分冒充。</p><p>如需逐张改主意，编辑旁边的 <a href="owner-decisions.json">owner-decisions.json</a>：action 留 null 表示默认归档；archive 表示归档；assign 加 emotion 表示归到现有差分（被替换的旧图也保存在备份中）；custom 加 emotion、label，可选 guidance，表示新增自定义差分。命令用 --decisions 指定这份 JSON。所有包完整备份到包外后才进行 CAS 发布。</p></section>'
  const document={version:1,defaultAction:'archive',items:plans.flatMap(({input,next})=>next.report.uncertain.map(row=>({packId:input.manifest.id,figureId:row.figureId,outfitKey:row.outfitKey,state:row.state,sourceLabel:row.label,figure:row.figure,outfit:row.outfit,thumbnail:thumbnail(input,row),action:null,emotion:null,label:null,guidance:null})))}
  try{await fs.writeFile(path.join(out,'owner-decisions.json'),JSON.stringify(document,null,2),{flag:'wx'})}catch(error){if(error.code!=='EEXIST')throw error}
  let html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>迁移预演</title><style>body{font:16px/1.6 Georgia,"Microsoft YaHei",serif;background:#f6f2e8;color:#25382c;margin:32px}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #b5c1b4}.grid{display:flex;flex-wrap:wrap;gap:16px}article{padding:12px;background:#fff;width:380px}img{width:180px;height:240px;object-fit:contain;background:repeating-conic-gradient(#eee 0% 25%,#ddd 0% 50%) 0 0/16px 16px}code{overflow-wrap:anywhere}</style><h1>迁移预演</h1>'+ownerSummary+'<p>四桶：补标准槽 / 冗余包外归档 / 独立自定义 / 不确定图默认归档。缺图保持缺图；不存 fallback 或 excluded。原借用仅限同人物同服装，从未跨人物。此处只读副本，未发布。</p><p>近重复依据透明度预乘像素差及 32×32 局部块差（避免整身未变稀释眼口差异），不计算文件哈希。自动像素相似性不是语义分类器；下列缩略图保留标签检查证据，歧义标签不擅自定性，默认包外归档；可用 JSON 明确改选。</p><table><tr><th>包</th><th>A 恢复</th><th>补标准槽</th><th>冗余</th><th>自定义图</th><th>新增自定义</th><th>不确定</th><th>缺图槽</th></tr>'
  for(const {next}of plans)html+='<tr><td>'+escape(next.report.name)+'</td>'+counts(next.report)+'</tr>'
  html+='</table><h2>拟新增自定义差分（人物内复用，服装仅有图才提供）</h2>'
  for(const {next}of plans)for(const row of next.report.newCustomEmotions)html+='<p>'+escape(next.report.name+' / '+row.figure+' / '+row.label+' ('+row.id+') — '+row.guidance)+'</p>'
  for(const kind of ['uncertain','redundant','fills','custom']){
    html+='<h2>'+escape({uncertain:'不确定差分：默认包外归档，可恢复',redundant:'冗余差分：包外归档',fills:'补入标准差分',custom:'独立自定义差分'}[kind])+'</h2><div class="grid">'
    for(const {input,next}of plans)for(const row of next.report[kind])html+='<article><b>'+escape(next.report.name+' / '+row.figure+' / '+row.outfit)+'</b><p>'+escape(row.label+' ['+row.state+'] → '+(row.emotion||row.reason||row.suggestedBucket))+'</p><img loading="lazy" src="'+escape(thumbnail(input,row))+'">'+(row.duplicate?'<img loading="lazy" src="'+escape(thumbnail(input,row,row.duplicate.state))+'"><p>'+escape(JSON.stringify(row.duplicate.comparison))+'</p>':'')+'<p>'+escape(row.suggestedBucket||'')+'</p></article>'
    html+='</div>'
  }
  html+='<h2>标准缺图清单</h2><p>完整逐槽数据见 missing-slots.json；所有图像字节仍在输入副本，apply 前完整包外备份。</p></html>'
  await fs.writeFile(path.join(out,'REPORT.html'),html)
  await fs.writeFile(path.join(out,'missing-slots.json'),JSON.stringify(plans.map(({next})=>({packId:next.report.packId,name:next.report.name,count:next.report.fillList.length,slots:next.report.fillList})),null,2))
}
