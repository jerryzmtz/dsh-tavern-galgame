const bytes=value=>new TextEncoder().encode(value).length

export function performanceCatalogueFragments(view) {
  const rows=view.packs.flatMap(pack=>pack.entries.map(entry=>({ref:entry.ref,name:entry.name,levels:entry.performanceLevels,default:entry.performanceDefault,note:entry.directorNote || ''})))
  if(!rows.length)return []
  const base=rows.map(({note,...row})=>row),budget=Math.max(0,(rows.length===1?512:1536)-bytes(JSON.stringify(base))-rows.length*10)
  const limit=Math.floor(budget/rows.length)
  const text=JSON.stringify(rows.map(({note,...row})=>{
    let kept=''
    for(const char of note.replace(/\s+/g,' ').trim()) {if(bytes(kept+char)>limit)break;kept+=char}
    return {...row,...(kept?{note:kept}:{})}
  }))
  return [{modId:'dsh.performance',id:'catalogue',type:'catalogue',source:'library',placement:{section:'director.catalogue',order:0},text}]
}
