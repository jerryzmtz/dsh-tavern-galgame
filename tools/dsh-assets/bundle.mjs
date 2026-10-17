// private fork: an allowlisted module closure, never a repository/profile copy.
import {VERSION} from './version.mjs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {readFile,writeFile,mkdir,readdir,statfs} from 'node:fs/promises'
const root=fileURLToPath(new URL('../../',import.meta.url))
export async function exportBundle(destination) {
  const disk=await statfs(path.dirname(destination))
  if(disk.bavail*disk.bsize<64*1024**2)throw new Error('At least 64 MiB free disk required for the portable bundle')
  await mkdir(destination)
  const copied=new Set()
  async function copy(relative,scan=true) {
    relative=relative.replaceAll('\\','/')
    if(copied.has(relative))return
    if(relative.startsWith('../')||path.isAbsolute(relative))throw new Error('Bundle dependency escaped repository')
    const source=await readFile(path.join(root,relative));copied.add(relative)
    const dest=path.join(destination,relative);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,source)
    if(!scan||! /\.(?:mjs|js|cjs)$/.test(relative))return
    const text=source.toString('utf8'),deps=[...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s+)['"]([^'"]+)['"]/g)].map(m=>m[1])
    for(const dep of deps) {
      if(dep.startsWith('node:'))continue
      if(!dep.startsWith('.'))throw new Error('Unexpected external bundle dependency: '+dep)
      await copy(path.normalize(path.join(path.dirname(relative),dep)))
    }
  }
  await copy('bin/dsh-assets.mjs')
  for(const file of ['tests/asset-cli-migrate-p5.test.mjs','tests/asset-cli-source-derived.test.mjs','tests/asset-cli-native-generation.test.mjs','tests/asset-cli-generation-history.test.mjs','tests/asset-cli-generation-guard.test.mjs','tests/asset-cli-template-finish.test.mjs','tests/asset-cli-mouth-matte.test.mjs','tests/asset-cli-edit-window.test.mjs','tests/asset-cli-animation-routes.test.mjs'])await copy(file)
  for(const file of ['SKILL.md','agents/openai.yaml'])await copy('.pi/skills/dsh-assets/'+file,false)
  await copyTree('.pi/skills/dsh-assets/references')
  const templates='tavern-plugin/presets/asset-gen/templates'
  for(const name of await readdir(path.join(root,templates)))await copy(templates+'/'+name,false)
  for(const file of ['viewer/template.html','viewer/sample-review-data.json','viewer/review-data.schema.json','tools/dsh-assets/NOTE-1.3.55.md','tools/dsh-assets/NOTE-1.3.54.md','tools/dsh-assets/NOTE-1.3.53.md','tools/dsh-assets/NOTE-1.3.52.md','tools/dsh-assets/NOTE-1.3.51.md','tools/dsh-assets/NOTE-1.3.50.md','tools/dsh-assets/NOTE-1.3.49.md','tools/dsh-assets/NOTE-1.3.48.md','tools/dsh-assets/NOTE-1.3.47.md','tools/dsh-assets/NOTE-1.3.46.md','tools/dsh-assets/NOTE-1.3.45.md','tools/dsh-assets/NOTE-1.3.44.md','tools/dsh-assets/NOTE-1.3.43.md','tools/dsh-assets/NOTE-1.3.42.md','tools/dsh-assets/NOTE-1.3.41.md','tools/dsh-assets/NOTE-1.3.40.md','tools/dsh-assets/NOTE-1.3.39.md','tools/dsh-assets/NOTE-1.3.38.md','tools/dsh-assets/NOTE-1.3.37.md','tools/dsh-assets/NOTE-1.3.36.md','tools/dsh-assets/NOTE-1.3.35.md','tools/dsh-assets/NOTE-1.3.34.md','tools/dsh-assets/NOTE-1.3.33.md','tools/dsh-assets/NOTE-1.3.32.md','tools/dsh-assets/NOTE-1.3.31.md','tools/dsh-assets/NOTE-1.3.29.md','tools/dsh-assets/NOTE-1.3.28.md','tools/dsh-assets/NOTE-1.3.27.md','tools/dsh-assets/NOTE-1.3.26.md','tools/dsh-assets/NOTE-1.3.25.md','tools/dsh-assets/NOTE-1.3.24.md','tools/dsh-assets/NOTE-1.3.23.md','tools/dsh-assets/NOTE-1.3.22.md','tools/dsh-assets/NOTE-1.3.19.md','tools/dsh-assets/NOTE-1.3.18.md','tools/dsh-assets/NOTE-1.3.17.md','tools/dsh-assets/NOTE-1.3.16.md','tools/dsh-assets/CHANGELOG.md','tools/dsh-assets/CHANGES-1.3.md','tools/dsh-assets/FEEDBACK-TEMPLATE.md','tools/dsh-assets/765-local-fills.json','docs/fork/asset-gen-contract.md','docs/fork/asset-cli-contract.md','docs/fork/asset-cli-dot.md','LICENSE','tavern-plugin/packages/dsh-asset-library/LICENSE','tavern-plugin/packages/dsh-image-gen/LICENSE'])await copy(file,false)
  async function copyTree(relative) {for(const item of await readdir(path.join(root,relative),{withFileTypes:true})) {const file=relative+'/'+item.name;if(item.isDirectory())await copyTree(file);else await copy(file,false)}}
  await copyTree('tools/dsh-assets/example')
  await writeFile(path.join(destination,'CHANGES-1.3.md'),await readFile(path.join(root,'tools/dsh-assets/CHANGES-1.3.md')))
  await copyTree('viewer/sample-images')
  await writeFile(path.join(destination,'package.json'),JSON.stringify({name:'dsh-assets-portable',version:VERSION,type:'module',private:true,engines:{node:'>=22.19.0'}},null,2)+'\n')
  await writeFile(path.join(destination,'README.txt'),'dsh-assets '+VERSION+' | Node >=22.19.0. No installation or app required.\nnode bin/dsh-assets.mjs --help\nnode bin/dsh-assets.mjs dry-run --project ./synthetic-project --json\nThe dry-run writes synthetic fixtures only to the requested NEW project.\n变更：tools/dsh-assets/NOTE-1.3.55.md；新图使用 generate 或 prepare -> 原生工具 -> finalize，保留 PNG.receipt.json。三个精确历史例外只放行来源，不代表 QA 通过。\nRegression: node --test tests/asset-cli-generation-guard.test.mjs tests/asset-cli-template-finish.test.mjs tests/asset-cli-mouth-matte.test.mjs\nConsumer skill: .pi/skills/dsh-assets/SKILL.md (identical for local and cloud agents).\nNo credentials included. All generation credentials are env-only.\n')
  return {destination,files:copied.size+3,node:'>=22.19.0',dependencies:[]}
}
