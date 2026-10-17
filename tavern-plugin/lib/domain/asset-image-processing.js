import {inflateSync, deflateSync, crc32} from 'node:zlib'
import {resizeImage} from './sprite-blink-patch.js'
import {pngSize} from '../../packages/dsh-asset-library/lib/pack-v2/media.js'

const unsupported = () => { throw Object.assign(new Error('此图片需要非交错、8/16 bit PNG；请先通过普通图片导入转换'), {code:'UNSUPPORTED_IMAGE'}) }
const paeth = (a,b,c) => { const p = a+b-c, x = Math.abs(p-a), y = Math.abs(p-b), z = Math.abs(p-c); return x <= y && x <= z ? a : y <= z ? b : c }
function chunk(type, bytes) {
  const result = Buffer.alloc(bytes.length + 12)
  result.writeUInt32BE(bytes.length); result.write(type,4); bytes.copy(result,8)
  result.writeUInt32BE(crc32(result.subarray(4,-4)),result.length-4)
  return result
}
/** Byte-aligned PNG pixels, no resampling/model/dependency. Candidate ingress checks structure. */
function decode(bytes) {
  pngSize(bytes)
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24], color = bytes[25]
  const channels = {0:1,2:3,4:2,6:4}[color]
  if (![8,16].includes(depth) || !channels || bytes[28] !== 0) unsupported()
  const bpp = channels * depth / 8, stride = width*bpp, blocks = [], ancillary = []
  for (let p = 8; p < bytes.length;) {
    const n = bytes.readUInt32BE(p), type = bytes.toString('ascii',p+4,p+8)
    if (type === 'IDAT') blocks.push(bytes.subarray(p+8,p+8+n))
    if (['gAMA','cHRM','iCCP','sRGB','tRNS'].includes(type)) ancillary.push(bytes.subarray(p,p+n+12))
    p += n+12
  }
  const raw = inflateSync(Buffer.concat(blocks),{maxOutputLength:(stride+1)*height})
  if (raw.length !== (stride+1)*height) unsupported()
  const pixels = Buffer.alloc(stride*height)
  for (let y = 0; y < height; y++) {
    const offset = y*(stride+1), filter = raw[offset]
    if (filter > 4) unsupported()
    for (let x = 0; x < stride; x++) {
      const pos = y*stride+x, a = x >= bpp ? pixels[pos-bpp] : 0, b = y ? pixels[pos-stride] : 0, c = y && x >= bpp ? pixels[pos-stride-bpp] : 0
      pixels[pos] = (raw[offset+1+x] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a+b)/2) : paeth(a,b,c))) & 255
    }
  }
  return {pixels,width,height,depth,color,bpp,stride,ancillary,header:bytes.subarray(16,29)}
}
function encodeRect(image,x,y,width,height) {
  const stride = width*image.bpp, raw = Buffer.alloc((stride+1)*height)
  for (let row = 0; row < height; row++) image.pixels.copy(raw,row*(stride+1)+1,(y+row)*image.stride+x*image.bpp,(y+row)*image.stride+(x+width)*image.bpp)
  const header = Buffer.from(image.header); header.writeUInt32BE(width); header.writeUInt32BE(height,4)
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...image.ancillary,chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
}
export function cropAssetBackground(bytes) {
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), unit = Math.floor(Math.min(width/16,height/9))
  if (!unit) unsupported()
  const w = unit*16, h = unit*9
  return w === width && h === height ? bytes : encodeRect(decode(bytes),Math.floor((width-w)/2),Math.floor((height-h)/2),w,h)
}
export function sliceAssetAvatarSheet(bytes, emotionIds, {checks = {}} = {}) {
  const rows=Math.ceil(emotionIds.length/4),image = decode(bytes), width = Math.floor(image.width/4), height = Math.floor(image.height/rows)
  if (!width || !height || !rows || emotionIds.length>256 || image.width%4) unsupported()
  const side = Math.max(width,height), cells = [], dx = Math.floor((side-width)/2), dy = Math.floor((side-height)/2)
  const header = Buffer.from(image.header); header[8] = 8; header[9] = 6
  const square = pixels => ({...image,pixels,width:side,height:side,stride:side*4,bpp:4,header,ancillary:image.ancillary.filter(c => c.toString('ascii',4,8) !== 'tRNS')})
  for (const [index,id] of emotionIds.entries()) {
    if (!id) continue
    const pixels = Buffer.alloc(side*side*4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const src = (Math.floor(index/4)*height+y)*image.stride+(index%4*width+x)*image.bpp, dst = ((dy+y)*side+dx+x)*4, step = image.depth/8
      const gray = [0,4].includes(image.color)
      pixels[dst] = image.pixels[src]; pixels[dst+1] = image.pixels[src+(gray ? 0 : step)]; pixels[dst+2] = image.pixels[src+(gray ? 0 : 2*step)]
      pixels[dst+3] = [4,6].includes(image.color) ? image.pixels[src+image.bpp-step] : 255
    }
    const raw = encodeRect(square(pixels),0,0,side,side)
    // Inspect the ORIGINAL cell: subsequent translation/padding must not hide clipped hair.
    const source = checkAssetImage(raw,'avatar',{slice:true,cellWidth:width,cellHeight:height})
    cells.push({id,pixels,raw,source})
  }
  const boxes = cells.filter(c => c.source.hasTransparency && c.source.bbox).map(c => c.source.bbox)
  const heights = boxes.map(b => b.h).sort((a,b) => a-b), middle = Math.floor(heights.length/2)
  const median = heights.length ? (heights[middle]+heights[Math.floor((heights.length-1)/2)])/2 : 1
  // Bbox height is the head/shoulders proxy. One scale for the whole sheet, never per-cell fitting.
  const scale = Math.min(1,height*0.72/median,...boxes.map(b => Math.min(width*0.76/b.w,height*0.76/b.h)))
  return Object.fromEntries(cells.map(({id,pixels,raw,source}) => {
    const box = source.bbox
    if (!box || !source.hasTransparency) { checks[id] = source; return [id,raw] }
    const output = Buffer.alloc(side*side*4), w = Math.max(1,Math.round(box.w*scale)), h = Math.max(1,Math.round(box.h*scale))
    const left = Math.floor((side-w)/2), top = dy+Math.round(height*0.12)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = Math.max(0,Math.min(box.w-1,(x+0.5)/scale-0.5)), sy = Math.max(0,Math.min(box.h-1,(y+0.5)/scale-0.5))
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx-x0, fy = sy-y0, rgba = [0,0,0,0]
      // Premultiplied-alpha bilinear sampling avoids dark fringes around transparent hair.
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const pos = ((box.y+Math.min(box.h-1,y0+j))*side+box.x+Math.min(box.w-1,x0+i))*4
        const weight = (i ? fx : 1-fx)*(j ? fy : 1-fy), alpha = pixels[pos+3]*weight
        rgba[3] += alpha
        for (let c = 0; c < 3; c++) rgba[c] += pixels[pos+c]*alpha
      }
      const dst = ((top+y)*side+left+x)*4
      for (let c = 0; c < 3; c++) output[dst+c] = rgba[3] ? Math.round(rgba[c]/rgba[3]) : 0
      output[dst+3] = Math.round(rgba[3])
    }
    const result = encodeRect(square(output),0,0,side,side)
    checks[id] = checkAssetImage(result,'avatar',{slice:true})
    for (const warning of source.warnings) if (!checks[id].warnings.some(w => w.code === warning.code)) checks[id].warnings.push(warning)
    return [id,result]
  }))
}
export function alignAssetSprite(bytes, anchorBytes) {
  if (anchorBytes) return registerSprite(bytes,anchorBytes).bytes
  const image = decode(bytes), source = checkAssetImage(bytes,'sprite'), anchor = anchorBytes ? checkAssetImage(anchorBytes,'sprite') : null
  if (!source.bbox || !source.hasTransparency) throw Object.assign(new Error('立绘没有可用的透明人物轮廓'),{code:'ALIGNMENT_REQUIRED'})
  if (anchor && (anchor.width !== image.width || anchor.height !== image.height || !anchor.bbox)) throw Object.assign(new Error('画布与 calm 标尺不同，请在对齐器中手动调整'),{code:'ALIGNMENT_REQUIRED'})
  const box = source.bbox, ruler = anchor?.bbox
  const dx = Math.round((ruler ? ruler.x+ruler.w/2 : image.width/2) - (box.x+box.w/2))
  const dy = Math.round((ruler ? ruler.y+ruler.h : image.height*0.99) - (box.y+box.h))
  if (box.x+dx < 0 || box.y+dy < 0 || box.x+box.w+dx > image.width || box.y+box.h+dy > image.height) throw Object.assign(new Error('自动对齐会截断人物，请手动调整或拒收'),{code:'ALIGNMENT_REQUIRED'})
  // Translation only. Never independently stretch an emotion bbox to fill the canvas.
  const pixels = Buffer.alloc(image.pixels.length)
  for (let y = Math.max(0,-dy); y < Math.min(image.height,image.height-dy); y++) {
    const x = Math.max(0,-dx), end = Math.min(image.width,image.width-dx)
    image.pixels.copy(pixels,(y+dy)*image.stride+(x+dx)*image.bpp,y*image.stride+x*image.bpp,y*image.stride+end*image.bpp)
  }
  return encodeRect({...image,pixels},0,0,image.width,image.height)
}
export function checkAssetImage(bytes,kind,{sheet = false, slice = false, cellWidth, cellHeight} = {}) {
  const warnings = [], warn = (code,message) => warnings.push({code,message,severity:'warning'})
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  const ratio = kind === 'background' && Math.abs(width/height-16/9)<0.06 ? 16/9 : sheet || ['background','settei','cg'].includes(kind) ? 1.5 : kind === 'sprite' ? 2/3 : 1
  // private fork: composed colour boards have character-specific dimensions, not a fixed generation aspect.
  if (!['identity-settei','settei'].includes(kind) && Math.abs(width/height-ratio) > 0.06) warn('ASPECT_MISMATCH','图片比例与请求不符')
  if (width < (slice ? 256 : 512) || height < (kind === 'sprite' ? 800 : slice ? 256 : 512)) warn('LOW_RESOLUTION','图片分辨率偏低')
  let image
  try { image = decode(bytes) } catch { warn('CHECK_UNAVAILABLE','此 PNG 编码不支持像素检查，请人工检查'); return {warnings,width,height} }
  const alphaOffset = [4,6].includes(image.color) ? image.bpp-image.depth/8 : -1
  let transparent = 0, visible = 0, min = 255, max = 0, left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y*image.stride+x*image.bpp, alpha = alphaOffset < 0 ? 255 : image.pixels[offset+alphaOffset]
    const insideCell = !slice || !cellWidth || x >= (width-cellWidth)/2 && x < (width+cellWidth)/2 && y >= (height-cellHeight)/2 && y < (height+cellHeight)/2
    if (alpha < 250 && insideCell) transparent++
    if (alpha > VISIBLE_ALPHA_THRESHOLD) { visible++; left = Math.min(left,x); top = Math.min(top,y); right = Math.max(right,x); bottom = Math.max(bottom,y); min = Math.min(min,image.pixels[offset]); max = Math.max(max,image.pixels[offset]) }
  }
  if (!visible || !transparent && min === max) warn('EMPTY_IMAGE','图片为空或近似纯色，请检查')
  if (['sprite','avatar'].includes(kind)) {
    if (!transparent) warn('NO_TRANSPARENCY','未检测到有效透明背景；画出的棋盘格不算透明')
    // Avatar shoulders intentionally meet the bottom edge; hair and side edges should not.
    if (transparent && visible && (left <= 1 || top <= 1 || right >= width-2 || kind === 'sprite' && bottom >= height-2)) warn('EDGE_CONTACT','人物轮廓接触画布边缘，可能截断；采用前请检查')
  }
  if (slice && visible && cellWidth && cellHeight) {
    const dx = Math.floor((width-cellWidth)/2), dy = Math.floor((height-cellHeight)/2)
    if (left <= dx+1 || top <= dy+1 || right >= dx+cellWidth-2 || bottom >= dy+cellHeight-2) warn('CELL_EDGE_CONTACT','头像触及原网格边缘，可能被切断；请人工检查')
  }
  return {warnings,width,height,hasTransparency:transparent > 0,visiblePixels:visible,bbox:visible ? {x:left,y:top,w:right-left+1,h:bottom-top+1} : null}
}

// private fork: one PNG codec for deterministic offline and in-app processing.
export function decodeAssetRgba(bytes) {
  const image = decode(bytes), data = new Uint8ClampedArray(image.width*image.height*4), step = image.depth/8
  for (let p=0; p<image.width*image.height; p++) {
    const s=p*image.bpp,d=p*4,gray=[0,4].includes(image.color)
    data[d]=image.pixels[s]; data[d+1]=image.pixels[s+(gray?0:step)]; data[d+2]=image.pixels[s+(gray?0:2*step)]
    data[d+3]=[4,6].includes(image.color)?image.pixels[s+image.bpp-step]:255
  }
  return {width:image.width,height:image.height,data}
}
export function encodeAssetRgba({width,height,data}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6
  return encodeRect({width,height,pixels:Buffer.from(data),stride:width*4,bpp:4,header,ancillary:[]},0,0,width,height)
}

export const VISIBLE_ALPHA_THRESHOLD = 8
const alignmentFail = message => {throw Object.assign(new Error(message),{code:'ALIGNMENT_REQUIRED'})}
export function registerSprite(bytes, anchorBytes, landmarks, anchorLandmarks) {
  const image=decodeAssetRgba(bytes), anchor=decodeAssetRgba(anchorBytes)
  const box=checkAssetImage(bytes,'sprite').bbox, target=checkAssetImage(anchorBytes,'sprite').bbox
  if (!box || !target) alignmentFail('Empty sprite cannot be registered')
  const estimate=b=>({headTop:b.y,feet:b.y+b.h,supportX:b.x+b.w/2})
  const from=landmarks || estimate(box), to=anchorLandmarks || estimate(target)
  for (const [p,canvas] of [[from,image],[to,anchor]]) if (![p.headTop,p.feet,p.supportX].every(Number.isFinite) || p.headTop<0 || p.feet<=p.headTop || p.feet>canvas.height || p.supportX<0 || p.supportX>canvas.width) alignmentFail('Invalid headTop/feet/supportX landmarks')
  const scale=(to.feet-to.headTop)/(from.feet-from.headTop), dx=Math.round(to.supportX-from.supportX*scale),dy=Math.round(to.feet-from.feet*scale)
  if (scale<0.25 || scale>4) alignmentFail('Registration scale outside 0.25..4')
  if (image.width*image.height*scale*scale>32*1024**2) alignmentFail('Scaled image exceeds 32 Mpixel processing limit')
  const scaled=resizeImage(image,Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)))
  const data=new Uint8ClampedArray(anchor.width*anchor.height*4)
  let clipped=0
  for(let y=0;y<scaled.height;y++) for(let x=0;x<scaled.width;x++) {
    const s=(y*scaled.width+x)*4,xx=x+dx,yy=y+dy
    if(xx<0||yy<0||xx>=anchor.width||yy>=anchor.height) {if(scaled.data[s+3]>VISIBLE_ALPHA_THRESHOLD)clipped++;continue}
    data.set(scaled.data.subarray(s,s+4),(yy*anchor.width+xx)*4)
  }
  if(clipped) alignmentFail(`Registration would crop ${clipped} nontransparent pixels; supply measured landmarks or record a legitimate pose exception`)
  return {bytes:scale===1&&dx===0&&dy===0&&image.width===anchor.width&&image.height===anchor.height?bytes:encodeAssetRgba({width:anchor.width,height:anchor.height,data}),transform:{scale,dx,dy,clippedPixels:0},warnings:landmarks&&anchorLandmarks?[]:[{code:'ESTIMATED_LANDMARKS',severity:'warning',message:'Alpha bounds are a proxy, not head/feet recognition; use measured landmarks for raised hands, ornaments or bent poses.'}]}
}
