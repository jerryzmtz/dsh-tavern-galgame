import z from '@deepseek-ai/schemastery'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { createManager, attachProvider, error } from './manager.js'
import { createTransport } from './transport.js'
import { registerRoutes } from './routes.js'
export const name = 'dsh-tts-local'
// private fork: never start from defaults while the persisted settings owner is loading.
export const inject = ['subprocess','settings']
export const Settings = z.object({ providerId:z.string().default('default'), installPath:z.string().default(''), pythonExecutable:z.string().default(''), workerScript:z.string().default(''), modelConfigPath:z.string().default(''), arguments:z.string().default('[]'), environment:z.string().default('{}'), autoStart:z.boolean().default(false), readinessTimeoutMs:z.natural().min(1000).max(600000).default(120000) })
export function apply(ctx, config = {}) {
  const entry = Settings(config.settings || {})
  let source = () => entry, activated = false
  const manager = createManager({ subprocess:ctx.get('subprocess'), getSettings:() => source(), ...createTransport(), scrubEnv:scrubbedParentEnv })
  ctx.provide('ttsLocal',manager)
  ctx.effect(() => () => manager.dispose())
  ctx.get('settings').installSection(ctx,'tts-local',Settings,entry,{
    setSource:fn => { source = fn }, onChange() { if (!activated) { activated = true; manager.activate() } else manager.configure() },
  })
  ctx.inject(['tts'], child => {
    child.effect(() => attachProvider(manager,child.get('tts')))
  })
  registerRoutes(ctx,'/api/dsh-tts-local/v1',async (method,args) => {
    switch (method) {
      case 'status': return manager.status()
      case 'settings': return source()
      case 'logs': return manager.recentLogs(args)
      case 'saveSettings': {
        const settings = ctx.get('settings')
        const parsed = Settings(args)
        if (!/^[a-z0-9_-]{1,40}$/.test(parsed.providerId)) throw error('INVALID_INPUT')
        await settings.replace('tts-local',parsed); return source()
      }
      case 'start': case 'stop': case 'restart': {
        if (Object.keys(args).some(k => !['expectedRevision','providerId'].includes(k)) || args.providerId !== source().providerId) throw error('INVALID_INPUT')
        if (method !== 'stop' && !args.expectedRevision) throw error('REVISION_CONFLICT')
        return manager[method](args)
      }
      default: throw error('UNKNOWN_METHOD')
    }
  })
}
