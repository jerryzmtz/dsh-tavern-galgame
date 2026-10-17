import { randomBytes } from 'node:crypto'
import { fail } from './core.js'

// Browser principals come from the authenticated single-user Connection carrier,
// never from JSON. Only grants explicitly issued to that principal are usable.
export function createJobs({ synthesize, resolveGrant, checkGrant, ticket, now = Date.now, timeoutMs = () => 125000 }) {
  const jobs = new Map()
  function expire() {
    for (const [id,j] of jobs) if (j.expires <= now()) { j.abort.abort(); jobs.delete(id) }
  }
  function read(id, principal) {
    expire(); const j = jobs.get(id)
    if (!j || j.principal !== principal) fail('JOB_GONE')
    checkGrant(j.grant); return j
  }
  return {
    submit(input, { principal, scope }) {
      expire(); const grant = resolveGrant(principal,input.voice?.source,scope)
      if (jobs.size >= 256) {
        const terminal = [...jobs].find(([,j]) => j.state !== 'running')
        if (terminal) jobs.delete(terminal[0]); else fail('QUEUE_FULL')
      }
      const requestId = randomBytes(32).toString('base64url'), abort = new AbortController()
      const budget = timeoutMs(input,grant)
      const job = { grant, principal, abort, state:'running', expires:now()+Math.max(300000,budget+5000) }
      jobs.set(requestId,job)
      void synthesize(input,{grant,scope,signal:abort.signal}).then(async result => {
        checkGrant(grant); if (abort.signal.aborted) return
        job.result = { ...result, ticket:await ticket({key:result.key,grant}) }; job.state = 'ready'
      }).catch(e => { job.state = 'error'; job.error = /^[A-Z_]+$/.test(e.code || '') ? e.code : 'SERVICE_OFFLINE'; job.status = e.status }).finally(() => { job.expires = now()+300000 })
      return {requestId,timeoutMs:budget}
    },
    poll(id, principal) { const j = read(id,principal); return {requestId:id,state:j.state,...(j.result ? {result:j.result} : {}),...(j.error ? {error:j.error,...(j.status ? {status:j.status} : {})} : {})} },
    cancel(id, principal) { const j = read(id,principal); j.abort.abort(); j.state='cancelled'; j.result=undefined; return {cancelled:true} },
    dispose() { for (const j of jobs.values()) j.abort.abort(); jobs.clear() },
  }
}
