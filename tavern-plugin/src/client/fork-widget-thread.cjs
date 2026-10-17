// private fork: a bounded projection of canonical text + accepted marks, not a message store.
function forkWidgetTextPrefix(text, limit) {
    let bytes=0, result='';
    for (const char of text) {const size=new TextEncoder().encode(char).length;if (bytes+size>limit) break;bytes+=size;result+=char;}
    return result;
}
function forkSourceMark(op,ref) {
    if(ref.modId==='dsh.phone')return op.op==='mod.command' && op.modId==='dsh.phone' && op.commandId==='mark' ? op.params : null;
    return op.op==='widget.source' && op.ref.packId===ref.packId && op.ref.kind===ref.kind && op.ref.assetId===ref.assetId ? op : null;
}
function forkWidgetThread({rows, ref, cursor, visibleText='', revealed=false, unavailable=false, limited=false}) {
    const key=value=>value.modId ? JSON.stringify([value.modId,value.packId,value.kind,value.entryId]) : JSON.stringify([value.packId,value.kind,value.assetId]);
    const wanted=key(ref), turns=[...rows].filter(row=>row.turn<=cursor.turn).sort((a,b)=>b.turn-a.turn).slice(0,20);
    const candidates=[];
    for (const row of turns) {
        const record=row.record;
        if (!row.sourceKey || !record?.token?.bindingKey || !['partial','done'].includes(record.phase)) continue;
        const pages=row.turn === cursor.turn ? row.pages.slice(0,cursor.page+1) : row.pages;
        const marks=new Map(record.entries.filter(entry=>entry.at<=record.through).flatMap(entry=>entry.ops.flatMap(op=>{const mark=forkSourceMark(op,ref);return mark?[[entry.at,mark]]:[]})));
        const messages=new Map();
        for (const [i,line] of pages.entries()) {
            const para=line.para || line.anchor?.para, mark=marks.get(para);
            if (!mark || !(line.kind === 'line' || ref.modId === 'dsh.phone' && line.kind === 'narration')) continue;
            const current=row.turn === cursor.turn && i === cursor.page;
            const text=current ? visibleText : line.text;
            const id=JSON.stringify([row.sourceKey,record.token.generation,row.turn,para]);
            const message=messages.get(para) || {id,turn:row.turn,para,alias:line.alias,name:line.name || '',contact:mark.contact,side:mark.side,...(ref.modId==='dsh.phone'?{form:mark.form || 'text'}:{}),text:'',revealed:true};
            // Page offsets include the original whitespace; do not duplicate a paragraph at page boundaries.
            const offset=line.anchor?.offset ?? message.text.length;
            message.text=message.text.slice(0,offset)+text;
            message.revealed=current ? revealed && !row.pages.slice(cursor.page+1).some(next=>(next.para || next.anchor?.para)===para) : true;
            messages.set(para,message);
        }
        candidates.push(...[...messages.values()].reverse());
    }
    const contact=candidates[0]?.contact;
    const threadKey=contact ? JSON.stringify([wanted,contact]) : '';
    // Reserve the bounded thread/cursor metadata as well as JSON array separators.
    let bytes=new TextEncoder().encode(threadKey).length+512,hasEarlier=false;
    const messages=[];
    for (const candidate of candidates.filter(message=>message.contact===contact)) {
        const message={...candidate};
        const text=forkWidgetTextPrefix(message.text,8192);
        if (text!==message.text) {message.text=text;message.truncated=true;}
        const size=new TextEncoder().encode(JSON.stringify(message)).length+65; // Reserve a bounded host voice handle.
        if (messages.length>=80 || bytes+size>65536) {hasEarlier=true;break;}
        bytes+=size;messages.push(message);
    }
    messages.reverse();
    const current=messages.findLast(message=>message.turn===cursor.turn && message.para===cursor.para);
    return {messages,threadKey,current:current ? {id:current.id,turn:current.turn,para:current.para,revealed:current.revealed} : null,
        historyStatus:unavailable ? 'unavailable' : limited || hasEarlier ? 'limited' : 'ready',hasEarlier};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={forkWidgetThread,forkWidgetTextPrefix,forkSourceMark};
