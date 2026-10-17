// private fork: 765 names map only at the interface. Vowels remain vowels in the layered runtime.
import path from 'node:path'
import {readFile} from 'node:fs/promises'
import {decodeAssetRgba,encodeAssetRgba} from '../../tavern-plugin/lib/domain/asset-image-processing.js'
import {validateSpriteManifest} from '../../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/sprite.js'
import {safeProjectFile,atomic,productionError,hash} from '../../tavern-plugin/lib/domain/asset-production-project.js'
const check=(ok,message)=>{if(!ok)throw productionError('INVALID_ARGUMENT',message)}
export const legacyEmotion=id=>({sadness:'sad',nervous:'anxious'}[id]||id)
export async function importLegacy(root,{file,sourceRoot,sprite,out='legacy/sample',dryRun=false}) {
  const rows=JSON.parse(await readFile(file,'utf8'));check(Array.isArray(rows),'Expected 765 mouth-manifest array')
  const row=rows.find(r=>r.sprite===sprite);check(row,'Select one exact source sprite path')
  const baseBytes=await readFile(await safeProjectFile(sourceRoot,row.sprite)),base=decodeAssetRgba(baseBytes),sourceState=path.posix.basename(row.sprite,'.png')
  const frames={},mapping={},mouthByFrame={},parts=[],seen=new Set();let width=0,height=0
  for(const frame of row.frames){const event=frame.shape.toLowerCase();check(['closed','a','i','u','e','o'].includes(event)&&!seen.has(event),'Unknown or duplicate vowel shape');seen.add(event)
    const bytes=await readFile(await safeProjectFile(sourceRoot,frame.patch)),image=decodeAssetRgba(bytes),[x,y,w,h]=frame.rect||[]
    check(frame.rect?.length===4&&frame.rect.every(Number.isInteger)&&x>=0&&y>=0&&w===image.width&&h===image.height&&x+w<=base.width&&y+h<=base.height,'Mouth rect is native base x,y,width,height; dimensions must match actual patch')
    check(bytes[24]===8,'Atlas import requires 8-bit source patches; no silent quantization')
    frames[event]={x:width,y:0,w,h};mapping[event]=event;mouthByFrame[event]={x,y,w,h};parts.push({frame,bytes,image,x:width,event});width+=w;height=Math.max(height,h)
  }
  const missing=['closed','a','i','u','e','o'].filter(e=>!seen.has(e)),warnings=missing.map(event=>({code:'MISSING_MOUTH_FRAME',severity:'warning',message:'Missing real '+event+' frame; no synthetic substitute'}))
  check(width>0&&width<=8192&&height<=8192&&width*height<=32*1024**2,'Atlas exceeds image budget or contains no real frames')
  const data=new Uint8ClampedArray(width*height*4)
  for(const part of parts)for(let y=0;y<part.image.height;y++)data.set(part.image.data.subarray(y*part.image.width*4,(y+1)*part.image.width*4),(y*width+part.x)*4)
  const atlasBytes=encodeAssetRgba({width,height,data}),spriteDoc={version:2,kind:'layered-static-sprites',character:{id:'legacy-sample',name:'765 legacy sample'},closedBehavior:'restore-base',mouthAtlas:{src:'mouth-atlas.png',width,height,frames},emotions:{[legacyEmotion(sourceState)]:{mouthFrames:mapping,stage:{src:'runtime/'+legacyEmotion(sourceState)+'.png',width:base.width,height:base.height,mouth:Object.values(mouthByFrame)[0],mouthByFrame}}}}
  validateSpriteManifest(spriteDoc)
  const metadata={schema_version:1,source_state_id:sourceState,emotion_id:legacyEmotion(sourceState),base_path:row.sprite,runtime_base_path:'runtime/'+legacyEmotion(sourceState)+'.png',base_hash:hash(baseBytes),mouth_semantics:'vowels',status:missing.length?'blocked':'changed',frames:row.frames,warnings}
  if(!dryRun){await atomic(root,out+'/'+row.sprite,baseBytes);await atomic(root,out+'/runtime/'+legacyEmotion(sourceState)+'.png',baseBytes);for(const part of parts)await atomic(root,out+'/'+part.frame.patch,part.bytes);await atomic(root,out+'/mouth-atlas.png',atlasBytes);await atomic(root,out+'/sprite.json',Buffer.from(JSON.stringify(spriteDoc,null,2)+'\n'));await atomic(root,out+'/source.json',Buffer.from(JSON.stringify(metadata,null,2)+'\n'))}
  return {out,sourceState,emotion:legacyEmotion(sourceState),frames:parts.length,missing,warnings,dryRun,sprite:spriteDoc}
}
