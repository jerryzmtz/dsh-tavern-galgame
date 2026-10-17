import {spawnSync} from 'node:child_process'

export const DEFAULT_AVATAR_CROP = Object.freeze({x:0.3,y:0,w:0.4,h:0.21})

// Work in source pixels: the serialized rectangle is normalized, but square in pixels.
export function detectAvatarCrop(alpha, width, height) {
  const empty = () => ({crop:{...DEFAULT_AVATAR_CROP},detected:false,fallback:'no-alpha'})
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || alpha.length !== width * height) return empty()
  const rows = []
  let minX=width,minY=height,maxX=-1,maxY=-1
  for (let y = 0; y < height; y++) {
    let left = width, right = -1, count = 0
    for (let x = 0; x < width; x++) if (alpha[y * width + x] >= 96) { left = Math.min(left,x); right = x; count++ }
    if (count) { minX=Math.min(minX,left);maxX=Math.max(maxX,right);minY=Math.min(minY,y);maxY=y }
    rows.push({left,right,width:count >= 3 ? right - left + 1 : 0})
  }
  if (maxX < 0) return empty()
  const geometry = {width,height,top:minY,rows:rows.map(({left,right,width})=>width ? [left,right] : null)}
  const fallback = () => {
    const side=Math.min(width,height,(maxY-minY+1)*0.55)
    // Separate upper-body components so a detached tail/wing tip cannot pull
    // the center away from the head. Prefer the substantial topmost component.
    const end=Math.min(maxY,Math.floor(minY+side*0.8)),seen=new Uint8Array(width*height),parts=[]
    for(let y=minY;y<=end;y++) for(let x=minX;x<=maxX;x++) {
      const start=y*width+x
      if(seen[start] || alpha[start]<96) continue
      const queue=[start];seen[start]=1
      let mass=0,sumX=0
      for(let i=0;i<queue.length;i++) {
        const pixel=queue[i],px=pixel%width,py=Math.floor(pixel/width),weight=alpha[pixel]
        mass+=weight;sumX+=px*weight
        for(const [nx,ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
          if(nx<minX || nx>maxX || ny<minY || ny>end) continue
          const next=ny*width+nx
          if(!seen[next] && alpha[next]>=96) { seen[next]=1;queue.push(next) }
        }
      }
      parts.push({top:y,mass,center:sumX/mass})
    }
    const candidates=parts.filter(part=>part.top<=minY+(maxY-minY+1)*0.1)
    const head=(candidates.length?candidates:parts).sort((a,b)=>b.mass-a.mass)[0]
    const center=head?.center ?? (minX+maxX)/2
    const x=Math.max(0,Math.min(width-side,center-side/2)),y=Math.max(0,Math.min(height-side,minY-side*0.02))
    return {crop:{x:x/width,y:y/height,w:side/width,h:side/height},detected:false,fallback:'alpha-bounds',geometry,bounds:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}}
  }
  if (width < 16 || height < 32) return fallback()
  const top = rows.findIndex(row => row.width >= 4)
  const bottom = rows.findLastIndex(row => row.width >= 4)
  const body = bottom - top
  if (top < 0 || body < height * 0.5) return fallback()
  const smooth = y => {
    const values = rows.slice(Math.max(top,y - 2),Math.min(bottom,y + 3)).map(row => row.width).sort((a,b) => a-b)
    return values[Math.floor(values.length / 2)] || 0
  }
  // A head has an early width maximum, a narrower neck, then sustained shoulders.
  let peakWidth = 0, neck = -1, shoulder = -1
  for (let y = top + 3; y <= top + body * 0.36; y++) {
    if (y <= top + body * 0.20) peakWidth = Math.max(peakWidth,smooth(y - 3))
    const value = smooth(y)
    if (y < top + body * 0.14 || y < top + peakWidth * 0.6 || !value || value > peakWidth * 0.98) continue
    if (value > smooth(y - 3) || value > smooth(y + 3)) continue
    for (let next = y + 3; next <= Math.min(bottom,y + body * 0.12,top + body * 0.43); next++) {
      if (smooth(next) < value * 0.95) break
      if (smooth(next) >= value * 1.15 && smooth(next + 2) >= value * 1.15) { neck = y; shoulder = next; break }
    }
    if (shoulder >= 0) break
  }
  if (shoulder < 0 || peakWidth < width * 0.12 || peakWidth > width * 0.75) return fallback()
  // Silhouette narrowing can precede the chin (hair beside the cheeks). Use a
  // short bounded lookahead, not the whole long-hair/shoulder widening interval.
  const headHeight = neck - top + Math.min(shoulder - neck + peakWidth * 0.06,body * 0.025)
  if (headHeight < body * 0.09 || headHeight > body * 0.40) return fallback()
  const side = Math.min(width,height,headHeight / 0.82)
  // Hair may run out of frame; reject only implausibly narrow head geometry.
  if (side < peakWidth * 0.65) return fallback()
  const headRows = rows.slice(top + Math.round(headHeight * 0.2),Math.min(neck,top + Math.round(headHeight * 0.75))).filter(row => row.width)
  if (!headRows.length) return fallback()
  const centers = headRows.map(row => (row.left + row.right) / 2).sort((a,b)=>a-b)
  const center = centers[Math.floor(centers.length / 2)]
  const x = Math.max(0,Math.min(width-side,center-side/2)), y = Math.max(0,Math.min(height-side,top-side*0.02))
  return {crop:{x:x/width,y:y/height,w:side/width,h:side/height},detected:true,geometry,head:{top,neck,shoulder,chin:top+headHeight,center,peakWidth}}
}

// The publisher already requires ffmpeg for lossless sprite conversion. Downsample
// alpha only; detect in a fixed aspect-preserving grid to bound work for large art.
export function avatarCropFromBytes(bytes) {
  const result = spawnSync('ffmpeg',['-v','error','-nostdin','-i','pipe:0','-vf','scale=256:-1,format=rgba','-frames:v','1','-f','rawvideo','pipe:1'],{input:bytes,maxBuffer:16*1024**2,timeout:30000,windowsHide:true})
  if (result.error || result.status !== 0 || !result.stdout?.length || result.stdout.length % 1024) return {crop:{...DEFAULT_AVATAR_CROP},detected:false}
  const width = 256, height = result.stdout.length / 1024
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = result.stdout[i * 4 + 3]
  return detectAvatarCrop(alpha,width,height)
}

// private fork: estimate scale once per outfit; position follows each state's hair.
const median = values => {
  const sorted = values.toSorted((a,b)=>a-b), n = sorted.length
  return n ? (sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2 : null
}
function robustHeadHeight(detections) {
  const values = detections.filter(d=>d.detected && d.head && d.geometry).map(d=>(d.head.chin-d.head.top)/d.geometry.width)
  const mid = median(values)
  if (mid === null) return null
  const mad = median(values.map(v=>Math.abs(v-mid)))
  const kept = values.filter(v=>Math.abs(v-mid)<=Math.max(mid*0.05,3*1.4826*mad))
  return kept.length >= 3 ? median(kept) : null
}
export function cohortAvatarCrops(cohorts) {
  const scales = cohorts.map(robustHeadHeight)
  return cohorts.map((detections,index)=>{
    const scale = scales[index] ?? median(scales.filter((v,i)=>i!==index && v!==null))
    const source = scales[index]!==null ? 'outfit-median' : scale!==null ? 'figure-median' : 'estimated-chin'
    const positioned = detections.map(d=>{
      if (!d.geometry) return {...d,scaleSource:source,flags:['no-alpha']}
      const {width,height,top,rows} = d.geometry
      const side = Math.min(width,height,scale!==null ? scale*width/0.82 : d.crop.w*width)
      const headRows = rows.slice(Math.floor(top+side*0.82*0.2),Math.ceil(top+side*0.82*0.65)).filter(Boolean)
      const center = median(headRows.map(([l,r])=>(l+r)/2)) ?? (d.crop.x+d.crop.w/2)*width
      const headWidth = median(headRows.map(([l,r])=>r-l+1)) ?? 0
      return {...d,crop:{x:Math.max(0,Math.min(width-side,center-side/2))/width,y:Math.max(0,Math.min(height-side,top-side*0.02))/height,w:side/width,h:side/height},scaleSource:source,position:{top:top/width,headWidth:headWidth/width},flags:[]}
    })
    const aspects = median(detections.filter(d=>d.geometry).map(d=>d.geometry.height/d.geometry.width))
    const tops = median(positioned.filter(d=>d.position).map(d=>d.position.top))
    const widths = median(positioned.filter(d=>d.position).map(d=>d.position.headWidth))
    for (const d of positioned) if(d.position) {
      if(Math.abs(d.geometry.height/d.geometry.width/aspects-1)>0.1) d.flags.push('canvas-aspect-deviation')
      if(Math.abs(d.position.top-tops)>Math.max(0.03,(scale ?? d.crop.w*0.82)*0.25)) d.flags.push('hair-top-deviation')
      if(widths && Math.abs(d.position.headWidth/widths-1)>0.25) d.flags.push('head-width-deviation')
      if(source==='estimated-chin') d.flags.push('insufficient-detections')
    }
    return positioned
  })
}

// Reviewed outfit crops are pinned to the complete set of known body identities.
export function reviewedAvatarCrops(review, states) {
  if (!review || !states.length || states.some(({id,hash})=>!review.hashes.includes(hash) || review.stateHashes[id]!==hash)) return null
  return review
}
