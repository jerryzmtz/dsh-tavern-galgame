// First-party host adapter, not a capability exposed to the mod. Every wake enters the
// normal event queue and obtains a new revocable facade; no callback retains host.request.
export function createDanmakuEventAdapter({current,snapshot,publish,emit,onError=()=>{},
  schedule=(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer},unschedule=clearTimeout}) {
  const sessions=new Map()
  let disposed=false
  function stop(row) {if(row.timer!==null){unschedule(row.timer);row.timer=null}}
  function clear(sessionId) {
    const row=sessions.get(sessionId)
    if(row)stop(row)
    sessions.delete(sessionId)
  }
  return Object.freeze({
    accept(context,result) {
      if(disposed || !result || !current(context))return
      clear(context.sessionId)
      const row={context:structuredClone(context),timer:null}
      sessions.set(context.sessionId,row)
      publish(context.sessionId,structuredClone(result.view))
      if(result.wakeAfterMs===null || !result.view.active || result.view.silent || context.mode!=='live' || !current(context))return
      row.timer=schedule(async()=>{
        row.timer=null
        try {
          if(disposed || sessions.get(context.sessionId)!==row || !current(row.context))return
          const fresh=await snapshot(context.sessionId)
          if(disposed || sessions.get(context.sessionId)!==row || !current(row.context) || !fresh.active || fresh.mode!=='live')return
          emit({event:'mod.context.changed',context:row.context,payload:{reason:'cadence',active:true,
            anchor:fresh.anchor,activeTimeMs:fresh.activeTimeMs}})
        } catch(error){onError(error)}
      },Math.max(1,result.wakeAfterMs))
    },
    revoke(sessionId) {
      clear(sessionId)
      publish(sessionId,null)
    },
    dispose() {
      disposed=true
      for(const [sessionId,row] of sessions){stop(row);publish(sessionId,null)}
      sessions.clear()
    },
  })
}
