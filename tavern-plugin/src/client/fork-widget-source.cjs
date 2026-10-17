// private fork: shared placement for the production widget presentation owner.
function forkWidgetSourcePlace({ width, height, size, figures = [], blocked = [], previous, anchor='center-card' }) {
    const w = size.width, h = size.height, padding = 16;
    const valid = r => r && !r.hidden && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
    const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + n * 2, height: r.height + n * 2 });
    const obstacles = [...blocked.filter(valid).map(r => inflate(r, 12)), ...figures.flatMap(f => [valid(f.body) && inflate(f.body, 18), valid(f.head) && inflate(f.head, 24)]).filter(Boolean)];
    const safe = r => r.x >= padding && r.y >= padding && r.x + w <= width - padding + 1e-7 && r.y + h <= height - padding + 1e-7
        && !obstacles.some(b => r.x < b.x + b.width - 1e-7 && r.x + w > b.x + 1e-7 && r.y < b.y + b.height - 1e-7 && r.y + h > b.y + 1e-7);
    const box = (x, y) => ({ x, y, width: w, height: h });
    if (previous && previous.width === w && previous.height === h && safe(previous)) return box(previous.x, previous.y);
    const cx = (width - w) / 2, cy = (height - h) / 2, xs = new Set([cx, padding, width - w - padding]), ys = new Set([cy, padding, height - h - padding]);
    for (const r of obstacles) { xs.add(r.x - w); xs.add(r.x + r.width); ys.add(r.y - h); ys.add(r.y + r.height); }
    const candidates = [];
    for (const x of xs) for (const y of ys) { const r = box(x, y); if (safe(r)) candidates.push(r); }
    const target=anchor==='corner-left' ? [padding,height-h-padding] : anchor==='corner-right' ? [width-w-padding,height-h-padding] : anchor==='top-center' ? [cx,padding] : [cx,cy];
    candidates.sort((a, b) => ((a.x - target[0]) ** 2 + (a.y - target[1]) ** 2) - ((b.x - target[0]) ** 2 + (b.y - target[1]) ** 2) || a.y-b.y || a.x-b.x);
    return candidates[0] || null;
}
function forkWidgetAvatarSquare(width,height,crop={x:0,y:0,w:1,h:1}) {
    const w=crop.w*width,h=crop.h*height,side=Math.min(w,h);
    return {x:crop.x*width+(w-side)/2,y:crop.y*height+(h-side)*.15,width:side,height:side};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {forkWidgetSourcePlace,forkWidgetAvatarSquare};
