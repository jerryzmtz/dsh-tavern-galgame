// private fork: synthetic end-to-end verification, never a paid request or live install.
import path from 'node:path'
import {generationReceipt} from '../../tavern-plugin/lib/domain/asset-generation-receipt.js'
import {hash} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {encodeAssetRgba} from '../../tavern-plugin/lib/domain/asset-image-processing.js'
import {safeProjectFile,initProject,preparePrompt,importImage,acceptProduction,registerProduction,cropProductionAvatar,validateProduction,packProduction,reviewProduction,projectStatus} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import {decodeMedia} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
import {buildBoard} from './board.mjs'
export function syntheticImage(width=128,height=192,{opaque=false,blink=false,mouth=false,shift=0}={}) {
  const data=new Uint8ClampedArray(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=(y*width+x)*4,visible=opaque||x>=32+shift&&x<96+shift&&y>=12&&y<180
    data.set([100+(x%40),120+(y%40),180,visible?255:0],i)
    if(blink&&y>=35&&y<43&&(x>=42&&x<54||x>=72&&x<84))data.set([30,20,20,255],i)
    if(mouth&&x>=56&&x<72&&y>=53&&y<61)data.set([80,20,30,255],i)
  }
  return encodeAssetRgba({width,height,data})
}
export async function dryRun(root) {
  await safeProjectFile(root,'project.json')
  await mkdir(path.dirname(path.resolve(root)),{recursive:true})
  await mkdir(root)
  const input={name:'Synthetic portable verification',characters:[{key:'fixture',name:'Fixture',identityAppearance:'Silver hair; blue accents',outfits:[{key:'daily',label:'Daily',outfitAppearance:'Blue jacket',eyesClosed:['sad'],mouth:true}]}],backgrounds:[{key:'room',prompt:'An empty room'}],cgs:[{key:'scene',prompt:'A quiet meeting'}]}
  await initProject(root,input)
  await mkdir(path.join(root,'fixtures'))
  const fixture=async(name,bytes)=>{const file=path.join(root,'fixtures',name+'.png');await writeFile(file,bytes);return file}
  const still=await fixture('sprite',syntheticImage()),avatar=await fixture('avatar',syntheticImage(128,128)),edit=await fixture('blink',syntheticImage(128,192,{blink:true})),mouth=await fixture('mouth',syntheticImage(128,192,{mouth:true})),scene=await fixture('scene',syntheticImage(192,128,{opaque:true}))
  const ingest=async(slot,file,extra={})=>{const plan=await preparePrompt(root,{slot});await writeFile(file+'.receipt.json',JSON.stringify(generationReceipt(plan.generation,{file,hash:hash(await readFile(file)),provider:'synthetic-dry-run'})));return importImage(root,{plan:plan.id,file,...extra})}
  await ingest('fixture/identity-settei',scene)
  await acceptProduction(root,{slot:'fixture/identity-settei',reviewer:'synthetic fixture (not real artwork)'})
  await ingest('fixture/daily/settei',scene)
  await acceptProduction(root,{slot:'fixture/daily/settei',reviewer:'synthetic fixture (not real artwork)'})
  for(const emotion of ['calm','sad']) {
    await ingest('fixture/daily/sprite/'+emotion,still)
    await registerProduction(root,{slot:'fixture/daily/sprite/'+emotion,landmarks:{headTop:12,feet:180,supportX:64},anchorLandmarks:{headTop:12,feet:180,supportX:64}})
    await ingest('fixture/daily/avatar/'+emotion,avatar,{geometry:{headRect:[32,12,64,90]}})
    for(const frame of ['closed','small','mid','open'])await ingest('fixture/daily/mouth/'+emotion+'/'+frame,mouth,{rect:[52,49,24,16]})
  }
  await ingest('fixture/daily/blink/calm',edit,{geometry:{headRect:[32,12,64,80],eyeRect:[38,34,52,16],browBottom:34,hairBottom:34}})
  await ingest('background/room',scene);await ingest('cg/scene',scene)
  await cropProductionAvatar(root,{slot:'fixture/daily/avatar/sad',rect:[0,0,128,128]})
  const config=path.join(root,'board-source.json')
  await writeFile(config,JSON.stringify({schema_version:1,character_id:'fixture',canvas:[256,192],sources:[{source_id:'scene',path:'fixtures/scene.png'}],blocks:[{source_id:'scene',crop_ltrb:[0,0,192,128],layout_xywh:[0,0,192,128],reference_role:'synthetic identity evidence',evidence_kind:'reconstructed'}],palette:[{source_id:'scene',sample_xy:[10,10],role:'base',zone:'hair',layout_xywh:[8,140,24,24],label_xy:[40,145],lighting:'synthetic flat'}]}))
  const board=await buildBoard(root,{config}),validation=await validateProduction(root),review=await reviewProduction(root),pack=await packProduction(root)
  await acceptProduction(root,{review:review.hash,reviewer:'synthetic fixture (not real artwork)'})
  const library=createAssetPackService({assetRoot:path.join(root,'verification-library'),decodeMedia})
  let installed
  try {
    const preview=await library.inspectImport({bytes:await readFile(pack.output)})
    const result=await library.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
    const snapshot=await library.getPackSnapshot({packId:result.snapshot.manifest.id})
    if(snapshot.manifest.id!==pack.id||Object.keys(snapshot.figures).length!==1)throw new Error('Import readback mismatch')
    installed={id:snapshot.manifest.id,figures:Object.keys(snapshot.figures).length,errors:0}
  } finally {await library.dispose()}
  return {project:root,validation,board,pack,review,installed,status:await projectStatus(root)}
}
