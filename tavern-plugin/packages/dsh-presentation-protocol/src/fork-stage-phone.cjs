// Read-only phone presentation. Paragraph IDs belong to the existing GAL source index.
function forkPhoneMarker(raw, unit, characters) {
    if (!raw || Object.keys(raw).some(key => !['op', 'contact', 'side', 'form'].includes(key)) || raw.op !== 'phone.message'
        || !unit || !['line', 'narration'].includes(unit.kind) || typeof raw.contact !== 'string' || !['in', 'out'].includes(raw.side) || raw.form !== undefined && !['text', 'voice'].includes(raw.form)) return null;
    // private fork: both source speakers and marker contacts resolve before identity comparisons.
    const resolver = typeof forkFigureResolution !== 'undefined' ? forkFigureResolution : require('./figure-resolution.cjs');
    const rows = characters.map(row => ({...row, actorKey:row.alias}));
    const contact = resolver.resolveFigureName(rows, raw.contact);
    if (contact.status !== 'resolved') return null;
    // Narration has no speaker identity; contact/side explicitly declare the message direction.
    if (unit.kind === 'line') {
        const speaker = resolver.resolveFigureName(rows, unit);
        if (speaker.status !== 'resolved' || (raw.side === 'in' ? speaker.actorKey !== contact.actorKey : speaker.actorKey === contact.actorKey)) return null;
    }
    return { op: 'phone.message', contact: contact.actorKey, side: raw.side, ...(raw.form ? {form:raw.form} : {}) };
}
function forkPhoneProjection(pages, at, record, characters) {
    const empty = { active: false, current: null, messages: [], key: '' };
    // private fork: validated pack prefixes have ops and a stable binding, not a legacy key.
    const pack = Boolean(record?.token?.bindingKey);
    const key = pack ? record.token.bindingKey + ':' + record.token.generation : record?.key;
    const ready = pack ? ['partial', 'done'].includes(record.phase) && pages[at]?.para <= record.through : record?.status === 'done';
    if (!ready || typeof key !== 'string' || !key || !Array.isArray(record.entries) || !pages[at]) return empty;
    const marks = new Map();
    for (const entry of record.entries) {
        const ops = pack ? entry?.at <= record.through && entry.ops : entry?.commands;
        for (const raw of Array.isArray(ops) ? ops : []) {
            if (!raw || raw.op !== 'phone.message') continue;
            const unit = pages.find(page => page.para === entry.at);
            const mark = forkPhoneMarker(raw, unit, characters || []);
            if (marks.has(entry.at) || !mark) marks.set(entry.at, null); else marks.set(entry.at, mark);
        }
    }
    const ordered = [...marks].filter(([, mark]) => mark).sort((a, b) => a[0] - b[0]);
    const groups = [];
    for (const [para, mark] of ordered) {
        let group = groups[groups.length - 1];
        if (!group || group.contact !== mark.contact || pages.some(item => item.para > group.last && item.para < para && item.kind === 'line' && !marks.get(item.para))) {
            group = { first: para, last: para, contact: mark.contact, marks: new Map() }; groups.push(group);
        }
        group.last = para; group.marks.set(para, mark);
    }
    const current = pages[at], group = groups.find(item => current.para >= item.first && current.para <= item.last);
    if (!group) return empty;
    const seen = new Set(), messages = [];
    for (const line of pages.slice(0, at + 1)) {
        const mark = group.marks.get(line.para);
        if (!mark || seen.has(line.para)) continue;
        seen.add(line.para);
        const prior = messages[messages.length - 1];
        const resolver = typeof forkFigureResolution !== 'undefined' ? forkFigureResolution : require('./figure-resolution.cjs');
        const rows = (characters || []).map(row => ({...row, actorKey:row.alias}));
        messages.push({ line, mark, continued: Boolean(prior && resolver.resolveFigureName(rows, prior.line).actorKey === resolver.resolveFigureName(rows, line).actorKey
            && prior.mark.side === mark.side && prior.line.para + 1 === line.para) });
    }
    return { active: true, current: group.marks.get(current.para) || null, messages, contact: group.contact,
        first: group.first, last: group.last, key: key + ':' + group.first + ':' + group.contact };
}
function forkPhoneSize(screenWidth) { return { screenWidth, width: screenWidth + 14, height: screenWidth * 932 / 430 + 14 }; }
function forkPhonePlace({ width, height, size, figures = [], blocked = [], previous }) {
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
    candidates.sort((a, b) => ((a.x - cx) ** 2 + (a.y - cy) ** 2) - ((b.x - cx) ** 2 + (b.y - cy) ** 2) || Math.abs(a.y - cy) - Math.abs(b.y - cy) || a.x - b.x);
    return candidates[0] || null;
}
function forkPhoneLayout({ width, height, figures, blocked, caption, previous, compactPrevious }) {
    const normalWidth = Math.min(280, width - 46, (height - 110 - 14) * 430 / 932);
    if (normalWidth < 200) return null;
    const normal = forkPhoneSize(normalWidth), place = (size, prior) => forkPhonePlace({ width, height, figures, blocked, size, previous: prior });
    let bounds = place(normal, previous);
    if (bounds) return { ...bounds, compact: false };
    if (!caption) return null;
    const attempt = value => { const size = forkPhoneSize(value), found = place(size, compactPrevious); return found && { ...found, compact: true }; };
    let low = 200, high = Math.min(normalWidth, (caption.y - 28 - 14) * 430 / 932);
    if (high < low) return null;
    bounds = attempt(high); if (bounds) return bounds;
    bounds = attempt(low); if (!bounds) return null;
    for (let i = 0; i < 12 && high - low > .1; i++) { const mid = (low + high) / 2, candidate = attempt(mid); if (candidate) { low = mid; bounds = candidate; } else high = mid; }
    return bounds;
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = { forkPhoneMarker, forkPhoneProjection, forkPhoneSize, forkPhonePlace, forkPhoneLayout };
