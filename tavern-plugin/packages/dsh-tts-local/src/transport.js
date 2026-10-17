import { resolve } from 'node:path'
import { isAbsolute } from 'node:path'
import { stat, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { error } from './manager.js'
export async function validatePaths(settings) {
  for (const [field,directory] of [['installPath',true],['pythonExecutable',false],['workerScript',false],['modelConfigPath',false]]) {
    if (!settings[field] || !isAbsolute(settings[field])) throw error('INVALID_PATH')
    const info = await stat(settings[field]).catch(() => { throw error('INVALID_PATH') })
    if (directory ? !info.isDirectory() : !info.isFile()) throw error('INVALID_PATH')
  }
}
export async function assertPortFree(port, host = '127.0.0.1') {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw error('INVALID_PORT')
  await new Promise((resolve,reject) => { const s = createServer(); s.once('error',() => reject(error('PORT_OCCUPIED'))); s.listen({host,port,exclusive:true},() => s.close(resolve)) })
}
// private fork: lifecycle only. Supply the service's ordinary base URL + key to dsh-tts.
export function createTransport({ fetch = globalThis.fetch } = {}) {
  async function request(launch,path,signal,post = false) {
    const response = await fetch(launch.url + path,{method:post ? 'POST' : 'GET',headers:{Authorization:'Bearer ' + launch.key},redirect:'error',signal:AbortSignal.any([...(signal ? [signal] : []),AbortSignal.timeout(5000)])})
    if (!response.ok) throw error(path === '/shutdown' && response.status === 404 ? 'SHUTDOWN_UNSUPPORTED' : 'SERVICE_OFFLINE')
    return response.json()
  }
  async function probe(launch,signal) {
    const health = await request(launch,'/v1/info',signal)
    if (health.protocol !== 'dsh-tts-reference-v1' || !['loading','starting','ready','error'].includes(health.state)) throw error('SERVICE_MISMATCH')
    return health
  }
  async function readLaunch(settings) {
      await validatePaths(settings)
      let config
      try { config = JSON.parse(await readFile(settings.modelConfigPath,'utf8')) } catch { throw error('INVALID_CONFIG') }
      // private fork: the installed worker config owns `token`; generic provider connections use `key`.
      if (!config || typeof config.token !== 'string' || !config.token || typeof config.url !== 'string') throw error('INVALID_CONFIG')
      const endpoint = new URL(config.url)
      if (endpoint.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || !endpoint.port) throw error('INVALID_CONFIG')
      const modelRequirements = [], source = config.models ? 'models' : 'voices'
      if (config[source]) {
        const inventory = JSON.parse(await readFile(resolve(config.root,config[source]),'utf8'))
        for (const model of inventory[source] || []) {
          const fields = ['gpt','sovits','sv','lora'].filter(k => model[k])
          if (!fields.includes('gpt') || !fields.includes('sovits')) continue
          if (!(await Promise.all(fields.map(k => stat(resolve(config.root,model[k].path)).then(s => s.isFile(),() => false)))).every(Boolean)) continue
          modelRequirements.push({engine:'gpt-sovits',modelVersion:model.modelVersion || 'v3',...Object.fromEntries(fields.map(k => [k,{sha256:model[k].sha256}]))})
        }
      }
      const provider = {id:settings.providerId,url:endpoint.origin,key:config.token,modelRequirements}
      let args, env
      try { args = JSON.parse(settings.arguments || '[]'); env = JSON.parse(settings.environment || '{}') } catch { throw error('INVALID_CONFIG') }
      if (!Array.isArray(args) || args.some(v => typeof v !== 'string') || !env || Array.isArray(env) || typeof env !== 'object' || Object.values(env).some(v => typeof v !== 'string')) throw error('INVALID_CONFIG')
      const launch = {url:provider.url,key:config.token,provider,cwd:settings.installPath,env,argv:[settings.pythonExecutable,'-u',settings.workerScript,...args,'--config',settings.modelConfigPath]}
      return launch
  }
  return {
    async connection(settings) { return (await readLaunch(settings)).provider },
    async prepare(settings,signal) {
      const launch = await readLaunch(settings), endpoint = new URL(launch.url)
      signal.throwIfAborted()
      await assertPortFree(Number(endpoint.port),endpoint.hostname.replace(/^\[|\]$/g,''))
      return launch
    },
    probe,
    async shutdown(launch) {
      await request(launch,'/shutdown',undefined,true)
      const deadline = Date.now() + 8000, endpoint = new URL(launch.url)
      while (Date.now() < deadline) {
        try { await assertPortFree(Number(endpoint.port),endpoint.hostname.replace(/^\[|\]$/g,'')); return } catch {}
        await new Promise(resolve => setTimeout(resolve,100))
      }
      throw error('STOP_TIMEOUT')
    },
  }
}
