// Offline first-party test double only; the production item widget is not migrated.
export function correctionDouble({wait=()=>Promise.resolve()}={}) {
  return {
    prepare(){return null},dispose(){},
    async command({params},host) {
      return host.stage.place({id:params.id,kind:'test.stock',payload:{name:params.name,action:params.action},
        ...(params.action==='show'?{}:{pairing:{readId:'stock',path:[params.name]}})})
    },
    async settled({settlementRevision,before,after,performances},host) {
      await wait()
      const used=new Set(),revisions=[]
      for(const performance of performances) {
        const base={performanceId:performance.id,expectedRevision:performance.revision}
        if(!performance.pairing) {revisions.push({...base,action:'replace',payload:performance.payload,reason:'display-only'});continue}
        const {readId,path}=performance.pairing,key=JSON.stringify([readId,path])
        const get=values=>path.reduce((value,part)=>value?.[part],values[readId])
        const delta=Number(get(after) || 0)-Number(get(before) || 0)
        const direction=performance.payload.action==='gain'?1:-1
        if(!Number.isFinite(delta) || delta*direction<=0 || used.has(key)) {
          revisions.push({...base,action:'remove',reason:used.has(key)?'duplicate-fact':'no-matching-change'})
        } else {
          used.add(key)
          revisions.push({...base,action:'replace',payload:{...performance.payload,count:Math.abs(delta)},reason:'settled-count'})
        }
      }
      return host.stage.reviseAfterSettlement({settlementRevision,revisions})
    }
  }
}
