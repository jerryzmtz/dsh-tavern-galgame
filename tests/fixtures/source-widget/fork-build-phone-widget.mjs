// Test-only generic source-mark fixture; never installed or built by production.
// Official widgets use the same import, bundle closure and item identity as authored packs.
// private fork: they ship as one general pack (通用模组); 手机 is a member, not the pack. The pack UUID and the
// member's asset id stay fixed so installed settings, card bindings and widget refs keep resolving.
import {readFile, writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {sealPack,verifyBytes,jsonBytes} from '../../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../../../tavern-plugin/packages/dsh-asset-library/src/zip.js'
export const PHONE_PACK_ID = 'da95db75-cad8-43a9-92e2-ad15cb290b83'
export const OFFICIAL_WIDGET_PACK_NAME = '通用模组'
export const OFFICIAL_WIDGET_CREDITS = 'credits/general-widgets.txt'
const MEMBERS = [
  {id:'phone',name:'手机',directorNote:'Use only when the source explicitly depicts phone communication.',files:['widget.json','index.html','battery.js','index.js','style.css','assets/message.wav']} // private fork (settings-ux r2): battery.js holds the shared battery levels
]
export async function officialPhonePack() {
  const files=new Map()
  for (const member of MEMBERS) for (const name of member.files) files.set('bundles/'+member.id+'/'+name,await readFile(new URL(name==='widget.json'?'widget.json':'../../../fork/mods/phone/view/'+name,import.meta.url)))
  files.set(OFFICIAL_WIDGET_CREDITS,Buffer.from('DSH Tavern official general widgets (通用模组).\nphone (手机): code AGPL-3.0; synthesized message tone: original project asset, CC0.\n'))
  const manifest={format:'dsh-asset-pack',schemaVersion:1,id:PHONE_PACK_ID,name:OFFICIAL_WIDGET_PACK_NAME,credits:[OFFICIAL_WIDGET_CREDITS],contentHash:'0'.repeat(64),
    assets:MEMBERS.map(member=>({id:member.id,kind:'widgets',name:member.name,enabled:true,recall:{mode:'constant',keywords:[]},directorNote:member.directorNote,bundleKey:member.id,entry:'widget.json'})),
    figures:[],sprites:{},bundles:Object.fromEntries(MEMBERS.map(member=>[member.id,{kind:'widget',entry:'widget.json',contentHash:'0'.repeat(64)}])),blobs:{},files:[]}
  await sealPack(manifest,files)
  // private fork: sealPack just computed these digests from the bytes; validate content only.
  return verifyBytes(manifest,files,{sealed:true})
}
export async function writePhonePack(output) {
  const pack=await officialPhonePack()
  await writeZip(output,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
  return pack.manifest
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length!==4 || process.argv[2]!=='--out') throw new Error('Usage: node bin/fork-build-phone-widget.mjs --out <archive.zip>')
  const manifest=await writePhonePack(path.resolve(process.argv[3]))
  process.stdout.write(JSON.stringify({packId:manifest.id,contentHash:manifest.contentHash,files:manifest.files.length})+'\n')
}
