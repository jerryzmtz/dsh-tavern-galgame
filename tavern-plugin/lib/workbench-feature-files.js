import path from 'node:path'
import {lstat,realpath,readFile,readdir,open} from 'node:fs/promises'
import {pipeline} from 'node:stream/promises'
import {createReadStream} from 'node:fs'
import {featureError} from './domain/workbench-feature-projections.js'

export function createWorkbenchFiles(root) {
  const denied=()=>{throw featureError('WORKSPACE_PATH_DENIED','$.file','Choose an ordinary relative file inside this session workspace.')}
  async function locate(relative,{output=false}={}) {
    if(typeof root!=='string'||!root||typeof relative!=='string'||!relative||/[\0:]/.test(relative)||path.isAbsolute(relative)) denied()
    const parts=relative.replaceAll('\\','/').split('/')
    if(parts.some(p=>!p||p==='.'||p==='..'||/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(p)||/[. ]$/.test(p)||/^\.?(?:credentials|env)(?:\.|$)/i.test(p))) denied()
    const base=await realpath(root)
    if((await lstat(root)).isSymbolicLink()) denied()
    let target=base
    for(let i=0;i<parts.length;i++) {
      target=path.join(target,parts[i])
      const info=await lstat(target).catch(error=>{if(output&&i===parts.length-1&&error.code==='ENOENT')return null;throw error})
      if(info?.isSymbolicLink()) denied()
      if(info && i<parts.length-1 && !info.isDirectory()) denied()
      if(info) {
        const actual=await realpath(target),inside=path.relative(base,actual)
        if(inside==='..'||inside.startsWith('..'+path.sep)||path.isAbsolute(inside)) denied()
      }
    }
    return target
  }
  return {
    locate,
    async read(file,max=60*1024**2) {
      const target=await locate(file),info=await lstat(target)
      if(!info.isFile()) denied()
      if(info.size>max) throw featureError('LIMIT_EXCEEDED','$.file','Use a file within the owner byte limit.')
      const bytes=await readFile(target)
      if(bytes.length>max) throw featureError('LIMIT_EXCEEDED','$.file')
      return bytes
    },
    async directory(directory) {
      const files=new Map();let total=0
      const visit=async relative=>{
        const target=await locate(relative),info=await lstat(target)
        if(info.isDirectory()) {for(const name of await readdir(target))await visit(relative+'/'+name)}
        else {
          if(!info.isFile()||info.size>512*1024**2||files.size>=20000||total+info.size>2*1024**3) throw featureError('LIMIT_EXCEEDED','$.directory')
          const bytes=await this.read(relative,512*1024**2);total+=bytes.length;files.set(relative.slice(directory.length+1).replaceAll('\\','/'),bytes)
        }
      }
      await visit(directory);return files
    },
    async export(output,archive) {
      const target=await locate(output,{output:true}),handle=await open(target,'wx')
      try {
        if(archive.file) await pipeline(createReadStream(archive.file),handle.createWriteStream({autoClose:false}))
        else await handle.writeFile(archive.bytes)
        return {file:output,size:(await handle.stat()).size}
      } finally {await handle.close();await archive.dispose?.()}
    }
  }
}
