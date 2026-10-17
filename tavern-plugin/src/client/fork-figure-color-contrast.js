// private fork (owner 2026-10): the stage SKIP label is the only figure-colour contrast consumer. Names (bubble,
// textbox, backlog) keep their pre-v3.1 theme CSS ink and are never given an inline backing.
function applyForkFigureTextContrast(roots) {
  const doc=roots[0].ownerDocument,win=doc.defaultView,canvas=doc.createElement('canvas');
  canvas.width=canvas.height=1;
  // Canvas 2D resolves system colors as light even in a dark document. Let CSS
  // resolve the actual canvas surface before compositing translucent ancestors.
  canvas.style.cssText='display:none;background-color:Canvas';
  doc.body.append(canvas);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  // Identical CSS colors share a canvas readback only within this read phase.
  // A new batch resolves them again, including system colors after a theme change.
  const colors=new Map(),surfaces=new WeakMap();
  const rgba=css=>{if(colors.has(css))return colors.get(css);ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);const color=[...ctx.getImageData(0,0,1,1).data];colors.set(css,color);return color;};
  const over=(front,back)=>{const a=front[3]/255;return [0,1,2].map(i=>front[i]*a+back[i]*(1-a)).concat(255);};
  const nodes=[...new Set(roots.flatMap(root=>[...root.querySelectorAll('[data-figure-skip-color]')]))];
  const canvasSurface=rgba(win.getComputedStyle(canvas).backgroundColor);
  // All mounted boxes share one read phase, then one write phase.
  const results=nodes.map(node=>{
    const layers=[];
    for(let ancestor=node;ancestor;ancestor=ancestor.parentElement){
      let layer=surfaces.get(ancestor);
      if(!layer){
        const style=win.getComputedStyle(ancestor);
        const gradient=style.backgroundImage.match(/(?:rgba?|color|oklab|oklch|lab|lch|hsla?)\([^)]*\)|#[0-9a-f]+/i);
        layer=rgba(gradient?gradient[0]:style.backgroundColor);surfaces.set(ancestor,layer);
      }
      layers.push(layer);if(layer[3]===255)break;
    }
    let background=canvasSurface;for(const layer of layers.reverse())background=over(layer,background);
    const hex='#'+background.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
    return {node,hex,ink:figureTextColor(node.dataset.figureSkipColor,hex)};
  });
  canvas.remove();
  for(const {node,hex,ink} of results){node.style.setProperty('--figure-skip-ink',ink);node.style.setProperty('--figure-skip-surface',hex);}
}
function scheduleForkFigureTextContrast(root) {
  const doc=root.ownerDocument,key=Symbol.for('dsh-tavern.figure-contrast-queue');
  let queue=doc[key];
  if(!queue){
    queue=doc[key]=new Set();
    doc.defaultView.queueMicrotask(()=>{
      delete doc[key];
      const roots=[...queue].filter(root=>root.isConnected);
      if(roots.length)applyForkFigureTextContrast(roots);
    });
  }
  queue.add(root);
  return()=>queue.delete(root);
}
// private fork (perf round 3): the stage root's look/performance variables (shake, vignette, haze, grain) are
// written every frame while the scene animates (the stage menu); they never reach a background, so such writes
// must not re-read the SKIP backing (a forced style recalc, ~8 ms per frame).
const FORK_CONTRAST_INERT_STYLE=/^--(?:look|performance)-/;
function forkContrastStyleChanged(scratch,before,after) {
  const read=text=>{scratch.style.cssText=text||'';const style=scratch.style,values=new Map();for(let i=0;i<style.length;i++)values.set(style[i],style.getPropertyValue(style[i])+'!'+style.getPropertyPriority(style[i]));return values;};
  const a=read(before),b=read(after);
  for(const name of new Set([...a.keys(),...b.keys()]))if(a.get(name)!==b.get(name)&&!FORK_CONTRAST_INERT_STYLE.test(name))return true;
  return false;
}
function useForkFigureTextContrast(React,ref,enabled,...keys) {
  React.useLayoutEffect(()=>{if(enabled&&ref.current)return scheduleForkFigureTextContrast(ref.current);},[enabled,...keys]);
  React.useEffect(()=>{
    const root=ref.current;if(!enabled||!root)return;
    const win=root.ownerDocument.defaultView,scratch=root.ownerDocument.createElement('div');
    const observer=new win.MutationObserver(records=>{
      if(records.some(record=>{
        const now=record.target.getAttribute(record.attributeName);
        return record.oldValue!==now&&(record.attributeName!=='style'||forkContrastStyleChanged(scratch,record.oldValue,now));
      }))scheduleForkFigureTextContrast(root);
    });
    for(const node of [root.ownerDocument.body,root.ownerDocument.documentElement,root.closest('.fork-gal-stage')].filter(Boolean))observer.observe(node,{attributes:true,attributeOldValue:true,attributeFilter:['class','style','data-ds-dark-theme','data-theme','data-fk-skin']});
    return()=>observer.disconnect();
  },[ref,enabled]);
}
