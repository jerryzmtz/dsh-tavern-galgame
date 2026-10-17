import { createHash } from 'node:crypto'

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const error = code => Object.assign(new Error(code), {code})
export function redact(value, secrets = []) {
  let text = String(value)
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]')
  return text.replace(/(authorization\s*[:=]\s*|bearer\s+)[^\r\n]+/gi,'$1[redacted]').replace(/((?:token|password|secret|api[_-]?key|access[_-]?key)\s*["']?\s*[:=]\s*)[^\s,;}]+/gi,'$1[redacted]').replace(/https?:\/\/[^\s]+/g,'[url]').slice(-2048)
}
export const IDLE_TIMEOUT_MS = 60 * 60 * 1000
export function createManager({ subprocess, getSettings, prepare, connection, probe, shutdown, scrubEnv = () => ({}), pollMs = 2000, stopTimeoutMs = 10000, idleClock = {setTimeout,clearTimeout} }) {
  let explicitStop = false
  let state = 'stopped', failure = '', generation = 0, handle, launch, flight, stopping, quiescing, abort, disposed = false, activeRevision = '', readyHealth, logCursor = 0, logTimer, healthTimer
  const listeners = new Set(), logs = [], offsets = { stdout:0, stderr:0 }, partial = { stdout:'', stderr:'' }
  let requests = 0, idleTimer
  const clearIdle = () => { idleClock.clearTimeout(idleTimer); idleTimer = undefined }
  function scheduleIdle() {
    clearIdle()
    if (disposed || state !== 'ready' || requests) return
    idleTimer = idleClock.setTimeout(() => { idleTimer = undefined; void api.stop().catch(() => {}) }, IDLE_TIMEOUT_MS)
    idleTimer?.unref?.()
  }
  const emit = type => { for (const fn of listeners) fn({type,generation}) }
  // private fork: the settings revision is hashed once per status read.
  const statusAt = configRevision => ({ state, configRevision, stale:!!activeRevision && activeRevision !== configRevision, error:failure, voiceCount:readyHealth?.voices?.length || 0, ...(readyHealth?.vramBytes !== undefined ? {vramBytes:readyHealth.vramBytes} : {}) })
  const status = () => statusAt(digest(getSettings()))
  function transition(next, code = '') { state = next; failure = code; emit('statusChanged') }
  function collect() {
    for (const stream of ['stdout','stderr']) {
      const delta = handle?.collected?.[stream]?.readFrom(offsets[stream]); if (!delta) continue
      offsets[stream] = delta.nextOffset
      if (delta.text || delta.lossy) {
        const lines = ((delta.lossy ? '' : partial[stream]) + delta.text).split(/\r?\n/)
        partial[stream] = lines.pop()
        if (partial[stream].length > 8192) { partial[stream] = ''; lines.push('[incomplete line withheld]') }
        if (delta.lossy) lines.unshift('[truncated]')
        // Redact complete lines, never expose a secret split across collected chunks.
        for (const line of lines) logs.push({cursor:++logCursor,stream,text:redact(line,[launch?.key])})
        while (logs.length > 128) logs.shift()
        emit('logsChanged')
      }
    }
  }
  async function bounded(promise, ms, code, signal) {
    let timer, cancel
    try { return await Promise.race([promise, new Promise((_,reject) => {
      timer = setTimeout(() => reject(error(code)),ms)
      cancel = () => reject(error('ABORTED'))
      if (signal?.aborted) cancel(); else signal?.addEventListener('abort',cancel,{once:true})
    })]) }
    finally { clearTimeout(timer); if (cancel) signal?.removeEventListener('abort',cancel) }
  }
  function quiesce() {
    if (!quiescing) quiescing = cleanRange().finally(() => { quiescing = undefined })
    return quiescing
  }
  async function cleanRange() {
    clearIdle()
    clearInterval(logTimer); logTimer = undefined; clearInterval(healthTimer); healthTimer = undefined
    if (launch && (handle || explicitStop && !disposed) && shutdown) {
      try { await bounded(shutdown(launch),stopTimeoutMs,'STOP_TIMEOUT') }
      catch (e) { if (!handle) throw e }
    }
    if (handle) {
      collect(); handle.terminate()
      await bounded(handle.waitForExit(),stopTimeoutMs,'STOP_TIMEOUT')
      collect(); handle = undefined
    }
    launch = undefined
    readyHealth = undefined; activeRevision = ''
  }
  async function run(mine, settings, signal) {
    try {
      launch = await prepare(settings,signal)
      if (signal.aborted || mine !== generation) throw error('ABORTED')
      // Cancellation fences readiness/synthesis; only cleanup may terminate the process after shutdown.
      handle = subprocess.spawn({ argv:launch.argv, cwd:launch.cwd || settings.installPath, env:{...scrubEnv(),PYTHONUTF8:'1',TORCH_FORCE_WEIGHTS_ONLY_LOAD:'1',...launch.env}, stdio:{stdin:'ignore',stdout:{maxBytes:65536},stderr:{maxBytes:65536}}, graceMs:5000 })
      offsets.stdout = offsets.stderr = 0; partial.stdout = partial.stderr = ''; logTimer = setInterval(collect,250)
      const owned = handle
      void owned?.done.then(() => crashed(owned,mine), () => crashed(owned,mine))
      const deadline = Date.now() + settings.readinessTimeoutMs
      while (!signal.aborted && mine === generation) {
        const remaining = deadline - Date.now(); if (remaining <= 0) throw error('TIMEOUT')
        const health = await bounded(probe(launch,signal),remaining,'TIMEOUT',signal).catch(e => { if (e.code === 'TIMEOUT') throw e; return {state:'starting'} })
        if (signal.aborted || mine !== generation) throw error('ABORTED')
        if (health.state === 'ready') {
          readyHealth = health; transition('ready'); scheduleIdle()
          let checking = false
          healthTimer = setInterval(async () => {
            if (checking || mine !== generation) return
            checking = true
            try {
              const current = await bounded(probe(launch,signal),5000,'TIMEOUT',signal)
              if (mine === generation && current.state !== 'ready') crashed(owned,mine)
              else if (mine === generation) { readyHealth = current; emit('statusChanged') }
            } catch { if (mine === generation) crashed(owned,mine) }
            finally { checking = false }
          },Math.max(1000,pollMs))
          return status()
        }
        if (health.state === 'error') {
          throw error('SERVICE_START_FAILED')
        }
        await new Promise(resolve => { const timer = setTimeout(done,Math.min(pollMs,remaining)); function done() { clearTimeout(timer); signal.removeEventListener('abort',done); resolve() }; signal.addEventListener('abort',done,{once:true}) })
      }
      throw error('ABORTED')
    } catch (e) {
      if (mine === generation && !signal.aborted) { transition('error', e.code || 'START_FAILED'); abort.abort(); try { await quiesce() } catch { failure = 'STOP_TIMEOUT' }; throw error(failure) }
      throw error('ABORTED')
    }
  }
  function crashed(owned,mine) {
    if (owned !== handle || mine !== generation || state === 'stopping' || disposed) return
    generation++; abort?.abort(); transition('error','PROCESS_EXITED')
    void quiesce().catch(() => { failure = 'STOP_TIMEOUT'; emit('statusChanged') })
  }
  const api = {
    apiVersion:1, status,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    recentLogs({after = 0,limit = 100} = {}) { collect(); return {cursor:logCursor,items:logs.filter(l => l.cursor > after).slice(-Math.max(1,Math.min(128,limit))).map(l => ({...l}))} },
    start({expectedRevision} = {}) {
      if (disposed) return Promise.reject(error('PLUGIN_UNAVAILABLE'))
      if (stopping) return stopping.then(() => api.start({expectedRevision}))
      if (quiescing) return quiescing.then(() => api.start({expectedRevision}))
      const revision = digest(getSettings())
      if (expectedRevision && expectedRevision !== revision) return Promise.reject(error('REVISION_CONFLICT'))
      if (flight) return flight
      if (state === 'ready') return activeRevision === revision ? Promise.resolve(statusAt(revision)) : api.restart({expectedRevision})
      if (handle || launch || failure === 'STOP_TIMEOUT') return Promise.reject(error(failure || 'STOP_TIMEOUT'))
      const settings = structuredClone(getSettings()); activeRevision = revision
      explicitStop = false; abort = new AbortController(); const mine = ++generation; transition('starting')
      flight = run(mine,settings,abort.signal).finally(() => { flight = undefined })
      return flight
    },
    stop() {
      clearIdle()
      if (stopping) return stopping
      explicitStop = true; generation++; abort?.abort(); transition('stopping')
      stopping = (async () => { try { await bounded(flight?.catch(() => {}),stopTimeoutMs,'STOP_TIMEOUT'); await quiesce(); transition('stopped'); return status() } catch (e) { const code = e.code === 'SHUTDOWN_UNSUPPORTED' ? e.code : 'STOP_TIMEOUT'; transition('error',code); throw error(code) } })().finally(() => { stopping = undefined })
      return stopping
    },
    async restart(input) {
      if (input?.expectedRevision && input.expectedRevision !== digest(getSettings())) throw error('REVISION_CONFLICT')
      await api.stop(); return api.start(input)
    },
    provider() {
      if (state !== 'ready') return null
      return {...launch.provider,revision:activeRevision}
    },
    // The connection survives idle stop; only its requests may wake the worker.
    async connection() {
      const settings = structuredClone(getSettings())
      if (disposed || !settings.modelConfigPath) return null
      try {
        const p = await connection(settings), revision = digest(settings)
        return {...p, revision, paid:false, lifecycle:{
          readinessTimeoutMs:settings.readinessTimeoutMs,
          ready:() => state === 'ready',
          onRequest:scheduleIdle,
          begin() { requests++; clearIdle(); return () => { requests--; scheduleIdle() } },
          async start({signal} = {}) {
            if (signal?.aborted) throw error('ABORTED')
            await api.start({expectedRevision:revision})
            if (signal?.aborted) throw error('ABORTED')
          },
        }}
      } catch (e) { if (!disposed) transition('error',e.code || 'INVALID_CONFIG'); return null }
    },
    configure() { emit('configChanged') },
    activate() { if (getSettings().autoStart === true) void api.start().catch(() => {}); return api },
    async dispose() { if (disposed) return; disposed = true; await api.stop(); emit('disposed'); listeners.clear() },
  }
  return api
}

// One optional injection owns a stable connection, independent of worker residency.
export function attachProvider(manager, tts) {
  let unregister, revision, generation = 0, disposed = false
  const sync = async () => {
    const mine = ++generation, p = await manager.connection()
    if (disposed || mine !== generation) return
    if (!p || p.revision !== revision) { unregister?.(); unregister = undefined; revision = undefined }
    if (p && !unregister) { unregister = tts.registerReferenceProvider('dsh-tts-local',p); revision = p.revision }
  }
  const off = manager.subscribe(e => { if (e.type === 'configChanged') void sync() }); void sync()
  return () => { disposed = true; generation++; off(); unregister?.() }
}
