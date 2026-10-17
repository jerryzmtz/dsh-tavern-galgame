// Flat-mouth bundles keep reference-canvas coordinates independent of stage framing.
function forkGalMouthBundle(model, mood) {
    const slot = model.images && model.images[mood] ? mood : "default", l = model.layered;
    const b = l && l.mode === "flat-mouth" && l.bindings && l.bindings[slot];
    const set = b && l.rig && l.rig.mouthSets && l.rig.mouthSets[b.mouth.set];
    if (!b || b.imageSha !== model.images[slot] || !set) return null;
    return { binding: b, set };
}
function forkGalMouthUrls(bundle) {
    return bundle ? Object.values(bundle.set.frames).concat(bundle.binding.mouth.cover ? [bundle.binding.mouth.cover.sha] : []) : [];
}
function forkGalMouthStep(previous, amplitude, voiced, now, audioKey) {
    let state = previous;
    if (!state || state.audioKey !== audioKey || now < state.sampledAt || now - state.sampledAt > 250) state = { frame: "closed", changedAt: -Infinity, audioKey };
    const level = Number.isFinite(amplitude) ? Math.max(0, Math.min(1, amplitude)) : 0;
    // Actual silence wins even inside the hold; no delayed silent open mouth.
    if (!voiced || level <= 0.01) return { frame: "closed", changedAt: state.frame === "closed" ? state.changedAt : now, sampledAt: now, audioKey };
    const levels = ["closed", "small", "mid", "open"], up = [0.20, 0.45, 0.72], down = [0.10, 0.32, 0.58];
    let index = levels.indexOf(state.frame), next = index;
    while (next < 3 && level >= up[next]) next++;
    if (next === index) while (next > 0 && level < down[next - 1]) next--;
    if (next !== index && now - state.changedAt >= 80) return { frame: levels[next], changedAt: now, sampledAt: now, audioKey };
    return Object.assign({}, state, { sampledAt: now });
}
function forkGalMouthTransform(binding, set, baseAnchor) {
    const a = binding.mouth.anchor, shiftX = binding.canvas[0] * baseAnchor.x, shiftY = binding.canvas[1] * baseAnchor.y;
    return { x: a.x - shiftX, y: a.y - shiftY, scale: a.scale, rotation: a.rotation * Math.PI / 180, pivot: set.pivot,
        cover: binding.mouth.cover ? { x: binding.mouth.cover.rect[0] - shiftX, y: binding.mouth.cover.rect[1] - shiftY } : null };
}
function forkGalMouthPoint(binding, set, point) {
    const a = binding.mouth.anchor, angle = a.rotation * Math.PI / 180, x = (point.x - set.pivot[0]) * a.scale, y = (point.y - set.pivot[1]) * a.scale;
    return { x: a.x + Math.cos(angle) * x - Math.sin(angle) * y, y: a.y + Math.sin(angle) * x + Math.cos(angle) * y };
}
function forkGalMouthLayers(surface, frame, voiced) {
    if (surface === "mouthless") return ["base", "mouth"];
    if (!voiced || surface === "neutral" && frame === "closed") return ["base"];
    return surface === "patch" ? ["base", "cover", "mouth"] : ["base", "mouth"];
}

// Baked mouths replace RGBA on one reusable canvas; no second source-over feather.
function forkGalMouthPaint(canvas, base, bundle, images, frame, voiced) {
    if (canvas.width !== base.width) canvas.width = base.width;
    if (canvas.height !== base.height) canvas.height = base.height;
    const ctx = canvas.getContext('2d'), b = bundle.binding, set = bundle.set;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(base, 0, 0);
    const layers = forkGalMouthLayers(b.mouth.surface, frame, voiced), cover = b.mouth.cover;
    if (layers.includes('cover')) ctx.drawImage(images.get(cover.sha), ...cover.rect);
    if (!layers.includes('mouth')) return;
    const image = images.get(set.frames[frame]), a = b.mouth.anchor;
    if (set.blends?.[frame] === 'replace') {
        // Native validation binds replacement pixels to unscaled integer source coordinates.
        const x = a.x - set.pivot[0], y = a.y - set.pivot[1];
        ctx.clearRect(x, y, ...set.canvas); ctx.drawImage(image, x, y);
    } else {
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rotation * Math.PI / 180); ctx.scale(a.scale, a.scale);
        ctx.drawImage(image, -set.pivot[0], -set.pivot[1]); ctx.restore();
    }
}
