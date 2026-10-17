// Closed, generic drawing vocabulary from the frozen skin contract (40c409bf).
  const STAGE_SKIN_CURSORS = {
    triangle(x, k, c) { if (k % 2) return; x.fillStyle = c.color; x.beginPath(); x.moveTo(9, 12); x.lineTo(25, 12); x.lineTo(17, 24); x.fill(); },
    wheel(x, k, c) { x.translate(17, 17); x.rotate(k * Math.PI / 6); x.strokeStyle = c.color; x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 11, 0, 7); x.stroke(); for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(i * Math.PI / 4) * 11, Math.sin(i * Math.PI / 4) * 11); x.stroke(); } x.fillStyle = c.accent; x.beginPath(); x.arc(0, 0, 3.5, 0, 7); x.fill(); },
    lollipop(x, k, c) { x.strokeStyle = c.color; x.lineWidth = 3; x.beginPath(); x.moveTo(17, 18); x.lineTo(17, 33); x.stroke(); x.translate(17, 13); x.rotate(k * Math.PI / 4); x.fillStyle = c.color; x.beginPath(); x.arc(0, 0, 11, 0, 7); x.fill(); x.strokeStyle = c.accent; x.lineWidth = 2.5; x.beginPath(); for (let a = 0; a < 12; a += 0.3) { const r = a * 0.85; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.stroke(); },
    eye(x, k, c) { const shut = k % 6 === 0; x.translate(17, 17); x.fillStyle = c.color; x.beginPath(); x.ellipse(0, 0, 13, shut ? 1.5 : 10, 0, 0, 7); x.fill(); if (!shut) { x.fillStyle = c.accent; x.beginPath(); x.arc((k % 3) - 1, 0, 6, 0, 7); x.fill(); x.fillStyle = "#000"; x.beginPath(); x.arc((k % 3) - 1, 0, 3, 0, 7); x.fill(); } },
    rose(x, k, c) { x.translate(17, 16); x.rotate(k * 0.35); x.fillStyle = c.accent; for (let i = 0; i < 5; i++) { x.rotate(Math.PI * 2 / 5); x.beginPath(); x.ellipse(0, -6, 5, 8, 0, 0, 7); x.fill(); } x.fillStyle = c.color; x.beginPath(); x.arc(0, 0, 4, 0, 7); x.fill(); },
    rec(x, k, c) { x.fillStyle = c.color; x.fillRect(4, 8, 26, 18); x.fillStyle = k % 2 ? c.accent : c.color; x.beginPath(); x.arc(12, 17, 5, 0, 7); x.fill(); x.fillStyle = c.accent; x.fillRect(20, 14, 7, 2); x.fillRect(20, 19, 5, 2); },
    candle(x, k, c) { x.fillStyle = c.color; x.fillRect(13, 15, 8, 17); x.fillStyle = c.accent; x.beginPath(); const lean = [0, 2, -1, 1][k % 4]; x.moveTo(17, 14); x.quadraticCurveTo(10 + lean, 8, 17 + lean, 1); x.quadraticCurveTo(24 + lean, 8, 17, 14); x.fill(); },
    gear(x, k, c) { x.translate(17, 17); x.rotate(-k * Math.PI / 8); x.fillStyle = c.color; for (let i = 0; i < 8; i++) { x.rotate(Math.PI / 4); x.fillRect(-3, -15, 6, 6); } x.beginPath(); x.arc(0, 0, 10, 0, 7); x.fill(); x.fillStyle = c.accent; x.beginPath(); x.arc(0, 0, 4, 0, 7); x.fill(); },
    light(x, k, c) { const on = k % 4 !== 3; x.fillStyle = on ? c.accent : c.color; x.fillRect(5, 5, 24, 24); x.fillStyle = c.color; x.fillRect(9, 9, 16, 16); if (on) { x.fillStyle = c.accent; x.fillRect(13, 13, 8, 8); } },
    bell(x, k, c) { x.translate(17, 6); x.rotate([0.35, 0, -0.35, 0][k % 4]); x.fillStyle = c.color; x.beginPath(); x.moveTo(-10, 20); x.quadraticCurveTo(-10, 2, 0, 2); x.quadraticCurveTo(10, 2, 10, 20); x.closePath(); x.fill(); x.fillStyle = c.accent; x.beginPath(); x.arc(0, 23, 3.5, 0, 7); x.fill(); },
    feather(x, k, c) { x.translate(17, 8 + (k % 4) * 4); x.rotate([0.5, 0.1, -0.4, 0.1][k % 4]); x.fillStyle = c.color; x.beginPath(); x.ellipse(0, 0, 5, 12, 0, 0, 7); x.fill(); x.strokeStyle = c.accent; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, -12); x.lineTo(0, 14); x.stroke(); },
    needle(x, k, c) { x.translate(17, 17); x.rotate(Math.PI / 4 + (k % 2) * 0.12); x.strokeStyle = c.color; x.lineWidth = 2.5; x.beginPath(); x.moveTo(0, -14); x.lineTo(0, 14); x.stroke(); x.strokeStyle = c.accent; x.lineWidth = 1.5; x.beginPath(); x.ellipse(0, -10, 1.6, 3, 0, 0, 7); x.stroke(); x.beginPath(); x.moveTo(0, -10); x.quadraticCurveTo(10, 0, 4 + (k % 3) * 2, 14); x.stroke(); },
    teacup(x, k, c) { x.fillStyle = c.color; x.beginPath(); x.moveTo(5, 13); x.lineTo(25, 13); x.quadraticCurveTo(24, 28, 15, 28); x.quadraticCurveTo(6, 28, 5, 13); x.fill(); x.strokeStyle = c.color; x.lineWidth = 2.5; x.beginPath(); x.arc(26, 18, 4, -1.4, 1.4); x.stroke(); x.strokeStyle = c.accent; x.lineWidth = 2; x.beginPath(); x.moveTo(12, 10); x.quadraticCurveTo(10 + (k % 2) * 4, 6, 13, 2); x.stroke(); },
    // private fork: original designer whale, on the same reduced-motion clock as every cursor.
    whale(x, k, c) {
  const p = k % 6;
  x.translate(0, [0, -1, -1, 0, 0, 0][p]);
  x.fillStyle = c.color;
  // body
  x.beginPath(); x.moveTo(2.5, 21); x.bezierCurveTo(2.5, 13, 9, 10.5, 16, 10.5); x.bezierCurveTo(22, 11, 25.5, 15, 26, 19);
  x.quadraticCurveTo(26.5, 24.5, 20, 26); x.lineTo(9, 26); x.quadraticCurveTo(2.5, 26, 2.5, 21); x.fill();
  // tail stock + fluke
  x.beginPath(); x.moveTo(22, 21); x.quadraticCurveTo(28.5, 18, 28.5, 12); x.quadraticCurveTo(26.5, 9, 25, 6); x.quadraticCurveTo(28, 7, 29.2, 9.5);
  x.quadraticCurveTo(30.5, 7, 33, 6.5); x.quadraticCurveTo(31.5, 10, 30.6, 13); x.quadraticCurveTo(30, 20, 24, 24.5); x.closePath(); x.fill();
  // eye and belly line: punched out
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.arc(8.2, 17.2, 1.7, 0, 7); x.fill();
  x.lineWidth = 1.5; x.lineCap = 'round'; x.beginPath(); x.moveTo(5, 22.4); x.quadraticCurveTo(12, 24.6, 20.5, 23); x.stroke();
  x.globalCompositeOperation = 'source-over';
  // spout
  if (p < 4) {
    x.fillStyle = c.accent;
    const y = 8 - p * 1.4, r = 1.8 - p * 0.25;
    x.beginPath(); x.arc(10, y, r, 0, 7); x.fill();
    x.beginPath(); x.arc(13.4, y - 1.6, r * 0.8, 0, 7); x.fill();
    if (p > 0) { x.beginPath(); x.arc(7, y - 0.6, r * 0.7, 0, 7); x.fill(); }
  }
},
  };
function ForkStageSkinCursor({cursor,active,snap}) {
    const ref=React.useRef(null);
    React.useEffect(() => {
        const canvas=ref.current;if(!canvas)return;
        const ctx=canvas.getContext('2d'),settings={name:'triangle',color:'#ffffff',accent:'#ffffff',fps:8,...cursor};
        let step=0,timer;
        const motion=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
        function draw(){ctx.clearRect(0,0,34,34);ctx.save();STAGE_SKIN_CURSORS[settings.name](ctx,step++,settings);ctx.restore();if(active&&!snap)timer=forkForeground.setTimeout(draw,(settings.name==='rec'?500:1000/settings.fps)*(motion?.matches?2:1));}
        function reset(){if(timer!==undefined)forkForeground.clearTimeout(timer);timer=undefined;step=0;draw();}
        motion?.addEventListener('change',reset);
        draw();return()=>{motion?.removeEventListener('change',reset);if(timer!==undefined)forkForeground.clearTimeout(timer);ctx.clearRect(0,0,34,34);};
    },[cursor,active,snap]);
    return React.createElement('canvas',{ref,width:34,height:34,'aria-hidden':true});
}
function stageSkinBand(b,side) {
    const c=b.colors,h=b.height||14,top=side==='top',style={left:b.inset??24,right:b.inset??24,[side]:b.offset??9,height:h};
    const paints={
        staff:`repeating-linear-gradient(${c[0]} 0 1px,transparent 1px ${Math.max(3,h/4|0)}px)`,
        rule:`linear-gradient(${c[0]},${c[0]})`,
        dots:`radial-gradient(circle,${c[0]} 0 ${h/4}px,transparent ${h/4+.5}px) 0 0/${h*1.4}px ${h}px repeat-x`,
        stripes:`repeating-linear-gradient(45deg,${c[0]} 0 8px,${c[1]||'transparent'} 8px 16px)`,
        teeth:`conic-gradient(from ${top?135:-45}deg at 50% ${top?0:100}%,${c[0]} 90deg,transparent 0) 0 0/${h*1.5}px ${h}px repeat-x`,
        scanlines:`repeating-linear-gradient(${c[0]} 0 2px,transparent 2px 5px)`,
        fence:`conic-gradient(from 150deg at 50% 0,${c[0]} 60deg,transparent 0) 0 0/${h}px ${h*.7}px repeat-x,linear-gradient(${c[0]},${c[0]}) 0 100%/100% 2px no-repeat`,
        stained:`repeating-linear-gradient(90deg,${c.map((color,i)=>`${color} ${i*34}px ${i*34+30}px,#000000 ${i*34+30}px ${i*34+34}px`).join(',')})`,
        lace:`radial-gradient(circle at 50% ${top?0:100}%,${c[0]} 0 ${h*.55}px,transparent ${h*.55+.5}px) 0 0/${h*1.2}px ${h}px repeat-x`,
        checker:`conic-gradient(${c[0]} 25%,${c[1]||'transparent'} 0 50%,${c[0]} 0 75%,${c[1]||'transparent'} 0) 0 0/${h}px ${h}px`,
        chain:`radial-gradient(circle,transparent 0 ${h*.22}px,${c[0]} ${h*.22}px ${h*.38}px,transparent ${h*.38+.5}px) 0 0/${h*.9}px ${h}px repeat-x`
    };
    style.background=paints[b.pattern];
    if(b.pattern==='rule'){style.height=1;style.boxShadow=`0 ${top?4:-4}px 0 ${c[1]||c[0]}`;}
    return style;
}
function ForkStageSkinFrame({skin}) {
    const h=React.createElement,frame=skin.textbox.frame||{},corner=frame.corners;
    const drawings={diamond:['M2 28V8Q2 2 8 2H28','M15 6l5 5-5 5-5-5z'],rivet:['M2 28V2H28','M15 11a4 4 0 1 0-8 0a4 4 0 1 0 8 0'],bow:['M15 15C3 3 3 21 15 15C27 3 27 21 15 15','M18 15a3 3 0 1 0-6 0a3 3 0 1 0 6 0'],bracket:['M3 27V3H27','M9 21V9H21']};
    return h('span',{className:'fork-skin-frame','aria-hidden':true},
        ['top','bottom'].map(side=>frame[side]?h('i',{key:side,'data-band':side,style:stageSkinBand(frame[side],side)}):null),
        drawings[corner?.kind]?['tl','tr','br','bl'].map((position,index)=>h('svg',{key:position,className:'fork-skin-corner '+position,viewBox:'0 0 32 32',style:{rotate:index*90+'deg'},fill:'none'},
            h('path',{d:drawings[corner.kind][0],stroke:corner.colors?.[0]||skin.textbox.paint.border||skin.textbox.paint.fg,strokeWidth:3}),
            h('path',{d:drawings[corner.kind][1],fill:corner.colors?.[1]||skin.textbox.paint.accent||skin.textbox.paint.fg,stroke:corner.colors?.[0]||skin.textbox.paint.fg,strokeWidth:1.5}))):null);
}
