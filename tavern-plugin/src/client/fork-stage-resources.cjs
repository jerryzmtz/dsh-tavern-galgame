'use strict';

// private fork: metadata follows local URLs, never transport/content identities.
const stageAvatarCrops = new Map();
function getStageAvatarCrop(url, fallback) { return stageAvatarCrops.get(url) || fallback; }
// private fork (docs/fork/spine-figures.md): a bundle's entry URL → its borrowed files (relative path → {url, json?, image?}),
// so a renderer that needs sibling files (a Spine atlas and its pages) borrows the owner's decoded copies.
const stageBundleFiles = new Map();
function getStageBundleFiles(url) { return stageBundleFiles.get(url) || null; }
function stageAvatarCap(dpr = globalThis.devicePixelRatio || 1) {
    // --cl-face <= (20 + 17*1.5 + 4 + 28*5.1 + 36)*1.5 = 342.45 CSS px.
    return Math.max(512, Math.ceil(342.45 * dpr / 128) * 128);
}
// private fork: Chromium encodes PNG canvases in main-thread idle slices, so a busy (scrolling)
// main thread delayed first-time avatars by seconds. Lossless WebP (alpha kept) is encoded off
// the main thread; measured in tests/fork-avatar-flash-browser.test.mjs.
function stageAvatarCanvas() {
    return typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1,1) : document.createElement('canvas');
}
function stageAvatarEncode(target) {
    return typeof target.convertToBlob === 'function' ? target.convertToBlob({type:'image/webp',quality:1})
        : new Promise(resolve => target.toBlob(resolve,'image/webp',1));
}
async function stageAvatarBitmap(image, crop, canvas = stageAvatarCanvas, cap = stageAvatarCap()) {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    crop ||= {x:0,y:0,w:1,h:1};
    const sw = width * crop.w, sh = height * crop.h, side = Math.max(sw,sh);
    if (!(side > 0 && sw > 0 && sh > 0)) throw new Error('Invalid avatar dimensions');
    // Keep ALL left overflow. The face square is flush with the stage bottom;
    // retain its bottom letterbox plus a 1/4-square guard for the CSS drop-shadow.
    // Pixels further down the body cannot reach the visible screen.
    const right = width * (crop.x + crop.w), top = height * crop.y;
    const bottom = Math.min(height,top + sh + (side - sh) / 2 + (crop.x || crop.y || crop.w !== 1 || crop.h !== 1 ? side / 4 : 0));
    const scale = Math.min(1,cap / side), target = canvas();
    target.width = Math.max(1,Math.ceil(right * scale));
    target.height = Math.max(1,Math.ceil((bottom - top) * scale));
    try {
        // private fork (stage perf 2026-10): a CPU-backed canvas. With the default GPU canvas, encoding read the
        // pixels back from the GPU while Live2D was drawing: 0.5-2 s main-thread stalls per new face offline.
        const context = target.getContext('2d',{willReadFrequently:true});
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(image,0,top,right,bottom-top,0,0,right*scale,(bottom-top)*scale);
        const blob = await stageAvatarEncode(target);
        if (!blob) throw new Error('Avatar encoding failed');
        return {blob,width:target.width,height:target.height,crop:{x:width*crop.x*scale/target.width,y:0,
            w:sw*scale/target.width,h:sh*scale/target.height}};
    } finally { target.width = target.height = 0; }
}

// private fork: one transport/byte owner. Presentation and replacement pins share
// content handles; tickets are transport only, never a renderer's identity.
function stageResourceMatches(descriptor, scope) {
    const ref = descriptor?.ref || descriptor;
    return !!scope.authority || !!scope.packId && ref?.packId === scope.packId ||
        (scope.refs || []).some(item => item.packId === ref?.packId && item.kind === ref?.kind && item.assetId === ref?.assetId && item.figureId === ref?.figureId) ||
        (scope.aliases || []).includes(descriptor?.alias);
}
function createStageResourceOwner({service, fetch: request = globalThis.fetch, urls = globalThis.URL,
    decode = async () => null, avatarBitmap = stageAvatarBitmap, maxBytes = 2 * 1024 ** 3, maxItems = 2048}) {
    const allocations = new Set();
    const entries = new Map(), getService = typeof service === 'function' ? service : () => service;
    let bytes = 0, disposed = false, lastBudgetFailure = null;
    function diagnostics() {
        const byKind = {};
        for (const entry of entries.values()) {
            const kind = entry.descriptor.kind === 'bundle' ? 'bundle' : entry.descriptor.ref?.kind || 'media';
            const row = byKind[kind] ||= {bytes:0, entries:0, pins:0, prefetchPins:0};
            row.bytes += entry.bytes; row.entries++; row.pins += entry.pins;
            row.prefetchPins += [...entry.holders].filter(pin => pin.prefetch).length;
        }
        if (allocations.size) byKind.performance = {bytes:[...allocations].reduce((n,a) => n + a.bytes,0),entries:allocations.size,pins:allocations.size,prefetchPins:0};
        return {bytes, entries:entries.size + allocations.size, maxBytes, maxItems, byKind};
    }
    const failure = code => Object.assign(new Error(code), {code});
    const keyFor = (descriptor, authority) => JSON.stringify([authority,descriptor.identity,
        ...(Object.hasOwn(descriptor,'crop') ? [descriptor.crop ? [descriptor.crop.x,descriptor.crop.y,descriptor.crop.w,descriptor.crop.h] : null] : [])]);
    function destroy(entry) {
        if (entries.get(entry.key) === entry) entries.delete(entry.key);
        entry.dead = true;
        for (const url of entry.urls) { stageAvatarCrops.delete(url); stageBundleFiles.delete(url); urls.revokeObjectURL(url); }
        for (const image of entry.decoded) image?.close?.();
        bytes -= entry.bytes; entry.bytes = 0; entry.urls.length = 0; entry.decoded.length = 0;
        if (entry.lease) void entry.service.releaseLease(entry.lease.ticket);
        entry.lease = null;
    }
    function room(size, count = 0, requester) {
        const fits = () => bytes + size <= maxBytes && entries.size + allocations.size + count <= maxItems;
        if (fits()) return;
        // private fork: oldest speculative holders are expendable, including in-flight
        // preloads. Never evict the entry whose bytes are currently being accounted.
        for (const entry of entries.values()) {
            if (fits()) break;
            if (entry === requester) continue;
            for (const pin of [...entry.holders]) if (pin.prefetch) pin.release();
            if (!entry.pins) destroy(entry);
        }
        if (!fits()) {
            lastBudgetFailure = {...diagnostics(), requestedBytes:size, requestedEntries:count,
                requestedKind:requester?.descriptor.kind, identity:requester?.descriptor.identity};
            throw Object.assign(failure('RESOURCE_BUDGET'), {budget:lastBudgetFailure});
        }
    }
    async function issue(descriptor, service) {
        const lease = await service[descriptor.kind === 'bundle' ? 'leaseBundle' : 'leaseMedia']({packId:descriptor.ref.packId,
            ...(descriptor.kind === 'bundle' ? {bundleKey:descriptor.bundleKey} : {hash:descriptor.hash})});
        if (lease.revision !== descriptor.revision) { void service.releaseLease(lease.ticket); throw failure('ASSET_STALE'); }
        return lease;
    }
    function valid(entry) { if (disposed || entry.dead) throw failure('RESOURCE_REVOKED'); }
    async function load(entry) {
        entry.service = getService();
        const lease = await issue(entry.descriptor,entry.service);
        if (disposed || entry.dead) { void entry.service.releaseLease(lease.ticket); throw failure('RESOURCE_REVOKED'); }
        entry.lease = lease;
        const absolute = url => new URL(url, 'http://stage.invalid').href;
        const files = new Map();
        const pendingFiles = [...(entry.descriptor.kind === 'bundle' ? lease.resources : [lease.url])];
        async function readFile(url) {
            const response = await request(url, {credentials:'same-origin'});
            valid(entry);
            if (!response.ok) throw failure('RESOURCE_READ_FAILED');
            const length = Number(response.headers.get('content-length'));
            if (length) room(length,0,entry);
            const chunks = [], reader = response.body?.getReader();
            if (reader) try {
                for (;;) {
                    const {done,value} = await reader.read(); valid(entry);
                    if (done) break;
                    room(value.byteLength,0,entry); bytes += value.byteLength; entry.bytes += value.byteLength;
                    chunks.push(value);
                }
            } catch (error) {await reader.cancel().catch(() => {}); throw error;}
            finally {reader.releaseLock();}
            const blob = new Blob(chunks,{type:response.headers.get('content-type') || ''});
            files.set(absolute(url), {blob, url});
        }
        // Bound bundle I/O instead of serialising model, textures and every motion.
        // Settle all workers before cleanup so late reads cannot resurrect byte accounting.
        let readError;
        async function worker() {
            while (pendingFiles.length && !readError) {
                try {await readFile(pendingFiles.shift());}
                catch (error) {readError ||= error;}
            }
        }
        await Promise.all(Array.from({length:Math.min(6,pendingFiles.length)},worker));
        if (readError) throw readError;
        // Bundle dependencies become local resources before the model is published.
        // Rewriting all JSON references also covers deferred motions/expressions.
        const materialize = async (key, visiting = new Set()) => {
            const file = files.get(key);
            if (file.local) return file.local;
            if (visiting.has(key)) throw failure('RESOURCE_BUNDLE_CYCLE');
            const next = new Set(visiting).add(key);
            let blob = file.blob;
            if (/\.json(?:\?|$)/i.test(file.url)) {
                const rewrite = async value => {
                    if (typeof value === 'string') {
                        // Empty metadata is not a dependency: URL('', key) points back to this JSON.
                        if (!value.trim()) return value;
                        const target = absolute(new URL(value, key).href);
                        return files.has(target) ? materialize(target,next) : value;
                    }
                    if (Array.isArray(value)) return Promise.all(value.map(rewrite));
                    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k,v]) => [k,await rewrite(v)])));
                    return value;
                };
                const document = JSON.parse(await blob.text());
                file.json = document;
                // Glyph-set ids have an implicit, verified bundle path in dsh.skin/1.
                if (document.schema === 'dsh.skin/1' && document.overlay?.glyphs) document.overlay.glyphs = 'glyphs/' + document.overlay.glyphs + '.json';
                blob = new Blob([JSON.stringify(await rewrite(document))], {type:'application/json'});
                const delta = blob.size - file.blob.size;
                room(Math.max(0,delta),0,entry); bytes += delta; entry.bytes += delta; file.blob = blob;
            }
            valid(entry);
            if (entry.descriptor.kind !== 'bundle' && Object.hasOwn(entry.descriptor,'crop')) {
                const sourceUrl = urls.createObjectURL(blob);
                let source, avatar;
                try {
                    source = await decode(blob,sourceUrl,{avatar:true}); valid(entry);
                    if (source) avatar = await avatarBitmap(source,entry.descriptor.crop);
                    valid(entry);
                } finally {
                    if (source?.close) source.close();
                    else if (source && 'src' in source) source.src = '';
                    urls.revokeObjectURL(sourceUrl);
                }
                if (avatar) {
                    const decodedBytes = avatar.width * avatar.height * 4;
                    const delta = avatar.blob.size + decodedBytes - blob.size;
                    room(Math.max(0,delta),0,entry);
                    bytes += delta; entry.bytes += delta; entry.decodedBytes += decodedBytes;
                    file.blob = avatar.blob;
                    file.local = urls.createObjectURL(avatar.blob); entry.urls.push(file.local);
                    stageAvatarCrops.set(file.local,avatar.crop);
                    // private fork: retain the cropped image too, not only its Blob URL.
                    // Otherwise revisiting a sprite avatar can trigger another browser decode.
                    entry.decoded.push(await decode(avatar.blob,file.local)); valid(entry);
                    return file.local;
                }
            }
            file.local = urls.createObjectURL(blob); entry.urls.push(file.local);
            const image = await decode(blob,file.local);
            file.image = image;
            entry.decoded.push(image); valid(entry);
            // private fork: compressed image bytes do not bound retained decoded memory.
            const decodedBytes = image ? (image.naturalWidth || image.width || 0) * (image.naturalHeight || image.height || 0) * 4 : 0;
            room(decodedBytes,0,entry); bytes += decodedBytes; entry.bytes += decodedBytes; entry.decodedBytes += decodedBytes;
            return file.local;
        };
        const url = await materialize(absolute(lease.url));
        // Consumers borrow decoded bundle files under the same pin, never fetch a second copy.
        const borrowed = Object.create(null), base = new URL('.',absolute(lease.url));
        // The entry can live in a subdirectory; file keys are relative to the lease root.
        const marker = '/lease/' + encodeURIComponent(lease.ticket) + '/';
        const root = base.pathname.indexOf(marker);
        if (root >= 0) base.pathname = base.pathname.slice(0,root + marker.length);
        const freezeJson = value => {
            if (value && typeof value === 'object') {Object.values(value).forEach(freezeJson); Object.freeze(value);}
            return value;
        };
        if (entry.descriptor.kind === 'bundle') for (const [key,file] of files) {
            const path = new URL(key);
            if (path.origin !== base.origin || !path.pathname.startsWith(base.pathname)) throw failure('RESOURCE_BUNDLE_PATH');
            const relative = decodeURIComponent(path.pathname.slice(base.pathname.length));
            if (!relative || relative.split('/').some(part => part === '..' || part === '.' || part.includes('\\'))) throw failure('RESOURCE_BUNDLE_PATH');
            await materialize(key);
            borrowed[relative] = Object.freeze({url:file.local,...(file.json ? {json:freezeJson(file.json)} : {}),...(file.image ? {image:file.image} : {})});
        }
        entry.handle = Object.freeze({identity:entry.descriptor.identity, ref:entry.descriptor.ref, hash:entry.descriptor.hash, url, files:Object.freeze(borrowed)});
        if (entry.descriptor.kind === 'bundle') stageBundleFiles.set(url, entry.handle.files);
        entry.ready = true;
        return entry.handle;
    }
    async function acquire(descriptor, authority, {prefetch = false, usage = 'external', signal} = {}) {
        if (signal?.aborted) throw failure('RESOURCE_CANCELLED');
        if (disposed) throw failure('RESOURCE_DISPOSED');
        const key = keyFor(descriptor,authority);
        let entry = entries.get(key);
        if (!entry) {
            room(0,1);
            entry = {key, descriptor, pins:0, holders:new Set(), bytes:0, decodedBytes:0, urls:[], decoded:[], dead:false, ready:false};
            entries.set(key,entry);
            entry.promise = load(entry).catch(error => {destroy(entry); throw error;});
        } else entry.descriptor = descriptor;
        entry.pins++;
        let released = false;
        const holder = {prefetch, usage, release:() => { if (!released) {
            released = true; entry.pins--; entry.holders.delete(holder);
            // private fork: gallery scroll must not retain full-resolution decoded images in the warm cache.
            if (usage === 'cg-gallery' && !entry.pins && !entry.dead) destroy(entry);
        } }};
        entry.holders.add(holder);
        const release = holder.release;
        let abort;
        const cancelled = signal && new Promise((_, reject) => {
            abort = () => {release(); reject(failure('RESOURCE_CANCELLED'));};
            signal.addEventListener('abort',abort,{once:true});
        });
        try {
            const handle = await (cancelled ? Promise.race([entry.promise,cancelled]) : entry.promise);
            valid(entry); return {handle, descriptor, release};
        } catch (error) { release(); throw error; }
        finally {if (abort) signal.removeEventListener('abort',abort);}
    }
    return {
        acquire,
        // private fork: optional performance layers account for their own canvases/textures.
        reserveBytes(size) {
            if (disposed) throw failure('RESOURCE_DISPOSED');
            if (!Number.isSafeInteger(size) || size < 0) throw failure('RESOURCE_BUDGET');
            room(size,1); bytes += size;
            const allocation = Object.freeze({bytes:size,release() {if (allocations.delete(allocation)) bytes -= size;}});
            allocations.add(allocation); return allocation;
        },
        // private fork: the BGM player co-owns the loaded track it plays, so a director handoff
        // releasing the runner's pin cannot revoke a Blob URL that is still sounding.
        retain(identity, authority) {
            const entry = entries.get(keyFor({identity},authority));
            if (!entry?.ready || entry.dead) return null;
            entry.pins++;
            let released = false;
            const holder = {prefetch:false, usage:'bgm', release:() => { if (!released) { released = true; entry.pins--; entry.holders.delete(holder); } }};
            entry.holders.add(holder);
            return {handle:entry.handle, release:holder.release};
        },
        // private fork: cache probes never acquire leases or publish loading state.
        isPrepared(value, authority) {
            function ready(item) {
                if (item?.resource === true) {
                    const entry = entries.get(keyFor(item,authority));
                    return !!entry?.ready && !entry.dead;
                }
                return !item || typeof item !== 'object' || Object.values(item).every(ready);
            }
            return ready(value);
        },
        async prepare(value, authority, options = {}) {
            const pins = [], shared = new Map();
            const abort = () => pins.forEach(pin => pin.release());
            options.signal?.addEventListener('abort',abort,{once:true});
            // private fork (stage perf 2026-10): subtrees without resources are copied synchronously; awaiting every
            // JSON node of a ~0.5 MB projection chained thousands of microtasks into one long task per page.
            const holds = new WeakMap();
            const has = item => {
                if (!item || typeof item !== 'object') return false;
                if (item.resource === true) return true;
                if (!holds.has(item)) holds.set(item,(Array.isArray(item) ? item : Object.values(item)).some(has));
                return holds.get(item);
            };
            const copy = item => {
                if (Array.isArray(item)) return item.map(copy);
                if (!item || typeof item !== 'object') return item;
                const result = {}; for (const [k,v] of Object.entries(item)) result[k] = copy(v); return result;
            };
            async function walk(item) {
                if (options.signal?.aborted) throw failure('RESOURCE_CANCELLED');
                if (item?.resource === true) {
                    const key = JSON.stringify([keyFor(item,authority),item.alias]);
                    if (!shared.has(key)) shared.set(key,acquire(item,authority,options).then(pin => {pins.push(pin); return pin.handle.url;}));
                    return shared.get(key);
                }
                if (!has(item)) return copy(item);
                if (Array.isArray(item)) return Promise.all(item.map(walk));
                if (item && typeof item === 'object') return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([k,v]) => [k,await walk(v)])));
                return item;
            }
            try { return {value:await walk(value), descriptors:value, pins, release() {pins.forEach(pin => pin.release());}}; }
            catch (error) {
                // Sibling loads can still acquire pins after the first rejection.
                await Promise.allSettled(shared.values());
                pins.forEach(pin => pin.release()); throw error;
            }
            finally {options.signal?.removeEventListener('abort',abort);}
        },
        async renew(identity, authority) {
            let handle;
            for (const entry of entries.values()) {
                if (entry.descriptor.identity !== identity || JSON.parse(entry.key)[0] !== authority) continue;
                const lease = await issue(entry.descriptor,entry.service);
                if (disposed || entry.dead) { void entry.service.releaseLease(lease.ticket); throw failure('RESOURCE_REVOKED'); }
                const previous = entry.lease; entry.lease = lease;
                if (previous) void entry.service.releaseLease(previous.ticket);
                handle ||= entry.handle;
            }
            return handle;
        },
        revoke(scope, authority) {
            for (const entry of [...entries.values()]) if ((authority === undefined || JSON.parse(entry.key)[0] === authority) && stageResourceMatches(entry.descriptor,entry.pins ? {...scope,aliases:[]} : scope)) destroy(entry);
        },
        snapshot: () => ({bytes, items:entries.size + allocations.size, pins:[...entries.values()].reduce((n,e) => n + e.pins,0)}),
        debug: () => ({...diagnostics(), lastBudgetFailure, resources:[...entries.values()].map(entry => ({
            identity:entry.descriptor.identity, kind:entry.descriptor.kind, ref:entry.descriptor.ref, alias:entry.descriptor.alias,
            bytes:entry.bytes, decodedBytes:entry.decodedBytes, ready:entry.ready,
            avatar:Object.hasOwn(entry.descriptor,'crop'),
            pins:[...entry.holders].map(pin => ({prefetch:pin.prefetch,usage:pin.usage}))
        }))}),
        dispose() { disposed = true; for (const entry of [...entries.values()]) destroy(entry); for (const allocation of [...allocations]) allocation.release(); }
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageResourceOwner, stageResourceMatches, stageAvatarBitmap, stageAvatarCap, getStageAvatarCrop, getStageBundleFiles};
