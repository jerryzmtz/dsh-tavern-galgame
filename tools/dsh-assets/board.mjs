// private fork: deterministic nearest-neighbour board composition; sources are never rewritten.
import path from 'node:path'
import {readFile} from 'node:fs/promises'
import {decodeAssetRgba,encodeAssetRgba} from '../../tavern-plugin/lib/domain/asset-image-processing.js'
import {safeProjectFile,atomic,hash,productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
const assert=(ok,message)=>{if(!ok)throw productionError('INVALID_ARGUMENT',message)}
const font={A:'01110100011000111111100011000110001',B:'11110100011000111110100011000111110',C:'01111100001000010000100001000001111',D:'11110100011000110001100011000111110',E:'11111100001000011110100001000011111',F:'11111100001000011110100001000010000',G:'01111100001000010111100011000101111',H:'10001100011000111111100011000110001',I:'11111001000010000100001000010011111',J:'00111000100001000010100101001001100',K:'10001100101010011000101001001010001',L:'10000100001000010000100001000011111',M:'10001110111010110101100011000110001',N:'10001110011010110011100011000110001',O:'01110100011000110001100011000101110',P:'11110100011000111110100001000010000',Q:'01110100011000110001101011001001101',R:'11110100011000111110101001001010001',S:'01111100001000001110000010000111110',T:'11111001000010000100001000010000100',U:'10001100011000110001100011000101110',V:'10001100011000110001100010101000100',W:'10001100011000110101101011101110001',X:'10001100010101000100010101000110001',Y:'10001100010101000100001000010000100',Z:'11111000010001000100010001000011111','0':'01110100011001110101110011000101110','1':'00100011000010000100001000010001110','2':'01110100010000100010001000100011111','3':'11110000010000101110000010000111110','4':'00010001100101010010111110001000010','5':'11111100001000011110000010000111110','6':'01110100001000011110100011000101110','7':'11111000010001000100010000100001000','8':'01110100011000101110100011000101110','9':'01110100011000101111000010000101110','#':'01010010101111101010111110101001010','-':'00000000000000011111000000000000000',' ':'00000000000000000000000000000000000',':':'00000001000010000000001000010000000','.':'00000000000000000000000000011000110','/':'00001000100001000100010000100010000','_':'00000000000000000000000000000011111'}
export async function buildBoard(root,{config,out='boards/board.png',dryRun=false}) {
  const file=path.resolve(config),c=JSON.parse(await readFile(file,'utf8')),base=path.dirname(file)
  assert(c.schema_version===1,'Board config schema_version must be 1')
  const [width,height]=c.canvas||[]
  assert([width,height].every(n=>Number.isInteger(n)&&n>0&&n<=8192)&&width*height<=32*1024**2,'Invalid board canvas')
  assert(typeof out==='string'&&out.endsWith('.png'),'Board output must end in .png')
  const output=await safeProjectFile(root,out)
  assert(path.resolve(output+'.json')!==file,'Output would overwrite its source config')
  const data=new Uint8ClampedArray(width*height*4);data.fill(255)
  const sources=new Map(), warnings=[]
  for(const s of c.sources||[]) {
    assert(typeof s.source_id==='string'&&!sources.has(s.source_id),'Duplicate source_id')
    const source=await safeProjectFile(base,s.path)
    assert(path.resolve(source)!==path.resolve(output),'Output would overwrite an original source')
    const bytes=await readFile(source)
    assert(bytes[24]===8,'Board source must be 8-bit PNG; no silent depth conversion')
    const image=decodeAssetRgba(bytes),digest=hash(bytes)
    if(s.source_hash)assert(s.source_hash===digest,'Source changed: '+s.source_id)
    sources.set(s.source_id,{...image,bytes,path:s.path,portable_path:path.posix.basename(out)+'.sources/'+String(sources.size).padStart(4,'0')+'.png',source_hash:digest})
  }
  const bounds=(r,w,h,ltrb=false)=>{assert(Array.isArray(r)&&r.length===4&&r.every(Number.isInteger),'Coordinates must be four integers');const [x,y,a,b]=r,ww=ltrb?a-x:a,hh=ltrb?b-y:b;assert(x>=0&&y>=0&&ww>0&&hh>0&&x+ww<=w&&y+hh<=h,'Rectangle outside canvas');return [x,y,ww,hh]}
  const pixel=(x,y,rgba)=>{if(x<0||x>=width||y<0||y>=height)return;const i=(y*width+x)*4,a=rgba[3]/255;for(let k=0;k<3;k++)data[i+k]=Math.round(rgba[k]*a+data[i+k]*(1-a));data[i+3]=255}
  const blocks=[]
  for(const b of c.blocks||[]) {
    const src=sources.get(b.source_id);assert(src,'Unknown block source')
    assert(['observed','inferred','reconstructed'].includes(b.evidence_kind),'Block needs evidence_kind')
    const [sx,sy,sw,sh]=bounds(b.crop_ltrb,src.width,src.height,true),[x,y,w,h]=bounds(b.layout_xywh,width,height)
    assert(sw===w&&sh===h||b.resize==='nearest','Scaling requires explicit resize: nearest')
    for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++){const i=((sy+Math.floor(dy*sh/h))*src.width+sx+Math.floor(dx*sw/w))*4;pixel(x+dx,y+dy,src.data.subarray(i,i+4))}
    blocks.push({...b,source_hash:src.source_hash,native_size:[src.width,src.height]})
  }
  const text=(label,x,y,scale=1)=>{assert(Number.isInteger(scale)&&scale>0&&scale<=12,'Invalid text scale');assert(typeof label==='string'&&Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x+label.length*6*scale<=width&&y+7*scale<=height,'Label outside board canvas');for(const ch of label.toUpperCase()){assert(font[ch],'Board text font supports A-Z, 0-9, space and # - : . / _; keep source-language notes in config');const glyph=font[ch];for(let i=0;i<35;i++)if(glyph[i]==='1')for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++)pixel(x+(i%5)*scale+xx,y+Math.floor(i/5)*scale+yy,[20,20,20,255]);x+=6*scale}}
  for(const t of c.labels||[]) {assert(Array.isArray(t.xy)&&t.xy.every(Number.isInteger),'Label needs xy');text(t.text,...t.xy,t.scale||1)}
  const palette=[]
  for(const p of c.palette||[]) {
    const src=sources.get(p.source_id),[sx,sy]=p.sample_xy||[];assert(src&&Number.isInteger(sx)&&Number.isInteger(sy)&&sx>=0&&sy>=0&&sx<src.width&&sy<src.height,'Palette sample outside source')
    const rgba=src.data.subarray((sy*src.width+sx)*4,(sy*src.width+sx)*4+4);assert(rgba[3]===255,'Palette sample must be an evidenced opaque pixel')
    const hex='#'+[...rgba.subarray(0,3)].map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase()
    assert(p.role&&p.zone,'Palette requires role and zone')
    const [x,y,w,h]=bounds(p.layout_xywh,width,height)
    for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)pixel(x+dx,y+dy,rgba)
    if(p.label_xy)text(p.zone+' '+p.role+' '+hex,...p.label_xy,p.text_scale||1)
    palette.push({...p,hex,evidence_kind:'observed'})
  }
  for(const r of c.rulers||[]) {
    const src=sources.get(r.source_id),b=blocks[r.block_index];assert(src&&b&&b.source_id===r.source_id,'Ruler must reference its displayed source block')
    assert(typeof r.definition==='string'&&typeof r.occlusion_notes==='string','Ruler needs definition and occlusion_notes')
    const [l,t,right,bottom]=b.crop_ltrb,[bx,by,bw,bh]=b.layout_xywh,x=r.x
    assert(Number.isInteger(x)&&x>=0&&x+8<width,'Ruler x outside board')
    const ys=[]
    for(const key of ['head_top','chin','sole'])if(r[key]!==undefined){assert(Number.isFinite(r[key])&&r[key]>=t&&r[key]<bottom,'Ruler measurement outside visible crop');const y=Math.round(by+(r[key]-t)*bh/(bottom-t));ys.push(y);for(let dx=0;dx<8;dx++)pixel(x+dx,y,[0,0,0,255]);text(key,x+10,y)}
    if(ys.length)for(let y=Math.min(...ys);y<=Math.max(...ys);y++)pixel(x,y,[0,0,0,255])
    if(r.sole===undefined)warnings.push({code:'OCCLUDED_SOLE',severity:'warning',message:'No full-body ratio computed from an occluded sole'})
    void l;void right;void bx;void bw
  }
  const bytes=encodeAssetRgba({width,height,data}),portableSources=[...sources].map(([source_id,s])=>({source_id,path:s.portable_path,source_hash:s.source_hash,original_path:s.path})),metadata={...c,sources:portableSources,blocks,palette,board_path:path.posix.basename(out),board_hash:hash(bytes),referenced_sources:portableSources,shown_sources:[...new Set(blocks.map(b=>b.source_id))]}
  if(!dryRun){for(const s of sources.values())await atomic(root,path.posix.join(path.posix.dirname(out),s.portable_path),s.bytes);await atomic(root,out,bytes);await atomic(root,out+'.json',Buffer.from(JSON.stringify(metadata,null,2)+'\n'))}
  return {path:out,width,height,size:bytes.length,palette,metadata,warnings,dryRun}
}
