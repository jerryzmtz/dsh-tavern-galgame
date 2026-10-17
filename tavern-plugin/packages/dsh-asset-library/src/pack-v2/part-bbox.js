import {inflateSync} from 'node:zlib'
import {check} from '../asset-packs/common.js'
// Parts use RGBA PNG, so the alpha extent can be measured without a host decoder.
// PNG structure/CRC has already been checked by inspectMedia at this ingress.
export function partAlphaBox(bytes) {
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24]
  check(bytes[25] === 6 && [8,16].includes(depth) && bytes[28] === 0,'$.part','Parts require non-interlaced RGBA PNG')
  const bpp = 4*depth/8, stride = width*bpp, blocks = []
  for (let p=8;p<bytes.length;) {
    const n=bytes.readUInt32BE(p)
    if (bytes.toString('ascii',p+4,p+8) === 'IDAT') blocks.push(bytes.subarray(p+8,p+8+n))
    p+=n+12
  }
  const raw=inflateSync(Buffer.concat(blocks),{maxOutputLength:(stride+1)*height})
  let previous=Buffer.alloc(stride), current=Buffer.alloc(stride), left=width, top=height, right=-1, bottom=-1
  for (let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)]
    for (let x=0;x<stride;x++) {
      const a=x>=bpp?current[x-bpp]:0,b=previous[x],c=x>=bpp?previous[x-bpp]:0,p=a+b-c
      const pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c)
      const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c
      current[x]=(raw[y*(stride+1)+1+x]+predictor)&255
    }
    for(let x=0;x<width;x++) if(current[x*bpp+3*depth/8]>8) {left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
    ;[previous,current]=[current,previous]
  }
  check(right>=0,'$.part.bbox','Empty layered part')
  return [left,top,right-left+1,bottom-top+1]
}
