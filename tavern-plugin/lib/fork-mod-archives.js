import path from 'node:path'
import {createReadStream,createWriteStream} from 'node:fs'
import {lstat,readdir,mkdir,readFile,open,unlink} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {isDeepStrictEqual as equal} from 'node:util'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {validateModManifest,validateModPack,validateModPath} from './domain/mods/manifest.js'
import {remapModIdentity,validateModDefaults} from './domain/mods/import.js'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check,modShape:shape,modFreeze} = contract
const LIMIT = 256 * 1024 ** 2, FILE_LIMIT = 64 * 1024 ** 2
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
const json = value => Buffer.from(JSON.stringify(value),'utf8')
function refs(value, modId, result = new Set()) {
  if (!value || typeof value !== 'object') return result
  if (value.modId === modId && value.packId && value.kind && value.entryId) result.add(value.packId)
  for (const child of Object.values(value)) refs(child,modId,result)
  return result
}

// Import sources are resolved by the authenticated host: never accept a client filesystem path.
export function createModArchives({root,library,builtins,resolveImport,archiveIO,now = Date.now}) {
  // Dormant archive support accepts owner-supplied I/O; it never imports another package's private implementation.
  const {openZip,writeZip,checkedPath}=archiveIO
  root = path.resolve(root)
  const inspections = new Map(), downloads = new Map()
  const locate = relative => checkedPath(root,relative)
  const sourceFile = async filename => {
    const target = await checkedPath(path.dirname(filename),path.basename(filename)), info = await lstat(target)
    check(info.isFile() && info.size <= LIMIT,'$.source','Import file exceeds budget or is not a regular file')
    return target
  }
  async function readSource(source) {
    const files = new Map(), names = new Set()
    let total = 0, digest
    const add = (name,bytes) => {
      validateModPath(name)
      check(!names.has(name.toLowerCase()) && files.size < 8192 && bytes.length <= FILE_LIMIT && total + bytes.length <= LIMIT,'$.files','Archive collision or size limit')
      names.add(name.toLowerCase());total+=bytes.length;files.set(name,Buffer.from(bytes))
    }
    if (source.kind === 'files') {
      // The outer card ZIP owns the transfer digest; embedded bundles never hash again.
      check(source.files instanceof Map,'$.source')
      for (const [name,bytes] of source.files) add(name,bytes)
      digest=source.archiveDigest
    } else if (source.kind === 'directory') {
      async function visit(prefix = '') {
        const folder = await checkedPath(source.path,prefix.replace(/\/$/,''))
        for (const item of await readdir(folder,{withFileTypes:true})) {
          const name=prefix+item.name, target=await checkedPath(source.path,name), info=await lstat(target)
          validateModPath(name)
          check(info.isDirectory() || info.isFile(),'$.files','Special import file rejected')
          if (info.isDirectory()) await visit(name+'/')
          else {check(info.size<=FILE_LIMIT && total+info.size<=LIMIT,'$.files','Directory exceeds budget');add(name,await readFile(target))}
        }
      }
      await visit()
    } else {
      check(source.kind === 'zip','$.source','Unsupported import source')
      const input=await sourceFile(source.path), temporary=await locate('incoming/'+randomUUID()+'.zip')
      await mkdir(path.dirname(temporary),{recursive:true})
      const hash=createHash('sha256');let size=0
      try {
        await pipeline(createReadStream(input),new Transform({transform(bytes,enc,done){size+=bytes.length;hash.update(bytes);done(size>LIMIT?Error('Archive exceeds budget'):null,bytes)}}),createWriteStream(temporary,{flags:'wx'}))
        digest=hash.digest('hex')
        const archive=await openZip(temporary,{entries:8192,entrySize:FILE_LIMIT,totalSize:LIMIT})
        for (const entry of archive.entries) if (!entry.directory) add(entry.path,await archive.read(entry))
      } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
    }
    return {files,digest,total}
  }
  function parse(files,name) {
    const bytes=files.get(name)
    check(bytes && bytes.length<=1024*1024,'$.files.'+name,'Required JSON file missing or too large')
    try {return JSON.parse(bytes.toString('utf8'))} catch {check(false,'$.files.'+name,'Invalid JSON')}
  }
  function declared(files,declarations,prefix,used) {
    const result=new Map()
    for (const file of declarations) {
      const name=prefix+file.path,bytes=files.get(name)
      check(!used.has(name) && bytes?.length===file.size,'$.files.'+name,'Missing, conflicting or wrong-sized declared file')
      used.add(name);result.set(file.path,bytes)
    }
    return result
  }
  function inspectFiles(source) {
    const {files}=source, raw=parse(files,'manifest.json'), used=new Set(['manifest.json']), state=library.snapshot()
    if (raw.format==='dsh-mod-pack') {
      const row=state.mods[raw.modId]
      check(row,'$.modId','Install the first-party mod before its pack','MOD_DEPENDENCY_MISSING')
      const pack=validateModPack(raw,row.manifest), packs=[{pack,files:declared(files,pack.files,'',used)}]
      for (const name of files.keys()) {
        const match=/^packs\/([0-9a-f-]+)\/pack\.json$/.exec(name)
        if (!match || used.has(name)) continue
        used.add(name)
        const dependency=validateModPack(parse(files,name),row.manifest)
        check(dependency.id===match[1] && dependency.id!==pack.id,'$.packs','Duplicate or mismatched pack identity')
        packs.push({pack:dependency,files:declared(files,dependency.files,'packs/'+dependency.id+'/files/',used)})
      }
      check(used.size===files.size,'$.files','Undeclared archive files')
      for (const id of refs(packs.map(row=>row.pack),row.manifest.id)) check(packs.some(row=>row.pack.id===id),'$.packs','Imported archive omits a referenced owned pack')
      return {kind:'mod-pack',manifest:row.manifest,packs,revision:state.revision}
    }
    let origin={builtinId:raw.id,packIds:{}}
    if (files.has('installation.json')) {
      origin=parse(files,'installation.json');used.add('installation.json')
      shape(origin,['builtinId','packIds'])
      check(origin.packIds && typeof origin.packIds==='object' && !Array.isArray(origin.packIds),'$.installation.packIds')
      check(Object.entries(origin.packIds).every(([from,to])=>uuid(from)&&uuid(to)) && new Set(Object.values(origin.packIds)).size===Object.keys(origin.packIds).length,'$.installation.packIds','Invalid identity mapping')
    }
    const builtin=builtins.manifest(origin.builtinId)
    const releaseFiles=declared(files,builtin.files,'',used)
    builtins.inspect(builtin,releaseFiles)
    const expected=remapModIdentity(builtin,builtin.id,raw.id,origin.packIds)
    check(equal(raw,expected),'$.manifest','Only application releases and their identity-remapped copies are executable')
    const manifest=raw.id===builtin.id && !Object.keys(origin.packIds).length ? builtin : validateModManifest(expected),packs=new Map()
    for (const file of builtin.defaultPacks) {
      const original=validateModPack(parse(releaseFiles,file),builtin),prefix=path.posix.dirname(file)+ '/'
      const media=new Map(original.files.map(entry=>{
        const bytes=releaseFiles.get(prefix+entry.path)
        check(bytes?.length===entry.size,'$.defaultPacks','Default pack closure is incomplete')
        return [entry.path,bytes]
      }))
      const pack=validateModPack(remapModIdentity(original,builtin.id,manifest.id,origin.packIds),manifest)
      packs.set(pack.id,{pack,files:media})
    }
    for (const name of files.keys()) {
      const match=/^packs\/([0-9a-f-]+)\/pack\.json$/.exec(name)
      if (!match || used.has(name)) continue
      used.add(name)
      const pack=validateModPack(parse(files,name),manifest)
      check(pack.id===match[1],'$.packs','Pack folder identity differs')
      packs.set(pack.id,{pack,files:declared(files,pack.files,'packs/'+pack.id+'/files/',used)})
    }
    const defaults=validateModDefaults(files.has('settings.json')?parse(files,'settings.json'):{},manifest)
    if (files.has('settings.json')) used.add('settings.json')
    check(used.size===files.size,'$.files','Undeclared archive files')
    for (const id of refs([defaults,manifest.settingsSchema,...[...packs.values()].map(row=>row.pack)],manifest.id)) check(packs.has(id),'$.packs','Imported archive omits a referenced owned pack')
    return {kind:'mod',manifest,origin,packs:[...packs.values()],defaults,releaseFiles,revision:state.revision}
  }
  async function store(files) {
    const id=randomUUID()
    for (const [name,bytes] of files) {
      const target=await locate('content/'+id+'/'+name)
      await mkdir(path.dirname(target),{recursive:true})
      const handle=await open(target,'wx')
      try {await handle.writeFile(bytes);await handle.sync()} finally {await handle.close()}
    }
    return id
  }
  const assertRevision = expected => check(library.snapshot().revision===expected,'$.expectedRevision','Mod library changed after inspection','MOD_REVISION_CONFLICT')
  async function inspectSource(source) {
    for (const [id,item] of inspections) if (now()-item.createdAt>600000) inspections.delete(id)
    const loaded=await readSource(source)
    check(inspections.size<4 && [...inspections.values()].reduce((n,item)=>n+item.size,0)+loaded.total<=LIMIT,'$.inspection','Pending import budget exceeded')
    const value=inspectFiles(loaded),inspectionId=randomUUID()
    inspections.set(inspectionId,{value,createdAt:now(),size:loaded.total})
    const existing=library.snapshot().mods[value.manifest.id]
    return modFreeze({inspectionId,kind:value.kind,name:value.kind==='mod'?value.manifest.name:value.packs[0].pack.name,revision:value.revision,
      conflicts:value.kind==='mod'?(existing?[value.manifest.id]:[]):(existing?.packs[value.packs[0].pack.id]?[value.packs[0].pack.id]:[]),
      dependencies:value.manifest.dependencies,builtinRuntimeCompatible:true,...(loaded.digest?{archiveDigest:loaded.digest}:{})})
  }
  async function storedFiles(rootId,declarations) {
    check(uuid(rootId),'$.content','Installed files are unavailable','MOD_RESOURCE_UNAVAILABLE')
    const files=new Map()
    for (const file of declarations) {
      const target=await locate('content/'+rootId+'/'+file.path),info=await lstat(target)
      check(info.isFile() && info.size===file.size,'$.content','Installed file missing or wrong-sized','MOD_RESOURCE_UNAVAILABLE')
      files.set(file.path,await readFile(target))
    }
    return files
  }
  async function exportFiles(files,name) {
    const downloadId=randomUUID(),file=await locate('downloads/'+downloadId+'.zip')
    await mkdir(path.dirname(file),{recursive:true})
    const receipt=await writeZip(file,[...files].map(([path,data])=>({path,data})))
    downloads.set(downloadId,{file,createdAt:now()})
    return {downloadId,name:name+'.zip',size:receipt.size}
  }
  return Object.freeze({
    inspectSource,
    async readReleaseText(modId,name) {
      const row=library.snapshot().mods[modId],file=row?.manifest.files.find(file=>file.path===name)
      check(row?.content && file,'$.path','Declared release file unavailable','MOD_RESOURCE_UNAVAILABLE')
      return (await storedFiles(row.content.release,[file])).get(name).toString('utf8')
    },
    async inspectModImport(args) {check(typeof resolveImport==='function','$.source','Import transport unavailable','MOD_RESOURCE_UNAVAILABLE');return inspectSource(await resolveImport(args))},
    async applyModImport({inspectionId,decision,expectedRevision}) {
      const item=inspections.get(inspectionId)
      check(item && now()-item.createdAt<=600000,'$.inspectionId','Import inspection expired','MOD_RESOURCE_UNAVAILABLE')
      check(item.value.revision===expectedRevision,'$.expectedRevision','Inspection revision differs','MOD_REVISION_CONFLICT');assertRevision(expectedRevision)
      check(['install','replace','keep-both'].includes(decision),'$.decision')
      let value=item.value
      if (value.kind==='mod-pack') {
        const modId=value.manifest.id,ids=decision==='keep-both'?Object.fromEntries(value.packs.map(({pack})=>[pack.id,randomUUID()])):{}
        const packs=value.packs.map(row=>({...row,pack:decision==='keep-both'?remapModIdentity(row.pack,modId,modId,ids):row.pack}))
        for (const {pack} of packs) check(!library.snapshot().mods[modId]?.packs[pack.id] || decision==='replace','$.decision','Pack already exists','MOD_REVISION_CONFLICT')
        const contentRoots={}
        for (const {pack,files} of packs) contentRoots[pack.id]=await store(files)
        const result=await library.importModPacks({modId,packs:packs.map(row=>row.pack),contentRoots,replace:decision==='replace',expectedRevision})
        inspections.delete(inspectionId)
        return {modId,packIds:result.packIds,revision:result.revision,notices:[]}
      }
      if (decision==='keep-both') {
        const from=value.manifest.id,to=from+'.copy-'+randomUUID().slice(0,8),ids=Object.fromEntries(value.packs.map(({pack})=>[pack.id,randomUUID()]))
        const origin={builtinId:value.origin.builtinId,packIds:Object.fromEntries(Object.entries(value.origin.packIds).map(([old,current])=>[old,ids[current]||current]))}
        for (const [old,current] of Object.entries(ids)) if (!Object.values(value.origin.packIds).includes(old)) origin.packIds[old]=current
        const manifest=validateModManifest(remapModIdentity(value.manifest,from,to,ids))
        value={...value,manifest,origin,defaults:remapModIdentity(value.defaults,from,to,ids),packs:value.packs.map(row=>({...row,pack:validateModPack(remapModIdentity(row.pack,from,to,ids),manifest)}))}
      }
      check(!library.snapshot().mods[value.manifest.id] || decision==='replace','$.decision','Mod already exists','MOD_REVISION_CONFLICT')
      const content={release:await store(value.releaseFiles),packs:{}}
      for (const row of value.packs) content.packs[row.pack.id]=await store(row.files)
      const result=await library.install({manifest:value.manifest,packs:value.packs.map(row=>row.pack),defaults:value.defaults,origin:value.origin,content,expectedRevision,replace:decision==='replace'})
      inspections.delete(inspectionId)
      return {modId:result.modId,packIds:value.packs.map(row=>row.pack.id),revision:result.revision,notices:decision==='keep-both'?['The copied installation and its packs are off and require a new grant.']:[]}
    },
    async exportMod({modId,packIds,expectedRevision}) {
      assertRevision(expectedRevision)
      const row=library.snapshot().mods[modId]
      check(row?.content,'$.modId','Installed mod files unavailable','MOD_RESOURCE_UNAVAILABLE')
      check(Array.isArray(packIds) && packIds.every(id=>uuid(id)),'$.packIds')
      const defaults=library.snapshot().global.mods[modId]?.settings || {},selected=new Set([...packIds,...refs([defaults,row.manifest.settingsSchema],modId)])
      for (const id of selected) {
        const pack=row.packs[id];check(pack,'$.packIds','Referenced pack unavailable','MOD_RESOURCE_UNAVAILABLE')
        for (const dependency of refs(pack,modId)) selected.add(dependency)
      }
      const files=await storedFiles(row.content.release,row.manifest.files)
      const add=(name,bytes)=>{check(!files.has(name),'$.files','Reserved archive path collision');files.set(name,bytes)}
      add('manifest.json',json(row.manifest));add('installation.json',json(row.origin));add('settings.json',json(defaults))
      for (const id of selected) {
        const pack=row.packs[id];add('packs/'+id+'/pack.json',json(pack))
        for (const [name,bytes] of await storedFiles(row.content.packs[id],pack.files)) add('packs/'+id+'/files/'+name,bytes)
      }
      assertRevision(expectedRevision)
      return exportFiles(files,modId)
    },
    async exportModPack({modId,packId,expectedRevision}) {
      assertRevision(expectedRevision)
      const row=library.snapshot().mods[modId],pack=row?.packs[packId]
      check(pack && row.content,'$.packId','Owned pack unavailable','MOD_RESOURCE_UNAVAILABLE')
      const selected=refs(pack,modId);selected.delete(packId)
      for (const id of selected) {
        check(row.packs[id],'$.packId','Referenced pack unavailable','MOD_RESOURCE_UNAVAILABLE')
        for (const dependency of refs(row.packs[id],modId)) if (dependency!==packId) selected.add(dependency)
      }
      const files=await storedFiles(row.content.packs[packId],pack.files)
      const add=(name,bytes)=>{check(!files.has(name),'$.files','Reserved archive path collision');files.set(name,bytes)}
      add('manifest.json',json(pack))
      for (const id of selected) {
        add('packs/'+id+'/pack.json',json(row.packs[id]))
        for (const [name,bytes] of await storedFiles(row.content.packs[id],row.packs[id].files)) add('packs/'+id+'/files/'+name,bytes)
      }
      assertRevision(expectedRevision)
      return exportFiles(files,packId)
    },
    download(downloadId) {const item=downloads.get(downloadId);check(item && now()-item.createdAt<=1800000,'$.downloadId','Download expired','MOD_RESOURCE_UNAVAILABLE');return item.file},
  })
}
